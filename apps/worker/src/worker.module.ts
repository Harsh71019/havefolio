import { TelemetryModule } from '@havefolio/logging';
import type { WorkerEnvironment } from '@havefolio/config';
import { BullModule } from '@nestjs/bullmq';
import { type DynamicModule, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { resolve } from 'node:path';
import { validateWorkerEnvironment } from '@havefolio/config';
import { SystemProcessor } from './system/system.processor.js';
import { SYSTEM_QUEUE, WORKER_ENVIRONMENT } from './worker.constants.js';
import { WorkerRuntimeService } from './worker-runtime.service.js';

@Module({})
export class WorkerModule {
  static register(environment: WorkerEnvironment): DynamicModule {
    const queueImports = environment.WORKER_QUEUE_ENABLED
      ? [
          BullModule.forRoot({
            connection: {
              db: environment.VALKEY_DATABASE,
              host: environment.VALKEY_HOST,
              port: environment.VALKEY_PORT,
              ...(environment.VALKEY_PASSWORD ? { password: environment.VALKEY_PASSWORD } : {}),
              ...(environment.VALKEY_USERNAME ? { username: environment.VALKEY_USERNAME } : {}),
            },
          }),
          BullModule.registerQueue({
            name: SYSTEM_QUEUE,
            prefix: environment.VALKEY_PREFIX,
          }),
        ]
      : [];

    return {
      module: WorkerModule,
      imports: [
        ConfigModule.forRoot({
          cache: true,
          envFilePath: [
            resolve(process.cwd(), '../../.env.local'),
            resolve(process.cwd(), '.env.local'),
          ],
          isGlobal: true,
          validate: validateWorkerEnvironment,
        }),
        TelemetryModule.register('worker'),
        ...queueImports,
      ],
      providers: [
        { provide: WORKER_ENVIRONMENT, useValue: environment },
        WorkerRuntimeService,
        ...(environment.WORKER_QUEUE_ENABLED ? [SystemProcessor] : []),
      ],
    };
  }
}
