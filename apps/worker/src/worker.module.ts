import { enrichmentQueue } from '@havefolio/domain';
import { EnrichmentRepository } from './enrichment/enrichment.repository.js';
import { EnrichmentWorkerService, ENRICHMENT_PROVIDERS } from './enrichment/enrichment.service.js';
import { EnrichmentRuntime } from './enrichment/enrichment.runtime.js';
import { LocalOcrProvider } from './enrichment/ocr/local-ocr.provider.js';
import { CloudinaryImageReader } from './enrichment/ocr/media-reader.js';
import { EnrichmentProcessor } from './enrichment/enrichment.processor.js';
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
import { desireReminderQueue } from '@havefolio/domain';
import { RemindersProcessor } from './reminders/reminders.processor.js';
import { RemindersRepository } from './reminders/reminders.repository.js';
import { NtfyNotifierService } from './reminders/ntfy-notifier.service.js';
import { ReminderReconciliationService } from './reminders/reminder-reconciliation.service.js';

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
          BullModule.registerQueue(
            { name: enrichmentQueue, prefix: environment.VALKEY_PREFIX },
            {
              name: SYSTEM_QUEUE,
              prefix: environment.VALKEY_PREFIX,
            },
            {
              name: desireReminderQueue,
              prefix: environment.VALKEY_PREFIX,
            },
          ),
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
        EnrichmentRepository,
        EnrichmentWorkerService,
        EnrichmentRuntime,
        {
          provide: ENRICHMENT_PROVIDERS,
          inject: [EnrichmentRepository],
          // PER-45: only an explicit OCR_ENABLED registers the local adapter; environment
          // validation has already required media credentials and the runtime database.
          useFactory: (repository: EnrichmentRepository) =>
            environment.OCR_ENABLED && repository.store
              ? [
                  new LocalOcrProvider(
                    repository.store,
                    new CloudinaryImageReader({
                      NODE_ENV: environment.NODE_ENV,
                      CLOUDINARY_CLOUD_NAME: environment.CLOUDINARY_CLOUD_NAME!,
                      CLOUDINARY_API_KEY: environment.CLOUDINARY_API_KEY!,
                      CLOUDINARY_API_SECRET: environment.CLOUDINARY_API_SECRET!,
                    }),
                  ),
                ]
              : [],
        },
        ...(environment.WORKER_QUEUE_ENABLED
          ? [
              SystemProcessor,
              EnrichmentProcessor,
              RemindersRepository,
              NtfyNotifierService,
              RemindersProcessor,
              ReminderReconciliationService,
            ]
          : []),
      ],
    };
  }
}
