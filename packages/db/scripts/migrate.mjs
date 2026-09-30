import pg from 'pg';
import { applyMigrations } from '../dist/index.js';

const connectionString = process.env.MIGRATION_DATABASE_URL;
if (!connectionString) {
  console.error('MIGRATION_DATABASE_URL is required; runtime credentials are never a fallback.');
  process.exit(1);
}
const client = new pg.Client({ connectionString, connectionTimeoutMillis: 5000 });
try {
  await client.connect();
  await applyMigrations(client);
  console.log('Migrations applied successfully.');
} catch {
  console.error('Migration failed; connection and SQL details withheld.');
  process.exitCode = 1;
} finally {
  await client.end();
}
