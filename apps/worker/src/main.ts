import './monitoring.js';
import { captureFailure, flushMonitoring } from '@havefolio/monitoring/server';
import { Logger } from 'nestjs-pino';
import 'reflect-metadata';
import { validateWorkerEnvironment } from '@havefolio/config';
import { NestFactory } from '@nestjs/core';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { WorkerModule } from './worker.module.js';

function loadLocalEnvironment(): void {
  const environmentFile = [
    resolve(process.cwd(), '.env.local'),
    resolve(process.cwd(), '../../.env.local'),
  ].find(existsSync);

  if (environmentFile) {
    process.loadEnvFile(environmentFile);
  }
}

async function bootstrap(): Promise<void> {
  loadLocalEnvironment();
  const environment = validateWorkerEnvironment(process.env);
  const app = await NestFactory.createApplicationContext(WorkerModule.register(environment), {
    bufferLogs: true,
    abortOnError: false,
    logger: false,
  });
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();
}

void bootstrap().catch(async (error: unknown) => {
  captureFailure(error, { code: 'STARTUP_FAILED', operation: 'bootstrap' });
  await flushMonitoring();
  process.stderr.write(
    JSON.stringify({
      application: 'havefolio',
      service: 'worker',
      environment: 'unknown',
      release: 'unknown',
      time: Date.now(),
      event: 'startup_failed',
      level: 50,
      component: 'bootstrap',
      category: 'configuration_or_dependency_failure',
    }) + '\n',
  );
  process.exitCode = 1;
});
