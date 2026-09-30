import { fileURLToPath } from 'node:url';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { Pool, Client } from 'pg';
import * as schema from './schema.js';

export { applicationMetadata } from './schema.js';

export function createDatabase(client: Pool | Client): NodePgDatabase<typeof schema> {
  return drizzle(client, { schema });
}

export async function applyMigrations(
  client: Pool | Client,
  migrationsSchema = 'drizzle',
): Promise<void> {
  await migrate(createDatabase(client), {
    migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)),
    migrationsSchema,
  });
}
