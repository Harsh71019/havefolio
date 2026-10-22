import 'reflect-metadata';
import { userInfo } from 'node:os';
import process from 'node:process';
import { performance } from 'node:perf_hooks';
import { setTimeout, setInterval, clearInterval } from 'node:timers';
const { fetch, AbortSignal, console } = globalThis;
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import pg from 'pg';
import { applyMigrations } from '@havefolio/db';
import { validateApiEnvironment } from '@havefolio/config';
import { AppModule } from '../dist/app.module.js';
import { configureApplication } from '../dist/app.setup.js';
import { PrivateMediaStorage } from '../dist/media/storage.js';
import { HomeService } from '../dist/home/home.service.js';
import { randomBytes } from 'node:crypto';
import { writeFile, access, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { summary, sample } from '../../../scripts/performance/core.mjs';
import { browserBaseline } from '../../../scripts/performance/browser.mjs';
import { mediaAudit } from '../../../scripts/performance/media.mjs';
import { seed } from './performance-fixture.mjs';
const directory = process.env.PER94_DIRECTORY;
const metadata = JSON.parse(process.env.PER94_METADATA ?? '{}');
await access(join(directory, 'PER-94-owned'));
const config = metadata.config;
const origin = 'http://127.0.0.1:3195',
  api = 'http://127.0.0.1:3194/api/v1';
const admin = new pg.Client({
  host: '127.0.0.1',
  port: 55494,
  database: 'postgres',
  user: userInfo().username,
  connectionTimeoutMillis: 3000,
});
let app,
  web,
  stage = 'database',
  stopping = false;
const cleanup = async () => {
  if (stopping) return;
  stopping = true;
  web?.kill('SIGTERM');
  await app?.close();
  await admin.end();
};
for (const signal of ['SIGINT', 'SIGTERM'])
  process.once(signal, () => {
    void cleanup().finally(() => process.exit(1));
  });
const report = { metadata, cases: [], cleanup: false };
const captured = new Map();
const phases = { poolMs: [], lockRoundTripMs: [], queryRoundTripMs: [] };
const originalConnect = pg.Pool.prototype.connect;
if (config.instrument) {
  pg.Pool.prototype.connect = async function (...args) {
    if (args.length) return originalConnect.apply(this, args);
    const start = performance.now();
    const client = await originalConnect.call(this);
    phases.poolMs.push(performance.now() - start);
    if (!client.__per94) {
      client.__per94 = true;
      const query = client.query;
      client.query = function (...args) {
        const start = performance.now(),
          text = typeof args[0] === 'string' ? args[0] : args[0]?.text;
        if (
          typeof text === 'string' &&
          /^\s*SELECT/i.test(text) &&
          !/FOR UPDATE|pg_/i.test(text) &&
          captured.size < 10 &&
          !captured.has(text)
        )
          captured.set(text, args[1]);
        const key = /SELECT id FROM users WHERE id=\$1 FOR UPDATE/.test(text)
          ? 'lockRoundTripMs'
          : 'queryRoundTripMs';
        const value = query.apply(this, args);
        if (value?.then) return value.finally(() => phases[key].push(performance.now() - start));
        return value;
      };
    }
    return client;
  };
}
try {
  await admin.connect();
  const location = await admin.query('SHOW data_directory');
  if ((await realpath(location.rows[0].data_directory)) !== (await realpath(join(directory, 'pg'))))
    throw new Error('Unexpected database cluster');
  for (const size of config.sizes) {
    const suffix = randomBytes(6).toString('hex'),
      database = `per94_${suffix}_test`,
      runtime = `per94_${suffix}_runtime`,
      migration = `per94_${suffix}_migrate`;
    await admin.query(`CREATE ROLE ${migration} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE`);
    await admin.query(`CREATE ROLE ${runtime} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE`);
    await admin.query(`CREATE DATABASE ${database} OWNER ${migration}`);
    const migrationUrl = `postgresql://${migration}@127.0.0.1:55494/${database}`;
    const runtimeUrl = `postgresql://${runtime}@127.0.0.1:55494/${database}`;
    const client = new pg.Client({ connectionString: migrationUrl });
    let fixture;
    try {
      await client.connect();
      await client.query('REVOKE CREATE ON SCHEMA public FROM PUBLIC');
      await client.query(
        `ALTER DEFAULT PRIVILEGES GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO ${runtime}`,
      );
      await client.query(`ALTER DEFAULT PRIVILEGES GRANT USAGE,SELECT ON SEQUENCES TO ${runtime}`);
      await applyMigrations(client);
      await client.query(`GRANT USAGE ON SCHEMA public TO ${runtime}`);
      stage = 'fixture';
      fixture = await seed(client, size);
    } finally {
      await client.end();
    }
    console.log(`PASS: synthetic ${size}-item-per-owner fixture prepared`);
    stage = 'API startup';
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ConfigService)
      .useValue(
        new ConfigService({
          ...validateApiEnvironment({ NODE_ENV: 'test' }),
          DATABASE_URL: runtimeUrl,
          API_CORS_ORIGIN: origin,
          MEDIA_STORAGE_ENABLED: true,
        }),
      )
      .overrideProvider(PrivateMediaStorage)
      .useValue({
        read: async (key) => {
          const bytes = fixture.stored.get(key);
          if (!bytes) throw new Error('Unknown synthetic media');
          return bytes;
        },
        put: async () => {
          throw new Error('Fixture storage is read only');
        },
        delete: async () => {
          throw new Error('Fixture storage is read only');
        },
        download: () => {
          throw new Error('Provider URL access prohibited');
        },
        checkReadiness: async () => ({ status: 'ok' }),
      })
      .compile();
    app = module.createNestApplication({ logger: false, bodyParser: false });
    configureApplication(app);
    app.useBodyParser('json', { limit: '16kb' });
    await app.listen(3194, '127.0.0.1');
    const headers = { Cookie: `havefolio_session=${fixture.token}` };
    const request = async (path, authenticated = true) =>
      fetch(`${api}${path}`, {
        headers: authenticated ? headers : {},
        signal: AbortSignal.timeout(15000),
        redirect: 'error',
      });
    stage = 'isolation';
    if (
      (await request(`/items/${fixture.foreign}`)).status !== 404 ||
      (await request('/home', false)).status !== 401
    )
      throw new Error('Isolation check failed');
    const routes = [
      ['home', '/home'],
      ['items', '/items?limit=25'],
      ['filtered', '/items?q=Synthetic&limit=25'],
      ['facets', '/items/facets'],
      ['item', `/items/${fixture.item}`],
      ['spending', '/spending?scope=all-history'],
      ['merchants', '/spending/merchants'],
    ];
    const row = { sizePerOwner: size, fixture: fixture.counts, api: [], browser: [] };
    stage = 'API samples';
    for (const [endpoint, path] of config.api ? routes : []) {
      for (let i = 0; i < 20; i++) {
        const r = await request(path);
        await r.arrayBuffer();
        if (!r.ok) throw new Error('Warmup failed');
      }
      for (const concurrency of [1, 4]) {
        for (const key of Object.keys(phases)) phases[key] = [];
        captured.clear();
        const waits = { samples: 0, lockSessions: 0, ioSessions: 0, activeSessions: 0 };
        let sampling = false;
        const timer = config.instrument
          ? setInterval(async () => {
              if (sampling) return;
              sampling = true;
              try {
                const r = await admin.query(
                  "SELECT count(*) FILTER(WHERE wait_event_type='Lock')::int AS locks,count(*) FILTER(WHERE wait_event_type='IO')::int AS io,count(*) FILTER(WHERE state='active')::int AS active FROM pg_stat_activity WHERE datname=$1",
                  [database],
                );
                waits.samples++;
                waits.lockSessions += r.rows[0].locks;
                waits.ioSessions += r.rows[0].io;
                waits.activeSessions += r.rows[0].active;
              } catch {
                /* No request text captured. */
              } finally {
                sampling = false;
              }
            }, 20)
          : undefined;
        const result = await sample(config.samples, concurrency, async () => {
          const r = await request(path);
          await r.arrayBuffer();
          return r.status;
        });
        clearInterval(timer);
        while (sampling) await new Promise((r) => setTimeout(r, 1));
        const db = Object.fromEntries(
          Object.entries(phases)
            .filter(([, v]) => v.length)
            .map(([key, v]) => [key, summary(v)]),
        );
        const plans = [];
        if (config.instrument && concurrency === 1) {
          const explain = new pg.Client({ connectionString: runtimeUrl });
          try {
            await explain.connect();
            for (const [text, values] of captured) {
              const result = await explain.query(
                'EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ' + text,
                values,
              );
              const plan = result.rows[0]['QUERY PLAN'][0];
              plans.push({
                executionMs: plan['Execution Time'],
                planningMs: plan['Planning Time'],
                rows: plan.Plan['Actual Rows'],
                sharedHitBlocks: plan.Plan['Shared Hit Blocks'],
                sharedReadBlocks: plan.Plan['Shared Read Blocks'],
                node: plan.Plan['Node Type'],
              });
            }
          } finally {
            await explain.end();
          }
        }
        row.api.push({ endpoint, concurrency, ...result, db, waits, plans });
        console.log(
          `Measured ${size}/${endpoint}/c${concurrency}: p95=${result.latencyMs.p95}ms errors=${result.errors}`,
        );
        if (result.errors) throw new Error('API measurement errors');
      }
    }
    // The product permits only one credentialed owner. Do not drop its unique index to fake mixed-owner HTTP.
    const service = app.get(HomeService);
    if (config.api)
      row.mixedOwnerService = await sample(config.samples, 4, async (i) => {
        await service.summary(fixture.owners[i % 2]);
        return 200;
      });
    if (config.browser) {
      stage = 'web startup';
      const require = (await import('node:module')).createRequire(
        resolve(import.meta.dirname, '../../web/package.json'),
      );
      web = spawn(
        process.execPath,
        [
          require.resolve('next/dist/bin/next'),
          'start',
          '--hostname',
          '127.0.0.1',
          '--port',
          '3195',
        ],
        {
          cwd: resolve(import.meta.dirname, '../../web'),
          env: {
            ...process.env,
            NODE_ENV: 'production',
            NEXT_PUBLIC_API_BASE_URL: api,
            NEXT_TELEMETRY_DISABLED: '1',
          },
          stdio: ['ignore', 'pipe', 'ignore'],
        },
      );
      let ready = false,
        ownReady = false,
        readyText = '';
      web.stdout.on('data', (data) => {
        readyText = (readyText + data.toString()).slice(-8192);
        ownReady = readyText.includes('Ready in');
      });
      for (let i = 0; i < 100; i++) {
        if (web.exitCode !== null) throw new Error('Owned web process failed');
        if (!ownReady) {
          await new Promise((r) => setTimeout(r, 100));
          continue;
        }
        try {
          const r = await fetch(origin, { signal: AbortSignal.timeout(500) });
          await r.arrayBuffer();
          if (r.ok) {
            ready = true;
            break;
          }
        } catch {
          /* Own loopback only. */
        }
        await new Promise((r) => setTimeout(r, 100));
      }
      if (!ready) throw new Error('Production web unavailable');
      stage = 'browser';
      // PER-97 media audit replaces the route matrix; the API phase is unchanged.
      row[config.mediaAudit ? 'media' : 'browser'] = await (
        config.mediaAudit ? mediaAudit : browserBaseline
      )({
        origin,
        fixture,
        runs: config.runs,
        metadata: report.metadata,
      });
      web.kill('SIGTERM');
      await new Promise((r) => web.once('exit', r));
      web = undefined;
    }
    const verify = new pg.Client({ connectionString: runtimeUrl });
    try {
      await verify.connect();
      const count = await verify.query('SELECT count(*)::int AS n FROM items');
      if (count.rows[0].n !== size * 2) throw new Error('Fixture size drift');
    } finally {
      await verify.end();
    }
    row.fixtureRestored = true;
    report.cases.push(row);
    await app.close();
    app = undefined;
    fixture.stored.clear();
    stage = 'cleanup';
    await admin.query(`DROP DATABASE ${database}`);
    await admin.query(`DROP ROLE ${runtime}`);
    await admin.query(`DROP ROLE ${migration}`);
    const left = await admin.query('SELECT 1 FROM pg_database WHERE datname=$1', [database]);
    if (left.rowCount) throw new Error('Cleanup verification failed');
    console.log('PASS: fixture database and both roles removed');
  }
  report.cleanup = true;
  await writeFile(join(directory, 'result.json'), JSON.stringify(report));
} catch (error) {
  console.error(
    `FAIL: PER-94 ${stage}; code=${/^[A-Z0-9_]{1,24}$/.test(error.code ?? '') ? error.code : 'withheld'}`,
  );
  process.exitCode = 1;
} finally {
  pg.Pool.prototype.connect = originalConnect;
  await cleanup();
}
