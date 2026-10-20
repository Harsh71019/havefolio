// PER-73 real-browser evidence. Requires dedicated IntegrationRun test settings
// and a completed production build; creates and removes synthetic data only.
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { URL } from 'node:url';
import process from 'node:process';
import console from 'node:console';
import { Test } from '@nestjs/testing';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { IntegrationRun, integrationConfiguration } from '@havefolio/test-utils';
import { TelemetryModule } from '@havefolio/logging';
import { validateApiEnvironment } from '@havefolio/config';
import { AuthModule } from '../dist/auth/auth.module.js';
import { ItemsModule } from '../dist/items/items.module.js';
import { MerchantsModule } from '../dist/merchants/merchants.module.js';
import { TaxonomyModule } from '../dist/taxonomy/taxonomy.module.js';
import { configureApplication } from '../dist/app.setup.js';
import { newToken, hashToken } from '../dist/auth/session-cookie.service.js';
const config = integrationConfiguration();
const run = new IntegrationRun(config);
let app;
try {
  await run.start();
  const owner = randomUUID(),
    token = newToken();
  await run.runtime.query(
    "INSERT INTO users(id,email,password_hash) VALUES($1,'per73-browser@example.test','$argon2id$fixture')",
    [owner],
  );
  await run.runtime.query(
    "INSERT INTO auth_sessions(owner_id,token_hash,idle_expires_at,absolute_expires_at) VALUES($1,$2,now()+interval '1 hour',now()+interval '1 day')",
    [owner, hashToken(token)],
  );
  const url = new URL(config.runtimeUrl);
  url.searchParams.set('options', `-c search_path=${run.schema},pg_catalog`);
  const module = await Test.createTestingModule({
    imports: [
      TelemetryModule.register('api'),
      ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, ignoreEnvVars: true }),
      AuthModule,
      ItemsModule,
      TaxonomyModule,
      MerchantsModule,
    ],
  })
    .overrideProvider(ConfigService)
    .useValue(
      new ConfigService({
        ...validateApiEnvironment({ NODE_ENV: 'test' }),
        DATABASE_URL: url.toString(),
      }),
    )
    .compile();
  app = module.createNestApplication({ logger: false });
  configureApplication(app);
  await app.listen(0, '127.0.0.1');
  const address = app.getHttpServer().address();
  await new Promise((resolve, reject) => {
    const child = spawn(
      'pnpm',
      ['--filter', '@havefolio/web', 'exec', 'playwright', 'test', 'collapsed-metadata.spec.ts'],
      {
        stdio: 'inherit',
        env: {
          ...process.env,
          PER73_TEST_API: `http://127.0.0.1:${address.port}`,
          PER73_TEST_COOKIE: `havefolio_session=${token}`,
        },
      },
    );
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`Browser exit ${code}`)),
    );
  });
  const rows = await run.runtime.query(
    'SELECT acquisition_type,condition,use_frequency,price_paid_minor FROM items WHERE owner_id=$1',
    [owner],
  );
  if (
    rows.rows.length !== 2 ||
    rows.rows.some(
      (row) =>
        row.acquisition_type !== 'gift' ||
        row.condition !== 'worn_out' ||
        row.use_frequency !== 'rarely' ||
        row.price_paid_minor !== null,
    )
  )
    throw new Error('Persisted browser results mismatch');
  console.log(
    'PASS: two browser projects persisted exactly two gifts, matching metadata and no inferred price.',
  );
} finally {
  await app?.close();
  await run.close();
}
