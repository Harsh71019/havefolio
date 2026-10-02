import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import { currencyCodes } from '@havefolio/db';
import { MediaService } from '../media/media.service.js';
import { ItemsRepository } from './items.repository.js';
import {
  CreateItemDto,
  type UpdateItemDto,
  type ItemActionDto,
  type ItemsQueryDto,
  type ItemDto,
  type ItemsPageDto,
  type EventsPageDto,
  type PurchaseDateDto,
} from './items.dto.js';
interface StoredItem {
  id: string;
  name: string;
  ownership_status: ItemDto['ownershipStatus'];
  currency: string;
  price_paid_minor: string | null;
  purchase_date_precision: string;
  purchase_year: number | null;
  purchase_month: number | null;
  purchase_day: number | null;
  acquisition_type: ItemDto['acquisitionType'];
  condition: ItemDto['condition'];
  use_frequency: ItemDto['useFrequency'];
  category_id: string | null;
  subcategory_id: string | null;
  brand: string | null;
  model: string | null;
  description: string | null;
  notes: string | null;
  specifications: Record<string, unknown> | null;
  original_entry: Record<string, unknown>;
  original_source: string;
  revision: number;
  created_at: Date;
  updated_at: Date;
}
const columns = {
  name: 'name',
  currency: 'currency',
  pricePaidMinor: 'price_paid_minor',
  acquisitionType: 'acquisition_type',
  condition: 'condition',
  useFrequency: 'use_frequency',
  categoryId: 'category_id',
  subcategoryId: 'subcategory_id',
  brand: 'brand',
  model: 'model',
  description: 'description',
  notes: 'notes',
  specifications: 'specifications',
} as const;
@Injectable()
export class ItemsService {
  constructor(
    private readonly repository: ItemsRepository,
    private readonly media: MediaService,
  ) {}
  private validate(input: Partial<CreateItemDto>): void {
    if (
      input.currency !== undefined &&
      !currencyCodes.includes(input.currency as (typeof currencyCodes)[number])
    )
      throw new BadRequestException('INVALID_ITEM');
    if (input.pricePaidMinor != null && BigInt(input.pricePaidMinor) > 9223372036854775807n)
      throw new BadRequestException('INVALID_ITEM');
    if (input.specifications && Buffer.byteLength(JSON.stringify(input.specifications)) > 16384)
      throw new BadRequestException('INVALID_ITEM');
    if (input.purchaseDate !== undefined) this.validateDate(input.purchaseDate);
  }
  private validateDate(date: PurchaseDateDto): void {
    const { precision, year, month, day } = date;
    const required =
      precision === 'unknown' ? 0 : precision === 'year' ? 1 : precision === 'month' ? 2 : 3;
    const values = [year, month, day];
    if (values.some((value, index) => (index < required ? value == null : value != null)))
      throw new BadRequestException('INVALID_ITEM_DATE');
    if (required === 3) {
      const leap = year! % 400 === 0 || (year! % 4 === 0 && year! % 100 !== 0);
      const days = month === 2 ? (leap ? 29 : 28) : [4, 6, 9, 11].includes(month!) ? 30 : 31;
      if (day! > days) throw new BadRequestException('INVALID_ITEM_DATE');
    }
  }
  private serialize(row: StoredItem, tagIds: string[]): ItemDto {
    return {
      id: row.id,
      name: row.name,
      ownershipStatus: row.ownership_status,
      currency: row.currency,
      pricePaidMinor: row.price_paid_minor,
      purchaseDate: {
        precision: row.purchase_date_precision,
        year: row.purchase_year,
        month: row.purchase_month,
        day: row.purchase_day,
      },
      acquisitionType: row.acquisition_type,
      condition: row.condition,
      useFrequency: row.use_frequency,
      categoryId: row.category_id,
      subcategoryId: row.subcategory_id,
      tagIds,
      brand: row.brand,
      model: row.model,
      description: row.description,
      notes: row.notes,
      specifications: row.specifications,
      originalEntry: row.original_entry,
      originalSource: row.original_source,
      revision: row.revision,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    };
  }
  private async owned(
    c: PoolClient,
    owner: string,
    id: string,
    revision?: number,
  ): Promise<StoredItem> {
    const row = (
      await c.query<StoredItem>('SELECT * FROM items WHERE owner_id=$1 AND id=$2', [owner, id])
    ).rows[0];
    if (!row) throw new NotFoundException('ITEM_NOT_FOUND');
    if (revision !== undefined && row.revision !== revision)
      throw new ConflictException('STALE_ITEM_REVISION');
    return row;
  }
  private async details(c: PoolClient, owner: string, id: string): Promise<ItemDto> {
    const row = await this.owned(c, owner, id);
    const tags = (
      await c.query<{ tag_id: string }>(
        'SELECT tag_id FROM item_tags WHERE owner_id=$1 AND item_id=$2 ORDER BY tag_id LIMIT 500',
        [owner, id],
      )
    ).rows;
    return this.serialize(
      row,
      tags.map((t) => t.tag_id),
    );
  }
  private async taxonomy(
    c: PoolClient,
    owner: string,
    input: Partial<CreateItemDto>,
    previous?: StoredItem,
  ): Promise<void> {
    const category = input.categoryId === undefined ? previous?.category_id : input.categoryId;
    const subcategory =
      input.subcategoryId === undefined ? previous?.subcategory_id : input.subcategoryId;
    const categoryChanged =
      !previous || (input.categoryId !== undefined && input.categoryId !== previous.category_id);
    const subcategoryChanged =
      !previous ||
      (input.subcategoryId !== undefined && input.subcategoryId !== previous.subcategory_id);
    if (subcategory && !category) throw new BadRequestException('INVALID_ITEM_TAXONOMY');
    if (category && (categoryChanged || (subcategory && subcategoryChanged))) {
      const root = (
        await c.query<{ retired_at: Date | null }>(
          'SELECT retired_at FROM categories WHERE owner_id=$1 AND id=$2',
          [owner, category],
        )
      ).rows[0];
      if (!root) throw new NotFoundException('ITEM_TAXONOMY_NOT_FOUND');
      if (root.retired_at) throw new ConflictException('ITEM_TAXONOMY_RETIRED');
    }
    if ((categoryChanged || subcategoryChanged) && subcategory) {
      const child = (
        await c.query<{ category_id: string; retired_at: Date | null }>(
          'SELECT category_id,retired_at FROM subcategories WHERE owner_id=$1 AND id=$2',
          [owner, subcategory],
        )
      ).rows[0];
      if (!child) throw new NotFoundException('ITEM_TAXONOMY_NOT_FOUND');
      if (child.category_id !== category) throw new BadRequestException('INVALID_ITEM_TAXONOMY');
      if (child.retired_at) throw new ConflictException('ITEM_TAXONOMY_RETIRED');
    }
    if (input.tagIds?.length) {
      const tags = await c.query('SELECT id FROM tags WHERE owner_id=$1 AND id=ANY($2::uuid[])', [
        owner,
        input.tagIds,
      ]);
      if (tags.rowCount !== input.tagIds.length)
        throw new NotFoundException('ITEM_TAXONOMY_NOT_FOUND');
    }
  }
  private async tags(c: PoolClient, owner: string, id: string, tags?: string[]): Promise<void> {
    if (tags === undefined) return;
    await c.query('DELETE FROM item_tags WHERE owner_id=$1 AND item_id=$2', [owner, id]);
    if (tags.length)
      await c.query(
        'INSERT INTO item_tags(owner_id,item_id,tag_id) SELECT $1,$2,unnest($3::uuid[])',
        [owner, id, tags],
      );
  }
  private async event(
    c: PoolClient,
    owner: string,
    id: string,
    type: string,
    metadata: Record<string, unknown>,
    occurredAt?: string,
  ): Promise<void> {
    await c.query(
      'INSERT INTO lifecycle_events(owner_id,item_id,event_type,occurred_at,metadata) VALUES($1,$2,$3,COALESCE($4::timestamptz,clock_timestamp()),$5)',
      [owner, id, type, occurredAt ?? null, metadata],
    );
  }
  async create(owner: string, input: CreateItemDto): Promise<ItemDto> {
    this.validate(input);
    return this.repository.transaction(owner, async (c) => {
      await this.taxonomy(c, owner, input);
      const date = input.purchaseDate ?? { precision: 'unknown' };
      const keys = Object.keys(columns) as (keyof typeof columns)[];
      const values = keys.map(
        (key) =>
          input[key] ??
          (['acquisitionType', 'condition', 'useFrequency'].includes(key) ? 'unknown' : null),
      );
      const params = [
        owner,
        ...values,
        input.ownershipStatus,
        date.precision,
        date.year ?? null,
        date.month ?? null,
        date.day ?? null,
        input,
      ];
      const row = (
        await c.query<{ id: string }>(
          `INSERT INTO items(owner_id,${keys.map((k) => columns[k]).join(',')},ownership_status,purchase_date_precision,purchase_year,purchase_month,purchase_day,original_entry,original_source) VALUES(${params.map((_v, i) => '$' + (i + 1)).join(',')},'manual') RETURNING id`,
          params,
        )
      ).rows[0]!;
      await this.tags(c, owner, row.id, input.tagIds);
      await this.event(c, owner, row.id, 'created', {
        source: 'user',
        ownershipStatus: input.ownershipStatus,
      });
      return this.details(c, owner, row.id);
    });
  }
  async read(owner: string, id: string): Promise<ItemDto> {
    return this.repository.transaction(owner, (c) => this.details(c, owner, id));
  }
  async list(owner: string, query: ItemsQueryDto): Promise<ItemsPageDto> {
    return this.repository.transaction(owner, async (c) => {
      const limit = query.limit ?? 25;
      const rows = (
        await c.query<StoredItem>(
          'SELECT * FROM items WHERE owner_id=$1 AND ($2::uuid IS NULL OR id>$2::uuid) ORDER BY id LIMIT $3',
          [owner, query.after ?? null, limit + 1],
        )
      ).rows;
      const page = rows.slice(0, limit);
      const tags = (
        await c.query<{ item_id: string; tag_id: string }>(
          'SELECT item_id,tag_id FROM item_tags WHERE owner_id=$1 AND item_id=ANY($2::uuid[]) ORDER BY item_id,tag_id',
          [owner, page.map((r) => r.id)],
        )
      ).rows;
      return {
        items: page.map((r) =>
          this.serialize(
            r,
            tags.filter((t) => t.item_id === r.id).map((t) => t.tag_id),
          ),
        ),
        hasMore: rows.length > limit,
        nextCursor: rows.length > limit ? page.at(-1)!.id : null,
      };
    });
  }
  async update(owner: string, id: string, input: UpdateItemDto): Promise<ItemDto> {
    this.validate(input);
    if (Object.keys(input).every((k) => k === 'revision'))
      throw new BadRequestException('INVALID_ITEM');
    return this.repository.transaction(owner, async (c) => {
      const old = await this.owned(c, owner, id, input.revision);
      await this.taxonomy(c, owner, input, old);
      const keys = (Object.keys(columns) as (keyof typeof columns)[]).filter(
        (k) => input[k] !== undefined,
      );
      const names: string[] = keys.map((k) => columns[k]);
      const values: unknown[] = keys.map((k) => input[k]);
      if (input.purchaseDate) {
        names.push('purchase_date_precision', 'purchase_year', 'purchase_month', 'purchase_day');
        values.push(
          input.purchaseDate.precision,
          input.purchaseDate.year ?? null,
          input.purchaseDate.month ?? null,
          input.purchaseDate.day ?? null,
        );
      }
      const assignments = names.map((n, i) => `${n}=$${i + 4}`);
      const updated = await c.query(
        `UPDATE items SET revision=revision+1${assignments.length ? ',' + assignments.join(',') : ''} WHERE owner_id=$1 AND id=$2 AND revision=$3`,
        [owner, id, input.revision, ...values],
      );
      if (updated.rowCount !== 1) throw new ConflictException('STALE_ITEM_REVISION');
      await this.tags(c, owner, id, input.tagIds);
      const changed = Object.keys(input).filter((k) => k !== 'revision');
      await this.event(c, owner, id, 'details_updated', {
        source: 'user',
        fields: changed,
        revision: input.revision + 1,
      });
      if (input.condition !== undefined && input.condition !== old.condition)
        await this.event(c, owner, id, 'condition_changed', {
          source: 'user',
          from: old.condition,
          to: input.condition,
        });
      if (input.useFrequency !== undefined && input.useFrequency !== old.use_frequency)
        await this.event(c, owner, id, 'usage_changed', {
          source: 'user',
          from: old.use_frequency,
          to: input.useFrequency,
        });
      return this.details(c, owner, id);
    });
  }
  async action(owner: string, id: string, input: ItemActionDto): Promise<ItemDto> {
    if (
      input.occurredAt &&
      (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(
        input.occurredAt,
      ) ||
        !Number.isFinite(Date.parse(input.occurredAt)))
    )
      throw new BadRequestException('INVALID_ITEM_DATE');
    if ((input.action === 'ownership_changed') !== (input.ownershipStatus !== undefined))
      throw new BadRequestException('INVALID_ITEM_ACTION');
    return this.repository.transaction(owner, async (c) => {
      const old = await this.owned(c, owner, id, input.revision);
      if (input.action === 'ownership_changed') {
        // Leaving owned and explicitly recovering/reacquiring an inactive item are supported.
        if (
          old.ownership_status === input.ownershipStatus ||
          (old.ownership_status !== 'owned' && input.ownershipStatus !== 'owned')
        )
          throw new ConflictException('INVALID_ITEM_TRANSITION');
      } else if (old.ownership_status !== 'owned')
        throw new ConflictException('INVALID_ITEM_TRANSITION');
      const updated = await c.query(
        'UPDATE items SET revision=revision+1,ownership_status=$4 WHERE owner_id=$1 AND id=$2 AND revision=$3',
        [owner, id, input.revision, input.ownershipStatus ?? old.ownership_status],
      );
      if (updated.rowCount !== 1) throw new ConflictException('STALE_ITEM_REVISION');
      await this.event(
        c,
        owner,
        id,
        input.action,
        {
          source: 'user',
          revision: input.revision + 1,
          ...(input.action === 'ownership_changed'
            ? { from: old.ownership_status, to: input.ownershipStatus }
            : {}),
          ...(input.note !== undefined ? { note: input.note } : {}),
        },
        input.occurredAt,
      );
      return this.details(c, owner, id);
    });
  }
  async history(owner: string, id: string, query: ItemsQueryDto): Promise<EventsPageDto> {
    return this.repository.transaction(owner, async (c) => {
      await this.owned(c, owner, id);
      const limit = query.limit ?? 25;
      const rows = (
        await c.query<{
          id: string;
          eventType: string;
          occurredAt: Date;
          createdAt: Date;
          metadata: Record<string, unknown>;
        }>(
          'SELECT id,event_type AS "eventType",occurred_at AS "occurredAt",created_at AS "createdAt",metadata FROM lifecycle_events WHERE owner_id=$1 AND item_id=$2 AND ($3::uuid IS NULL OR id>$3::uuid) ORDER BY id LIMIT $4',
          [owner, id, query.after ?? null, limit + 1],
        )
      ).rows;
      const page = rows.slice(0, limit);
      return {
        events: page.map((r) => ({
          ...r,
          occurredAt: r.occurredAt.toISOString(),
          createdAt: r.createdAt.toISOString(),
        })),
        hasMore: rows.length > limit,
        nextCursor: rows.length > limit ? page.at(-1)!.id : null,
      };
    });
  }
  async delete(owner: string, id: string, revision: number): Promise<void> {
    await this.repository.transaction(owner, async (c) => {
      await this.owned(c, owner, id, revision);
      await c.query('SELECT id FROM items WHERE owner_id=$1 AND id=$2 FOR UPDATE', [owner, id]);
      const attachments = (
        await c.query<{ id: string; state: string }>(
          "SELECT id,state FROM media_attachments WHERE owner_id=$1 AND item_id=$2 AND state<>'deleted' ORDER BY (parent_id IS NULL),id LIMIT 501",
          [owner, id],
        )
      ).rows;
      if (attachments.length > 500 || attachments.some((a) => a.state === 'pending'))
        throw new ConflictException('ITEM_MEDIA_PENDING');
      // Separate media transactions persist cleanup progress across any provider/SQL failure.
      for (const attachment of attachments)
        if (attachment.state !== 'deleted') await this.media.delete(owner, attachment.id);
      const incomplete = await c.query(
        "SELECT id FROM media_attachments WHERE owner_id=$1 AND item_id=$2 AND state<>'deleted' LIMIT 1",
        [owner, id],
      );
      if (incomplete.rowCount) throw new ConflictException('ITEM_MEDIA_PENDING');
      // Exact-key tombstones remain for PER-12 reconciliation, detached only after confirmed deletion.
      await c.query(
        "UPDATE media_attachments SET item_id=NULL WHERE owner_id=$1 AND item_id=$2 AND state='deleted'",
        [owner, id],
      );
      const deleted = await c.query(
        'DELETE FROM items WHERE owner_id=$1 AND id=$2 AND revision=$3',
        [owner, id, revision],
      );
      if (deleted.rowCount !== 1) throw new ConflictException('STALE_ITEM_REVISION');
    });
  }
}
