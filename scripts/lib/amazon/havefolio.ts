import { randomUUID, createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { request, type APIRequestContext } from 'playwright';
import { amazonProduct, NetworkError, retry, type Product } from './core.js';

function record(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new Error('Unexpected Havefolio API response.');
  return input as Record<string, unknown>;
}
function id(input: unknown): string {
  if (typeof input !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(input))
    throw new Error('Invalid Havefolio item/photo UUID.');
  return input;
}
export interface Item {
  id: string;
  revision: number;
  name: string;
  model: string | null;
  purchaseUrl: string | null;
  specifications: Record<string, unknown> | null;
}
export function item(input: unknown): Item {
  const r = record(input);
  if (typeof r.revision !== 'number' || typeof r.name !== 'string')
    throw new Error('Invalid item response.');
  return {
    id: id(r.id),
    revision: r.revision,
    name: r.name,
    model: typeof r.model === 'string' ? r.model : null,
    purchaseUrl: typeof r.purchaseUrl === 'string' ? r.purchaseUrl : null,
    specifications:
      r.specifications === null || r.specifications === undefined ? null : record(r.specifications),
  };
}
/** Only explicit identifiers; product-title similarity cannot prove purchase identity. */
function knownAsins(entry: Item): string[] {
  const values: string[] = [];
  try {
    if (entry.purchaseUrl) values.push(amazonProduct(entry.purchaseUrl).asin);
  } catch {
    /* Other merchants. */
  }
  for (const candidate of [entry.specifications?.['Amazon ASIN'], entry.specifications?.ASIN])
    if (typeof candidate === 'string' && /^[A-Z0-9]{10}$/i.test(candidate))
      values.push(candidate.toUpperCase());
  for (const candidate of (entry.model ?? '').match(/\b[A-Z0-9]{10}\b/g) ?? [])
    if (candidate.startsWith('B0')) values.push(candidate);
  return [...new Set(values)];
}
export interface Snapshot {
  revision: number;
  photos: { id: string }[];
}
function snapshot(value: unknown): Snapshot {
  const r = record(value);
  if (typeof r.revision !== 'number' || !Array.isArray(r.photos))
    throw new Error('Invalid photo snapshot.');
  return { revision: r.revision, photos: r.photos.map((p: unknown) => ({ id: id(record(p).id) })) };
}
export class Havefolio {
  private constructor(
    private readonly client: APIRequestContext,
    readonly base: string,
  ) {}
  static async connect(): Promise<Havefolio> {
    const url = new URL(process.env.HAVEFOLIO_API_URL ?? '');
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !['https:', 'http:'].includes(url.protocol)
    )
      throw new Error('Invalid HAVEFOLIO_API_URL.');
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.protocol === 'http:' && !local && process.env.HAVEFOLIO_ALLOW_HTTP !== 'true')
      throw new Error('Use HTTPS, or explicitly enable HAVEFOLIO_ALLOW_HTTP for a trusted LAN.');
    const token = process.env.HAVEFOLIO_TOKEN;
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token))
      throw new Error('HAVEFOLIO_TOKEN must be your current session cookie value.');
    const cookie =
      process.env.HAVEFOLIO_COOKIE_NAME ||
      (url.protocol === 'https:'
        ? '__Host-havefolio_session'
        : local
          ? 'havefolio_session'
          : 'havefolio_lan_session');
    if (
      !['__Host-havefolio_session', 'havefolio_session', 'havefolio_lan_session'].includes(cookie)
    )
      throw new Error('Invalid HAVEFOLIO_COOKIE_NAME.');
    const base = url.origin + (url.pathname.replace(/\/$/, '') || '/api/v1');
    if (!base.endsWith('/api/v1'))
      throw new Error('HAVEFOLIO_API_URL must be the app origin or end with /api/v1.');
    const client = await request.newContext({
      extraHTTPHeaders: { Cookie: `${cookie}=${token}`, Origin: url.origin },
      timeout: 30000,
      maxRedirects: 0,
    });
    return new Havefolio(client, base);
  }
  async close(): Promise<void> {
    await this.client.dispose();
  }
  async call(
    path: string,
    options: Parameters<APIRequestContext['fetch']>[1] = {},
  ): Promise<unknown> {
    return retry(async () => {
      let response;
      try {
        response = await this.client.fetch(`${this.base}/${path}`, { ...options, maxRedirects: 0 });
      } catch {
        throw new NetworkError('Havefolio network request failed; credentials have been redacted.');
      }
      try {
        if ([408, 429, 500, 502, 503, 504].includes(response.status()))
          throw new NetworkError(`Havefolio HTTP ${response.status()}; retryable request failed.`);
        if (!response.ok())
          throw new Error(
            `Havefolio HTTP ${response.status()} at ${path.split('?')[0]}. Check session, permissions, revision and upload limits.`,
          );
        const value: unknown = await response.json();
        return value;
      } finally {
        await response.dispose();
      }
    });
  }
  async getItem(value: string): Promise<Item> {
    return item(await this.call(`items/${id(value)}`));
  }
  async find(product: Product): Promise<Item[]> {
    const matches: Item[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 100; page++) {
      const query = new URLSearchParams({ limit: '100', sort: 'id' });
      if (cursor) query.set('cursor', cursor);
      const result = record(await this.call(`items?${query}`));
      if (!Array.isArray(result.items)) throw new Error('Invalid inventory page.');
      // List entries intentionally omit purchaseUrl/specifications; fetch owner-authorized details.
      for (const summary of result.items) {
        const entry = await this.getItem(id(record(summary).id));
        if (knownAsins(entry).includes(product.asin)) matches.push(entry);
      }
      if (!result.hasMore) return matches;
      if (typeof result.nextCursor !== 'string' || result.nextCursor === cursor)
        throw new Error('Invalid inventory cursor.');
      cursor = result.nextCursor;
    }
    throw new Error('Inventory exceeds scan bound; use --item.');
  }
  async photos(itemId: string): Promise<Snapshot> {
    return snapshot(await this.call(`items/${id(itemId)}/photos`));
  }
}
interface Upload {
  uploadId: string;
  hash: string;
  photoId?: string;
  attempted?: boolean;
}
interface State {
  version: 1;
  base: string;
  asin: string;
  requestedItem: string | null;
  commandId: string;
  itemId?: string;
  createPayload?: Record<string, unknown>;
  uploads: Upload[];
}
export async function uploadImages(
  api: Havefolio,
  product: Product,
  title: string,
  files: string[],
  requestedItem?: string,
  stateDirectory = join(homedir(), '.havefolio-scraper-state'),
): Promise<string> {
  const directory = stateDirectory;
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const key = createHash('sha256')
    .update(`${api.base}\0${product.asin}\0${requestedItem ?? ''}`)
    .digest('hex');
  let path = join(directory, `${key}.json`);
  const lockPath = `${path}.lock`;
  // The CLI also locks the shared Chrome profile, serializing all URLs on this machine.
  await mkdir(lockPath, { mode: 0o700 }).catch(() => {
    throw new Error(
      `Import is already active (or interrupted); inspect ${lockPath} before removing its lock.`,
    );
  });
  const { rm } = await import('node:fs/promises');
  try {
    let state: State;
    try {
      state = JSON.parse(await readFile(path, 'utf8')) as State;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        throw new Error('Import state is unreadable; inspect it before retrying.');
      state = {
        version: 1,
        base: api.base,
        asin: product.asin,
        requestedItem: requestedItem ?? null,
        commandId: randomUUID(),
        uploads: [],
      };
    }
    if (
      state.version !== 1 ||
      state.base !== api.base ||
      state.asin !== product.asin ||
      (requestedItem !== undefined &&
        state.itemId !== undefined &&
        state.itemId !== requestedItem) ||
      !Array.isArray(state.uploads)
    )
      throw new Error('Import state does not match target.');
    const save = async (): Promise<void> => {
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      await writeFile(`${path}.new`, JSON.stringify(state, null, 2), { mode: 0o600 });
      await rename(`${path}.new`, path);
    };
    let target: Item;
    if (state.itemId || requestedItem) target = await api.getItem(state.itemId ?? requestedItem!);
    else {
      const matches = await api.find(product);
      if (matches.length > 1)
        throw new Error('Multiple existing purchases match this ASIN. Supply --item.');
      if (matches[0]) target = matches[0];
      else {
        // Persist the exact command and payload before the first POST. Retries must be identical.
        state.createPayload ??= {
          commandId: state.commandId,
          name: title.slice(0, 300),
          currency: process.env.HAVEFOLIO_CURRENCY || 'INR',
          ownershipStatus: 'owned',
          purchaseUrl: product.url,
          pricePaidMinor: null,
          purchaseDate: { precision: 'unknown' },
          acquisitionType: 'unknown',
          condition: 'unknown',
          useFrequency: 'unknown',
          specifications: { 'Amazon ASIN': product.asin, 'Amazon title': title },
        };
        await save();
        target = item(await api.call('items', { method: 'POST', data: state.createPayload }));
      }
    }
    // Explicit target mismatch must never attach photos of a different known product.
    if (knownAsins(target).some((asin) => asin !== product.asin))
      throw new Error('Target item records a different or conflicting ASIN.');
    state.itemId = target.id;
    await save();
    // Explicit --item and automatic matching must share the same upload ledger.
    const canonicalKey = createHash('sha256')
      .update(`${api.base}\0${product.asin}\0${target.id}`)
      .digest('hex');
    const canonicalPath = join(directory, `${canonicalKey}.json`);
    if (canonicalPath !== path) {
      try {
        const stored = JSON.parse(await readFile(canonicalPath, 'utf8')) as State;
        if (
          stored.version !== 1 ||
          stored.base !== api.base ||
          stored.asin !== product.asin ||
          stored.itemId !== target.id ||
          !Array.isArray(stored.uploads)
        )
          throw new Error('Canonical import state does not match target.');
        state = stored;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      path = canonicalPath;
      await save();
    }
    const specs = { ...target.specifications, 'Amazon ASIN': product.asin, 'Amazon title': title };
    if (JSON.stringify(specs) !== JSON.stringify(target.specifications))
      await api.call(`items/${target.id}`, {
        method: 'PATCH',
        data: { revision: target.revision, specifications: specs },
      });
    const buffers = await Promise.all(files.map((file) => readFile(file)));
    const hashes = buffers.map((bytes) => createHash('sha256').update(bytes).digest('hex'));
    if (
      state.uploads.length &&
      (state.uploads.length !== hashes.length || state.uploads.some((u, i) => u.hash !== hashes[i]))
    )
      throw new Error(
        'Images changed since the previous attempt. Inspect saved state before starting a different upload.',
      );
    if (!state.uploads.length) {
      state.uploads = hashes.map((hash) => ({ hash, uploadId: randomUUID() }));
      await save();
    }
    const initial = await api.photos(target.id);
    const knownPhotoIds = state.uploads.flatMap((u) => (u.photoId ? [u.photoId] : []));
    if (knownPhotoIds.some((p) => !initial.photos.some((x) => x.id === p)))
      throw new Error('A previously imported photo was removed. Inspect state before reimporting.');
    const remaining = state.uploads.filter((u) => !u.photoId && !u.attempted).length;
    if (initial.photos.length + remaining > 8)
      throw new Error('Not enough photo slots (8 per item); no photos removed.');
    for (let index = 0; index < state.uploads.length; index++) {
      const entry = state.uploads[index]!;
      if (entry.photoId) continue;
      entry.attempted = true;
      await save();
      const result = record(
        await api.call(`items/${target.id}/photos`, {
          method: 'POST',
          headers: { 'Upload-Id': entry.uploadId },
          multipart: {
            photos: {
              name: `${product.asin}-${index + 1}.jpg`,
              mimeType: 'image/jpeg',
              buffer: buffers[index]!,
            },
          },
        }),
      );
      if (!Array.isArray(result.results))
        throw new Error('Invalid upload response; state retained.');
      const row = record(result.results[0]);
      if (row.error || !row.photo)
        throw new Error(
          'Photo not ready or rejected. State/Upload-Id retained; rerun after reconciliation.',
        );
      entry.photoId = id(record(row.photo).id);
      await save();
    }
    // Keep existing cover/order, with the imported main image first within the new group.
    const imported = state.uploads.map((u) => u.photoId!);
    const current = await api.photos(target.id);
    if (imported.some((p) => !current.photos.some((x) => x.id === p)))
      throw new Error('Persisted photo verification failed.');
    const order = [
      ...current.photos.filter((p) => !imported.includes(p.id)).map((p) => p.id),
      ...imported,
    ];
    if (order.some((p, i) => current.photos[i]?.id !== p))
      await api.call(`items/${target.id}/photos/order`, {
        method: 'PATCH',
        data: { revision: current.revision, photoIds: order },
      });
    const confirmed = await api.photos(target.id);
    if (JSON.stringify(confirmed.photos.map((p) => p.id)) !== JSON.stringify(order))
      throw new Error('Photo ordering verification failed.');
    console.log(
      `Verified ${imported.length} imported photos on item ${target.id}. Existing cover/photos preserved. State: ${path}`,
    );
    return target.id;
  } finally {
    await rm(lockPath, { recursive: true });
  }
}
