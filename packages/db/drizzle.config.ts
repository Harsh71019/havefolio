import { defineConfig } from 'drizzle-kit';

// Generation/checking are offline and must never load connection secrets.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema.ts',
  out: './migrations',
  strict: true,
});
