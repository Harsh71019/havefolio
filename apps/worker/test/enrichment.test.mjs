import assert from 'node:assert/strict';
import test from 'node:test';
import { EnrichmentWorkerService } from '../dist/enrichment/enrichment.service.js';
import { EnrichmentRuntime } from '../dist/enrichment/enrichment.runtime.js';
import { EnrichmentProcessor } from '../dist/enrichment/enrichment.processor.js';

test('PER-43 standby worker, bounded outage hints, duplicate delivery and safe telemetry', async () => {
  const events = [];
  const logger = { emit: (_level, e) => events.push(e) };
  const standby = new EnrichmentWorkerService({}, [], logger);
  await standby.process('irrelevant');
  let claims = 0,
    calls = 0,
    finish = 0,
    resolve;
  const store = {
    claim: async () => {
      claims++;
      return { input: { kind: 'name', name: 'PRIVATE' } };
    },
    finish: async () => {
      finish++;
    },
    due: async () => ['id', 'second'],
  };
  const service = new EnrichmentWorkerService(
    { store },
    [
      {
        id: 'fake',
        kinds: ['name'],
        suggest: () => {
          calls++;
          return new Promise((r) => (resolve = r));
        },
      },
    ],
    logger,
  );
  const processing = service.process('id');
  await new Promise((r) => setImmediate(r));
  await service.process('id');
  assert.equal(claims, 1);
  assert.equal(calls, 1);
  resolve([]);
  await processing;
  assert.equal(finish, 1);
  let hints = 0;
  const runtime = new EnrichmentRuntime({ store }, { process: async () => {} }, logger, {
    add: () => {
      hints++;
      return new Promise(() => {});
    },
  });
  await runtime.reconcile();
  await runtime.reconcile();
  assert.equal(hints, 1);
  const processor = new EnrichmentProcessor(service, logger);
  await processor.process({ name: 'invalid', data: { workId: 'private URL' } });
  processor.onError(new Error('PRIVATE_PROVIDER_PAYLOAD'));
  assert.equal(JSON.stringify(events).includes('PRIVATE'), false);
});
test('PER-43 unconfigured provider never fabricates candidates', async () => {
  const outcomes = [];
  const service = new EnrichmentWorkerService(
    {
      store: {
        claim: async () => ({ input: { kind: 'receipt', attachmentId: 'private' } }),
        finish: async (...args) => outcomes.push(args),
      },
    },
    [],
    { emit: () => {} },
  );
  await service.process('id');
  assert.equal(outcomes[0][1], 'unconfigured');
  assert.equal(outcomes[0][2], undefined);
});
test('PER-43 timed-out non-cooperative adapter retains its slot and logs only fixed tokens', async () => {
  let calls = 0,
    aborted = false;
  const outcomes = [],
    events = [];
  const store = {
    claim: async () => ({ input: { kind: 'name', name: 'PRIVATE' } }),
    finish: async (_claim, outcome) => outcomes.push(outcome),
  };
  const service = new EnrichmentWorkerService(
    { store },
    [
      {
        id: 'fake',
        kinds: ['name'],
        suggest: (_input, signal) => {
          calls++;
          signal.addEventListener('abort', () => (aborted = true));
          return new Promise(() => {});
        },
      },
    ],
    { emit: (_level, event) => events.push(event) },
  );
  await service.process('first');
  assert.equal(aborted, true);
  assert.deepEqual(outcomes, ['failed']);
  await service.process('second');
  assert.equal(calls, 1);
  assert.deepEqual(outcomes, ['failed', 'circuit']);
  assert.equal(JSON.stringify(events).includes('PRIVATE'), false);
});

test('PER-44 legacy work without matching provider consent remains unconfigured', async () => {
  for (const input of [
    { kind: 'url', url: 'https://shop.example.org/private' },
    { kind: 'barcode', barcode: '3017620422003' },
  ]) {
    const outcomes = [];
    let calls = 0;
    const service = new EnrichmentWorkerService(
      {
        store: {
          claim: async () => ({ input }),
          finish: async (_claim, outcome) => outcomes.push(outcome),
        },
      },
      [
        {
          id: 'real-source-contract',
          kinds: [input.kind],
          supports: () => false,
          suggest: async () => {
            calls++;
            return [];
          },
        },
      ],
      { emit: () => {} },
    );
    await service.process('legacy');
    assert.equal(calls, 0);
    assert.deepEqual(outcomes, ['unconfigured']);
  }
});
