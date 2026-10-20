import { EnrichmentStore } from '@havefolio/db';
import type { WorkerEnvironment } from '@havefolio/config';
import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { Pool } from 'pg';
import { WORKER_ENVIRONMENT } from '../worker.constants.js';
@Injectable()
export class EnrichmentRepository implements OnModuleDestroy {
  private readonly pool?: Pool;
  readonly store?: EnrichmentStore;
  constructor(@Inject(WORKER_ENVIRONMENT) environment: WorkerEnvironment) {
    if (environment.DATABASE_URL) {
      this.pool = new Pool({
        connectionString: environment.DATABASE_URL,
        max: 2,
        connectionTimeoutMillis: 3000,
        idleTimeoutMillis: 10000,
        statement_timeout: 5000,
      });
      this.pool.on('error', () => undefined);
      this.store = new EnrichmentStore(this.pool);
    }
  }
  async onModuleDestroy(): Promise<void> {
    await this.pool?.end();
  }
}
