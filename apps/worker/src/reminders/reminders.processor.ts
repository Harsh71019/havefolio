import {
  desireReminderJob,
  desireReminderQueue,
  isDesireReminderJobData,
  type DesireReminderJobData,
} from '@havefolio/domain';
import { EventLogger, jobContext, logContext, type LogContext } from '@havefolio/logging';
import { captureFailure, startOperation } from '@havefolio/monitoring/server';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { NtfyNotifierService } from './ntfy-notifier.service.js';
import { RemindersRepository } from './reminders.repository.js';

type ReminderPayload = DesireReminderJobData & { metadata?: LogContext };

@Processor(desireReminderQueue, { concurrency: 2 })
export class RemindersProcessor extends WorkerHost {
  constructor(
    private readonly repository: RemindersRepository,
    private readonly notifier: NtfyNotifierService,
    private readonly logger: EventLogger,
  ) {
    super();
  }

  async process(job: Job<ReminderPayload>): Promise<void> {
    await Promise.resolve(
      logContext.run(jobContext(job.data.metadata, job.id, job.attemptsMade), async () => {
        const endSpan = startOperation(
          job.name === desireReminderJob ? 'desire.wait-ended' : '/unmatched',
        );
        const started = performance.now();
        this.logger.emit('info', {
          event: 'job_started',
          component: 'reminders',
          operation: 'deliver',
        });
        try {
          if (job.name !== desireReminderJob || !isDesireReminderJobData(job.data)) {
            throw new Error('INVALID_REMINDER_JOB');
          }
          const result = await this.repository.deliver({
            desireId: job.data.desireId,
            scheduleVersion: job.data.scheduleVersion,
            scheduledFor: new Date(job.data.scheduledFor),
          });
          if (result.status === 'delivered' && result.notificationId) {
            await this.notifier.deliver(result.notificationId);
          }
          this.logger.emit('info', {
            event: 'job_completed',
            component: 'reminders',
            operation: result.status,
            durationMs: performance.now() - started,
          });
        } catch (error) {
          const retry = job.attemptsMade + 1 < (job.opts.attempts ?? 1);
          if (!retry) captureFailure(error, { operation: 'deliver', code: 'REMINDER_JOB_FAILED' });
          this.logger.emit(retry ? 'warn' : 'error', {
            event: retry ? 'job_retry' : 'job_failed',
            component: 'reminders',
            operation: 'deliver',
            category: 'operational_failure',
            code: 'REMINDER_JOB_FAILED',
            error,
            durationMs: performance.now() - started,
          });
          throw error;
        } finally {
          endSpan();
        }
      }),
    );
  }

  @OnWorkerEvent('error')
  onError(error: Error): void {
    this.logger.emit('error', {
      event: 'worker_error',
      component: 'reminders',
      category: 'operational_failure',
      error,
    });
  }
}
