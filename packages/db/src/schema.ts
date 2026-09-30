import { pgTable, text } from 'drizzle-orm/pg-core';

// Infrastructure metadata only; product-domain tables belong to their own tickets.
export const applicationMetadata = pgTable('application_metadata', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});
