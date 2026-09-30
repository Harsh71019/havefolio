import { randomBytes } from 'node:crypto';
import { appendFile } from 'node:fs/promises';
import pg from 'pg';
import { Redis } from 'ioredis';

// Only for ephemeral, loopback CI service containers; never an operator/shared-service tool.
if (process.env.CI !== 'true' || !process.env.GITHUB_ENV) {
  throw new Error('CI provisioning requires a GitHub Actions ephemeral runner.');
}
const pgPort = Number(process.env.CI_POSTGRES_PORT || 5432);
const valkeyPort = Number(process.env.CI_VALKEY_PORT || 6379);
if (![pgPort, valkeyPort].every((port) => Number.isInteger(port) && port > 0 && port < 65536))
  throw new Error('Invalid loopback port');
const id = randomBytes(8).toString('hex');
const database = `ci_${id}_test`;
const migration = `ci_${id}_migrate`;
const runtime = `ci_${id}_runtime`;
const password = randomBytes(32).toString('hex');
console.log(`::add-mask::${password}`);
const admin = new pg.Client({
  connectionString: `postgresql://postgres@127.0.0.1:${pgPort}/postgres`,
});
const valkey = new Redis({
  host: '127.0.0.1',
  port: valkeyPort,
  lazyConnect: true,
  retryStrategy: () => null,
});
valkey.on('error', () => undefined);
try {
  await admin.connect();
  await admin.query(
    `CREATE ROLE ${pg.escapeIdentifier(migration)} LOGIN PASSWORD ${pg.escapeLiteral(password)} NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT`,
  );
  await admin.query(
    `CREATE ROLE ${pg.escapeIdentifier(runtime)} LOGIN PASSWORD ${pg.escapeLiteral(password)} NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT`,
  );
  await admin.query(
    `CREATE DATABASE ${pg.escapeIdentifier(database)} OWNER ${pg.escapeIdentifier(migration)}`,
  );
  await admin.query(`REVOKE ALL ON DATABASE ${pg.escapeIdentifier(database)} FROM PUBLIC`);
  await admin.query(
    `GRANT CONNECT ON DATABASE ${pg.escapeIdentifier(database)} TO ${pg.escapeIdentifier(runtime)}`,
  );
  const owner = new pg.Client({
    connectionString: `postgresql://${migration}:${password}@127.0.0.1:${pgPort}/${database}`,
  });
  try {
    await owner.connect();
    await owner.query('REVOKE CREATE ON SCHEMA public FROM PUBLIC');
    await owner.query(`GRANT USAGE ON SCHEMA public TO ${pg.escapeIdentifier(runtime)}`);
    await owner.query(
      `ALTER DEFAULT PRIVILEGES GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${pg.escapeIdentifier(runtime)}`,
    );
    await owner.query(
      `ALTER DEFAULT PRIVILEGES GRANT USAGE, SELECT ON SEQUENCES TO ${pg.escapeIdentifier(runtime)}`,
    );
  } finally {
    await owner.end();
  }
  await valkey.connect();
  await valkey.acl(
    'SETUSER',
    runtime,
    'reset',
    'on',
    `>${password}`,
    '~havefolio:test:*',
    '+ping',
    '+get',
    '+set',
    '+del',
    '+client|setinfo',
  );
  await appendFile(
    process.env.GITHUB_ENV,
    [
      `TEST_MIGRATION_DATABASE_URL=postgresql://${migration}:${password}@127.0.0.1:${pgPort}/${database}`,
      `TEST_DATABASE_URL=postgresql://${runtime}:${password}@127.0.0.1:${pgPort}/${database}`,
      'TEST_VALKEY_HOST=127.0.0.1',
      `TEST_VALKEY_PORT=${valkeyPort}`,
      `TEST_VALKEY_USERNAME=${runtime}`,
      `TEST_VALKEY_PASSWORD=${password}`,
      'TEST_VALKEY_ACL_ENFORCED=true',
    ].join('\n') + '\n',
    { mode: 0o600 },
  );
  console.log('PASS: created empty ephemeral database, separate roles and restricted test ACL.');
} catch {
  console.error('Ephemeral CI provisioning failed; details withheld.');
  process.exitCode = 1;
} finally {
  await admin.end();
  valkey.disconnect();
}
