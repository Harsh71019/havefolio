import { lookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import ipaddr from 'ipaddr.js';

export interface PublicResponse {
  url: string;
  bytes: Buffer;
  mime: string;
  status: number;
}
export interface Hop {
  status: number;
  location?: string | undefined;
  bytes: Buffer;
  mime: string;
}
export type Resolver = (hostname: string) => Promise<Array<{ address: string; family: number }>>;
export type Transport = (
  url: URL,
  address: { address: string; family: number },
  signal: AbortSignal,
  maxBytes: number,
  types: readonly string[],
) => Promise<Hop>;
const fail = (): Error => new Error('PUBLIC_FETCH_REJECTED');
export function publicAddress(address: string): boolean {
  try {
    const parsed = ipaddr.parse(address);
    // Reject mapped/translated/tunnel addresses altogether, including public mapped IPv4.
    return (
      parsed.range() === 'unicast' &&
      (parsed.kind() === 'ipv4' || parsed.match(ipaddr.parse('2000::'), 3))
    );
  } catch {
    return false;
  }
}
export function publicUrl(value: string): URL {
  if (
    value.length > 2048 ||
    Array.from(value).some((c) => c.charCodeAt(0) <= 32 || c.charCodeAt(0) === 127)
  )
    throw fail();
  const url = new URL(value);
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.port ||
    !host ||
    host.endsWith('.') ||
    (!isIP(host) &&
      (!host.includes('.') ||
        /(?:^|\.)(?:localhost|local|internal|home|lan|test|invalid|example|onion)$/.test(host))) ||
    (isIP(host) && !publicAddress(host))
  )
    throw fail();
  url.hash = '';
  return url;
}
const resolvePublic: Resolver = (hostname) => lookup(hostname, { all: true, verbatim: true });
/** Connect directly to a vetted IP; preserve Host, TLS SNI and certificate hostname verification.
 * No proxy environment, agent reuse, second DNS lookup, cookies, auth, referer or owner headers. */
export const directTransport: Transport = (url, target, signal, maxBytes, types) =>
  new Promise((resolve, reject) => {
    const req = (url.protocol === 'https:' ? httpsRequest : httpRequest)(
      {
        protocol: url.protocol,
        hostname: target.address,
        family: target.family,
        port: url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80,
        path: `${url.pathname}${url.search}`,
        servername: isIP(url.hostname.replace(/^\[|\]$/g, '')) ? undefined : url.hostname,
        method: 'GET',
        agent: false,
        signal,
        maxHeaderSize: 16384,
        headers: {
          Host: url.host,
          'User-Agent': 'Havefolio/1.0 (https://github.com/Harsh71019/havefolio)',
          Accept: types.join(', '),
          'Accept-Encoding': 'identity',
          Connection: 'close',
        },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if ([301, 302, 303, 307, 308].includes(status)) {
          res.destroy();
          resolve({ status, location: res.headers.location, bytes: Buffer.alloc(0), mime: '' });
          return;
        }
        const mime = (res.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase();
        const length = res.headers['content-length'];
        if (
          ![200, 404].includes(status) ||
          !types.includes(mime) ||
          (res.headers['content-encoding'] && res.headers['content-encoding'] !== 'identity') ||
          (length && (!/^\d+$/.test(length) || Number(length) > maxBytes))
        ) {
          res.destroy();
          reject(fail());
          return;
        }
        let size = 0;
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > maxBytes) {
            chunks.length = 0;
            res.destroy();
            reject(fail());
          } else chunks.push(chunk);
        });
        res.on('error', () => reject(fail()));
        res.on('aborted', () => reject(fail()));
        res.on('end', () => resolve({ status, bytes: Buffer.concat(chunks), mime }));
      },
    );
    req.on('error', () => reject(fail()));
    req.end();
  });
let active = 0;
export class PublicFetcher {
  constructor(
    private readonly resolver: Resolver = resolvePublic,
    private readonly transport: Transport = directTransport,
  ) {}
  async fetch(
    value: string,
    types: readonly string[],
    maxBytes: number,
    parent: AbortSignal,
    allowNotFound = false,
  ): Promise<PublicResponse> {
    if (active >= 2) throw fail();
    active++;
    const signal = AbortSignal.any([parent, AbortSignal.timeout(4000)]);
    // DNS cannot be cancelled, so release its slot only once the actual operation settles.
    const operation = (async () => {
      let url = publicUrl(value);
      for (let redirects = 0; redirects <= 3; redirects++) {
        signal.throwIfAborted();
        const host = url.hostname.replace(/^\[|\]$/g, '');
        const answers = isIP(host)
          ? [{ address: host, family: isIP(host) }]
          : await this.resolver(host);
        signal.throwIfAborted();
        if (
          !answers.length ||
          answers.length > 32 ||
          answers.some((a) => !publicAddress(a.address) || isIP(a.address) !== a.family)
        )
          throw fail();
        const response = await this.transport(url, answers[0]!, signal, maxBytes, types);
        signal.throwIfAborted();
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          if (!response.location || redirects === 3) throw fail();
          const next = publicUrl(new URL(response.location, url).href);
          if (url.protocol === 'https:' && next.protocol !== 'https:') throw fail();
          url = next;
          continue;
        }
        if (
          (response.status !== 200 && !(allowNotFound && response.status === 404)) ||
          response.bytes.length > maxBytes ||
          !types.includes(response.mime)
        )
          throw fail();
        return {
          url: url.href,
          bytes: response.bytes,
          mime: response.mime,
          status: response.status,
        };
      }
      throw fail();
    })().finally(() => {
      active--;
    });
    let abort: () => void = () => undefined;
    try {
      return await Promise.race([
        operation,
        new Promise<never>((_resolve, reject) => {
          abort = () => reject(fail());
          signal.addEventListener('abort', abort, { once: true });
          if (signal.aborted) abort();
        }),
      ]);
    } catch {
      throw fail();
    } finally {
      signal.removeEventListener('abort', abort);
    }
  }
}
