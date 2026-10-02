import assert from 'node:assert/strict';
import test from 'node:test';
import { randomBytes } from 'node:crypto';
import { Queue, QueueEvents, Worker } from 'bullmq';
import pino from 'pino';
import {
  EventLogger,
  LogDestination,
  loggerOptions,
  correlatedJobData,
  logContext,
} from '@havefolio/logging';
import { SystemProcessor } from '../dist/system/system.processor.js';

test(
  'BullMQ dispatch, successful completion and real retry retain context during Seq outage',
  { timeout: 20000 },
  async () => {
    // Dedicated ephemeral runner/loopback services only; never connect to a shared host.
    assert.equal(process.env.TEST_VALKEY_HOST, '127.0.0.1');
    const connection = {
      host: '127.0.0.1',
      port: Number(process.env.TEST_VALKEY_PORT),
      maxRetriesPerRequest: null,
    };
    const prefix = `havefolio:test:per48_${randomBytes(12).toString('hex')}`;
    const lines = [];
    const sink = new LogDestination(
      { enabled: true, endpoint: 'http://127.0.0.1:1', apiKey: randomBytes(16).toString('hex') },
      { write: (line) => lines.push(JSON.parse(line)) },
    );
    const logger = pino(
      loggerOptions({
        application: 'havefolio',
        service: 'worker',
        environment: 'test',
        release: 'per48-integration',
        level: 'info',
      }),
      sink,
    );
    const processor = new SystemProcessor(new EventLogger(logger));
    const queue = new Queue('system', { connection, prefix });
    const events = new QueueEvents('system', { connection, prefix });
    const worker = new Worker('system', (job) => processor.process(job), { connection, prefix });
    for (const item of [queue, events, worker]) item.on('error', () => {});
    try {
      await Promise.all([queue.waitUntilReady(), events.waitUntilReady(), worker.waitUntilReady()]);
      const data = logContext.run(
        { requestId: 'request_integration_1', correlationId: 'correlation_integration_1' },
        () => correlatedJobData({ requestedAt: new Date().toISOString(), notes: 'private-canary' }),
      );
      const success = await queue.add('system.noop', data, {
        removeOnComplete: true,
        removeOnFail: true,
      });
      await success.waitUntilFinished(events, 5000);
      const failed = await queue.add('unsupported', data, {
        attempts: 2,
        backoff: { type: 'fixed', delay: 50 },
        removeOnComplete: true,
        removeOnFail: true,
      });
      await assert.rejects(failed.waitUntilFinished(events, 5000));
      assert.deepEqual(
        lines.filter((e) => e.jobId === success.id).map((e) => e.event),
        ['job_started', 'job_completed'],
      );
      const retries = lines.filter((e) => e.jobId === failed.id);
      assert.deepEqual(
        retries.map((e) => e.event),
        ['job_started', 'job_retry', 'job_started', 'job_failed'],
      );
      assert.deepEqual(
        retries.map((e) => e.attempt),
        [1, 1, 2, 2],
      );
      for (const e of lines) assert.equal(e.correlationId, data.metadata.correlationId);
      assert.ok(!JSON.stringify(lines).includes('private-canary'));
    } finally {
      sink.close();
      await worker.close(true);
      await events.close();
      // Only the random test-owned queue, never a shared prefix.
      await queue.obliterate({ force: true });
      await queue.close();
    }
  },
);
