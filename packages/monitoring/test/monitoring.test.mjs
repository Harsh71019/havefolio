import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import {
  monitoringConfig,
  monitoringOptions,
  normalizeRoute,
  scrubEvent,
  safeTags,
  traceRate,
} from '../dist/index.js';
const dsn = `http://${randomBytes(16).toString('hex')}@127.0.0.1/1`;
const config = {
  GLITCHTIP_ENABLED: 'true',
  GLITCHTIP_DSN: dsn,
  NODE_ENV: 'production',
  LOG_RELEASE: 'a'.repeat(40),
};
test('optional configuration rejects placeholders, unsafe DSNs, mutable releases and unbounded sampling', () => {
  assert.equal(monitoringConfig({}).enabled, false);
  assert.equal(monitoringConfig(config).enabled, true);
  for (const patch of [
    { GLITCHTIP_DSN: 'REPLACE_WITH_DSN' },
    { GLITCHTIP_DSN: dsn + '?token=private' },
    { GLITCHTIP_DSN: dsn.replace('@', ':private@') },
    { LOG_RELEASE: 'latest' },
    { LOG_RELEASE: 'local' },
    { GLITCHTIP_TRACE_SAMPLE_RATE: '1' },
    { GLITCHTIP_TRACE_SAMPLE_RATE: 'NaN' },
    { GLITCHTIP_TRACE_SAMPLE_RATE: '-1' },
  ]) {
    const result = monitoringConfig({ ...config, ...patch });
    assert.equal(result.enabled, false);
    assert.equal(result.invalid, true);
  }
  assert.equal(monitoringConfig({ ...config, GLITCHTIP_TRACE_SAMPLE_RATE: '0' }).enabled, true);
});
test('known routes normalize UUIDs, queries and app-router templates without keeping arbitrary paths', () => {
  assert.equal(
    normalizeRoute('/items/private-value/photos/private-asset?token=secret'),
    '/items/:itemId/photos/:attachmentId',
  );
  assert.equal(normalizeRoute('/(inventory)/items/[itemId]/page'), '/items/:itemId');
  assert.equal(
    normalizeRoute('GET /api/v1/items/000/photos/123'),
    '/api/v1/items/:itemId/photos/:attachmentId',
  );
  assert.equal(normalizeRoute('/private-note/email@example.com'), '/unmatched');
  assert.equal(normalizeRoute('/api/v1/goals?status=archived'), '/api/v1/goals');
  assert.equal(normalizeRoute('/api/v1/goals/private-id'), '/api/v1/goals/:id');
  assert.equal(
    normalizeRoute('/api/v1/goals/private-id/contributions?before=3'),
    '/api/v1/goals/:id/contributions',
  );
  assert.equal(normalizeRoute('/api/v1/goals/private-id/private-note'), '/unmatched');
  assert.equal(
    normalizeRoute('/api/v1/spending?categoryId=private&currency=INR'),
    '/api/v1/spending',
  );
  assert.equal(normalizeRoute('/api/v1/home?private=1'), '/api/v1/home');
  assert.equal(normalizeRoute('/api/v1/home/private-id'), '/unmatched');
  assert.equal(traceRate('/api/v1/health?secret=x', 0.01), 0);
  assert.equal(traceRate('/_next/static/chunk.js', 0.01), 0);
  assert.equal(traceRate('/store', 0.01), 0.01);
});
test('defensive reconstruction removes secrets and private values at every alternate-case/nested location', () => {
  const canary = 'private-' + randomBytes(20).toString('hex');
  const event = {
    event_id: 'a'.repeat(32),
    release: 'b'.repeat(40),
    environment: 'production',
    message: canary,
    user: { email: canary },
    request: {
      url: 'https://private.invalid/?token=' + canary,
      headers: { Authorization: canary },
      data: { password: canary },
    },
    extra: {
      ReCeIpT: canary,
      deep: {
        NOTE: canary,
        OriginalFilename: canary,
        SQL: canary,
        DSN: canary,
        Specifications: canary,
      },
    },
    contexts: { device: { name: canary }, runtime: { description: canary } },
    breadcrumbs: [{ message: canary, data: { image: canary } }],
    tags: {
      requestId: 'a'.repeat(32),
      correlationId: 'b'.repeat(32),
      route: '/items/' + canary,
      private: canary,
      service: 'api',
      code: 'REQUEST_FAILED',
    },
    exception: {
      values: [
        {
          type: canary,
          value: canary,
          mechanism: { type: canary, data: { password: canary } },
          stacktrace: {
            frames: [
              {
                filename: '/Users/private/' + canary,
                abs_path: canary,
                function: canary,
                vars: { Password: canary },
                pre_context: [canary],
                context_line: canary,
                lineno: 5,
                colno: 1,
              },
              {
                filename:
                  'https://app.invalid/_next/static/chunks/app/page-123.js?secret=' + canary,
                lineno: 10,
                colno: 20,
                in_app: true,
              },
            ],
          },
        },
      ],
    },
    debug_meta: {
      images: [
        {
          type: 'sourcemap',
          code_file: 'https://app.invalid/_next/static/chunks/app/page-123.js',
          debug_id:
            'a'.repeat(8) +
            '-' +
            'b'.repeat(4) +
            '-' +
            'c'.repeat(4) +
            '-' +
            'd'.repeat(4) +
            '-' +
            'e'.repeat(12),
        },
      ],
    },
  };
  const result = scrubEvent(event);
  const serialized = JSON.stringify(result);
  assert.ok(result);
  assert.ok(!serialized.includes(canary));
  assert.ok(!serialized.includes('/Users/'));
  assert.ok(!serialized.includes('https://'));
  assert.equal(
    result.exception.values[0].stacktrace.frames[1].filename,
    '~/_next/static/chunks/app/page-123.js',
  );
  assert.equal(result.tags.route, '/items/:itemId');
  assert.equal(result.tags.requestId, 'a'.repeat(32));
  assert.equal(result.release, event.release);
  assert.equal(result.environment, 'production');
  assert.ok(result.debug_meta.images.length);
  assert.ok(event.request.data.password === canary);
});
test('events, nested cause chains and breadcrumbs remain bounded and getters cannot break reporting', () => {
  const event = {
    exception: {
      values: Array.from({ length: 100 }, () => ({
        value: 'x'.repeat(100000),
        type: 'Error',
        stacktrace: {
          frames: Array.from({ length: 1000 }, () => ({
            filename: 'x'.repeat(2000),
            vars: { private: 'x'.repeat(10000) },
            lineno: 10,
          })),
        },
      })),
    },
  };
  const result = scrubEvent(event);
  assert.equal(result.exception.values.length, 3);
  assert.ok(JSON.stringify(result).length < 16384);
  assert.equal(
    monitoringOptions(monitoringConfig(config), 'api').beforeBreadcrumb({ message: 'private' }),
    null,
  );
  assert.equal(
    scrubEvent({
      get tags() {
        throw new Error('private');
      },
    }),
    null,
  );
});
test('transactions preserve only normalized route, timings and trace identity', () => {
  const result = scrubEvent({
    type: 'transaction',
    transaction: 'GET /items/private?secret=value',
    start_timestamp: 1,
    timestamp: 2,
    contexts: {
      trace: { trace_id: 'a'.repeat(32), span_id: 'b'.repeat(16), data: { sql: 'private' } },
    },
    spans: [{ description: 'secret sql', data: { note: 'private' } }],
    request: { data: { password: 'private' } },
  });
  assert.equal(result.transaction, '/items/:itemId');
  assert.deepEqual(result.spans, []);
  assert.ok(!JSON.stringify(result).includes('private'));
  assert.equal(scrubEvent({ type: 'transaction', transaction: '/api/v1/health' }), null);
});
test('SDK options disable PII, logs, replay, sessions and remote reports; error capture is independent of traces', () => {
  const options = monitoringOptions(
    monitoringConfig({ ...config, GLITCHTIP_TRACE_SAMPLE_RATE: '0' }),
    'worker',
  );
  assert.equal(options.sendDefaultPii, false);
  assert.equal(options.autoSessionTracking, false);
  assert.equal(options.enableLogs, false);
  assert.equal(options.sampleRate, 1);
  assert.equal(options.defaultIntegrations, false);
  assert.equal(options.transportOptions.bufferSize, 32);
  assert.equal(options.tracesSampler({ name: '/store' }), 0);
  assert.ok(options.beforeSend({ exception: { values: [{ type: 'Error', value: 'private' }] } }));
  assert.deepEqual(
    safeTags({ jobId: 'private filename.pdf', attempt: 999999, correlationId: 'a'.repeat(32) }),
    { correlationId: 'a'.repeat(32), attempt: '10000' },
  );
});

test('PER-22 financial fields and alternate-case values never survive the event boundary', () => {
  const financial = 987654321;
  const event = {
    exception: { values: [{ type: 'Error', value: String(financial) }] },
    tags: {
      paidMinor: financial,
      refundMinor: financial,
      currency: 'INR',
      historicalSpend: financial,
    },
    contexts: { inventory: { PurchasePrice: financial, Refunds: [{ AmountMinor: financial }] } },
    extra: {
      financial: { OwnedSpendMinor: financial, UnknownPriceCount: financial },
      notes: 'private',
    },
    request: { data: { amountMinor: financial } },
    breadcrumbs: [{ data: { balance: financial } }],
  };
  const result = JSON.stringify(scrubEvent(event));
  assert.ok(!result.includes(String(financial)));
  assert.ok(!result.includes('INR'));
  assert.ok(!result.includes('notes'));
});

test('merchant routes, search and purchase links are stripped from error reports', () => {
  const purchaseUrl = 'https://shop.example.test/synthetic?ref=synthetic';
  const output = JSON.stringify(
    scrubEvent({
      request: { url: '/api/v1/merchants?q=synthetic-search', data: { purchaseUrl } },
      extra: { purchaseUrl, merchantName: 'Synthetic seller' },
      exception: { values: [{ type: 'Error', value: purchaseUrl }] },
      tags: { route: '/api/v1/merchants?q=synthetic-search' },
    }),
  );
  assert.equal(
    normalizeRoute('/api/v1/merchants/11111111-1111-4111-8111-111111111111?q=synthetic-search'),
    '/api/v1/merchants/:id',
  );
  for (const value of [purchaseUrl, 'synthetic-search', 'Synthetic seller'])
    assert.equal(output.includes(value), false);
});
