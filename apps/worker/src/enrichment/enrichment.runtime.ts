import { enrichmentQueue } from '@havefolio/domain';
import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Optional, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { EventLogger } from '@havefolio/logging';
import { EnrichmentRepository } from './enrichment.repository.js';
import { EnrichmentWorkerService } from './enrichment.service.js';
@Injectable()
export class EnrichmentRuntime implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private running = false;
  private hintPending = false;
  constructor(
    private readonly repository: EnrichmentRepository,
    private readonly service: EnrichmentWorkerService,
    private readonly logger: EventLogger,
    @Optional() @InjectQueue(enrichmentQueue) private readonly queue?: Queue,
  ) {}
  onModuleInit(): void {
    void this.reconcile();
    this.timer = setInterval(() => void this.reconcile(), 5000);
    this.timer.unref();
  }
  async reconcile(): Promise<void> {
    if (this.running || !this.repository.store) return;
    this.running = true;
    try {
      for (const id of await this.repository.store.due()) {
        // Queue hints contain only opaque IDs; database claims make duplicate delivery safe.
        // A stalled Redis connection does not delay authoritative database recovery.
        if (this.queue && !this.hintPending) {
          this.hintPending = true;
          void this.queue
            .add(
              'suggest',
              { workId: id },
              {
                jobId: id,
                attempts: 1,
                removeOnComplete: true,
                removeOnFail: { age: 3600, count: 100 },
              },
            )
            .catch(() => undefined)
            .finally(() => {
              this.hintPending = false;
            });
        }
        await this.service.process(id);
      }
    } catch {
      this.logger.emit('warn', {
        event: 'worker_error',
        component: 'enrichment',
        operation: 'reconcile',
        code: 'ENRICHMENT_WORK_UNAVAILABLE',
        category: 'operational_failure',
      });
    } finally {
      this.running = false;
    }
  }
  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
