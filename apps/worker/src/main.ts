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
  const app = await NestFactory.createApplicationContext(WorkerModule.register(environment));
  app.enableShutdownHooks();
}

void bootstrap();
