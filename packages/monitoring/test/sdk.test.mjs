import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import {
  initializeMonitoring,
  captureFailure,
  flushMonitoring,
  startOperation,
} from '../dist/server.js';
import { logContext } from '@havefolio/logging';

test('real SDK sends one safe correlated error, deduplicates and tolerates transport outage', async () => {
  const envelopes = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (data) => (body += data));
    req.on('end', () => {
      envelopes.push(body);
      res.writeHead(200);
      res.end('{}');
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  initializeMonitoring('api', {
    GLITCHTIP_ENABLED: 'true',
    GLITCHTIP_DSN: `http://${randomBytes(16).toString('hex')}@127.0.0.1:${address.port}/1`,
    LOG_RELEASE: 'per49-sdk-test',
    NODE_ENV: 'test',
    GLITCHTIP_TRACE_SAMPLE_RATE: '0',
  });
  const secret = randomBytes(20).toString('hex');
  const error = new Error(secret);
  const id = logContext.run(
    { requestId: 'request_123456789', correlationId: 'correlation_12345' },
    () =>
      captureFailure(error, {
        code: 'REQUEST_FAILED',
        route: '/api/v1/items/123',
        password: secret,
      }),
  );
  assert.match(id, /^[a-f0-9]{32}$/);
  assert.equal(captureFailure(error), undefined);
  await flushMonitoring();
  assert.equal(envelopes.length, 1);
  assert.ok(!envelopes[0].includes(secret));
  const event = JSON.parse(envelopes[0].split('\n')[2]);
  assert.equal(event.release, 'per49-sdk-test');
  assert.equal(event.environment, 'test');
  assert.equal(event.tags.requestId, 'request_123456789');
  assert.equal(event.tags.correlationId, 'correlation_12345');
  assert.equal(event.tags.route, '/api/v1/items/:itemId');
  assert.equal(event.tags.service, 'api');
  await new Promise((resolve) => server.close(resolve));
  assert.doesNotThrow(() => captureFailure(new TypeError(secret)));
  assert.doesNotThrow(() => startOperation('/store')());
  const start = performance.now();
  await flushMonitoring();
  assert.ok(performance.now() - start < 1500);
});

test('real performance event passes static transaction scrubbing with normalized routes', async () => {
  const { mock } = await import('node:test');
  const { closeMonitoring } = await import('../dist/server.js');
  const envelopes = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (data) => (body += data));
    req.on('end', () => {
      envelopes.push(body);
      res.end('{}');
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const random = mock.method(Math, 'random', () => 0);
  try {
    initializeMonitoring('api', {
      GLITCHTIP_ENABLED: 'true',
      GLITCHTIP_DSN: `http://${randomBytes(16).toString('hex')}@127.0.0.1:${server.address().port}/1`,
      LOG_RELEASE: 'per49-trace-test',
      NODE_ENV: 'test',
      GLITCHTIP_TRACE_SAMPLE_RATE: '0.1',
    });
    logContext.run({ requestId: 'request_123456789', correlationId: 'correlation_12345' }, () =>
      startOperation('/api/v1/items/private')('/api/v1/items/:itemId'),
    );
    startOperation('/api/v1/health')();
    random.mock.mockImplementation(() => 0.5);
    startOperation('/api/v1/items/another-private')();
    await flushMonitoring();
    assert.equal(envelopes.length, 1);
    const event = JSON.parse(envelopes[0].split('\n')[2]);
    assert.equal(event.type, 'transaction');
    assert.equal(event.transaction, '/api/v1/items/:itemId');
    assert.deepEqual(event.spans, []);
    assert.equal(event.release, 'per49-trace-test');
    assert.equal(event.tags.requestId, 'request_123456789');
    assert.equal(event.tags.correlationId, 'correlation_12345');
    assert.ok(!envelopes[0].includes('private'));
  } finally {
    random.mock.restore();
    await closeMonitoring();
    await new Promise((resolve) => server.close(resolve));
  }
});
