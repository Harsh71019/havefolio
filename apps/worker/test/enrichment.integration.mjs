import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { IntegrationRun, integrationConfiguration } from '@havefolio/test-utils';
import { EnrichmentRepository } from '../dist/enrichment/enrichment.repository.js';
import { EnrichmentWorkerService } from '../dist/enrichment/enrichment.service.js';
import { EnrichmentRuntime } from '../dist/enrichment/enrichment.runtime.js';

test(
  'PER-43 durable recovery, fenced claims, retries, stale revisions and deletion admission',
  { timeout: 30000 },
  async () => {
    const run = new IntegrationRun(integrationConfiguration());
    await run.start();
    const url = new URL(integrationConfiguration().runtimeUrl);
    url.searchParams.set('options', `-c search_path=${run.schema},pg_catalog`);
    const repository = new EnrichmentRepository({ DATABASE_URL: url.toString() });
    const store = repository.store;
    const events = [];
    const logger = { emit: (_level, event) => events.push(event) };
    const owner = randomUUID(),
      other = randomUUID(),
      item = randomUUID();
    const candidate = [
      {
        id: 'fixture',
        fields: [
          {
            field: 'brand',
            value: 'Synthetic',
            confidence: 0.3,
            source: { provider: 'fake', inputKind: 'name', reference: 'fixture-v1' },
          },
        ],
      },
    ];
    let calls = 0,
      mode = 'success';
    const provider = {
      id: 'fake',
      kinds: ['name'],
      suggest: async () => {
        calls++;
        if (mode === 'failure')
          throw new Error(
            'PRIVATE_PROVIDER_PAYLOAD https://private.test/receipt?credential=SECRET',
          );
        return candidate;
      },
    };
    const service = new EnrichmentWorkerService(repository, [provider], logger);
    const row = async (id) =>
      (await run.runtime.query('SELECT * FROM enrichment_work WHERE id=$1', [id])).rows[0];
    async function intent() {
      const id = randomUUID();
      await run.runtime.query(
        `INSERT INTO enrichment_work(id,owner_id,item_id,command_id,request_hash,base_revision,input,confirmed_snapshot) VALUES($1,$2,$3,$4,repeat('a',64),1,'{"kind":"name","name":"PRIVATE_INPUT"}','{"brand":null}')`,
        [id, owner, item, randomUUID()],
      );
      return id;
    }
    const ready = async (id) =>
      run.runtime.query(
        "UPDATE enrichment_work SET next_attempt_at=now()-interval '1 second' WHERE id=$1",
        [id],
      );
    try {
      await run.runtime.query('INSERT INTO users(id) VALUES($1),($2)', [owner, other]);
      await run.runtime.query(
        "INSERT INTO items(id,owner_id,name,currency,original_entry,original_source) VALUES($1,$2,'Manual','INR','{}','manual')",
        [item, owner],
      );
      const id = await intent();
      const claimed = await Promise.all([store.claim(id), store.claim(id)]);
      assert.equal(claimed.filter(Boolean).length, 1);
      const first = claimed.find(Boolean);
      await run.runtime.query(
        "UPDATE enrichment_work SET lease_until=now()-interval '1 second' WHERE id=$1",
        [id],
      );
      const second = await store.claim(id);
      assert.ok(second);
      assert.notEqual(first.token, second.token);
      await store.finish(first, 'succeeded', candidate);
      assert.equal((await row(id)).state, 'processing');
      await store.finish(second, 'succeeded', candidate);
      assert.equal((await row(id)).state, 'succeeded');
      await service.process(id);
      assert.equal(calls, 0);
      assert.equal(
        (await run.runtime.query('SELECT brand FROM items WHERE id=$1', [item])).rows[0].brand,
        null,
      );

      const unavailable = await intent();
      await new EnrichmentWorkerService(repository, [], logger).process(unavailable);
      assert.equal((await row(unavailable)).failure_code, 'PROVIDER_UNCONFIGURED');
      assert.deepEqual((await row(unavailable)).candidates, []);

      const retry = await intent();
      mode = 'failure';
      for (let i = 1; i <= 3; i++) {
        await ready(retry);
        await service.process(retry);
        assert.equal((await row(retry)).attempts, i);
        assert.equal((await row(retry)).state, i === 3 ? 'failed' : 'retry');
      }
      const before = calls;
      await service.process(retry);
      assert.equal(calls, before);
      const circuit = await intent();
      await service.process(circuit);
      assert.equal(calls, before);
      assert.equal((await row(circuit)).state, 'retry');
      assert.equal(JSON.stringify(events).includes('PRIVATE_'), false);
      assert.equal(JSON.stringify(events).includes('SECRET'), false);
      assert.equal(JSON.stringify(events).includes('https://'), false);

      const dead = await intent();
      for (let i = 0; i < 3; i++) {
        assert.ok(await store.claim(dead));
        await run.runtime.query(
          "UPDATE enrichment_work SET lease_until=now()-interval '1 second' WHERE id=$1",
          [dead],
        );
      }
      assert.equal(await store.claim(dead), null);
      assert.equal((await row(dead)).state, 'failed');

      const recovering = await intent();
      mode = 'success';
      const freshService = new EnrichmentWorkerService(repository, [provider], logger);
      let hintCalls = 0;
      const queue = {
        add: async () => {
          hintCalls++;
          throw new Error('PRIVATE_QUEUE_SECRET');
        },
      };
      const runtime = new EnrichmentRuntime(repository, freshService, logger, queue);
      await runtime.reconcile();
      assert.equal((await row(recovering)).state, 'succeeded');
      assert.ok(hintCalls > 0);

      for (let i = 0; i < 14; i++) await intent();
      assert.equal((await store.due()).length, 10);
      const stale = await intent();
      const staleClaim = await store.claim(stale);
      await run.runtime.query('UPDATE items SET revision=revision+1 WHERE id=$1', [item]);
      await store.finish(staleClaim, 'succeeded', candidate);
      assert.equal((await row(stale)).state, 'stale');
      assert.deepEqual((await row(stale)).candidates, []);
      const pending = (await store.due())[0];
      assert.equal(await store.claim(pending), null);
      assert.equal((await row(pending)).state, 'stale');
      await run.runtime.query('UPDATE users SET deletion_requested_at=now() WHERE id=$1', [owner]);
      assert.deepEqual(await store.due(), []);
      await assert.rejects(
        run.runtime.query('UPDATE enrichment_work SET updated_at=now() WHERE owner_id=$1', [owner]),
      );
      await store.finish(staleClaim, 'succeeded', candidate); // In-flight result after admission is ignored.
      assert.equal(
        (await run.runtime.query('SELECT id FROM users WHERE id=$1', [other])).rowCount,
        1,
      );
    } finally {
      await repository.onModuleDestroy();
      await run.close();
    }
  },
);
