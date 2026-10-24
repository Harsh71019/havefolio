import sharp from 'sharp';

export interface Product {
  asin: string;
  url: string;
}
const amazonDomains = new Set([
  'com',
  'in',
  'co.uk',
  'com.au',
  'ca',
  'de',
  'fr',
  'it',
  'es',
  'co.jp',
  'com.br',
  'com.mx',
  'nl',
  'se',
  'pl',
  'com.be',
  'ie',
  'sg',
  'ae',
  'sa',
  'com.tr',
  'eg',
  'co.za',
]);
export function amazonProduct(input: string): Product {
  const url = new URL(input);
  const domain = url.hostname.replace(/^(?:www\.|smile\.|m\.)/, '').replace(/^amazon\./, '');
  if (
    !/^https?:$/.test(url.protocol) ||
    url.username ||
    url.password ||
    url.port ||
    !amazonDomains.has(domain) ||
    !/^(?:(?:www|smile|m)\.)?amazon\./.test(url.hostname)
  )
    throw new Error('Provide a full Amazon product URL on a supported Amazon domain.');
  const asin = /\/(?:dp|gp\/product|gp\/aw\/d)\/([A-Z0-9]{10})(?:\/|$)/i
    .exec(url.pathname)?.[1]
    ?.toUpperCase();
  if (!asin)
    throw new Error('Amazon URL must contain a ten-character ASIN in /dp/ or /gp/product/.');
  return { asin, url: `https://www.amazon.${domain}/dp/${asin}` };
}
export function imageId(input: string): string | undefined {
  try {
    const url = new URL(input);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.port ||
      !/(?:^|\.)(?:media-amazon\.com|ssl-images-amazon\.com|images\.amazon\.com)$/.test(
        url.hostname,
      )
    )
      return;
    if (
      /video|360|spin|sprite|placeholder|grey|gray|transparent|loading|play-button/i.test(
        url.pathname,
      )
    )
      return;
    return /\/I\/([^/]+?)(?:\._|\.(?:jpg|jpeg|png|webp)$)/i.exec(url.pathname)?.[1];
  } catch {
    return;
  }
}
export function fullSize(input: string): string {
  const url = new URL(input);
  url.pathname = url.pathname.replace(/\._[^/]+(?=\.(?:jpg|jpeg|png|webp)$)/i, '');
  url.search = '';
  url.hash = '';
  return url.href;
}
/** Decode the JSON string passed to Amazon's parseJSON wrapper without eval. */
function quotedJson(input: string): string | undefined {
  const quote = input[0];
  if (quote !== "'" && quote !== '"') return;
  let output = '';
  for (let i = 1; i < input.length; i++) {
    const c = input[i]!;
    if (c === quote) return output;
    if (c !== '\\') {
      output += c;
      continue;
    }
    const escaped = input[++i];
    const escapes: Record<string, string> = {
      n: '\n',
      r: '\r',
      t: '\t',
      b: '\b',
      f: '\f',
      v: '\v',
      "'": "'",
      '"': '"',
      '\\': '\\',
      '/': '/',
    };
    if (escaped && escaped in escapes) output += escapes[escaped];
    else if (escaped === 'u' || escaped === 'x') {
      const count = escaped === 'u' ? 4 : 2,
        hex = input.slice(i + 1, i + 1 + count);
      if (!new RegExp(`^[0-9a-f]{${count}}$`, 'i').test(hex)) return;
      output += String.fromCharCode(parseInt(hex, 16));
      i += count;
    } else return;
  }
  return;
}
/** Find a JSON array without evaluating JavaScript from the remote page. */
export function initialImages(script: string): string[] {
  const start = /["']colorImages["']\s*:\s*\{\s*["']initial["']\s*:\s*\[/.exec(script);
  if (!start) {
    const wrapped =
      /["']colorImages["']\s*:\s*\{\s*["']initial["']\s*:\s*(?:A\.\$\.parseJSON|JSON\.parse|jQuery\.parseJSON)\(\s*/.exec(
        script,
      );
    if (!wrapped) return [];
    const decoded = quotedJson(script.slice(wrapped.index + wrapped[0].length));
    if (!decoded || !decoded.trimStart().startsWith('[')) return [];
    return initialImages(`"colorImages":{"initial":${decoded}}`);
  }
  const offset = start.index + start[0].length - 1;
  let depth = 0,
    quote = '',
    escaped = false;
  for (let i = offset; i < script.length; i++) {
    const c = script[i]!;
    if (quote) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === quote) quote = '';
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      continue;
    }
    if (c === '[') depth++;
    if (c === ']' && --depth === 0) {
      try {
        const rows: unknown = JSON.parse(script.slice(offset, i + 1));
        if (!Array.isArray(rows)) return [];
        return rows.flatMap((row: unknown) => {
          if (!row || typeof row !== 'object') return [];
          const r = row as Record<string, unknown>;
          if (r.video || r.isVideo || r.is360 || r.mediaType === 'VIDEO' || r.mediaType === '360')
            return [];
          return typeof r.hiRes === 'string' && r.hiRes
            ? [r.hiRes]
            : typeof r.large === 'string'
              ? [r.large]
              : [];
        });
      } catch {
        return [];
      }
    }
  }
  return [];
}
export interface ImageSources {
  scripts: string[];
  hires: string | null;
  dynamic: string | null;
  thumbnails: string[];
}
export function imageCandidates(source: ImageSources): string[] {
  let dynamic: string[] = [];
  try {
    const value: unknown = JSON.parse(source.dynamic ?? '{}');
    if (value && typeof value === 'object' && !Array.isArray(value))
      dynamic = Object.entries(value)
        .filter(
          (entry): entry is [string, number[]] =>
            Array.isArray(entry[1]) &&
            entry[1].length === 2 &&
            entry[1].every((n: unknown) => typeof n === 'number' && Number.isFinite(n)),
        )
        .sort((a, b) => b[1][0]! * b[1][1]! - a[1][0]! * a[1][1]!)
        .map(([url]) => url);
  } catch {
    /* Malformed optional Amazon metadata; use other sources. */
  }
  const initial = source.scripts.flatMap(initialImages);
  const main = source.hires || dynamic[0];
  const values = [
    ...initial,
    ...(source.hires ? [source.hires] : []),
    ...dynamic,
    ...source.thumbnails.filter(imageId).map(fullSize),
  ];
  const unique = new Map<string, string>();
  for (const url of values) {
    const id = imageId(url);
    if (id && !unique.has(id)) unique.set(id, url);
  }
  const mainId = main && imageId(main);
  return [
    ...(mainId && unique.has(mainId) ? [unique.get(mainId)!] : []),
    ...[...unique].filter(([id]) => id !== mainId).map(([, url]) => url),
  ].slice(0, 24);
}
export class NetworkError extends Error {}
export async function retry<T>(
  operation: () => Promise<T>,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (!(error instanceof NetworkError) || attempt === 2) throw error;
      await sleep(1000 * 2 ** attempt);
    }
  }
}
export async function jpegImage(bytes: Buffer, mime: string): Promise<Buffer> {
  if (
    !mime.toLowerCase().startsWith('image/') ||
    bytes.length <= 5 * 1024 ||
    bytes.length > 20 * 1024 * 1024
  )
    throw new Error('Image MIME/size rejected (must be image/*, >5 KiB, <=20 MiB downloaded).');
  const options = { limitInputPixels: 24_000_000, failOn: 'warning' as const };
  const meta = await sharp(bytes, options).metadata();
  if (
    !meta.width ||
    !meta.height ||
    (meta.pages ?? 1) !== 1 ||
    Math.max(meta.width, meta.height) < 500 ||
    Math.max(meta.width, meta.height) > 8192
  )
    throw new Error('Image dimensions/animation rejected.');
  const output = await sharp(bytes, options)
    .rotate()
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: 90 })
    .toBuffer();
  if (output.length > 10 * 1024 * 1024)
    throw new Error('Converted JPEG exceeds Havefolio 10 MiB limit.');
  return output;
}
