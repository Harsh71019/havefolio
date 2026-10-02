import type { WorkerEnvironment } from '@havefolio/config';
import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { WORKER_ENVIRONMENT } from './worker.constants.js';

@Injectable()
export class WorkerRuntimeService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WorkerRuntimeService.name);
  private keepAliveTimer: NodeJS.Timeout | undefined;

  constructor(
    @Inject(WORKER_ENVIRONMENT)
    private readonly environment: WorkerEnvironment,
  ) {}

  onModuleInit(): void {
    const mode = this.environment.WORKER_QUEUE_ENABLED ? 'connected' : 'standby';
    this.logger.log({ event: 'worker_started', component: 'runtime', operation: mode });

    if (!this.environment.WORKER_QUEUE_ENABLED) {
      this.keepAliveTimer = setInterval(() => undefined, 60_000);
    }
  }

  onModuleDestroy(): void {
    if (this.keepAliveTimer) {
      clearInterval(this.keepAliveTimer);
    }
  }
}
