import assert from 'node:assert/strict';
import { amazonProduct, type Product } from './core.js';
import type { Havefolio, Item, Snapshot } from './havefolio.js';
export interface BatchEntry {
  id: string;
  name: string;
  product?: Product;
  status: 'queued' | 'running' | 'success' | 'failed' | 'skipped';
  reason?: string;
  attempted?: boolean;
  before: Record<string, unknown>;
  originalPhotoIds: string[];
  photoIds?: string[];
}
export interface BatchState {
  version: 1;
  base: string;
  startedAt: string;
  updatedAt: string;
  entries: BatchEntry[];
}
export function productForItem(entry: Item): Product | undefined {
  const identifiers = new Set<string>();
  let product: Product | undefined;
  if (entry.purchaseUrl) {
    try {
      product = amazonProduct(entry.purchaseUrl);
      identifiers.add(product.asin);
    } catch {
      return;
    }
  }
  for (const value of [entry.specifications?.['Amazon ASIN'], entry.specifications?.ASIN])
    if (typeof value === 'string' && /^[a-z0-9]{10}$/i.test(value))
      identifiers.add(value.toUpperCase());
  for (const value of (entry.model ?? '').match(/\bB0[A-Z0-9]{8}\b/g) ?? []) identifiers.add(value);
  if (identifiers.size !== 1) return;
  return product ?? amazonProduct(`https://www.amazon.in/dp/${[...identifiers][0]!}`);
}
export async function planBatch(
  api: Pick<Havefolio, 'inventory' | 'photos'>,
  base: string,
): Promise<BatchState> {
  const entries: BatchEntry[] = [];
  for await (const current of api.inventory()) {
    const photos = await api.photos(current.id);
    const product = productForItem(current);
    entries.push({
      id: current.id,
      name: current.name,
      ...(product ? { product } : {}),
      status: photos.photos.length || !product ? 'skipped' : 'queued',
      ...(photos.photos.length
        ? { reason: 'already_has_photos' }
        : !product
          ? { reason: 'missing_unsupported_or_conflicting_amazon_source' }
          : {}),
      before: current.data,
      originalPhotoIds: photos.photos.map((p) => p.id),
    });
  }
  return {
    version: 1,
    base,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    entries,
  };
}
export function assertPreserved(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): void {
  for (const key of Object.keys(before))
    if (!['revision', 'updatedAt', 'specifications'].includes(key))
      assert.deepEqual(after[key], before[key], `Existing item field changed: ${key}`);
  const specs = before.specifications as Record<string, unknown> | null;
  for (const [key, value] of Object.entries(specs ?? {}))
    if (key !== 'Amazon title')
      assert.deepEqual(
        (after.specifications as Record<string, unknown> | null)?.[key],
        value,
        'Existing specification changed',
      );
}
export interface BatchDependencies {
  api: Pick<Havefolio, 'getItem' | 'photos'>;
  upload: (entry: BatchEntry) => Promise<void>;
  content: (entry: BatchEntry, photos: Snapshot) => Promise<void>;
  save: () => Promise<void>;
  progress: (message: string) => void;
}
export async function executeBatch(state: BatchState, deps: BatchDependencies): Promise<void> {
  for (let index = 0; index < state.entries.length; index++) {
    const entry = state.entries[index]!;
    if (entry.status === 'skipped' || entry.status === 'success') continue;
    deps.progress(
      `[${index + 1}/${state.entries.length}] ${entry.product?.asin ?? 'unknown'}: ${entry.name}`,
    );
    try {
      const latest = await deps.api.getItem(entry.id);
      assertPreserved(entry.before, latest.data);
      const now = await deps.api.photos(entry.id);
      if (now.photos.length && !entry.attempted) {
        entry.status = 'skipped';
        entry.reason = 'photos_added_since_preview';
        await deps.save();
        continue;
      }
      entry.status = 'running';
      entry.attempted = true;
      await deps.save();
      await deps.upload(entry);
      const after = await deps.api.getItem(entry.id);
      const photos = await deps.api.photos(entry.id);
      assertPreserved(entry.before, after.data);
      if (photos.photos.length < 1 || photos.photos.length > 3)
        throw new Error('Expected one to three saved imported photos.');
      await deps.content(entry, photos);
      entry.status = 'success';
      entry.photoIds = photos.photos.map((p) => p.id);
      delete entry.reason;
      await deps.save();
      deps.progress(`Saved and verified ${photos.photos.length} photo(s).`);
    } catch (error) {
      entry.status = 'failed';
      entry.reason =
        error instanceof Error
          ? (error.message.split('\n')[0] ?? 'Import failed')
          : 'Import failed';
      await deps.save();
      // Do not repeatedly hit expired auth, rate limits or an unhealthy provider.
      if (
        /HTTP (401|403|429|503)|Manual interaction required|CAPTCHA|Target item records|Existing item field changed|Existing specification changed/i.test(
          entry.reason,
        )
      )
        throw new Error('Batch paused: ' + entry.reason);
      deps.progress(`Recorded failure: ${entry.reason}`);
    }
  }
}
export function batchSummary(state: BatchState): Record<string, number> {
  const counts: Record<string, number> = {
    total: state.entries.length,
    queued: 0,
    running: 0,
    success: 0,
    failed: 0,
    skipped: 0,
  };
  for (const entry of state.entries) counts[entry.status] = (counts[entry.status] ?? 0) + 1;
  return counts;
}
