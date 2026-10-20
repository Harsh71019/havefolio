import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { IntegrationRun, integrationConfiguration } from '@havefolio/test-utils';
import { EnrichmentRepository } from '../dist/enrichment/enrichment.repository.js';
import { EnrichmentWorkerService } from '../dist/enrichment/enrichment.service.js';
import { LocalOcrProvider } from '../dist/enrichment/ocr/local-ocr.provider.js';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'ocr');

test(
  'PER-45 owner-scoped local OCR through durable work: suggestions only, nothing applied, deleted media never read',
  { timeout: 120000 },
  async () => {
    const run = new IntegrationRun(integrationConfiguration());
    await run.start();
    const url = new URL(integrationConfiguration().runtimeUrl);
    url.searchParams.set('options', `-c search_path=${run.schema},pg_catalog`);
    const repository = new EnrichmentRepository({ DATABASE_URL: url.toString() });
    const events = [];
    const reads = [];
    const bytes = await readFile(join(fixtures, 'receipt-single-total.webp'));
    // Synthetic stand-in for private storage: it serves only the exact key it was given.
    const reader = {
      read: async (key, format, size) => {
        reads.push(key);
        assert.equal(format, 'webp');
        assert.equal(size, bytes.length);
        return Buffer.from(bytes);
      },
    };
    const service = new EnrichmentWorkerService(
      repository,
      [new LocalOcrProvider(repository.store, reader, undefined, () => '2026-10-20')],
      { emit: (_level, event) => events.push(event) },
    );
    const owner = randomUUID(),
      other = randomUUID(),
      item = randomUUID(),
      otherItem = randomUUID();
    const row = async (id) =>
      (await run.runtime.query('SELECT * FROM enrichment_work WHERE id=$1', [id])).rows[0];
    const attachment = async (ownerId, itemId, kind = 'receipt') => {
      const id = randomUUID();
      await run.runtime.query(
        `INSERT INTO media_attachments(id,owner_id,item_id,kind,variant,state,object_key,resource_type,format,provider_asset_id,provider_version,original_filename,mime_type,byte_size,checksum) VALUES($1,$2,$3,$4,'original','ready',$5,'image','webp',$6,1,'sanitized.webp','image/webp',$7,$8)`,
        [
          id,
          ownerId,
          itemId,
          kind,
          `havefolio/test/${id}`,
          randomUUID(),
          bytes.length,
          createHash('sha256').update(bytes).digest('hex'),
        ],
      );
      return id;
    };
    const intent = async (attachmentId, kind = 'receipt', itemId = item, ownerId = owner) => {
      const id = randomUUID();
      await run.runtime.query(
        `INSERT INTO enrichment_work(id,owner_id,item_id,command_id,request_hash,base_revision,input,confirmed_snapshot) VALUES($1,$2,$3,$4,repeat('a',64),1,$5,'{"name":"Manual"}')`,
        [id, ownerId, itemId, randomUUID(), JSON.stringify({ kind, attachmentId })],
      );
      return id;
    };
    try {
      await run.runtime.query('INSERT INTO users(id) VALUES($1),($2)', [owner, other]);
      await run.runtime.query(
        "INSERT INTO items(id,owner_id,name,currency,original_entry,original_source) VALUES($1,$2,'Manual','INR','{}','manual'),($3,$4,'Other','INR','{}','manual')",
        [item, owner, otherItem, other],
      );
      const receipt = await attachment(owner, item);
      const work = await intent(receipt);
      await service.process(work);
      const done = await row(work);
      assert.equal(done.state, 'succeeded');
      const fields = Object.fromEntries(done.candidates[0].fields.map((f) => [f.field, f.value]));
      assert.deepEqual(fields, {
        name: 'Ceramic Teapot',
        pricePaid: 'INR 151000',
        purchaseDate: '2026-09-03',
      });
      assert.deepEqual(reads, [`havefolio/test/${receipt}`]);
      // The worker never applies suggestions to the item.
      const itemRow = (await run.runtime.query('SELECT * FROM items WHERE id=$1', [item])).rows[0];
      assert.equal(itemRow.name, 'Manual');
      assert.equal(itemRow.price_paid_minor, null);
      assert.equal(itemRow.revision, 1);

      // Another owner's attachment ID inside this owner's work resolves to nothing and is never read.
      const foreign = await attachment(other, otherItem);
      const crossed = await intent(foreign);
      await service.process(crossed);
      assert.equal((await row(crossed)).state, 'stale');
      // A photo cannot be read as receipt evidence.
      const photo = await attachment(owner, item, 'photo');
      const wrongKind = await intent(photo);
      await service.process(wrongKind);
      assert.equal((await row(wrongKind)).state, 'stale');
      // Media deleted after the request: the work becomes stale before any read.
      const deleted = await attachment(owner, item);
      const late = await intent(deleted);
      await run.runtime.query("UPDATE media_attachments SET state='deleting' WHERE id=$1", [
        deleted,
      ]);
      await service.process(late);
      assert.equal((await row(late)).state, 'stale');
      assert.deepEqual(reads, [`havefolio/test/${receipt}`]);
      assert.equal(JSON.stringify(events).includes('havefolio/test'), false);
      // The adapter's own lookup repeats the scope check (owner, item, kind, ready image).
      const store = repository.store;
      assert.ok(await store.readyImage(owner, item, receipt, 'receipt'));
      assert.equal(await store.readyImage(owner, item, foreign, 'receipt'), null);
      assert.equal(await store.readyImage(other, item, receipt, 'receipt'), null);
      assert.equal(await store.readyImage(owner, item, receipt, 'photo'), null);
      assert.equal(await store.readyImage(owner, item, deleted, 'receipt'), null);
      await run.runtime.query('UPDATE users SET deletion_requested_at=now() WHERE id=$1', [owner]);
      assert.equal(await store.readyImage(owner, item, receipt, 'receipt'), null);
    } finally {
      await repository.onModuleDestroy();
      await run.close();
    }
  },
);
