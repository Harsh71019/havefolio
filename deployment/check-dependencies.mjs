import process from 'node:process';
import console from 'node:console';
import pg from 'pg';
import Redis from 'ioredis';
const db = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 5000,
});
const redis = new Redis({
  host: process.env.VALKEY_HOST,
  port: Number(process.env.VALKEY_PORT || 6379),
  username: process.env.VALKEY_USERNAME,
  password: process.env.VALKEY_PASSWORD,
  lazyConnect: true,
  connectTimeout: 5000,
  retryStrategy: () => null,
});
try {
  await db.connect();
  await db.query('SELECT 1 FROM users LIMIT 1');
  await redis.connect();
  await redis.ping();
} catch {
  console.error(
    JSON.stringify({
      application: 'havefolio',
      service: 'api',
      environment: 'production',
      release: /^[A-Za-z0-9_.-]{1,80}$/.test(process.env.LOG_RELEASE ?? '')
        ? process.env.LOG_RELEASE
        : 'unknown',
      time: Date.now(),
      level: 50,
      event: 'startup_dependency_failed',
      component: 'bootstrap',
      category: 'operational_failure',
    }),
  );
  process.exitCode = 1;
} finally {
  await db.end().catch(() => {});
  redis.disconnect();
}
