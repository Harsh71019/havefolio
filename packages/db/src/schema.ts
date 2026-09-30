import { sql } from 'drizzle-orm';
import {
  pgTable,
  text,
  uuid,
  bigint,
  integer,
  timestamp,
  index,
  uniqueIndex,
  unique,
  check,
  foreignKey,
} from 'drizzle-orm/pg-core';

// Infrastructure metadata only; product-domain tables belong to their own tickets.
export const applicationMetadata = pgTable('application_metadata', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

// Owner FK is added with PER-7's identity model; no unauthenticated route uses this table.
export const mediaAttachments = pgTable(
  'media_attachments',
  {
    id: uuid('id').primaryKey(),
    ownerId: uuid('owner_id').notNull(),
    parentId: uuid('parent_id'),
    kind: text('kind', { enum: ['photo', 'receipt', 'warranty'] }).notNull(),
    variant: text('variant', { enum: ['original', 'display', 'thumbnail'] }).notNull(),
    state: text('state', { enum: ['pending', 'ready', 'deleting', 'deleted'] })
      .notNull()
      .default('pending'),
    provider: text('provider').notNull().default('cloudinary'),
    objectKey: text('object_key').notNull(),
    resourceType: text('resource_type', { enum: ['image', 'raw'] }).notNull(),
    format: text('format', { enum: ['jpg', 'png', 'webp', 'pdf'] }).notNull(),
    providerAssetId: text('provider_asset_id'),
    providerVersion: bigint('provider_version', { mode: 'number' }),
    originalFilename: text('original_filename').notNull(),
    mimeType: text('mime_type').notNull(),
    byteSize: bigint('byte_size', { mode: 'number' }).notNull(),
    checksum: text('checksum').notNull(),
    width: integer('width'),
    height: integer('height'),
    createdAt: timestamp('created_at', { withTimezone: true, precision: 3 }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, precision: 3 }).notNull().defaultNow(),
  },
  (table) => [
    unique('media_owner_identity_unique').on(table.id, table.ownerId),
    foreignKey({
      columns: [table.parentId, table.ownerId],
      foreignColumns: [table.id, table.ownerId],
      name: 'media_parent_owner_fk',
    }),
    uniqueIndex('media_object_key_unique').on(table.objectKey),
    uniqueIndex('media_provider_asset_unique').on(table.providerAssetId),
    index('media_owner_created_idx').on(table.ownerId, table.createdAt),
    index('media_recovery_idx').on(table.state, table.updatedAt),
    index('media_parent_idx').on(table.parentId),
    check('media_provider_check', sql`${table.provider} = 'cloudinary'`),
    check('media_state_check', sql`${table.state} in ('pending','ready','deleting','deleted')`),
    check('media_kind_check', sql`${table.kind} in ('photo','receipt','warranty')`),
    check(
      'media_variant_check',
      sql`(${table.variant} = 'original' and ${table.parentId} is null) or (${table.variant} in ('display','thumbnail') and ${table.parentId} is not null)`,
    ),
    check('media_size_check', sql`${table.byteSize} > 0 and ${table.byteSize} <= 20971520`),
    check('media_checksum_check', sql`${table.checksum} ~ '^[a-f0-9]{64}$'`),
    check(
      'media_ready_check',
      sql`${table.state} <> 'ready' or (${table.providerAssetId} is not null and ${table.providerVersion} is not null and ${table.providerVersion} > 0)`,
    ),
    check(
      'media_dimensions_check',
      sql`(${table.width} is null and ${table.height} is null) or (${table.width} is not null and ${table.height} is not null and ${table.width} > 0 and ${table.height} > 0 and ${table.width} <= 8192 and ${table.height} <= 8192 and ${table.width}::bigint * ${table.height} <= 24000000)`,
    ),
    check(
      'media_type_check',
      sql`(${table.resourceType} = 'raw' and ${table.format} = 'pdf' and ${table.mimeType} = 'application/pdf' and ${table.kind} <> 'photo') or (${table.resourceType} = 'image' and ${table.byteSize} <= 10485760 and ((${table.format} = 'jpg' and ${table.mimeType} = 'image/jpeg') or (${table.format} = 'png' and ${table.mimeType} = 'image/png') or (${table.format} = 'webp' and ${table.mimeType} = 'image/webp')))`,
    ),
  ],
);
