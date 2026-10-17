import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomUUID } from 'node:crypto';
import { EventLogger } from '@havefolio/logging';
import { captureFailure } from '@havefolio/monitoring/server';
import type { PoolClient } from 'pg';
import { ItemsService } from '../items/items.service.js';
import type { CreateItemDto } from '../items/items.dto.js';
import { PrivateMediaStorage, type StoredAsset } from '../media/storage.js';
import { DesiresRepository } from './desires.repository.js';
import type {
  ConvertDesireDto,
  DesireConversionDto,
  DesireConversionStateDto,
} from './desire-conversions.dto.js';
import type { DesirePhotoDto } from './desires.dto.js';

interface ConversionRow {
  id: string;
  desire_id: string;
  item_id: string;
  item_name: string;
  bought_event_id: string;
  current_event_id: string | null;
  request_hash: string;
  photo_state: DesireConversionDto['photo'];
  photo_attempt: number;
  created_at: Date;
}
interface SourceVariant {
  id: string;
  variant: 'original' | 'display' | 'thumbnail';
  object_key: string;
  byte_size: string;
  checksum: string;
  width: number;
  height: number;
  alt_text: string | null;
  created_at: Date;
}
interface TargetVariant {
  id: string;
  variant: SourceVariant['variant'];
  state: string;
  object_key: string;
  byte_size: string;
  checksum: string;
}
interface CopyPlan {
  itemId: string;
  copies: { id: string; key: string; sourceKey: string; byteSize: number; checksum: string }[];
}

const variants = ['original', 'display', 'thumbnail'] as const;
const maxPhotoAttempts = 5;
const selectConversion = `SELECT c.*,i.name AS item_name,
  (SELECT e.id FROM desire_review_events e WHERE e.desire_id=c.desire_id AND e.owner_id=c.owner_id ORDER BY e.sequence DESC LIMIT 1) AS current_event_id
  FROM desire_conversions c JOIN items i ON i.id=c.item_id AND i.owner_id=c.owner_id`;

const map = (r: ConversionRow): DesireConversionDto => ({
  id: r.id,
  desireId: r.desire_id,
  itemId: r.item_id,
  itemName: r.item_name,
  boughtEventId: r.bought_event_id,
  boughtOutcomeCurrent: r.current_event_id === r.bought_event_id,
  photo: r.photo_state,
  createdAt: r.created_at.toISOString(),
});

/** Deterministic attachment identity so a retried copy attempt never creates a second family. */
const mediaId = (conversion: string, attempt: number, variant: string): string => {
  const hex = createHash('sha256').update(`${conversion}:${attempt}:${variant}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};

/**
 * PER-29: optional, idempotent conversion of an effective bought desire into an owned item.
 * Item, created event, link and durable photo-copy intent commit in one owner transaction;
 * provider copying happens after commit and is resumable without duplicating media.
 */
@Injectable()
export class DesireConversionsService {
  constructor(
    private readonly repo: DesiresRepository,
    private readonly items: ItemsService,
    private readonly storage: PrivateMediaStorage,
    private readonly config: ConfigService,
    private readonly logger: EventLogger,
  ) {}

  private async desire(
    c: PoolClient,
    owner: string,
    id: string,
  ): Promise<{
    name: string;
    reason: string | null;
    product_url: string | null;
    likely_price_minor: string | null;
    currency: string | null;
  }> {
    const row = (
      await c.query<{
        name: string;
        reason: string | null;
        product_url: string | null;
        likely_price_minor: string | null;
        currency: string | null;
      }>(
        'SELECT name,reason,product_url,likely_price_minor,currency FROM desires WHERE id=$1 AND owner_id=$2 FOR UPDATE',
        [id, owner],
      )
    ).rows[0];
    if (!row) throw new NotFoundException('DESIRE_NOT_FOUND');
    return row;
  }

  private async latest(
    c: PoolClient,
    owner: string,
    id: string,
  ): Promise<{ id: string; outcome: string } | undefined> {
    return (
      await c.query<{ id: string; outcome: string }>(
        'SELECT id,outcome FROM desire_review_events WHERE desire_id=$1 AND owner_id=$2 ORDER BY sequence DESC LIMIT 1',
        [id, owner],
      )
    ).rows[0];
  }

  private async conversion(
    c: PoolClient,
    owner: string,
    clause: 'desire' | 'command',
    value: string,
  ): Promise<(ConversionRow & { desire_id: string }) | undefined> {
    return (
      await c.query<ConversionRow>(
        `${selectConversion} WHERE c.owner_id=$1 AND ${clause === 'desire' ? 'c.desire_id' : 'c.command_id'}=$2`,
        [owner, value],
      )
    ).rows[0];
  }

  /** A complete ready source family, original first, or undefined when it cannot be copied. */
  private async source(
    c: PoolClient,
    owner: string,
    desireId: string,
  ): Promise<SourceVariant[] | undefined> {
    const rows = (
      await c.query<SourceVariant>(
        `SELECT m.id,m.variant,m.object_key,m.byte_size,m.checksum,m.width,m.height,m.alt_text,m.created_at
         FROM media_attachments o JOIN media_attachments m ON m.owner_id=o.owner_id AND m.desire_id=o.desire_id
           AND (m.id=o.id OR m.parent_id=o.id)
         WHERE o.owner_id=$1 AND o.desire_id=$2 AND o.kind='photo' AND o.variant='original' AND o.state='ready'
           AND m.kind='photo' AND m.state='ready' AND m.resource_type='image' AND m.format='webp'
         LIMIT 4`,
        [owner, desireId],
      )
    ).rows;
    const ordered = variants.map((v) => rows.find((r) => r.variant === v));
    return rows.length === variants.length && ordered.every(Boolean)
      ? (ordered as SourceVariant[])
      : undefined;
  }

  private photo(source: SourceVariant[] | undefined): DesirePhotoDto | null {
    const original = source?.[0];
    if (!original) return null;
    return {
      id: original.id,
      width: original.width,
      height: original.height,
      byteSize: Number(original.byte_size),
      mimeType: 'image/webp',
      altText: original.alt_text || null,
      decorative: original.alt_text === '',
      createdAt: original.created_at.toISOString(),
    };
  }

  /** Reserves owner/global quota and records durable pending intent before any provider write. */
  private async reserve(
    c: PoolClient,
    owner: string,
    itemId: string,
    conversionId: string,
    attempt: number,
    source: SourceVariant[],
  ): Promise<void> {
    const bytes = source.reduce((n, s) => n + Number(s.byte_size), 0);
    const used = (
      await c.query<{ bytes: string }>(
        "SELECT coalesce(sum(byte_size),0)::text AS bytes FROM media_attachments WHERE owner_id=$1 AND state<>'deleted'",
        [owner],
      )
    ).rows[0]!;
    if (Number(used.bytes) + bytes > 2 * 1024 ** 3)
      throw new ConflictException('PHOTO_QUOTA_EXCEEDED');
    // Shares the photo upload advisory lock so the global quota is serialized across replicas.
    await c.query('SELECT pg_advisory_xact_lock(13130013)');
    const total = (
      await c.query<{ bytes: string }>(
        "SELECT coalesce(sum(byte_size),0)::text AS bytes FROM media_attachments WHERE state<>'deleted'",
      )
    ).rows[0]!;
    if (Number(total.bytes) + bytes > 4 * 1024 ** 3)
      throw new ConflictException('PHOTO_QUOTA_EXCEEDED');
    const env = this.config.get<string>('NODE_ENV', 'development');
    const parent = mediaId(conversionId, attempt, 'original');
    for (const s of source) {
      const id = mediaId(conversionId, attempt, s.variant);
      await c.query(
        `INSERT INTO media_attachments(id,owner_id,item_id,parent_id,kind,variant,object_key,resource_type,format,original_filename,mime_type,byte_size,checksum,width,height,alt_text)
         VALUES($1,$2,$3,$4,'photo',$5,$6,'image','webp','sanitized.webp','image/webp',$7,$8,$9,$10,$11)`,
        [
          id,
          owner,
          itemId,
          s.variant === 'original' ? null : parent,
          s.variant,
          `havefolio/${env}/${id}`,
          s.byte_size,
          s.checksum,
          s.width,
          s.height,
          s.variant === 'original' ? s.alt_text : null,
        ],
      );
    }
  }

  private hash(input: ConvertDesireDto): string {
    const i = input.item;
    const date = i.purchaseDate;
    return createHash('sha256')
      .update(
        JSON.stringify([
          input.boughtEventId,
          input.copyPhoto,
          i.name.trim(),
          i.ownershipStatus,
          i.currency,
          i.pricePaid.state,
          i.pricePaid.state === 'known' ? i.pricePaid.minor : null,
          date.precision,
          date.year ?? null,
          date.month ?? null,
          date.day ?? null,
          i.acquisitionType,
          i.condition,
          i.useFrequency,
          i.categoryId ?? null,
          i.subcategoryId ?? null,
          [...(i.tagIds ?? [])].sort(),
          i.brand?.trim() || null,
          i.model?.trim() || null,
          i.notes?.trim() || null,
        ]),
      )
      .digest('hex');
  }

  /** Confirmed facts only; the likely price is never consulted. */
  private itemInput(input: ConvertDesireDto): CreateItemDto {
    const i = input.item;
    if (i.pricePaid.state === 'unknown' && i.pricePaid.minor !== undefined)
      throw new BadRequestException('INVALID_CONVERSION');
    return {
      name: i.name.trim(),
      ownershipStatus: i.ownershipStatus,
      currency: i.currency,
      pricePaidMinor: i.pricePaid.state === 'known' ? i.pricePaid.minor! : null,
      purchaseDate: i.purchaseDate,
      acquisitionType: i.acquisitionType,
      condition: i.condition,
      useFrequency: i.useFrequency,
      categoryId: i.categoryId ?? null,
      subcategoryId: i.subcategoryId ?? null,
      ...(i.tagIds ? { tagIds: i.tagIds } : {}),
      brand: i.brand?.trim() || null,
      model: i.model?.trim() || null,
      notes: i.notes?.trim() || null,
    };
  }

  async state(owner: string, id: string): Promise<DesireConversionStateDto> {
    return this.repo.transaction(owner, async (c) => {
      const d = await this.desire(c, owner, id);
      const latest = await this.latest(c, owner, id);
      const existing = await this.conversion(c, owner, 'desire', id);
      const bought = latest?.outcome === 'bought' ? latest.id : null;
      return {
        desireId: id,
        eligibility: existing ? 'converted' : bought ? 'eligible' : 'not_bought',
        boughtEventId: bought,
        suggestions: {
          name: d.name,
          notes: d.reason,
          productUrl: d.product_url,
          photo: this.photo(await this.source(c, owner, id)),
          likelyPriceMinor: d.likely_price_minor,
          likelyCurrency: d.currency,
        },
        conversion: existing ? map(existing) : null,
      };
    });
  }

  async convert(owner: string, id: string, input: ConvertDesireDto): Promise<DesireConversionDto> {
    const item = this.itemInput(input);
    const hash = this.hash(input);
    const result = await this.repo.transaction(owner, async (c) => {
      const d = await this.desire(c, owner, id);
      // Replays resolve before any stale-state validation, so an applied command always returns.
      const replay = await this.conversion(c, owner, 'command', input.commandId);
      if (replay) {
        if (replay.desire_id !== id || replay.request_hash !== hash)
          throw new ConflictException('CONVERSION_COMMAND_REUSED');
        return { row: replay, created: false };
      }
      if (await this.conversion(c, owner, 'desire', id))
        throw new ConflictException('DESIRE_ALREADY_CONVERTED');
      const latest = await this.latest(c, owner, id);
      if (latest?.outcome !== 'bought') throw new ConflictException('DESIRE_NOT_BOUGHT');
      if (latest.id !== input.boughtEventId) throw new ConflictException('STALE_BOUGHT_OUTCOME');
      const source = input.copyPhoto ? await this.source(c, owner, id) : undefined;
      const conversionId = randomUUID();
      const sources = Object.fromEntries(
        (['name', 'notes'] as const).map((k) => [
          k,
          (k === 'name' ? d.name : d.reason) === item[k] ? 'desire_suggestion' : 'owner',
        ]),
      );
      const itemId = await this.items.insert(c, owner, item, {
        // Immutable provenance: the confirmed facts, kept apart from which values were suggestions.
        originalEntry: {
          ...item,
          provenance: {
            source: 'desire_conversion',
            fields: { ...sources, photo: source ? 'desire_suggestion' : null },
            confirmed: [
              'pricePaid',
              'currency',
              'purchaseDate',
              'acquisitionType',
              'condition',
              'useFrequency',
              'ownershipStatus',
            ],
          },
        },
        event: {
          source: 'desire_conversion',
          ownershipStatus: item.ownershipStatus,
          desireId: id,
          conversionId,
        },
      });
      const photoState = !input.copyPhoto ? 'not_requested' : source ? 'pending' : 'unavailable';
      const inserted = await c
        .query(
          `INSERT INTO desire_conversions(id,owner_id,desire_id,item_id,bought_event_id,command_id,request_hash,photo_state,photo_attempt)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING RETURNING id`,
          [
            conversionId,
            owner,
            id,
            itemId,
            input.boughtEventId,
            input.commandId,
            hash,
            photoState,
            input.copyPhoto ? 1 : 0,
          ],
        )
        .catch((error: unknown) => {
          // The database guard is the final check that the bought event is still effective.
          if (error instanceof Error && error.message === 'CONVERSION_NOT_BOUGHT')
            throw new ConflictException('STALE_BOUGHT_OUTCOME');
          throw error;
        });
      if (!inserted.rowCount) throw new ConflictException('DESIRE_ALREADY_CONVERTED');
      if (source) await this.reserve(c, owner, itemId, conversionId, 1, source);
      return { row: (await this.conversion(c, owner, 'desire', id))!, created: true };
    });
    if (result.created)
      this.logger.emit('info', {
        event: 'desire_converted',
        component: 'desires',
        operation: 'convert',
        category: 'success',
      });
    if (result.row.photo_state !== 'pending') return map(result.row);
    await this.copyPhoto(owner, id).catch(() => undefined);
    return this.read(owner, id);
  }

  async read(owner: string, id: string): Promise<DesireConversionDto> {
    return this.repo.transaction(owner, async (c) => {
      await this.desire(c, owner, id);
      const row = await this.conversion(c, owner, 'desire', id);
      if (!row) throw new NotFoundException('CONVERSION_NOT_FOUND');
      return map(row);
    });
  }

  /** Explicit owner retry of an unfinished photo copy. */
  async resumePhoto(owner: string, id: string): Promise<DesireConversionDto> {
    await this.copyPhoto(owner, id);
    return this.read(owner, id);
  }

  private async copyPhoto(owner: string, id: string): Promise<void> {
    try {
      const plan = await this.plan(owner, id);
      if (!plan) return;
      const assets: { id: string; asset: StoredAsset }[] = [];
      for (const copy of plan.copies) {
        const bytes = await this.storage.read(copy.sourceKey, 'image', 'webp', copy.byteSize);
        try {
          if (createHash('sha256').update(bytes).digest('hex') !== copy.checksum)
            throw new ServiceUnavailableException('MEDIA_STORAGE_UNAVAILABLE');
          assets.push({
            id: copy.id,
            asset: await this.storage.put({
              key: copy.key,
              bytes,
              checksum: copy.checksum,
              resourceType: 'image',
              format: 'webp',
            }),
          });
        } finally {
          bytes.fill(0);
        }
      }
      await this.repo.transaction(owner, async (c) => {
        const item = await c.query('SELECT id FROM items WHERE id=$1 AND owner_id=$2 FOR UPDATE', [
          plan.itemId,
          owner,
        ]);
        if (!item.rowCount) return;
        const ids = assets.map((a) => a.id);
        const pending = await c.query(
          "SELECT id FROM media_attachments WHERE owner_id=$1 AND item_id=$2 AND id=ANY($3::uuid[]) AND state='pending' FOR UPDATE",
          [owner, plan.itemId, ids],
        );
        // Recovery cleaned part of this attempt: commit nothing; the next resume starts afresh.
        if (pending.rowCount !== ids.length) return;
        for (const { id: mediaRow, asset } of assets)
          await c.query(
            "UPDATE media_attachments SET state='ready',provider_asset_id=$1,provider_version=$2,position=0,updated_at=now() WHERE id=$3 AND owner_id=$4 AND state='pending'",
            [asset.assetId, asset.version, mediaRow, owner],
          );
        await c.query(
          'UPDATE items SET revision=revision+1,updated_at=now() WHERE id=$1 AND owner_id=$2',
          [plan.itemId, owner],
        );
        await c.query(
          "UPDATE desire_conversions SET photo_state='copied' WHERE owner_id=$1 AND item_id=$2 AND photo_state='pending'",
          [owner, plan.itemId],
        );
      });
    } catch (error) {
      if (!(error instanceof HttpException && error.getStatus() < 500)) {
        captureFailure(error, { code: 'MEDIA_STORAGE_UNAVAILABLE' });
        this.logger.emit('warn', {
          event: 'desire_conversion_photo_pending',
          component: 'desires',
          operation: 'convert_photo',
          category: 'operational_failure',
          code: 'MEDIA_STORAGE_UNAVAILABLE',
        });
      }
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException('MEDIA_STORAGE_UNAVAILABLE');
    }
  }

  /** Decides what remains to copy under owner, desire, conversion and item locks. */
  private async plan(owner: string, id: string): Promise<CopyPlan | null> {
    return this.repo.transaction(owner, async (c) => {
      await this.desire(c, owner, id);
      const conv = (
        await c.query<{ id: string; item_id: string; photo_state: string; photo_attempt: number }>(
          'SELECT id,item_id,photo_state,photo_attempt FROM desire_conversions WHERE owner_id=$1 AND desire_id=$2 FOR UPDATE',
          [owner, id],
        )
      ).rows[0];
      if (!conv) throw new NotFoundException('CONVERSION_NOT_FOUND');
      if (conv.photo_state !== 'pending') return null;
      await c.query('SELECT id FROM items WHERE id=$1 AND owner_id=$2 FOR UPDATE', [
        conv.item_id,
        owner,
      ]);
      const settle = async (state: string, attempt = conv.photo_attempt): Promise<null> => {
        await c.query(
          'UPDATE desire_conversions SET photo_state=$1,photo_attempt=$2 WHERE id=$3 AND owner_id=$4',
          [state, attempt, conv.id, owner],
        );
        return null;
      };
      const targetsOf = async (attempt: number): Promise<TargetVariant[]> =>
        (
          await c.query<TargetVariant>(
            'SELECT id,variant,state,object_key,byte_size,checksum FROM media_attachments WHERE owner_id=$1 AND item_id=$2 AND id=ANY($3::uuid[])',
            [owner, conv.item_id, variants.map((v) => mediaId(conv.id, attempt, v))],
          )
        ).rows;
      let attempt = conv.photo_attempt;
      let targets = await targetsOf(attempt);
      if (targets.length === variants.length && targets.every((t) => t.state === 'ready'))
        return settle('copied');
      const source = await this.source(c, owner, id);
      // Rules: a removed or replaced desire photo is never silently substituted; an intact
      // pending attempt is retried with the same keys; an attempt partly reclaimed by media
      // recovery is abandoned to recovery and a bounded fresh attempt is reserved.
      if (!source) return settle('unavailable');
      const allPending =
        targets.length === variants.length && targets.every((t) => t.state === 'pending');
      if (allPending) {
        if (
          !targets.every((t) =>
            source.some((s) => s.variant === t.variant && s.checksum === t.checksum),
          )
        )
          return settle('unavailable');
        // Keep in-flight intent fresh so recovery does not reclaim it mid-copy.
        await c.query(
          "UPDATE media_attachments SET updated_at=now() WHERE owner_id=$1 AND id=ANY($2::uuid[]) AND state='pending'",
          [owner, targets.map((t) => t.id)],
        );
      } else {
        if (attempt >= maxPhotoAttempts) return settle('unavailable');
        attempt += 1;
        await this.reserve(c, owner, conv.item_id, conv.id, attempt, source);
        await settle('pending', attempt);
        targets = await targetsOf(attempt);
      }
      return {
        itemId: conv.item_id,
        copies: variants.map((v) => {
          const target = targets.find((r) => r.variant === v)!;
          const from = source.find((s) => s.variant === v)!;
          return {
            id: target.id,
            key: target.object_key,
            sourceKey: from.object_key,
            byteSize: Number(from.byte_size),
            checksum: from.checksum,
          };
        }),
      };
    });
  }
}
