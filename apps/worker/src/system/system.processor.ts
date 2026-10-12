import { captureFailure, startOperation } from '@havefolio/monitoring/server';
import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { EventLogger, jobContext, logContext, type LogContext } from '@havefolio/logging';
import { SYSTEM_QUEUE } from '../worker.constants.js';

export interface SystemJobPayload {
  requestedAt: string;
  metadata?: LogContext;
}

@Processor(SYSTEM_QUEUE)
export class SystemProcessor extends WorkerHost {
  constructor(private readonly logger: EventLogger) {
    super();
  }
  async process(job: Job<SystemJobPayload>): Promise<void> {
    await Promise.resolve(
      logContext.run(jobContext(job.data.metadata, job.id, job.attemptsMade), () => {
        const endSpan = startOperation(job.name === 'system.noop' ? 'system.noop' : '/unmatched');
        const started = performance.now();
        const operation = job.name === 'system.noop' ? 'system.noop' : 'unsupported';
        this.logger.emit('info', { event: 'job_started', component: 'system', operation });
        try {
          if (job.name !== 'system.noop') throw new Error('Unsupported system operation');
          this.logger.emit('info', {
            event: 'job_completed',
            component: 'system',
            operation,
            durationMs: performance.now() - started,
          });
        } catch (error) {
          const retry = job.attemptsMade + 1 < (job.opts.attempts ?? 1);
          if (!retry) captureFailure(error, { operation, code: 'UNSUPPORTED_OPERATION' });
          this.logger.emit(retry ? 'warn' : 'error', {
            event: retry ? 'job_retry' : 'job_failed',
            component: 'system',
            operation,
            category: 'controlled_failure',
            code: 'UNSUPPORTED_OPERATION',
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
    // Connection retries are expected; actionable terminal jobs are captured above.
    this.logger.emit('error', {
      event: 'worker_error',
      component: 'system',
      category: 'operational_failure',
      error,
    });
  }
}
