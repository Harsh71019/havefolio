import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { Queue, QueueEvents, Worker } from 'bullmq';
import pino from 'pino';
import { EventLogger } from '@havefolio/logging';
import { IntegrationRun, integrationConfiguration } from '@havefolio/test-utils';
import { RemindersProcessor } from '../dist/reminders/reminders.processor.js';
import { RemindersRepository } from '../dist/reminders/reminders.repository.js';
import { NtfyNotifierService } from '../dist/reminders/ntfy-notifier.service.js';
import { ReminderReconciliationService } from '../dist/reminders/reminder-reconciliation.service.js';

test(
  'due reminder delivery is idempotent and reconciliation restores a missing delayed job',
  { timeout: 30000 },
  async () => {
    const config = integrationConfiguration();
    assert.equal(config.valkeyHost, '127.0.0.1');
    const run = new IntegrationRun(config);
    await run.start();
    const runtimeUrl = new URL(config.runtimeUrl);
    runtimeUrl.searchParams.set('options', `-c search_path=${run.schema},pg_catalog`);
    const environment = {
      NODE_ENV: 'test',
      DATABASE_URL: runtimeUrl.toString(),
      NTFY_ENABLED: false,
      REMINDER_RECONCILE_INTERVAL_SECONDS: 60,
    };
    const logger = new EventLogger(pino({ level: 'silent' }));
    const repository = new RemindersRepository(environment);
    const notifier = new NtfyNotifierService(environment, repository, logger);
    const processor = new RemindersProcessor(repository, notifier, logger);
    const connection = {
      host: config.valkeyHost,
      port: config.valkeyPort,
      enableReadyCheck: false,
      maxRetriesPerRequest: null,
    };
    const queue = new Queue('desire-reminders', { connection, prefix: run.prefix });
    const events = new QueueEvents('desire-reminders', { connection, prefix: run.prefix });
    const worker = new Worker('desire-reminders', (job) => processor.process(job), {
      connection,
      prefix: run.prefix,
    });
    for (const item of [queue, events, worker]) item.on('error', () => undefined);

    try {
      await Promise.all([queue.waitUntilReady(), events.waitUntilReady(), worker.waitUntilReady()]);
      const ownerId = randomUUID();
      const desireId = randomUUID();
      const startedAt = new Date(Date.now() - 120_000);
      const scheduledFor = new Date(Date.now() - 60_000);
      await run.runtime.query(
        "INSERT INTO users(id,email,password_hash) VALUES($1,'reminder-owner@example.test','$argon2id$fixture')",
        [ownerId],
      );
      await run.runtime.query(
        `INSERT INTO desires(id,owner_id,name,status,waiting_started_at,review_at)
         VALUES($1,$2,'Synthetic reminder','waiting',$3,$4)`,
        [desireId, ownerId, startedAt, scheduledFor],
      );
      await run.runtime.query(
        `INSERT INTO desire_reminders(desire_id,owner_id,schedule_version,scheduled_for)
         VALUES($1,$2,1,$3)`,
        [desireId, ownerId, scheduledFor],
      );

      const data = {
        desireId,
        scheduleVersion: 1,
        scheduledFor: scheduledFor.toISOString(),
      };
      const first = await queue.add('desire.wait-ended', data, {
        jobId: `duplicate-a-${randomUUID()}`,
      });
      const second = await queue.add('desire.wait-ended', data, {
        jobId: `duplicate-b-${randomUUID()}`,
      });
      await Promise.all([
        first.waitUntilFinished(events, 10000),
        second.waitUntilFinished(events, 10000),
      ]);

      const delivery = await run.runtime.query(
        `SELECT count(*)::int AS count FROM notifications
         WHERE desire_id=$1 AND reminder_version=1 AND type='desire_wait_ended'`,
        [desireId],
      );
      assert.equal(delivery.rows[0].count, 1);
      const reminder = await run.runtime.query(
        'SELECT state,delivered_at FROM desire_reminders WHERE desire_id=$1',
        [desireId],
      );
      assert.equal(reminder.rows[0].state, 'delivered');
      assert.ok(reminder.rows[0].delivered_at instanceof Date);

      const futureDesireId = randomUUID();
      const future = new Date(Date.now() + 60 * 60 * 1000);
      await run.runtime.query(
        `INSERT INTO desires(id,owner_id,name,status,waiting_started_at,review_at)
         VALUES($1,$2,'Synthetic future reminder','waiting',now(),$3)`,
        [futureDesireId, ownerId, future],
      );
      await run.runtime.query(
        `INSERT INTO desire_reminders(desire_id,owner_id,schedule_version,scheduled_for)
         VALUES($1,$2,1,$3)`,
        [futureDesireId, ownerId, future],
      );
      const reconciliation = new ReminderReconciliationService(
        queue,
        environment,
        repository,
        notifier,
        logger,
      );
      await reconciliation.reconcile();
      const stableJobId = `desire-reminder-${futureDesireId}-1`;
      const scheduled = await queue.getJob(stableJobId);
      assert.ok(scheduled);
      assert.equal(await scheduled.getState(), 'delayed');
      await scheduled.remove();
      assert.equal(await queue.getJob(stableJobId), undefined);
      await reconciliation.reconcile();
      assert.ok(await queue.getJob(stableJobId));
    } finally {
      await worker.close(true);
      await events.close();
      await queue.obliterate({ force: true });
      await queue.close();
      await repository.onModuleDestroy();
      await run.close();
    }
  },
);
