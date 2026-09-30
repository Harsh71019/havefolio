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
  jsonb,
  smallint,
  boolean,
  date,
  primaryKey,
} from 'drizzle-orm/pg-core';

import { currencyCodes } from './currencies.js';

export const applicationMetadata = pgTable('application_metadata', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    displayName: text('display_name'),
    email: text('email'),
    passwordHash: text('password_hash'),
    taxonomyDefaultsSeededAt: timestamp('taxonomy_defaults_seeded_at', {
      withTimezone: true,
      precision: 3,
    }),
    createdAt: timestamp('created_at', { withTimezone: true, precision: 3 }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, precision: 3 }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('user_email_unique').on(t.email),
    // Existing identity shells stay credential-free. Only one initial login owner is allowed.
    uniqueIndex('user_initial_owner_unique')
      .on(sql`(true)`)
      .where(sql`${t.email} is not null`),
    check(
      'user_credentials_check',
      sql`(${t.email} is null and ${t.passwordHash} is null) or (${t.email} is not null and ${t.passwordHash} is not null and ${t.email} = lower(btrim(${t.email})) and length(${t.email}) between 3 and 254 and ${t.passwordHash} like '$argon2id$%')`,
    ),
  ],
);

export const authSessions = pgTable(
  'auth_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, precision: 3 }).notNull().defaultNow(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true, precision: 3 })
      .notNull()
      .defaultNow(),
    idleExpiresAt: timestamp('idle_expires_at', { withTimezone: true, precision: 3 }).notNull(),
    absoluteExpiresAt: timestamp('absolute_expires_at', {
      withTimezone: true,
      precision: 3,
    }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true, precision: 3 }),
  },
  (t) => [
    uniqueIndex('session_token_hash_unique').on(t.tokenHash),
    index('session_owner_created_idx').on(t.ownerId, t.createdAt, t.id),
    index('session_expiry_idx').on(t.absoluteExpiresAt),
    check('session_hash_check', sql`${t.tokenHash} ~ '^[a-f0-9]{64}$'`),
    check(
      'session_times_check',
      sql`isfinite(${t.createdAt}) and isfinite(${t.lastUsedAt}) and isfinite(${t.idleExpiresAt}) and isfinite(${t.absoluteExpiresAt}) and ${t.createdAt} <= ${t.lastUsedAt} and ${t.lastUsedAt} < ${t.idleExpiresAt} and ${t.idleExpiresAt} <= ${t.absoluteExpiresAt} and (${t.revokedAt} is null or isfinite(${t.revokedAt}))`,
    ),
  ],
);

export const categories = pgTable(
  'categories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    position: integer('position').notNull().default(0),
    isDemo: boolean('is_demo').notNull().default(false),
    retiredAt: timestamp('retired_at', { withTimezone: true, precision: 3 }),
    createdAt: timestamp('created_at', { withTimezone: true, precision: 3 }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, precision: 3 }).notNull().defaultNow(),
  },
  (t) => [
    unique('category_owner_identity_unique').on(t.id, t.ownerId),
    uniqueIndex('category_owner_name_unique').on(t.ownerId, sql`lower(btrim(${t.name}))`),
    check('category_name_check', sql`length(btrim(${t.name})) between 1 and 120`),
    check('category_position_check', sql`${t.position} >= 0`),
  ],
);

export const subcategories = pgTable(
  'subcategories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    categoryId: uuid('category_id').notNull(),
    name: text('name').notNull(),
    position: integer('position').notNull().default(0),
    retiredAt: timestamp('retired_at', { withTimezone: true, precision: 3 }),
    createdAt: timestamp('created_at', { withTimezone: true, precision: 3 }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, precision: 3 }).notNull().defaultNow(),
  },
  (t) => [
    unique('subcategory_category_owner_unique').on(t.id, t.categoryId, t.ownerId),
    foreignKey({
      columns: [t.categoryId, t.ownerId],
      foreignColumns: [categories.id, categories.ownerId],
      name: 'subcategory_category_owner_fk',
    }).onDelete('restrict'),
    uniqueIndex('subcategory_owner_category_name_unique').on(
      t.ownerId,
      t.categoryId,
      sql`lower(btrim(${t.name}))`,
    ),
    index('subcategory_category_owner_idx').on(t.categoryId, t.ownerId),
    check('subcategory_name_check', sql`length(btrim(${t.name})) between 1 and 120`),
    check('subcategory_position_check', sql`${t.position} >= 0`),
  ],
);

export const items = pgTable(
  'items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    categoryId: uuid('category_id'),
    subcategoryId: uuid('subcategory_id'),
    brand: text('brand'),
    model: text('model'),
    description: text('description'),
    specifications: jsonb('specifications').$type<Record<string, unknown>>(),
    notes: text('notes'),
    pricePaidMinor: bigint('price_paid_minor', { mode: 'bigint' }),
    currency: text('currency').notNull(),
    purchaseDatePrecision: text('purchase_date_precision', {
      enum: ['exact', 'month', 'year', 'unknown'],
    })
      .notNull()
      .default('unknown'),
    purchaseYear: smallint('purchase_year'),
    purchaseMonth: smallint('purchase_month'),
    purchaseDay: smallint('purchase_day'),
    acquisitionType: text('acquisition_type', {
      enum: ['bought', 'gift', 'secondhand', 'other', 'unknown'],
    })
      .notNull()
      .default('unknown'),
    condition: text('condition', { enum: ['working', 'needs_repair', 'broken', 'unknown'] })
      .notNull()
      .default('unknown'),
    useFrequency: text('use_frequency', {
      enum: ['often', 'sometimes', 'rarely', 'never', 'unknown'],
    })
      .notNull()
      .default('unknown'),
    ownershipStatus: text('ownership_status', {
      enum: ['owned', 'sold', 'donated', 'disposed', 'lost', 'returned'],
    })
      .notNull()
      .default('owned'),
    originalEntry: jsonb('original_entry').$type<Record<string, unknown>>().notNull(),
    originalSource: text('original_source', {
      enum: ['manual', 'url', 'barcode', 'photo', 'receipt', 'import'],
    }).notNull(),
    revision: integer('revision').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true, precision: 3 }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, precision: 3 }).notNull().defaultNow(),
  },
  (t) => [
    unique('item_owner_identity_unique').on(t.id, t.ownerId),
    foreignKey({
      columns: [t.categoryId, t.ownerId],
      foreignColumns: [categories.id, categories.ownerId],
      name: 'item_category_owner_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [t.subcategoryId, t.categoryId, t.ownerId],
      foreignColumns: [subcategories.id, subcategories.categoryId, subcategories.ownerId],
      name: 'item_subcategory_owner_fk',
    }).onDelete('restrict'),
    check('item_name_check', sql`length(btrim(${t.name})) between 1 and 300`),
    check(
      'item_subcategory_requires_category',
      sql`${t.subcategoryId} is null or ${t.categoryId} is not null`,
    ),
    check('item_price_check', sql`${t.pricePaidMinor} is null or ${t.pricePaidMinor} >= 0`),
    check(
      'item_currency_check',
      sql`${t.currency} in (${sql.join(
        currencyCodes.map((code) => sql.raw("'" + code + "'")),
        sql`, `,
      )})`,
    ),
    check(
      'item_date_precision_check',
      sql`
    (${t.purchaseDatePrecision} = 'unknown' and ${t.purchaseYear} is null and ${t.purchaseMonth} is null and ${t.purchaseDay} is null) or
    (${t.purchaseDatePrecision} = 'year' and ${t.purchaseYear} is not null and ${t.purchaseYear} between 1 and 9999 and ${t.purchaseMonth} is null and ${t.purchaseDay} is null) or
    (${t.purchaseDatePrecision} = 'month' and ${t.purchaseYear} is not null and ${t.purchaseYear} between 1 and 9999 and ${t.purchaseMonth} is not null and ${t.purchaseMonth} between 1 and 12 and ${t.purchaseDay} is null) or
    (${t.purchaseDatePrecision} = 'exact' and ${t.purchaseYear} is not null and ${t.purchaseYear} between 1 and 9999 and ${t.purchaseMonth} is not null and ${t.purchaseMonth} between 1 and 12 and ${t.purchaseDay} is not null and ${t.purchaseDay} between 1 and
      case when ${t.purchaseMonth} = 2 then case when ${t.purchaseYear} % 400 = 0 or (${t.purchaseYear} % 4 = 0 and ${t.purchaseYear} % 100 <> 0) then 29 else 28 end
      when ${t.purchaseMonth} in (4,6,9,11) then 30 else 31 end)`,
    ),
    check(
      'item_acquisition_check',
      sql`${t.acquisitionType} in ('bought','gift','secondhand','other','unknown')`,
    ),
    check(
      'item_condition_check',
      sql`${t.condition} in ('working','needs_repair','broken','unknown')`,
    ),
    check(
      'item_usage_check',
      sql`${t.useFrequency} in ('often','sometimes','rarely','never','unknown')`,
    ),
    check(
      'item_status_check',
      sql`${t.ownershipStatus} in ('owned','sold','donated','disposed','lost','returned')`,
    ),
    check('item_original_entry_check', sql`jsonb_typeof(${t.originalEntry}) = 'object'`),
    check(
      'item_specs_check',
      sql`${t.specifications} is null or jsonb_typeof(${t.specifications}) = 'object'`,
    ),
    check(
      'item_original_source_check',
      sql`${t.originalSource} in ('manual','url','barcode','photo','receipt','import')`,
    ),
    check('item_revision_check', sql`${t.revision} > 0`),
    index('item_owner_keyset_idx').on(t.ownerId, t.id),
    index('item_owner_created_idx').on(t.ownerId, t.createdAt, t.id),
    index('item_owner_status_created_idx').on(t.ownerId, t.ownershipStatus, t.createdAt, t.id),
    index('item_owner_category_idx').on(t.ownerId, t.categoryId, t.subcategoryId),
    index('item_subcategory_owner_idx').on(t.subcategoryId, t.categoryId, t.ownerId),
  ],
);

export const tags = pgTable(
  'tags',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, precision: 3 }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, precision: 3 }).notNull().defaultNow(),
  },
  (t) => [
    unique('tag_owner_identity_unique').on(t.id, t.ownerId),
    uniqueIndex('tag_owner_name_unique').on(t.ownerId, sql`lower(btrim(${t.name}))`),
    check('tag_name_check', sql`length(btrim(${t.name})) between 1 and 80`),
  ],
);

export const itemTags = pgTable(
  'item_tags',
  {
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    itemId: uuid('item_id').notNull(),
    tagId: uuid('tag_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, precision: 3 }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, precision: 3 }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.itemId, t.tagId] }),
    foreignKey({
      columns: [t.itemId, t.ownerId],
      foreignColumns: [items.id, items.ownerId],
      name: 'item_tag_item_owner_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [t.tagId, t.ownerId],
      foreignColumns: [tags.id, tags.ownerId],
      name: 'item_tag_tag_owner_fk',
    }).onDelete('cascade'),
    index('item_tag_owner_tag_idx').on(t.ownerId, t.tagId, t.itemId),
  ],
);

export const lifecycleEvents = pgTable(
  'lifecycle_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    itemId: uuid('item_id').notNull(),
    eventType: text('event_type', {
      enum: [
        'created',
        'details_updated',
        'ownership_changed',
        'condition_changed',
        'usage_changed',
        'used',
        'repaired',
        'refund_recorded',
        'correction',
      ],
    }).notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true, precision: 3 }).notNull(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true, precision: 3 }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.itemId, t.ownerId],
      foreignColumns: [items.id, items.ownerId],
      name: 'event_item_owner_fk',
    }).onDelete('cascade'),
    check(
      'event_type_check',
      sql`${t.eventType} in ('created','details_updated','ownership_changed','condition_changed','usage_changed','used','repaired','refund_recorded','correction')`,
    ),
    check('event_metadata_check', sql`jsonb_typeof(${t.metadata}) = 'object'`),
    check('event_time_check', sql`isfinite(${t.occurredAt})`),
    index('event_owner_item_keyset_idx').on(t.ownerId, t.itemId, t.id),
    index('event_owner_item_time_idx').on(t.ownerId, t.itemId, t.occurredAt, t.id),
    index('event_item_owner_idx').on(t.itemId, t.ownerId),
  ],
);

export const itemSuggestions = pgTable(
  'item_suggestions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    itemId: uuid('item_id').notNull(),
    provider: text('provider').notNull(),
    suggestedValues: jsonb('suggested_values').$type<Record<string, unknown>>().notNull(),
    status: text('status', { enum: ['pending', 'accepted', 'rejected'] })
      .notNull()
      .default('pending'),
    decidedAt: timestamp('decided_at', { withTimezone: true, precision: 3 }),
    createdAt: timestamp('created_at', { withTimezone: true, precision: 3 }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, precision: 3 }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.itemId, t.ownerId],
      foreignColumns: [items.id, items.ownerId],
      name: 'suggestion_item_owner_fk',
    }).onDelete('cascade'),
    check('suggestion_provider_check', sql`length(btrim(${t.provider})) between 1 and 120`),
    check('suggestion_values_check', sql`jsonb_typeof(${t.suggestedValues}) = 'object'`),
    check(
      'suggestion_status_check',
      sql`(${t.status} = 'pending' and ${t.decidedAt} is null) or (${t.status} in ('accepted','rejected') and ${t.decidedAt} is not null and isfinite(${t.decidedAt}))`,
    ),
    index('suggestion_item_owner_idx').on(t.itemId, t.ownerId),
  ],
);

export const itemWarranties = pgTable(
  'item_warranties',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    itemId: uuid('item_id').notNull(),
    provider: text('provider'),
    startsOn: date('starts_on', { mode: 'string' }),
    expiresOn: date('expires_on', { mode: 'string' }),
    terms: text('terms'),
    createdAt: timestamp('created_at', { withTimezone: true, precision: 3 }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, precision: 3 }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.itemId, t.ownerId],
      foreignColumns: [items.id, items.ownerId],
      name: 'warranty_item_owner_fk',
    }).onDelete('cascade'),
    check(
      'warranty_dates_check',
      sql`(${t.startsOn} is null or isfinite(${t.startsOn})) and (${t.expiresOn} is null or isfinite(${t.expiresOn})) and (${t.startsOn} is null or ${t.expiresOn} is null or ${t.expiresOn} >= ${t.startsOn})`,
    ),
    index('warranty_item_owner_idx').on(t.itemId, t.ownerId),
  ],
);

// Provider records survive until exact-key cleanup; deletion of their owner/item is restricted.
export const mediaAttachments = pgTable(
  'media_attachments',
  {
    id: uuid('id').primaryKey(),
    ownerId: uuid('owner_id').notNull(),
    parentId: uuid('parent_id'),
    itemId: uuid('item_id'),
    position: integer('position').notNull().default(0),
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
    foreignKey({
      columns: [table.ownerId],
      foreignColumns: [users.id],
      name: 'media_owner_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.itemId, table.ownerId],
      foreignColumns: [items.id, items.ownerId],
      name: 'media_item_owner_fk',
    }).onDelete('restrict'),
    index('media_item_owner_idx').on(table.itemId, table.ownerId),
    check('media_position_check', sql`${table.position} >= 0`),
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
