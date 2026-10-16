import type { WorkerEnvironment } from '@havefolio/config';
import { desireReminderJob, desireReminderJobId, desireReminderQueue } from '@havefolio/domain';
import { correlatedJobData, EventLogger } from '@havefolio/logging';
import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { WORKER_ENVIRONMENT } from '../worker.constants.js';
import { NtfyNotifierService } from './ntfy-notifier.service.js';
import { RemindersRepository, type ReminderIntent } from './reminders.repository.js';

@Injectable()
export class ReminderReconciliationService implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    @InjectQueue(desireReminderQueue)
    private readonly queue: Queue,
    @Inject(WORKER_ENVIRONMENT)
    private readonly environment: WorkerEnvironment,
    private readonly repository: RemindersRepository,
    private readonly notifier: NtfyNotifierService,
    private readonly logger: EventLogger,
  ) {}

  onModuleInit(): void {
    void this.reconcile();
    this.timer = setInterval(
      () => void this.reconcile(),
      this.environment.REMINDER_RECONCILE_INTERVAL_SECONDS * 1000,
    );
    this.timer.unref();
  }

  private async ensureJob(intent: ReminderIntent): Promise<void> {
    const jobId = desireReminderJobId(intent.desireId, intent.scheduleVersion);
    const existing = await this.queue.getJob(jobId);
    if (existing) {
      const state = await existing.getState();
      if (['waiting', 'delayed', 'active'].includes(state)) {
        await this.repository.markScheduled(intent);
        return;
      }
      if (state === 'failed' && Date.now() - (existing.finishedOn ?? Date.now()) < 60_000) return;
      await existing.remove().catch(() => undefined);
    }
    await this.queue.add(
      desireReminderJob,
      correlatedJobData({
        desireId: intent.desireId,
        scheduleVersion: intent.scheduleVersion,
        scheduledFor: intent.scheduledFor.toISOString(),
      }),
      {
        jobId,
        delay: Math.max(0, intent.scheduledFor.getTime() - Date.now()),
        attempts: 5,
        backoff: { type: 'exponential', delay: 30_000 },
        removeOnComplete: true,
        removeOnFail: { age: 7 * 24 * 60 * 60, count: 1000 },
      },
    );
    await this.repository.markScheduled(intent);
  }

  async reconcile(): Promise<void> {
    if (this.running) return;
    this.running = true;
    const started = performance.now();
    try {
      const intents = await this.repository.listActive();
      let completed = 0;
      let failed = 0;
      for (const intent of intents) {
        try {
          await this.ensureJob(intent);
          completed++;
        } catch {
          failed++;
        }
      }
      if (this.notifier.isEnabled()) {
        for (const notificationId of await this.repository.listPendingNtfy()) {
          await this.notifier.deliver(notificationId).catch(() => undefined);
        }
      }
      const counts = await this.queue.getJobCounts();
      this.logger.emit(failed > 0 ? 'warn' : 'info', {
        event: 'worker_health',
        component: 'reminders',
        operation: 'reconcile',
        completed,
        failed: Math.max(failed, counts.failed ?? 0),
        waiting: counts.waiting ?? 0,
        delayed: counts.delayed ?? 0,
        active: counts.active ?? 0,
        pending: intents.length,
        durationMs: performance.now() - started,
      });
    } catch (error) {
      this.logger.emit('error', {
        event: 'worker_error',
        component: 'reminders',
        operation: 'reconcile',
        category: 'operational_failure',
        code: 'REMINDER_RECONCILIATION_FAILED',
        error,
        durationMs: performance.now() - started,
      });
    } finally {
      this.running = false;
    }
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
