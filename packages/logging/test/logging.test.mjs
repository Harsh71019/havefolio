import assert from 'node:assert/strict';
import test from 'node:test';
import { randomBytes } from 'node:crypto';
import pino from 'pino';
import {
  loggerOptions,
  LogDestination,
  redact,
  safeError,
  effectiveId,
  validId,
  logContext,
  jobMetadata,
  jobContext,
  seqEndpoint,
} from '../dist/index.js';

const base = {
  application: 'havefolio',
  service: 'api',
  environment: 'test',
  release: 'per48-test',
  level: 'trace',
};
function capture(options = { enabled: false }, send) {
  const lines = [];
  const destination = new LogDestination(options, { write: (line) => lines.push(line) }, send);
  const logger = pino(loggerOptions(base), destination);
  return { lines, destination, logger };
}
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('IDs reject arrays, control characters and oversized input', () => {
  assert.match(effectiveId(undefined), /^[a-f0-9-]{36}$/);
  const id = 'caller_request_123456';
  assert.equal(effectiveId(id), id);
  for (const value of ['short', 'x'.repeat(65), id + '\n', ['x'], null]) {
    assert.equal(validId(value), false);
    assert.notEqual(effectiveId(value), value);
  }
});

test('concurrent request context and job causation are isolated', async () => {
  const { logger, lines, destination } = capture();
  await Promise.all(
    Array.from({ length: 12 }, (_, i) =>
      logContext.run(
        {
          requestId: `request_${i}`.padEnd(16, '0'),
          correlationId: `correlate_${i}`.padEnd(16, '0'),
        },
        async () => {
          await wait((12 - i) % 5);
          const metadata = jobMetadata();
          assert.equal(metadata.causationId, logContext.getStore().requestId);
          logContext.run(jobContext(metadata, `job_${i}`, 2), () =>
            logger.info({ event: 'job_retry' }),
          );
        },
      ),
    ),
  );
  assert.equal(logContext.getStore(), undefined);
  for (const line of lines) {
    const e = JSON.parse(line);
    assert.equal(e.attempt, 3);
    assert.equal(e.causationId, e.requestId);
    assert.equal(e.correlationId, e.requestId.replace('request_', 'correlate_').slice(0, 16));
  }
  destination.close();
});

test('allowlist and recursive redaction exclude credentials/private data at both sinks', async () => {
  const secret = randomBytes(16).toString('hex');
  const sent = [];
  const { logger, lines, destination } = capture(
    { enabled: true, endpoint: 'http://localhost:5341', apiKey: randomBytes(16).toString('hex') },
    async (_url, init) => {
      sent.push(init.body);
      return new Response('', { status: 201 });
    },
  );
  const privateData = {
    Password: secret,
    SESSION_HASH: secret,
    Authorization: secret,
    'Set-Cookie': secret,
    apiKey: secret,
    CloudinaryCredentials: { signedURL: secret },
    filename: secret,
    receipt: secret,
    warranty: secret,
    image: secret,
    notes: secret,
    multipart: secret,
    body: { password: secret },
    sqlParameters: [secret],
  };
  logger.info(
    {
      ...privateData,
      event: 'test_event',
      error: Object.assign(new Error(secret), { code: 'ECONNREFUSED' }),
      nested: [privateData],
    },
    secret,
  );
  logger.error(new Error(secret));
  logger.info(secret);
  logger.child({ privateData }).info({ event: 'child_event' });
  await wait(150);
  assert.ok(sent.length > 0);
  for (const output of [...lines, ...sent]) {
    assert.ok(!output.includes(secret));
    assert.ok(!output.includes('Authorization'));
    assert.ok(!output.includes('SESSION_HASH'));
  }
  assert.deepEqual(privateData.Password, secret);
  assert.ok(!JSON.stringify(redact({ items: [privateData] })).includes(secret));
  const parsed = JSON.parse(lines[0]);
  assert.equal(parsed.error.type, 'Error');
  assert.equal(parsed.error.code, 'ECONNREFUSED');
  assert.ok(!JSON.stringify(parsed.error).includes('/'));
  assert.equal(parsed.release, 'per48-test');
  assert.equal(parsed.environment, 'test');
  assert.equal(parsed.service, 'api');
  destination.close();
});

test('redaction bounds collections/strings/depth, prevents forging and never invokes getters', () => {
  assert.equal(redact('a'.repeat(1000)).length, 256);
  assert.equal(redact(Array(100).fill('x')).length, 16);
  assert.equal(redact('a\r\nb\x00c'), 'abc');
  assert.equal(redact('/Users/private/data.png'), '[REDACTED]');
  const obj = {};
  Object.defineProperty(obj, 'danger', {
    enumerable: true,
    get() {
      throw new Error('getter');
    },
  });
  assert.deepEqual(redact(obj), {});
  obj.self = obj;
  assert.equal(redact(obj).self, '[CIRCULAR]');
  const e = new Error('private');
  e.name = 'private';
  e.stack = 'private\nat password (/home/me/secret.js:12:4)';
  assert.deepEqual(safeError(e), { type: 'Error', stack: ['at [frame]:12:4'] });
});

test('disabled/misconfigured Seq never attempts delivery and console survives', async () => {
  for (const config of [
    { enabled: false },
    { enabled: true },
    { enabled: true, endpoint: 'https://user:secret@localhost', apiKey: 'key' },
    { enabled: true, endpoint: 'https://localhost?secret=1', apiKey: 'key' },
    { enabled: true, endpoint: 'ftp://localhost', apiKey: 'key' },
    { enabled: true, endpoint: 'http://localhost', apiKey: 'REPLACE_WITH_KEY' },
  ]) {
    assert.equal(seqEndpoint(config), undefined);
    let attempts = 0;
    const c = capture(config, () => {
      attempts++;
      throw new Error('offline');
    });
    c.logger.info({ event: 'test' });
    await wait(110);
    assert.equal(attempts, 0);
    assert.equal(c.lines.length, 1);
    c.destination.close();
  }
});

test('outages are bounded, retried twice and cannot reject or block callers', async () => {
  let calls = 0;
  const c = capture({ enabled: true, endpoint: 'http://localhost', apiKey: 'test' }, () => {
    calls++;
    return Promise.reject(new Error('offline'));
  });
  const start = performance.now();
  for (let i = 0; i < 1000; i++) c.logger.info({ event: 'test' });
  assert.ok(performance.now() - start < 500);
  assert.equal(c.lines.length, 1000);
  assert.ok(c.destination.pendingEvents <= 256);
  await wait(160);
  assert.equal(calls, 2);
  assert.ok(c.destination.pendingEvents < 256);
  c.destination.close();
  assert.doesNotThrow(() => {
    const d = new LogDestination(
      { enabled: false },
      {
        write() {
          throw new Error('console offline');
        },
      },
    );
    pino(loggerOptions(base), d).info({ event: 'test' });
  });
});

test('hung ingestion aborts within timeout and shutdown discards pending telemetry', async () => {
  let aborted = false;
  const c = capture(
    { enabled: true, endpoint: 'http://localhost', apiKey: 'test' },
    (_url, init) =>
      new Promise((resolve, reject) => {
        init.signal.addEventListener('abort', () => {
          aborted = true;
          reject(new Error('timeout'));
        });
      }),
  );
  c.logger.info({ event: 'test' });
  await wait(1150);
  assert.equal(aborted, true);
  c.destination.close();
  assert.equal(c.destination.pendingEvents, 0);
});

test('logging configuration validates bounded tokens, strict booleans and rejects placeholders safely', async () => {
  const { validateWorkerEnvironment } = await import('@havefolio/config');
  const environment = validateWorkerEnvironment({
    NODE_ENV: 'test',
    LOG_APPLICATION: 'havefolio',
    LOG_SERVICE: 'worker',
    LOG_RELEASE: 'per48-test',
    SEQ_ENABLED: true,
    SEQ_ENDPOINT: 'invalid',
    SEQ_API_KEY: 'REPLACE_WITH_KEY',
  });
  assert.equal(environment.SEQ_API_KEY, undefined);
  assert.equal(
    seqEndpoint({
      enabled: environment.SEQ_ENABLED,
      endpoint: environment.SEQ_ENDPOINT,
      apiKey: environment.SEQ_API_KEY,
    }),
    undefined,
  );
  for (const invalid of [
    { LOG_RELEASE: 'REPLACE_WITH_RELEASE' },
    { LOG_RELEASE: 'private\nforged' },
    { LOG_SERVICE: 'x'.repeat(50) },
    { SEQ_ENABLED: 'yes' },
    { LOG_PRETTY: 'yes' },
  ])
    assert.throws(() => validateWorkerEnvironment(invalid));
});
