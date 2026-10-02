import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto';
import type { PoolClient } from 'pg';
import { currencyCodes } from '@havefolio/db';
import { normalizeInventorySearch } from '@havefolio/contracts';
import { ItemsRepository } from './items.repository.js';
import type { ItemsQueryDto } from './inventory-query.dto.js';
import type { ItemsPageDto, ItemListEntryDto } from './items.dto.js';

export const inventoryDocument =
  "to_tsvector('simple', normalize(coalesce(i.name,'') || ' ' || coalesce(i.brand,'') || ' ' || coalesce(i.model,''),NFKC))";
const sortColumns = {
  id: 'i.id',
  name: 'lower(i.name) COLLATE "C"',
  newest: 'i.created_at',
  oldest: 'i.created_at',
  updated: 'i.updated_at',
  price: 'i.price_paid_minor',
} as const;
interface Cursor {
  v: 1;
  scope: string;
  id: string;
  value: string | null;
  expiresAt: number;
}
interface Row {
  id: string;
  name: string;
  ownership_status: ItemListEntryDto['ownershipStatus'];
  currency: string;
  price_paid_minor: string | null;
  purchase_date_precision: string;
  purchase_year: number | null;
  purchase_month: number | null;
  purchase_day: number | null;
  acquisition_type: ItemListEntryDto['acquisitionType'];
  condition: ItemListEntryDto['condition'];
  use_frequency: ItemListEntryDto['useFrequency'];
  category_id: string | null;
  subcategory_id: string | null;
  brand: string | null;
  model: string | null;
  revision: number;
  created_at: Date;
  updated_at: Date;
  cursor_value: string | null;
}
const invalid = (): never => {
  throw new BadRequestException('INVALID_ITEM_QUERY');
};
const badCursor = (): never => {
  throw new BadRequestException('INVALID_ITEM_CURSOR');
};
export function normalizeQuery(input: ItemsQueryDto): ItemsQueryDto {
  const q = {
    ...input,
    q: normalizeInventorySearch(input.q ?? ''),
    sort: input.sort ?? 'id',
    limit: input.limit ?? 25,
    priceKnown: input.priceKnown ?? 'include',
    dateKnown: input.dateKnown ?? 'include',
  };
  q.direction ??= ['newest', 'updated'].includes(q.sort) ? 'desc' : 'asc';
  if (
    (['id', 'oldest'].includes(q.sort) && q.direction !== 'asc') ||
    (['newest', 'updated'].includes(q.sort) && q.direction !== 'desc')
  )
    invalid();
  if (q.subcategoryId && !q.categoryId) invalid();
  if (q.currency && !currencyCodes.includes(q.currency as (typeof currencyCodes)[number]))
    invalid();
  if ((q.sort === 'price' || q.priceMin !== undefined || q.priceMax !== undefined) && !q.currency)
    invalid();
  for (const price of [q.priceMin, q.priceMax])
    if (price !== undefined && BigInt(price) > 9223372036854775807n) invalid();
  if (
    q.priceMin !== undefined &&
    q.priceMax !== undefined &&
    BigInt(q.priceMin) > BigInt(q.priceMax)
  )
    invalid();
  if (q.priceKnown === 'only' && (q.priceMin !== undefined || q.priceMax !== undefined)) invalid();
  for (const date of [q.purchasedFrom, q.purchasedTo]) {
    if (
      date &&
      (date.startsWith('0000') ||
        !Number.isFinite(Date.parse(date)) ||
        new Date(date).toISOString().slice(0, 10) !== date)
    )
      invalid();
  }
  if (q.purchasedFrom && q.purchasedTo && q.purchasedFrom > q.purchasedTo) invalid();
  if (
    q.dateKnown === 'only' &&
    (q.purchasedFrom || q.purchasedTo || (q.datePrecision && q.datePrecision !== 'unknown'))
  )
    invalid();
  if (q.dateKnown === 'exclude' && q.datePrecision === 'unknown') invalid();
  return q;
}
/** Only allowlisted SQL fragments are composed. Every external value is a pg bind parameter. */
export function inventorySql(
  owner: string,
  q: ItemsQueryDto,
  cursor?: Cursor,
): { text: string; values: unknown[] } {
  const values: unknown[] = [owner];
  const bind = (value: unknown): string => {
    values.push(value);
    return `$${values.length}`;
  };
  const clauses = ['i.owner_id=$1'];
  for (const [key, col] of [
    ['categoryId', 'category_id'],
    ['subcategoryId', 'subcategory_id'],
    ['ownershipStatus', 'ownership_status'],
    ['useFrequency', 'use_frequency'],
    ['currency', 'currency'],
    ['datePrecision', 'purchase_date_precision'],
  ] as const) {
    if (q[key] !== undefined) clauses.push(`i.${col}=${bind(q[key])}`);
  }
  if (q.tagId)
    clauses.push(
      `EXISTS (SELECT 1 FROM item_tags it WHERE it.owner_id=$1 AND it.item_id=i.id AND it.tag_id=${bind(q.tagId)})`,
    );
  if (q.q) {
    const words = q.q.match(/[\p{L}\p{N}]+/gu) ?? [];
    if (!words.length) clauses.push('FALSE');
    else {
      const term = bind(words.join(' '));
      clauses.push(
        `i.id IN (SELECT i.id FROM items i WHERE i.owner_id=$1 AND ${inventoryDocument} @@ plainto_tsquery('simple',${term}) UNION SELECT it.item_id FROM tags t JOIN item_tags it ON it.owner_id=t.owner_id AND it.tag_id=t.id WHERE t.owner_id=$1 AND to_tsvector('simple',normalize(t.name,NFKC)) @@ plainto_tsquery('simple',${term}))`,
      );
    }
  }
  if (q.priceKnown === 'only') clauses.push('i.price_paid_minor IS NULL');
  if (q.priceKnown === 'exclude') clauses.push('i.price_paid_minor IS NOT NULL');
  const priceRange: string[] = [];
  if (q.priceMin !== undefined) priceRange.push(`i.price_paid_minor>=${bind(q.priceMin)}::bigint`);
  if (q.priceMax !== undefined) priceRange.push(`i.price_paid_minor<=${bind(q.priceMax)}::bigint`);
  if (priceRange.length)
    clauses.push(
      `(${priceRange.join(' AND ')}${q.priceKnown === 'include' ? ' OR i.price_paid_minor IS NULL' : ''})`,
    );
  if (q.dateKnown === 'only') clauses.push("i.purchase_date_precision='unknown'");
  if (q.dateKnown === 'exclude') clauses.push("i.purchase_date_precision<>'unknown'");
  // Month/year components define a possible interval, not an asserted purchase day.
  const start =
    'make_date(i.purchase_year,coalesce(i.purchase_month,1),coalesce(i.purchase_day,1))';
  const end = `(CASE i.purchase_date_precision WHEN 'year' THEN make_date(i.purchase_year,12,31) WHEN 'month' THEN (make_date(i.purchase_year,i.purchase_month,1)+interval '1 month - 1 day')::date ELSE ${start} END)`;
  const dates: string[] = [];
  if (q.purchasedFrom) dates.push(`${end}>=${bind(q.purchasedFrom)}::date`);
  if (q.purchasedTo) dates.push(`${start}<=${bind(q.purchasedTo)}::date`);
  if (dates.length)
    clauses.push(
      `(${dates.join(' AND ')}${q.dateKnown === 'include' ? " OR i.purchase_date_precision='unknown'" : ''})`,
    );
  const sort = q.sort ?? 'id',
    column = sortColumns[sort];
  const direction = q.direction === 'desc' ? 'DESC' : 'ASC';
  const comparator = direction === 'ASC' ? '>' : '<';
  const cast =
    sort === 'price'
      ? 'bigint'
      : sort === 'id'
        ? 'uuid'
        : sort === 'name'
          ? 'text COLLATE "C"'
          : 'timestamptz';
  if (cursor) {
    const id = bind(cursor.id);
    if (cursor.value === null) clauses.push(`(${column} IS NULL AND i.id>${id}::uuid)`);
    else {
      const value = bind(cursor.value);
      clauses.push(
        `(${column}${comparator}${value}::${cast} OR (${column}=${value}::${cast} AND i.id>${id}::uuid)${sort === 'price' ? ` OR ${column} IS NULL` : ''})`,
      );
    }
  }
  // Exact six-digit timestamp tuple avoids pg's JS Date millisecond truncation during pagination.
  const tuple = ['newest', 'oldest', 'updated'].includes(sort)
    ? `to_char(${column} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`
    : `(${column})::text`;
  return {
    text: `SELECT i.id,i.name,i.ownership_status,i.currency,i.price_paid_minor,i.purchase_date_precision,i.purchase_year,i.purchase_month,i.purchase_day,i.acquisition_type,i.condition,i.use_frequency,i.category_id,i.subcategory_id,i.brand,i.model,i.revision,i.created_at,i.updated_at,${tuple} AS cursor_value FROM items i WHERE ${clauses.join(' AND ')} ORDER BY ${column} ${direction} NULLS LAST${sort === 'id' ? '' : ',i.id ASC'} LIMIT ${bind((q.limit ?? 25) + 1)}`,
    values,
  };
}
@Injectable()
export class InventoryQueryService {
  private readonly key: Buffer;
  constructor(
    private readonly repo: ItemsRepository,
    config: ConfigService,
  ) {
    // Domain-separated derivation of the existing required production secret. Dev/test cursors expire on restart if no secret is configured.
    const secret = config.get<string>('AUTH_RATE_KEY_SECRET');
    this.key = secret
      ? createHmac('sha256', secret).update('havefolio.inventory.cursor.v1').digest()
      : randomBytes(32);
  }
  private scope(owner: string, query: ItemsQueryDto): string {
    const rest = { ...query };
    delete rest.after;
    return createHash('sha256')
      .update(JSON.stringify([owner, Object.entries(rest).sort(([a], [b]) => a.localeCompare(b))]))
      .digest('hex');
  }
  private encode(cursor: Cursor): string {
    const iv = randomBytes(12),
      cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(Buffer.from('inventory.v1'));
    const body = Buffer.concat([cipher.update(JSON.stringify(cursor), 'utf8'), cipher.final()]);
    return 'v1.' + Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url');
  }
  private decode(value: string, scope: string, sort: ItemsQueryDto['sort']): Cursor {
    try {
      if (!/^v1\.[A-Za-z0-9_-]{40,2045}$/.test(value)) return badCursor();
      const data = Buffer.from(value.slice(3), 'base64url');
      if (data.toString('base64url') !== value.slice(3)) return badCursor();
      const decipher = createDecipheriv('aes-256-gcm', this.key, data.subarray(0, 12));
      decipher.setAAD(Buffer.from('inventory.v1'));
      decipher.setAuthTag(data.subarray(12, 28));
      const cursor = JSON.parse(
        Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString(),
      ) as Cursor;
      if (
        cursor.v !== 1 ||
        !Number.isSafeInteger(cursor.expiresAt) ||
        cursor.expiresAt <= Date.now() ||
        cursor.scope !== scope ||
        !/^[a-f0-9-]{36}$/.test(cursor.id) ||
        (cursor.value !== null && typeof cursor.value !== 'string')
      )
        return badCursor();
      if (cursor.value === null && sort !== 'price') return badCursor();
      return cursor;
    } catch {
      return badCursor();
    }
  }
  private async taxonomy(c: PoolClient, owner: string, q: ItemsQueryDto): Promise<void> {
    // One bounded validation query; foreign/absent choices share the same controlled error.
    if (!q.categoryId && !q.subcategoryId && !q.tagId) return;
    const result = await c.query<{ valid: boolean }>(
      `SELECT
      ($2::uuid IS NULL OR EXISTS (SELECT 1 FROM categories WHERE owner_id=$1 AND id=$2)) AND
      ($3::uuid IS NULL OR EXISTS (SELECT 1 FROM subcategories WHERE owner_id=$1 AND id=$3 AND category_id=$2)) AND
      ($4::uuid IS NULL OR EXISTS (SELECT 1 FROM tags WHERE owner_id=$1 AND id=$4)) AS valid`,
      [owner, q.categoryId ?? null, q.subcategoryId ?? null, q.tagId ?? null],
    );
    if (!result.rows[0]?.valid) invalid();
  }
  async list(owner: string, input: ItemsQueryDto): Promise<ItemsPageDto> {
    const q = normalizeQuery(input),
      scope = this.scope(owner, q),
      cursor = q.after ? this.decode(q.after, scope, q.sort) : undefined;
    return this.repo.transaction(owner, async (c) => {
      await this.taxonomy(c, owner, q);
      const sql = inventorySql(owner, q, cursor),
        result = await c.query<Row>(sql.text, sql.values),
        rows = result.rows.slice(0, q.limit);
      const ids = rows.map((r) => r.id);
      const tags = await c.query<{ item_id: string; tag_id: string }>(
        'SELECT item_id,tag_id FROM item_tags WHERE owner_id=$1 AND item_id=ANY($2::uuid[]) ORDER BY item_id,tag_id',
        [owner, ids],
      );
      const covers = await c.query<{
        item_id: string;
        id: string;
        width: number;
        height: number;
        alt_text: string | null;
      }>(
        "SELECT DISTINCT ON (item_id) item_id,id,width,height,alt_text FROM media_attachments WHERE owner_id=$1 AND item_id=ANY($2::uuid[]) AND kind='photo' AND variant='original' AND state='ready' ORDER BY item_id,position,id",
        [owner, ids],
      );
      const tagMap = new Map<string, string[]>();
      for (const t of tags.rows)
        tagMap.set(t.item_id, [...(tagMap.get(t.item_id) ?? []), t.tag_id]);
      const coverMap = new Map(
        covers.rows.map((r) => [
          r.item_id,
          {
            id: r.id,
            width: r.width,
            height: r.height,
            altText: r.alt_text || null,
            decorative: r.alt_text === '',
          },
        ]),
      );
      const items = rows.map((r) => ({
        id: r.id,
        name: r.name,
        ownershipStatus: r.ownership_status,
        currency: r.currency,
        pricePaidMinor: r.price_paid_minor,
        purchaseDate: {
          precision: r.purchase_date_precision,
          year: r.purchase_year,
          month: r.purchase_month,
          day: r.purchase_day,
        },
        acquisitionType: r.acquisition_type,
        condition: r.condition,
        useFrequency: r.use_frequency,
        categoryId: r.category_id,
        subcategoryId: r.subcategory_id,
        tagIds: tagMap.get(r.id) ?? [],
        brand: r.brand,
        model: r.model,
        revision: r.revision,
        createdAt: r.created_at.toISOString(),
        updatedAt: r.updated_at.toISOString(),
        cover: coverMap.get(r.id) ?? null,
      }));
      const last = rows.at(-1),
        hasMore = result.rows.length > (q.limit ?? 25);
      return {
        items,
        hasMore,
        nextCursor:
          hasMore && last
            ? this.encode({
                v: 1,
                scope,
                id: last.id,
                value: last.cursor_value,
                expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
              })
            : null,
      };
    });
  }
}
