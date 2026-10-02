import assert from 'node:assert/strict';
import test from 'node:test';
import pino from 'pino';
import {
  EventLogger,
  loggerOptions,
  LogDestination,
  correlatedJobData,
  logContext,
} from '@havefolio/logging';
import { SystemProcessor } from '../dist/system/system.processor.js';

function fixture(destination) {
  const lines = [];
  const sink =
    destination ??
    new LogDestination({ enabled: false }, { write: (line) => lines.push(JSON.parse(line)) });
  const root = pino(
    loggerOptions({
      application: 'havefolio',
      service: 'worker',
      environment: 'test',
      release: 'per48-worker-test',
      level: 'debug',
    }),
    sink,
  );
  const logger = new EventLogger(root);
  return { processor: new SystemProcessor(logger), lines, sink };
}
test('job lifecycle preserves correlation, request, causation and retry attempts without payloads', async () => {
  const { processor, lines, sink } = fixture();
  const data = logContext.run(
    { requestId: 'request_123456789', correlationId: 'correlate_12345678' },
    () =>
      correlatedJobData({
        requestedAt: new Date().toISOString(),
        password: 'private-seed',
        notes: 'private-note',
      }),
  );
  const job = { name: 'system.noop', id: 'job_123', data, attemptsMade: 0, opts: { attempts: 2 } };
  await processor.process(job);
  assert.deepEqual(
    lines.map((e) => e.event),
    ['job_started', 'job_completed'],
  );
  for (const e of lines) {
    assert.equal(e.requestId, 'request_123456789');
    assert.equal(e.correlationId, 'correlate_12345678');
    assert.equal(e.causationId, 'request_123456789');
    assert.equal(e.attempt, 1);
    assert.equal(e.service, 'worker');
    assert.equal(e.release, 'per48-worker-test');
  }
  job.name = 'private-unsupported-operation';
  await assert.rejects(processor.process(job));
  job.attemptsMade = 1;
  await assert.rejects(processor.process(job));
  assert.equal(lines.at(-3).event, 'job_retry');
  assert.equal(lines.at(-1).event, 'job_failed');
  assert.equal(lines.at(-1).attempt, 2);
  assert.equal(lines.at(-1).correlationId, data.metadata.correlationId);
  assert.ok(!JSON.stringify(lines).includes('private-'));
  sink.close();
});
test('legacy jobs without metadata retain deterministic correlation across retries', async () => {
  const { processor, lines, sink } = fixture();
  const job = {
    name: 'unsupported',
    id: 'legacy_job_1',
    data: {},
    attemptsMade: 0,
    opts: { attempts: 2 },
  };
  await assert.rejects(processor.process(job));
  job.attemptsMade = 1;
  await assert.rejects(processor.process(job));
  assert.equal(lines[0].correlationId, lines.at(-1).correlationId);
  sink.close();
});
test('console/Seq failure never changes a successful job into a BullMQ retry', async () => {
  const sink = new LogDestination(
    { enabled: true, endpoint: 'http://localhost', apiKey: 'test' },
    {
      write() {
        throw new Error('offline');
      },
    },
    () => Promise.reject(new Error('offline')),
  );
  const { processor } = fixture(sink);
  await assert.doesNotReject(
    processor.process({ name: 'system.noop', id: '1', data: {}, attemptsMade: 0, opts: {} }),
  );
  processor.onError(new Error('private transport body'));
  sink.close();
});
