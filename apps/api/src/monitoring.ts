import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { initializeMonitoring } from '@havefolio/monitoring/server';
for (const file of [
  resolve(process.cwd(), '.env.local'),
  resolve(process.cwd(), '../../.env.local'),
]) {
  if (existsSync(file)) {
    process.loadEnvFile(file);
    break;
  }
}
initializeMonitoring('api');
