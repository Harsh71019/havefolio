import { enrichmentQueue } from '@havefolio/domain';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { EventLogger } from '@havefolio/logging';
import { EnrichmentWorkerService } from './enrichment.service.js';
@Processor(enrichmentQueue, { concurrency: 1 })
export class EnrichmentProcessor extends WorkerHost {
  constructor(
    private readonly service: EnrichmentWorkerService,
    private readonly logger: EventLogger,
  ) {
    super();
  }
  async process(job: Job<{ workId?: unknown }>): Promise<void> {
    if (
      job.name === 'suggest' &&
      typeof job.data.workId === 'string' &&
      /^[a-f0-9-]{36}$/i.test(job.data.workId)
    )
      await this.service.process(job.data.workId);
  }
  @OnWorkerEvent('error') onError(): void {
    this.logger.emit('warn', {
      event: 'worker_error',
      component: 'enrichment',
      operation: 'queue',
      code: 'ENRICHMENT_QUEUE_UNAVAILABLE',
      category: 'operational_failure',
    });
  }
}
