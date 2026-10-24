import { test } from 'node:test';
import assert from 'node:assert/strict';
import { item, type Item } from './havefolio.js';
import {
  productForItem,
  planBatch,
  executeBatch,
  assertPreserved,
  batchSummary,
  type BatchState,
  type BatchEntry,
} from './batch.js';
const id = '12345678-1234-4234-8234-123456789012';
const make = (overrides: Record<string, unknown> = {}): Item =>
  item({
    id,
    revision: 1,
    name: 'Adapter',
    model: null,
    purchaseUrl: 'https://www.amazon.in/dp/B07V78GMXS?ref=tracking',
    specifications: { 'User note': 'keep' },
    pricePaidMinor: '74400',
    currency: 'INR',
    ...overrides,
  });
const entry = (): BatchEntry => {
  const i = make();
  return {
    id: i.id,
    name: i.name,
    product: productForItem(i)!,
    status: 'queued',
    before: i.data,
    originalPhotoIds: [],
  };
};
const state = (entries: BatchEntry[]): BatchState => ({
  version: 1,
  base: 'https://app.test/api/v1',
  startedAt: 'now',
  updatedAt: 'now',
  entries,
});
void test('batch only uses explicit non-conflicting Amazon identifiers', () => {
  assert.equal(productForItem(make())?.url, 'https://www.amazon.in/dp/B07V78GMXS');
  assert.equal(
    productForItem(make({ purchaseUrl: null, specifications: { 'Amazon ASIN': 'B07V78GMXS' } }))
      ?.asin,
    'B07V78GMXS',
  );
  assert.equal(
    productForItem(make({ purchaseUrl: null, model: 'Adapter | B07V78GMXS' }))?.asin,
    'B07V78GMXS',
  );
  for (const overrides of [
    { purchaseUrl: null },
    { purchaseUrl: 'https://example.test/dp/B07V78GMXS' },
    { specifications: { 'Amazon ASIN': 'B00DIFFER1' } },
    { purchaseUrl: 'https://amazon.in.evil.test/dp/B07V78GMXS' },
  ])
    assert.equal(productForItem(make(overrides)), undefined);
});
void test('read-only plan classifies all items and preserves original photo IDs', async () => {
  let reads = 0;
  const noSource = make({ id: '12345678-1234-4234-8234-123456789013', purchaseUrl: null });
  const hasPhoto = make({ id: '12345678-1234-4234-8234-123456789014' });
  const plan = await planBatch(
    {
      async *inventory() {
        yield await Promise.resolve(make());
        yield noSource;
        yield hasPhoto;
      },
      photos: (itemId) => {
        reads++;
        return Promise.resolve({
          revision: 1,
          photos: itemId === hasPhoto.id ? [{ id: 'photo' }] : [],
        });
      },
    },
    'https://app.test/api/v1',
  );
  assert.equal(reads, 3);
  assert.deepEqual(batchSummary(plan), {
    total: 3,
    queued: 1,
    running: 0,
    success: 0,
    failed: 0,
    skipped: 2,
  });
  assert.deepEqual(plan.entries[2]?.originalPhotoIds, ['photo']);
});
void test('batch rechecks media immediately before import and skips newly added owner photos', async () => {
  const plan = state([entry()]);
  let uploads = 0,
    saves = 0;
  await executeBatch(plan, {
    api: {
      getItem: () => Promise.resolve(make()),
      photos: () => Promise.resolve({ revision: 1, photos: [{ id: 'owner-photo' }] }),
    },
    upload: () => {
      uploads++;
      return Promise.resolve();
    },
    content: () => Promise.resolve(),
    save: () => {
      saves++;
      return Promise.resolve();
    },
    progress: () => {},
  });
  assert.equal(uploads, 0);
  assert.equal(saves, 1);
  assert.equal(plan.entries[0]?.reason, 'photos_added_since_preview');
});
void test('success is persisted and repeated execution does not upload again', async () => {
  const plan = state([entry()]);
  let uploads = 0,
    content = 0,
    saves = 0;
  const deps = {
    api: {
      getItem: () => Promise.resolve(make()),
      photos: () => Promise.resolve({ revision: 1, photos: uploads ? [{ id: 'photo' }] : [] }),
    },
    upload: () => {
      uploads++;
      return Promise.resolve();
    },
    content: () => {
      content++;
      return Promise.resolve();
    },
    save: () => {
      saves++;
      return Promise.resolve();
    },
    progress: () => {},
  };
  await executeBatch(plan, deps);
  await executeBatch(plan, deps);
  assert.equal(uploads, 1);
  assert.equal(content, 1);
  assert.equal(saves, 2);
  assert.equal(plan.entries[0]?.status, 'success');
  assert.deepEqual(plan.entries[0]?.photoIds, ['photo']);
});
void test('item failure checkpoints and continues; expired auth checkpoints and pauses', async () => {
  const a = entry(),
    b = { ...entry(), id: '12345678-1234-4234-8234-123456789013' };
  const plan = state([a, b]);
  let saves = 0;
  const deps = {
    api: {
      getItem: () => Promise.resolve(make()),
      photos: () => Promise.resolve({ revision: 1, photos: [] }),
    },
    upload: () => Promise.reject(new Error('Product unavailable')),
    content: () => Promise.resolve(),
    save: () => {
      saves++;
      return Promise.resolve();
    },
    progress: () => {},
  };
  await executeBatch(plan, deps);
  assert.equal(a.status, 'failed');
  assert.equal(b.status, 'failed');
  assert.equal(saves, 4);
  a.status = 'queued';
  b.status = 'queued';
  deps.upload = () => Promise.reject(new Error('Havefolio HTTP 401'));
  await assert.rejects(executeBatch(plan, deps), /Batch paused/);
  assert.equal(a.status, 'failed');
  assert.equal(b.status, 'queued');
});
void test('purchase data and user specifications cannot change unnoticed', () => {
  const before = make().data;
  assert.doesNotThrow(() =>
    assertPreserved(before, {
      ...before,
      revision: 2,
      updatedAt: 'now',
      specifications: { 'User note': 'keep', 'Amazon title': 'source' },
    }),
  );
  assert.throws(() => assertPreserved(before, { ...before, pricePaidMinor: '1' }));
  assert.throws(() => assertPreserved(before, { ...before, specifications: {} }));
});
