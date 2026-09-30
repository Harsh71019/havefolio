import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { SYSTEM_QUEUE } from '../worker.constants.js';

export interface SystemJobPayload {
  requestedAt: string;
}

@Processor(SYSTEM_QUEUE)
export class SystemProcessor extends WorkerHost {
  process(job: Job<SystemJobPayload>): Promise<void> {
    if (job.name !== 'system.noop') {
      throw new Error(`Unsupported system job: ${job.name}`);
    }

    return Promise.resolve();
  }
}
