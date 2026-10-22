import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summary, options, sample, mediaVariant, decodeMs, validateReport } from './core.mjs';
test('nearest-rank tails retain outliers and small-sample limits', () => {
  const values = Array.from({ length: 1000 }, (_, i) => i + 1);
  assert.deepEqual(summary(values), { n: 1000, min: 1, p50: 500, p95: 950, p99: 990, max: 1000 });
  assert.equal(summary([1, 2, 3, 4, 900]).p95, 900);
  assert.throws(() => summary([]));
  assert.throws(() => summary([NaN]));
});
test('capacity and target options fail closed', () => {
  for (const args of [
    ['--sizes=1000000'],
    ['--url=https://production.invalid'],
    ['--sizes=100,100'],
    ['--sizes='],
    ['--api-only', '--browser-only'],
  ])
    assert.throws(() => options(args));
  assert.deepEqual(options(['--sizes=10000']).sizes, [10000]);
});
test('bounded closed-loop load counts errors without capturing private failures', async () => {
  let active = 0,
    max = 0;
  const result = await sample(17, 3, async (i) => {
    active++;
    max = Math.max(max, active);
    await new Promise((resolve) => setTimeout(resolve, 1));
    active--;
    if (i === 0) throw new Error('Cookie=private; https://private.invalid/photo?token=secret');
    return i === 1 ? 503 : 200;
  });
  assert.equal(max, 3);
  assert.equal(result.latencyMs.n, 17);
  assert.equal(result.errors, 2);
  assert.equal(result.statuses[200], 15);
  assert.doesNotMatch(JSON.stringify(result), /Cookie|private|https|secret/);
});
test('artifact validator rejects arbitrary text and credential-bearing fields', async () => {
  const { validateReport } = await import('./core.mjs');
  assert.doesNotThrow(() =>
    validateReport({ endpoint: 'home', latencyMs: { p95: 2 }, samplesMs: [1, 2], cleanup: true }),
  );
  for (const data of [
    { cookie: 'private' },
    { requestUrl: 'https://private.invalid' },
    { error: 'private query' },
    { route: '/items/private-id' },
    { samplesMs: [Infinity] },
    { cpu: 'https://example.invalid' },
  ])
    assert.throws(() => validateReport(data));
});
test('warm priming drains old requests and restores measured throttling, including failure', async () => {
  const { primeWarm } = await import('./core.mjs');
  for (const fail of [false, true]) {
    const events = [];
    const cdp = { send: async (method, settings) => events.push({ method, settings }) };
    const action = () =>
      primeWarm(cdp, { latency: 150, download: 200000, upload: 93750 }, async () => {
        events.push({ method: 'drained' });
        if (fail) throw new Error('prime failed');
      });
    if (fail) await assert.rejects(action);
    else await action();
    assert.equal(events[0].method, 'Page.stopLoading');
    assert.equal(events[2].settings.latency, 0);
    assert.equal(events.at(-2).method, 'Page.stopLoading');
    assert.equal(events.at(-1).settings.latency, 150);
    assert.equal(events.at(-1).settings.downloadThroughput, 200000);
  }
});
test('missing ready observations stay censored and are never converted to zero', async () => {
  const { observed } = await import('./core.mjs');
  const result = observed([100, 200, null, 300, 400]);
  assert.equal(result.attempts, 5);
  assert.equal(result.missing, 1);
  assert.equal(result.summary.n, 4);
  assert.equal(result.summary.min, 100);
  assert.equal(observed([null, null]).summary, null);
});
test('occupied service ports are rejected without connecting to or reusing the listener', async () => {
  const { createServer } = await import('node:net');
  const { assertFreePorts } = await import('./core.mjs');
  let contacted = false;
  const existing = createServer(() => {
    contacted = true;
  });
  await new Promise((r) => existing.listen(0, '127.0.0.1', r));
  try {
    await assert.rejects(() => assertFreePorts([existing.address().port]));
    assert.equal(contacted, false);
  } finally {
    await new Promise((r) => existing.close(r));
  }
  await assertFreePorts([0]);
});
test('readiness censoring never invents HTTP errors or merges network terminations', async () => {
  const { censorObservation } = await import('./core.mjs');
  const id = { profile: 'mobile', repeat: 0, route: 'store', condition: 'warm' };
  const stats = {
    requests: 10,
    transferBytes: 100,
    jsBytes: 10,
    errors: 0,
    failedRequests: 3,
    cookie: 'private',
  };
  const ready = censorObservation(id, 'ready-timeout', 30000, stats);
  assert.equal(ready.errors, 0);
  assert.equal(ready.failedRequests, 3);
  assert.equal(ready.readyMs, null);
  assert.equal(ready.readyLowerBoundMs, 30000);
  assert.doesNotMatch(JSON.stringify(ready), /cookie|private/);
  const prime = censorObservation(id, 'priming-timeout', 30000, stats);
  assert.equal(prime.readyLowerBoundMs, null);
  assert.equal(prime.requests, null);
  assert.equal(prime.errors, null);
});
test('PER-97 media audit keeps variant labels and decode totals only', () => {
  const id = '00000000-0000-4000-8000-000000000000';
  assert.equal(
    mediaVariant(`http://127.0.0.1:3195/api/v1/items/${id}/photos/${id}/content/thumbnail`),
    'thumbnail',
  );
  assert.equal(
    mediaVariant(`http://127.0.0.1:3195/api/v1/items/${id}/photos/${id}/content/display?attempt=2`),
    'display',
  );
  for (const url of [
    `http://127.0.0.1:3195/api/v1/items/${id}/photos/${id}/access/display`,
    `http://127.0.0.1:3195/api/v1/items/${id}/photos/${id}/content/original`,
    'not a url',
  ])
    assert.equal(mediaVariant(url), null);
  assert.deepEqual(
    decodeMs({
      traceEvents: [
        { ph: 'X', name: 'Decode Image', dur: 1500, args: { url: 'private' } },
        { ph: 'X', name: 'ImageDecodeTask', dur: 2500 },
        { ph: 'B', name: 'Decode Image', dur: 9000 },
      ],
    }),
    { decodeImageMs: 1.5, imageDecodeTaskMs: 2.5 },
  );
  assert.equal(options(['--media-audit', '--browser-only']).mediaAudit, true);
  assert.doesNotThrow(() =>
    validateReport({ profile: 'retina', view: 'revisit', density: 'large', sidebar: 'collapsed' }),
  );
  assert.throws(() => validateReport({ view: '/api/v1/items' }));
});
