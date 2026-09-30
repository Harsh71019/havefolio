import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { Redis } from 'ioredis';
import { applyMigrations } from '@havefolio/db';

export interface IntegrationConfiguration {
  migrationUrl: string;
  runtimeUrl: string;
  valkeyHost: string;
  valkeyPort: number;
  valkeyUsername: string;
  valkeyPassword: string;
}

export function integrationConfiguration(
  environment: NodeJS.ProcessEnv = process.env,
): IntegrationConfiguration {
  const required = (key: string): string => {
    const value = environment[key];
    if (!value) throw new Error(`Missing integration setting: ${key}`);
    return value;
  };
  try {
    const migrationUrl = required('TEST_MIGRATION_DATABASE_URL');
    const runtimeUrl = required('TEST_DATABASE_URL');
    const migration = new URL(migrationUrl);
    const runtime = new URL(runtimeUrl);
    if (
      !['postgres:', 'postgresql:'].includes(migration.protocol) ||
      !['postgres:', 'postgresql:'].includes(runtime.protocol) ||
      !migration.pathname.endsWith('_test') ||
      migration.pathname !== runtime.pathname ||
      migration.host !== runtime.host ||
      !migration.username ||
      !runtime.username ||
      migration.username === runtime.username ||
      migration.search ||
      runtime.search
    )
      throw new Error('Invalid test database boundary');
    const valkeyPort = Number(required('TEST_VALKEY_PORT'));
    if (!Number.isInteger(valkeyPort) || valkeyPort < 1 || valkeyPort > 65535) {
      throw new Error('Invalid test port');
    }
    return {
      migrationUrl,
      runtimeUrl,
      valkeyHost: required('TEST_VALKEY_HOST'),
      valkeyPort,
      valkeyUsername: required('TEST_VALKEY_USERNAME'),
      valkeyPassword: required('TEST_VALKEY_PASSWORD'),
    };
  } catch {
    throw new Error(
      'Integration configuration requires dedicated test URLs (same *_test database, distinct roles, no URL options) and authenticated Valkey settings.',
    );
  }
}

export class IntegrationRun {
  readonly schema = `hf_test_${randomUUID().replaceAll('-', '')}`;
  readonly prefix = `havefolio:test:${this.schema}`;
  readonly migration: pg.Client;
  readonly runtime: pg.Client;
  readonly valkey: Redis;
  private schemaCreated = false;
  private readonly keys = new Set<string>();

  constructor(config: IntegrationConfiguration) {
    const options = {
      connectionTimeoutMillis: 5000,
      query_timeout: 10000,
      options: `-c search_path=${this.schema},pg_catalog`,
    };
    this.migration = new pg.Client({ ...options, connectionString: config.migrationUrl });
    this.runtime = new pg.Client({ ...options, connectionString: config.runtimeUrl });
    this.valkey = new Redis({
      host: config.valkeyHost,
      port: config.valkeyPort,
      username: config.valkeyUsername,
      password: config.valkeyPassword,
      db: 0,
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 0,
      retryStrategy: () => null,
      connectTimeout: 5000,
    });
    // Never let transport error emitters print connection details.
    this.valkey.on('error', () => undefined);
    this.migration.on('error', () => undefined);
    this.runtime.on('error', () => undefined);
  }

  async start(): Promise<void> {
    try {
      await this.migration.connect();
      await this.runtime.connect();
      const roles = await this.runtime.query<{ privileged: boolean }>(
        'SELECT rolsuper OR rolcreatedb OR rolcreaterole AS privileged FROM pg_roles WHERE rolname = current_user',
      );
      if (roles.rows[0]?.privileged !== false) throw new Error('Privileged runtime role');
      const identity = await this.runtime.query<{ user: string }>('SELECT current_user AS "user"');
      const role = identity.rows[0]?.user;
      if (!role) throw new Error('Missing runtime role');
      await this.migration.query(`CREATE SCHEMA "${this.schema}"`);
      this.schemaCreated = true;
      // PER-3 default grants are scoped to public. Keep new grants confined to this run.
      await this.migration.query(
        `ALTER DEFAULT PRIVILEGES IN SCHEMA "${this.schema}" GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${pg.escapeIdentifier(role)}`,
      );
      await this.migration.query(
        `ALTER DEFAULT PRIVILEGES IN SCHEMA "${this.schema}" GRANT USAGE, SELECT ON SEQUENCES TO ${pg.escapeIdentifier(role)}`,
      );
      await applyMigrations(this.migration, this.schema);
      await this.migration.query(
        `GRANT USAGE ON SCHEMA "${this.schema}" TO ${pg.escapeIdentifier(role)}`,
      );
      await this.valkey.connect();
    } catch {
      try {
        await this.close();
      } catch {
        /* Keep the public failure redacted. */
      }
      throw new Error(
        'Integration setup failed; verify dedicated test service access and role grants.',
      );
    }
  }

  async setKey(name: string, value: string): Promise<string> {
    if (!/^[a-z0-9_-]+$/.test(name)) throw new Error('Invalid test key suffix');
    const key = `${this.prefix}:${name}`;
    this.keys.add(key);
    await this.valkey.set(key, value, 'EX', 300);
    return key;
  }

  async close(): Promise<void> {
    // Attempt every teardown step even when one fails. Never discover keys or reset a DB.
    const results = await Promise.allSettled([
      (async (): Promise<void> => {
        try {
          if (this.keys.size && this.valkey.status === 'ready') {
            await this.valkey.del(...this.keys);
            this.keys.clear();
          }
        } finally {
          this.valkey.disconnect();
        }
      })(),
      (async (): Promise<void> => {
        try {
          if (this.schemaCreated) {
            await this.migration.query(`DROP SCHEMA "${this.schema}" CASCADE`);
            this.schemaCreated = false;
          }
        } finally {
          await this.migration.end();
        }
      })(),
      this.runtime.end(),
    ]);
    if (results.some((result) => result.status === 'rejected')) {
      throw new Error(
        'Test teardown failed; inspect only this run schema. Keys expire within five minutes.',
      );
    }
  }
}
