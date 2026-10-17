import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
} from 'node:crypto';
import { captureFailure } from '@havefolio/monitoring/server';
import type { PoolClient } from 'pg';

import {
  deriveDesireEffectiveState,
  isDesireClassification,
  validateLikelyPrice,
  validateProductUrl,
  transitionDesireWaiting,
  isDesireDomainError,
} from '@havefolio/domain';
import { PhotoProcessor, type PhotoInput } from '../media/photo-processing.js';
import { PrivateMediaStorage, type StoredAsset } from '../media/storage.js';
import { DesiresRepository } from './desires.repository.js';
import {
  ReminderQueueService,
  type ReminderQueueChange,
} from '../notifications/reminder-queue.service.js';
import type {
  CreateDesireDto,
  PatchDesireDto,
  DesiresQueryDto,
  DesiresPageDto,
  DesireDto,
  DesirePhotoDto,
  DesireStatus,
} from './desires.dto.js';

interface DesireRow {
  id: string;
  owner_id: string;
  name: string;
  classification: DesireDto['classification'];
  likely_price_minor: string | null;
  currency: string | null;
  product_url: string | null;
  reason: string | null;
  status: DesireStatus;
  waiting_started_at: Date | null;
  review_at: Date | null;
  revision: number;
  created_at: Date;
  updated_at: Date;
}

interface PhotoRow {
  id: string;
  desire_id: string;
  width: number;
  height: number;
  byte_size: string;
  alt_text: string | null;
  created_at: Date;
}

interface Cursor {
  v: 1;
  scope: string;
  id: string;
  createdAt: string;
  expiresAt: number;
}

interface ReminderIntentRow {
  desire_id: string;
  schedule_version: number;
  scheduled_for: Date;
}

const badCursor = (): never => {
  throw new BadRequestException('INVALID_DESIRE_CURSOR');
};

@Injectable()
export class DesiresService {
  private readonly key: Buffer;
  private clockFn: () => Date = () => new Date();

  constructor(
    private readonly repo: DesiresRepository,
    private readonly processor: PhotoProcessor,
    private readonly storage: PrivateMediaStorage,
    private readonly config: ConfigService,
    private readonly reminders: ReminderQueueService,
  ) {
    const secret = config.get<string>('AUTH_RATE_KEY_SECRET');
    this.key = secret
      ? createHmac('sha256', secret).update('havefolio.desires.cursor.v1').digest()
      : randomBytes(32);
  }

  setClock(clock: () => Date): void {
    this.clockFn = clock;
  }

  resetClock(): void {
    this.clockFn = () => new Date();
  }

  private clock(): Date {
    return this.clockFn();
  }

  private scope(owner: string, query: DesiresQueryDto): string {
    const rest = { ...query };
    delete rest.after;
    return createHash('sha256')
      .update(JSON.stringify([owner, Object.entries(rest).sort(([a], [b]) => a.localeCompare(b))]))
      .digest('hex');
  }

  private encodeCursor(cursor: Cursor): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(Buffer.from('desires.v1'));
    const body = Buffer.concat([cipher.update(JSON.stringify(cursor), 'utf8'), cipher.final()]);
    return 'v1.' + Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url');
  }

  private decodeCursor(value: string, expectedScope: string): Cursor {
    try {
      if (!/^v1\.[A-Za-z0-9_-]{40,2045}$/.test(value)) return badCursor();
      const data = Buffer.from(value.slice(3), 'base64url');
      if (data.toString('base64url') !== value.slice(3)) return badCursor();
      const decipher = createDecipheriv('aes-256-gcm', this.key, data.subarray(0, 12));
      decipher.setAAD(Buffer.from('desires.v1'));
      decipher.setAuthTag(data.subarray(12, 28));
      const cursor = JSON.parse(
        Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString(),
      ) as Cursor;
      if (
        cursor.v !== 1 ||
        !Number.isSafeInteger(cursor.expiresAt) ||
        cursor.expiresAt <= this.clock().getTime() ||
        cursor.scope !== expectedScope ||
        !/^[a-f0-9-]{36}$/.test(cursor.id) ||
        typeof cursor.createdAt !== 'string' ||
        !Number.isFinite(new Date(cursor.createdAt).getTime())
      ) {
        return badCursor();
      }
      return cursor;
    } catch {
      return badCursor();
    }
  }

  private mapPhoto(row: PhotoRow | undefined): DesirePhotoDto | null {
    if (!row) return null;
    return {
      id: row.id,
      width: row.width,
      height: row.height,
      byteSize: Number(row.byte_size),
      mimeType: 'image/webp',
      altText: row.alt_text ?? null,
      decorative: row.alt_text === '',
      createdAt: row.created_at.toISOString(),
    };
  }

  private mapDesire(row: DesireRow, photo: PhotoRow | undefined, now = this.clock()): DesireDto {
    return {
      id: row.id,
      name: row.name,
      classification: row.classification,
      likelyPriceMinor: row.likely_price_minor,
      currency: row.currency,
      productUrl: row.product_url,
      reason: row.reason,
      status: row.status,
      effectiveState: deriveDesireEffectiveState(row.status, row.review_at, now),
      waitingStartedAt: row.waiting_started_at ? row.waiting_started_at.toISOString() : null,
      reviewAt: row.review_at ? row.review_at.toISOString() : null,
      photo: this.mapPhoto(photo),
      revision: row.revision,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    };
  }

  private async syncReminderIntent(
    client: PoolClient,
    ownerId: string,
    desireId: string,
    scheduledFor: Date | null,
  ): Promise<ReminderQueueChange> {
    const existing = (
      await client.query<ReminderIntentRow>(
        `SELECT desire_id,schedule_version,scheduled_for
         FROM desire_reminders
         WHERE desire_id=$1 AND owner_id=$2
         FOR UPDATE`,
        [desireId, ownerId],
      )
    ).rows[0];

    if (!scheduledFor) {
      if (existing) {
        await client.query('DELETE FROM desire_reminders WHERE desire_id=$1 AND owner_id=$2', [
          desireId,
          ownerId,
        ]);
      }
      return {
        desireId,
        obsoleteVersions: existing ? [existing.schedule_version] : [],
      };
    }

    if (existing?.scheduled_for.getTime() === scheduledFor.getTime()) {
      return {
        desireId,
        current: {
          desireId,
          scheduleVersion: existing.schedule_version,
          scheduledFor: existing.scheduled_for,
        },
        obsoleteVersions: [],
      };
    }

    const scheduleVersion = (existing?.schedule_version ?? 0) + 1;
    const result = await client.query<ReminderIntentRow>(
      `INSERT INTO desire_reminders(
         desire_id,owner_id,schedule_version,scheduled_for,state,last_enqueued_at,delivered_at
       ) VALUES($1,$2,$3,$4,'pending',null,null)
       ON CONFLICT(desire_id) DO UPDATE
       SET owner_id=excluded.owner_id,
           schedule_version=excluded.schedule_version,
           scheduled_for=excluded.scheduled_for,
           state='pending',last_enqueued_at=null,delivered_at=null,updated_at=now()
       RETURNING desire_id,schedule_version,scheduled_for`,
      [desireId, ownerId, scheduleVersion, scheduledFor],
    );
    const current = result.rows[0]!;
    return {
      desireId,
      current: {
        desireId,
        scheduleVersion: current.schedule_version,
        scheduledFor: current.scheduled_for,
      },
      obsoleteVersions: existing ? [existing.schedule_version] : [],
    };
  }

  async create(owner: string, input: CreateDesireDto): Promise<DesireDto> {
    const trimmedName = input.name?.trim();
    if (!trimmedName || trimmedName.length > 300) {
      throw new BadRequestException('INVALID_DESIRE');
    }

    if (input.classification !== undefined && input.classification !== null) {
      if (!isDesireClassification(input.classification)) {
        throw new BadRequestException('INVALID_DESIRE');
      }
    }

    let likelyPrice: { minor: bigint | null; currency: string | null };
    try {
      likelyPrice = validateLikelyPrice(input.likelyPriceMinor, input.currency);
    } catch (err) {
      if (isDesireDomainError(err)) throw new BadRequestException(err.code);
      throw err;
    }

    let productUrl: string | null;
    try {
      productUrl = validateProductUrl(input.productUrl);
    } catch (err) {
      if (isDesireDomainError(err)) throw new BadRequestException(err.code);
      throw err;
    }

    let reason: string | null = null;
    if (input.reason !== undefined && input.reason !== null) {
      const trimmedReason = input.reason.trim();
      if (trimmedReason.length > 2000) {
        throw new BadRequestException('INVALID_DESIRE');
      }
      reason = trimmedReason.length > 0 ? trimmedReason : null;
    }

    let waiting: ReturnType<typeof transitionDesireWaiting>;
    try {
      waiting = transitionDesireWaiting(
        { status: 'considering', waitingStartedAt: null, reviewAt: null },
        input.waitingPeriod,
        this.clock(),
      );
    } catch (err) {
      if (isDesireDomainError(err)) throw new BadRequestException(err.code);
      throw err;
    }

    const created = await this.repo.transaction(owner, async (c) => {
      const id = randomUUID();
      const result = await c.query<DesireRow>(
        `INSERT INTO desires(
          id, owner_id, name, classification, likely_price_minor, currency,
          product_url, reason, status, waiting_started_at, review_at, revision
        ) VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 1)
        RETURNING *`,
        [
          id,
          owner,
          trimmedName,
          input.classification ?? null,
          likelyPrice.minor !== null ? likelyPrice.minor.toString() : null,
          likelyPrice.currency,
          productUrl,
          reason,
          waiting.status,
          waiting.waitingStartedAt,
          waiting.reviewAt,
        ],
      );
      const row = result.rows[0]!;
      const reminder = await this.syncReminderIntent(c, owner, id, row.review_at);
      return { desire: this.mapDesire(row, undefined), reminder };
    });
    await this.reminders.apply(created.reminder).catch(() => undefined);
    return created.desire;
  }

  async get(owner: string, id: string): Promise<DesireDto> {
    return this.repo.transaction(owner, async (c) => {
      const desireRes = await c.query<DesireRow>(
        'SELECT * FROM desires WHERE id=$1 AND owner_id=$2',
        [id, owner],
      );
      const row = desireRes.rows[0];
      if (!row) throw new NotFoundException('DESIRE_NOT_FOUND');

      const photoRes = await c.query<PhotoRow>(
        `SELECT id, desire_id, width, height, byte_size, alt_text, created_at
         FROM media_attachments
         WHERE owner_id=$1 AND desire_id=$2 AND kind='photo' AND variant='original' AND state='ready'
         LIMIT 1`,
        [owner, id],
      );
      return this.mapDesire(row, photoRes.rows[0]);
    });
  }

  async list(owner: string, input: DesiresQueryDto): Promise<DesiresPageDto> {
    const limit = Math.min(Math.max(input.limit ?? 25, 1), 100);
    const scope = this.scope(owner, input);
    const cursor = input.after ? this.decodeCursor(input.after, scope) : undefined;

    return this.repo.transaction(owner, async (c) => {
      const values: unknown[] = [owner];
      const clauses: string[] = ['d.owner_id = $1'];

      if (input.status) {
        values.push(input.status);
        clauses.push(`d.status = $${values.length}`);
      }

      if (input.effectiveState) {
        if (input.effectiveState === 'considering') {
          clauses.push(`d.status = 'considering'`);
        } else if (input.effectiveState === 'waiting') {
          values.push(this.clock());
          clauses.push(`d.status = 'waiting' AND d.review_at > $${values.length}`);
        } else if (input.effectiveState === 'ready_for_review') {
          values.push(this.clock());
          clauses.push(`d.status = 'waiting' AND d.review_at <= $${values.length}`);
        }
      }

      if (input.classification) {
        values.push(input.classification);
        clauses.push(`d.classification = $${values.length}`);
      }

      if (cursor) {
        values.push(new Date(cursor.createdAt), cursor.id);
        const idxCreated = values.length - 1;
        const idxId = values.length;
        clauses.push(
          `(d.created_at < $${idxCreated} OR (d.created_at = $${idxCreated} AND d.id > $${idxId}))`,
        );
      }

      values.push(limit + 1);
      const limitIdx = values.length;

      const queryText = `
        SELECT * FROM desires d
        WHERE ${clauses.join(' AND ')}
        ORDER BY d.created_at DESC, d.id ASC
        LIMIT $${limitIdx}
      `;

      const result = await c.query<DesireRow>(queryText, values);
      const hasMore = result.rows.length > limit;
      const rows = result.rows.slice(0, limit);

      const desireIds = rows.map((r) => r.id);
      const photoMap = new Map<string, PhotoRow>();
      if (desireIds.length > 0) {
        const photoRes = await c.query<PhotoRow>(
          `SELECT id, desire_id, width, height, byte_size, alt_text, created_at
           FROM media_attachments
           WHERE owner_id=$1 AND desire_id = ANY($2::uuid[]) AND kind='photo' AND variant='original' AND state='ready'`,
          [owner, desireIds],
        );
        for (const p of photoRes.rows) {
          photoMap.set(p.desire_id, p);
        }
      }

      const items = rows.map((r) => this.mapDesire(r, photoMap.get(r.id)));
      const last = rows.at(-1);

      return {
        items,
        hasMore,
        nextCursor:
          hasMore && last
            ? this.encodeCursor({
                v: 1,
                scope,
                id: last.id,
                createdAt: last.created_at.toISOString(),
                expiresAt: this.clock().getTime() + 7 * 24 * 60 * 60 * 1000,
              })
            : null,
      };
    });
  }

  async update(owner: string, id: string, input: PatchDesireDto): Promise<DesireDto> {
    if (
      input.name === undefined &&
      input.classification === undefined &&
      input.likelyPriceMinor === undefined &&
      input.currency === undefined &&
      input.productUrl === undefined &&
      input.reason === undefined &&
      input.waitingPeriod === undefined
    ) {
      throw new BadRequestException('INVALID_DESIRE');
    }

    const changed = await this.repo.transaction(owner, async (c) => {
      const desireRes = await c.query<DesireRow>(
        'SELECT * FROM desires WHERE id=$1 AND owner_id=$2 FOR UPDATE',
        [id, owner],
      );
      const row = desireRes.rows[0];
      if (!row) throw new NotFoundException('DESIRE_NOT_FOUND');
      if (row.revision !== input.revision) {
        throw new ConflictException('STALE_DESIRE_REVISION');
      }

      let newName = row.name;
      if (input.name !== undefined) {
        const trimmed = input.name.trim();
        if (!trimmed || trimmed.length > 300) {
          throw new BadRequestException('INVALID_DESIRE');
        }
        newName = trimmed;
      }

      let newClassification = row.classification;
      if (input.classification !== undefined) {
        if (input.classification !== null && !isDesireClassification(input.classification)) {
          throw new BadRequestException('INVALID_DESIRE');
        }
        newClassification = input.classification;
      }

      let newPriceMinor = row.likely_price_minor;
      let newCurrency = row.currency;
      if (input.likelyPriceMinor !== undefined || input.currency !== undefined) {
        if (input.likelyPriceMinor === null && input.currency === null) {
          newPriceMinor = null;
          newCurrency = null;
        } else {
          try {
            const price = validateLikelyPrice(
              input.likelyPriceMinor !== undefined
                ? input.likelyPriceMinor
                : row.likely_price_minor,
              input.currency !== undefined ? input.currency : row.currency,
            );
            newPriceMinor = price.minor !== null ? price.minor.toString() : null;
            newCurrency = price.currency;
          } catch (err) {
            if (isDesireDomainError(err)) throw new BadRequestException(err.code);
            throw err;
          }
        }
      }

      let newProductUrl = row.product_url;
      if (input.productUrl !== undefined) {
        try {
          newProductUrl = validateProductUrl(input.productUrl);
        } catch (err) {
          if (isDesireDomainError(err)) throw new BadRequestException(err.code);
          throw err;
        }
      }

      let newReason = row.reason;
      if (input.reason !== undefined) {
        if (input.reason === null) {
          newReason = null;
        } else {
          const trimmed = input.reason.trim();
          if (trimmed.length > 2000) throw new BadRequestException('INVALID_DESIRE');
          newReason = trimmed.length > 0 ? trimmed : null;
        }
      }

      let waitingState: ReturnType<typeof transitionDesireWaiting>;
      try {
        waitingState = transitionDesireWaiting(
          {
            status: row.status,
            waitingStartedAt: row.waiting_started_at,
            reviewAt: row.review_at,
          },
          input.waitingPeriod,
          this.clock(),
        );
      } catch (err) {
        if (isDesireDomainError(err)) throw new BadRequestException(err.code);
        throw err;
      }

      const updatedRes = await c.query<DesireRow>(
        `UPDATE desires
         SET name=$1, classification=$2, likely_price_minor=$3, currency=$4,
             product_url=$5, reason=$6, status=$7, waiting_started_at=$8,
             review_at=$9, revision=revision+1, updated_at=now()
         WHERE id=$10 AND owner_id=$11
         RETURNING *`,
        [
          newName,
          newClassification,
          newPriceMinor,
          newCurrency,
          newProductUrl,
          newReason,
          waitingState.status,
          waitingState.waitingStartedAt,
          waitingState.reviewAt,
          id,
          owner,
        ],
      );

      const photoRes = await c.query<PhotoRow>(
        `SELECT id, desire_id, width, height, byte_size, alt_text, created_at
         FROM media_attachments
         WHERE owner_id=$1 AND desire_id=$2 AND kind='photo' AND variant='original' AND state='ready'
         LIMIT 1`,
        [owner, id],
      );

      const updated = updatedRes.rows[0]!;
      const reminder = await this.syncReminderIntent(c, owner, id, updated.review_at);
      return { desire: this.mapDesire(updated, photoRes.rows[0]), reminder };
    });
    await this.reminders.apply(changed.reminder).catch(() => undefined);
    return changed.desire;
  }

  async delete(owner: string, id: string, revision: number): Promise<void> {
    const reminder = await this.repo.transaction(owner, async (c) => {
      const desireRes = await c.query<DesireRow>(
        'SELECT * FROM desires WHERE id=$1 AND owner_id=$2 FOR UPDATE',
        [id, owner],
      );
      const row = desireRes.rows[0];
      if (!row) throw new NotFoundException('DESIRE_NOT_FOUND');
      if (row.revision !== revision) {
        throw new ConflictException('STALE_DESIRE_REVISION');
      }

      const attachments = (
        await c.query<{
          id: string;
          state: string;
          object_key: string;
          variant: string;
        }>(
          `SELECT id, state, object_key, variant FROM media_attachments WHERE owner_id=$1 AND desire_id=$2`,
          [owner, id],
        )
      ).rows;

      if (attachments.some((a) => a.state === 'pending')) {
        throw new ConflictException('DESIRE_MEDIA_PENDING');
      }

      const activeAttachments = attachments.filter((a) => ['ready', 'deleting'].includes(a.state));

      if (activeAttachments.length > 0) {
        await c.query(
          `UPDATE media_attachments
           SET state='deleting', updated_at=now()
           WHERE owner_id=$1 AND desire_id=$2 AND state IN ('ready', 'deleting')`,
          [owner, id],
        );

        for (const att of activeAttachments) {
          try {
            await this.storage.delete(att.object_key, 'image');
          } catch (err) {
            captureFailure(err, { code: 'MEDIA_STORAGE_UNAVAILABLE' });
            throw new ServiceUnavailableException('DESIRES_UNAVAILABLE');
          }
        }

        // Mark deleted and detach from desire
        await c.query(
          `UPDATE media_attachments
           SET state='deleted', original_filename='deleted',
               alt_text=null, checksum=repeat('0', 64), width=null, height=null,
               provider_asset_id=null, provider_version=null, updated_at=now()
           WHERE owner_id=$1 AND desire_id=$2 AND state='deleting'`,
          [owner, id],
        );

        await c.query(
          `UPDATE media_attachments
           SET desire_id=NULL
           WHERE owner_id=$1 AND desire_id=$2 AND state='deleted'`,
          [owner, id],
        );
      }

      const queueChange = await this.syncReminderIntent(c, owner, id, null);
      await c.query('DELETE FROM desires WHERE id=$1 AND owner_id=$2', [id, owner]);
      return queueChange;
    });
    await this.reminders.apply(reminder).catch(() => undefined);
  }

  // --- Photo support ---

  async authorizePhoto(owner: string, id: string): Promise<void> {
    if (!this.config.get<boolean>('MEDIA_STORAGE_ENABLED', false)) {
      throw new ServiceUnavailableException('MEDIA_STORAGE_DISABLED');
    }
    await this.repo.transaction(owner, async (c) => {
      const r = await c.query('SELECT id FROM desires WHERE id=$1 AND owner_id=$2', [id, owner]);
      if (!r.rows[0]) throw new NotFoundException('DESIRE_NOT_FOUND');
    });
  }

  async uploadPhoto(
    owner: string,
    desireId: string,
    uploadId: string,
    file: PhotoInput,
  ): Promise<DesirePhotoDto> {
    if (!this.config.get<boolean>('MEDIA_STORAGE_ENABLED', false)) {
      throw new ServiceUnavailableException('MEDIA_STORAGE_DISABLED');
    }

    let outputs: Awaited<ReturnType<PhotoProcessor['process']>> = [];
    try {
      outputs = await this.processor.process(file);
      const hex = createHash('sha256').update(`${uploadId}:0`).digest('hex');
      const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
      const ids = [id, randomUUID(), randomUUID()];

      const existing = await this.repo.transaction(owner, async (c) => {
        const desireRes = await c.query<DesireRow>(
          'SELECT * FROM desires WHERE id=$1 AND owner_id=$2 FOR UPDATE',
          [desireId, owner],
        );
        if (!desireRes.rows[0]) throw new NotFoundException('DESIRE_NOT_FOUND');

        const prior = (
          await c.query<{
            id: string;
            owner_id: string;
            desire_id: string;
            checksum: string;
            state: string;
          }>('SELECT * FROM media_attachments WHERE id=$1', [id])
        ).rows[0];

        if (prior) {
          if (
            prior.owner_id === owner &&
            prior.desire_id === desireId &&
            prior.state === 'deleted'
          ) {
            throw new ConflictException('PHOTO_UPLOAD_RECOVERED');
          }
          if (
            prior.owner_id !== owner ||
            prior.desire_id !== desireId ||
            prior.checksum !== outputs[0]!.checksum
          ) {
            throw new ConflictException('PHOTO_UPLOAD_ID_REUSED');
          }
          if (prior.state !== 'ready') throw new ConflictException('PHOTO_UPLOAD_PENDING');
          return prior;
        }

        // Check storage quota (2 GiB per owner)
        const ownerBytes = (
          await c.query<{ bytes: string }>(
            `SELECT coalesce(sum(byte_size), 0)::text AS bytes
             FROM media_attachments WHERE owner_id=$1 AND state<>'deleted'`,
            [owner],
          )
        ).rows[0]!;
        const additionalBytes = outputs.reduce((n, o) => n + o.bytes.length, 0);
        if (Number(ownerBytes.bytes) + additionalBytes > 2 * 1024 ** 3) {
          throw new ConflictException('PHOTO_QUOTA_EXCEEDED');
        }

        // Global advisory lock (13130013) to serialize total app quota (4 GiB)
        await c.query('SELECT pg_advisory_xact_lock(13130013)');
        const totalBytes = (
          await c.query<{ bytes: string }>(
            `SELECT coalesce(sum(byte_size), 0)::text AS bytes
             FROM media_attachments WHERE state<>'deleted'`,
          )
        ).rows[0]!;
        if (Number(totalBytes.bytes) + additionalBytes > 4 * 1024 ** 3) {
          throw new ConflictException('PHOTO_QUOTA_EXCEEDED');
        }

        // Clean up any existing photo family on this desire before inserting new attachments
        const existingOld = (
          await c.query<{ id: string; object_key: string }>(
            `SELECT id, object_key FROM media_attachments
             WHERE owner_id=$1 AND desire_id=$2 AND state IN ('ready', 'deleting')`,
            [owner, desireId],
          )
        ).rows;

        if (existingOld.length > 0) {
          await c.query(
            `UPDATE media_attachments
             SET state='deleting', updated_at=now()
             WHERE owner_id=$1 AND desire_id=$2 AND state IN ('ready', 'deleting')`,
            [owner, desireId],
          );

          for (const old of existingOld) {
            try {
              await this.storage.delete(old.object_key, 'image');
            } catch (err) {
              captureFailure(err, { code: 'MEDIA_STORAGE_UNAVAILABLE' });
            }
          }

          await c.query(
            `UPDATE media_attachments
             SET state='deleted', original_filename='deleted',
                 alt_text=null, checksum=repeat('0', 64), width=null, height=null,
                 provider_asset_id=null, provider_version=null, updated_at=now()
             WHERE owner_id=$1 AND desire_id=$2 AND state='deleting'`,
            [owner, desireId],
          );

          await c.query(
            `UPDATE media_attachments
             SET desire_id=NULL
             WHERE owner_id=$1 AND desire_id=$2 AND state='deleted'`,
            [owner, desireId],
          );
        }

        // Insert new pending attachments
        const env = this.config.get<string>('NODE_ENV', 'development');
        for (const [i, o] of outputs.entries()) {
          await c.query(
            `INSERT INTO media_attachments(
              id, owner_id, desire_id, parent_id, kind, variant, object_key,
              resource_type, format, original_filename, mime_type, byte_size,
              checksum, width, height
            ) VALUES($1, $2, $3, $4, 'photo', $5, $6, 'image', 'webp', 'sanitized.webp', 'image/webp', $7, $8, $9, $10)`,
            [
              ids[i],
              owner,
              desireId,
              i === 0 ? null : id,
              o.variant,
              `havefolio/${env}/${ids[i]}`,
              o.bytes.length,
              o.checksum,
              o.width,
              o.height,
            ],
          );
        }
        return undefined;
      });

      if (!existing) {
        const assets: StoredAsset[] = [];
        const env = this.config.get<string>('NODE_ENV', 'development');
        for (const [i, o] of outputs.entries()) {
          assets.push(
            await this.storage.put({
              key: `havefolio/${env}/${ids[i]}`,
              bytes: o.bytes,
              checksum: o.checksum,
              resourceType: 'image',
              format: 'webp',
            }),
          );
        }

        await this.repo.transaction(owner, async (c) => {
          const desireRes = await c.query<DesireRow>(
            'SELECT * FROM desires WHERE id=$1 AND owner_id=$2 FOR UPDATE',
            [desireId, owner],
          );
          if (!desireRes.rows[0]) throw new NotFoundException('DESIRE_NOT_FOUND');

          for (const [i, asset] of assets.entries()) {
            const r = await c.query(
              `UPDATE media_attachments
               SET state='ready', provider_asset_id=$1, provider_version=$2, position=0, updated_at=now()
               WHERE id=$3 AND owner_id=$4 AND state='pending'`,
              [asset.assetId, asset.version, ids[i], owner],
            );
            if (r.rowCount !== 1) throw new ConflictException('PHOTO_UPLOAD_PENDING');
          }

          await c.query(
            'UPDATE desires SET revision=revision+1, updated_at=now() WHERE id=$1 AND owner_id=$2',
            [desireId, owner],
          );
        });
      }

      return this.getPhoto(owner, desireId);
    } catch (error) {
      if (!(error instanceof HttpException && error.getStatus() < 500)) {
        captureFailure(error, { code: 'MEDIA_STORAGE_UNAVAILABLE' });
      }
      throw error;
    } finally {
      file.bytes.fill(0);
      outputs.forEach((o) => o.bytes.fill(0));
    }
  }

  async getPhoto(owner: string, desireId: string): Promise<DesirePhotoDto> {
    return this.repo.transaction(owner, async (c) => {
      const desireRes = await c.query('SELECT id FROM desires WHERE id=$1 AND owner_id=$2', [
        desireId,
        owner,
      ]);
      if (!desireRes.rows[0]) throw new NotFoundException('DESIRE_NOT_FOUND');

      const photoRes = await c.query<PhotoRow>(
        `SELECT id, desire_id, width, height, byte_size, alt_text, created_at
         FROM media_attachments
         WHERE owner_id=$1 AND desire_id=$2 AND kind='photo' AND variant='original' AND state='ready'
         LIMIT 1`,
        [owner, desireId],
      );
      const photo = photoRes.rows[0];
      if (!photo) throw new NotFoundException('DESIRE_PHOTO_NOT_FOUND');
      return this.mapPhoto(photo)!;
    });
  }

  async deletePhoto(
    owner: string,
    desireId: string,
    revision: number,
  ): Promise<{ revision: number }> {
    return this.repo.transaction(owner, async (c) => {
      const desireRes = await c.query<DesireRow>(
        'SELECT * FROM desires WHERE id=$1 AND owner_id=$2 FOR UPDATE',
        [desireId, owner],
      );
      const row = desireRes.rows[0];
      if (!row) throw new NotFoundException('DESIRE_NOT_FOUND');
      if (row.revision !== revision) {
        throw new ConflictException('STALE_DESIRE_REVISION');
      }

      const attachments = (
        await c.query<{ id: string; object_key: string }>(
          `SELECT id, object_key FROM media_attachments
           WHERE owner_id=$1 AND desire_id=$2 AND kind='photo' AND state IN ('ready', 'deleting')`,
          [owner, desireId],
        )
      ).rows;

      if (attachments.length === 0) {
        throw new NotFoundException('DESIRE_PHOTO_NOT_FOUND');
      }

      await c.query(
        `UPDATE media_attachments
         SET state='deleting', updated_at=now()
         WHERE owner_id=$1 AND desire_id=$2 AND state IN ('ready', 'deleting')`,
        [owner, desireId],
      );

      for (const att of attachments) {
        try {
          await this.storage.delete(att.object_key, 'image');
        } catch (err) {
          captureFailure(err, { code: 'MEDIA_STORAGE_UNAVAILABLE' });
          throw new ServiceUnavailableException('DESIRES_UNAVAILABLE');
        }
      }

      await c.query(
        `UPDATE media_attachments
         SET state='deleted', original_filename='deleted',
             alt_text=null, checksum=repeat('0', 64), width=null, height=null,
             provider_asset_id=null, provider_version=null, updated_at=now()
         WHERE owner_id=$1 AND desire_id=$2 AND state='deleting'`,
        [owner, desireId],
      );

      await c.query(
        `UPDATE media_attachments
         SET desire_id=NULL
         WHERE owner_id=$1 AND desire_id=$2 AND state='deleted'`,
        [owner, desireId],
      );

      const updated = await c.query<{ revision: number }>(
        'UPDATE desires SET revision=revision+1, updated_at=now() WHERE id=$1 AND owner_id=$2 RETURNING revision',
        [desireId, owner],
      );
      return { revision: updated.rows[0]!.revision };
    });
  }

  async getPhotoContent(owner: string, desireId: string, variant: string): Promise<Buffer> {
    if (!['display', 'thumbnail'].includes(variant)) {
      throw new BadRequestException('PHOTO_VARIANT_INVALID');
    }

    const row = await this.repo.transaction(owner, async (c) => {
      const desireRes = await c.query('SELECT id FROM desires WHERE id=$1 AND owner_id=$2', [
        desireId,
        owner,
      ]);
      if (!desireRes.rows[0]) throw new NotFoundException('DESIRE_NOT_FOUND');

      const attRes = await c.query<{
        object_key: string;
        resource_type: 'image';
        format: 'webp';
        byte_size: string;
        checksum: string;
      }>(
        `SELECT object_key, resource_type, format, byte_size, checksum
         FROM media_attachments
         WHERE owner_id=$1 AND desire_id=$2 AND kind='photo' AND variant=$3 AND state='ready'
           AND parent_id IN (
             SELECT id FROM media_attachments
             WHERE owner_id=$1 AND desire_id=$2 AND kind='photo' AND variant='original' AND state='ready'
           )
         LIMIT 1`,
        [owner, desireId, variant],
      );
      const r = attRes.rows[0];
      if (!r) throw new NotFoundException('DESIRE_PHOTO_NOT_FOUND');
      return r;
    });

    try {
      const bytes = await this.storage.read(
        row.object_key,
        row.resource_type,
        row.format,
        Number(row.byte_size),
      );
      if (createHash('sha256').update(bytes).digest('hex') !== row.checksum) {
        bytes.fill(0);
        throw new ServiceUnavailableException('MEDIA_STORAGE_UNAVAILABLE');
      }
      return bytes;
    } catch (err) {
      if (err instanceof HttpException) throw err;
      throw new ServiceUnavailableException('MEDIA_STORAGE_UNAVAILABLE');
    }
  }
}
