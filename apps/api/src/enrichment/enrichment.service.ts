import { PublicFetcher, publicUrl } from '@havefolio/enrichment';
import { ItemPhotosService } from '../media/item-photos.service.js';
import { UploadRateService } from '../media/upload-rate.service.js';
import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  HttpException,
  Optional,
  Inject,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { PoolClient } from 'pg';
import type { EnrichmentWork, EnrichmentPage, EnrichmentReviewEvent } from '@havefolio/contracts';
import {
  approximateDate,
  formatPurchaseDateValue,
  parsePricePaidValue,
  parsePurchaseDateValue,
  receiptOnlyFields,
  refundTotals,
  validEnrichmentValue,
  validBarcode,
  type AcquisitionType,
  type EnrichmentInput,
  type EnrichmentCandidate,
  type KnownDate,
} from '@havefolio/domain';
import { domain, refundConstraintException } from '../items/financial-errors.js';
import { ItemsRepository } from '../items/items.repository.js';
import type {
  EnrichmentRequestDto,
  EnrichmentReviewDto,
  EnrichmentPageQueryDto,
} from './enrichment.dto.js';
const fields = {
  name: 'name',
  brand: 'brand',
  model: 'model',
  description: 'description',
} as const;
interface Item {
  id: string;
  revision: number;
  demo_dataset_id: string | null;
  name: string;
  brand: string | null;
  model: string | null;
  description: string | null;
  purchase_url: string | null;
  specifications: Record<string, unknown> | null;
  price_paid_minor: string | null;
  currency: string;
  acquisition_type: AcquisitionType;
  purchase_date_precision: 'exact' | 'month' | 'year' | 'unknown';
  purchase_year: number | null;
  purchase_month: number | null;
  purchase_day: number | null;
}
/** Canonical review forms of the receipt fields; `null` is "not recorded". */
function pricePaidValue(item: Item): string | null {
  return item.price_paid_minor === null ? null : `${item.currency} ${item.price_paid_minor}`;
}
function purchaseDateValue(item: Item): string | null {
  if (item.purchase_date_precision === 'unknown') return null;
  return formatPurchaseDateValue(
    approximateDate({
      precision: item.purchase_date_precision,
      year: item.purchase_year,
      month: item.purchase_month,
      day: item.purchase_day,
    }) as KnownDate,
  );
}
function currentValue(item: Item, field: EnrichmentReviewDto['field']): string | null {
  if (field === 'pricePaid') return pricePaidValue(item);
  if (field === 'purchaseDate') return purchaseDateValue(item);
  return item[field as keyof typeof fields];
}
interface WorkRow {
  id: string;
  item_id: string;
  base_revision: number;
  input: EnrichmentInput;
  state: EnrichmentWork['state'];
  attempts: number;
  failure_code: EnrichmentWork['failureCode'];
  candidates: EnrichmentCandidate[];
  created_at: Date;
  request_hash: string;
}
interface ReviewRow {
  id: string;
  work_id: string;
  command_id: string;
  revision: number;
  candidate_id: string;
  field: EnrichmentReviewDto['field'];
  decision: EnrichmentReviewDto['decision'];
  value: string | null;
  previous_value: string | null;
  confirmed_value: string | null;
  resulting_revision: number;
  created_at: Date;
  request_hash: string;
}
function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
function work(r: WorkRow): EnrichmentWork {
  return {
    id: r.id,
    itemId: r.item_id,
    inputKind: r.input.kind,
    // Only the owner's own opaque attachment ID; URLs, barcodes and names are not echoed.
    attachmentId: 'attachmentId' in r.input ? r.input.attachmentId : null,
    baseRevision: r.base_revision,
    state: r.state,
    attempts: r.attempts,
    failureCode: r.failure_code,
    candidates: r.candidates,
    createdAt: r.created_at.toISOString(),
  };
}
function review(r: ReviewRow): EnrichmentReviewEvent {
  return {
    id: r.id,
    workId: r.work_id,
    commandId: r.command_id,
    revision: r.revision,
    candidateId: r.candidate_id,
    field: r.field,
    decision: r.decision,
    ...(r.value === null ? {} : { value: r.value }),
    previousValue: r.previous_value,
    confirmedValue: r.confirmed_value,
    resultingRevision: r.resulting_revision,
    createdAt: r.created_at.toISOString(),
  };
}
@Injectable()
export class EnrichmentService {
  private readonly availableKinds: EnrichmentPage['availableKinds'];
  private importingImage = false;
  constructor(
    private readonly repository: ItemsRepository,
    @Optional() private readonly photos?: ItemPhotosService,
    @Optional() private readonly uploadRate?: UploadRateService,
    @Optional()
    @Inject('ENRICHMENT_FETCHER')
    private readonly fetcher: PublicFetcher = new PublicFetcher(),
    @Optional() config?: ConfigService,
  ) {
    this.availableKinds = [
      'url',
      'barcode',
      ...(config?.get<boolean>('ENRICHMENT_OCR_ENABLED', false)
        ? (['photo', 'receipt'] as const)
        : []),
    ];
  }
  private async item(c: PoolClient, owner: string, id: string, revision?: number): Promise<Item> {
    const active = (
      await c.query('SELECT id FROM users WHERE id=$1 AND deletion_requested_at IS NULL', [owner])
    ).rowCount;
    if (!active) throw new ConflictException('ACCOUNT_DELETION_PENDING');
    const row = (
      await c.query<Item>('SELECT * FROM items WHERE owner_id=$1 AND id=$2 FOR UPDATE', [owner, id])
    ).rows[0];
    if (!row) throw new NotFoundException('ITEM_NOT_FOUND');
    if (revision !== undefined && row.demo_dataset_id)
      throw new ConflictException('DEMO_ITEM_READ_ONLY');
    if (revision !== undefined && row.revision !== revision)
      throw new ConflictException('STALE_ITEM_REVISION');
    return row;
  }
  async request(owner: string, id: string, dto: EnrichmentRequestDto): Promise<EnrichmentWork> {
    const requestHash = hash([
      id,
      dto.revision,
      dto.kind,
      dto.barcode ?? null,
      dto.attachmentId ?? null,
      ...(dto.url !== undefined || dto.providerConsent !== undefined
        ? [{ url: dto.url ?? null, providerConsent: dto.providerConsent ?? null }]
        : []),
    ]);
    return this.repository.transaction(owner, async (c) => {
      await this.item(c, owner, id);
      const existing = (
        await c.query<WorkRow>(
          'SELECT * FROM enrichment_work WHERE owner_id=$1 AND command_id=$2',
          [owner, dto.commandId],
        )
      ).rows[0];
      if (existing) {
        if (existing.request_hash !== requestHash)
          throw new ConflictException('ENRICHMENT_COMMAND_CONFLICT');
        return work(existing);
      }
      const item = await this.item(c, owner, id, dto.revision);
      if (
        (dto.kind !== 'barcode' && dto.barcode !== undefined) ||
        (dto.kind !== 'url' && dto.url !== undefined) ||
        (!['url', 'barcode'].includes(dto.kind) && dto.providerConsent !== undefined) ||
        (!['photo', 'receipt'].includes(dto.kind) && dto.attachmentId !== undefined)
      )
        throw new BadRequestException('INVALID_ENRICHMENT_INPUT');
      let input: EnrichmentInput;
      switch (dto.kind) {
        case 'name':
          input = { kind: 'name', name: item.name };
          break;
        case 'url':
          if (dto.providerConsent !== 'public-product-metadata-v1')
            throw new BadRequestException('ENRICHMENT_CONSENT_REQUIRED');
          if (!(dto.url ?? item.purchase_url))
            throw new BadRequestException('ENRICHMENT_URL_REQUIRED');
          try {
            input = {
              kind: 'url',
              url: publicUrl((dto.url ?? item.purchase_url)!).href,
              consent: 'public-product-metadata-v1',
            };
          } catch {
            throw new BadRequestException('INVALID_ENRICHMENT_URL');
          }
          break;
        case 'barcode':
          if (dto.providerConsent !== 'open-food-facts-v1')
            throw new BadRequestException('ENRICHMENT_CONSENT_REQUIRED');
          if (!dto.barcode || !validBarcode(dto.barcode))
            throw new BadRequestException('ENRICHMENT_BARCODE_REQUIRED');
          input = { kind: 'barcode', barcode: dto.barcode, consent: 'open-food-facts-v1' };
          break;
        default: {
          if (!dto.attachmentId) throw new BadRequestException('ENRICHMENT_ATTACHMENT_REQUIRED');
          const media = (
            await c.query<{ resource_type: string }>(
              `SELECT resource_type FROM media_attachments WHERE id=$1 AND owner_id=$2 AND item_id=$3 AND kind=$4 AND variant='original' AND state='ready'`,
              [dto.attachmentId, owner, id, dto.kind],
            )
          ).rows[0];
          if (!media) throw new NotFoundException('ENRICHMENT_ATTACHMENT_NOT_FOUND');
          // PER-45 reads sanitized images only; PDF receipts are never rendered or parsed here.
          if (media.resource_type !== 'image')
            throw new BadRequestException('ENRICHMENT_ATTACHMENT_UNSUPPORTED');
          input = { kind: dto.kind, attachmentId: dto.attachmentId };
        }
      }
      const counts = (
        await c.query<{ total: number; active: number }>(
          `SELECT count(*)::int AS total,count(*) FILTER (WHERE state IN ('pending','processing','retry'))::int AS active FROM enrichment_work WHERE owner_id=$1 AND item_id=$2`,
          [owner, id],
        )
      ).rows[0]!;
      if (counts.total >= 100 || counts.active >= 3)
        throw new HttpException('ENRICHMENT_LIMIT_REACHED', 429);
      const snapshot = {
        name: item.name,
        brand: item.brand,
        model: item.model,
        description: item.description,
        specifications: item.specifications,
        pricePaid: pricePaidValue(item),
        purchaseDate: purchaseDateValue(item),
      };
      const row = (
        await c.query<WorkRow>(
          `INSERT INTO enrichment_work(owner_id,item_id,command_id,request_hash,base_revision,input,confirmed_snapshot) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
          [
            owner,
            id,
            dto.commandId,
            requestHash,
            dto.revision,
            JSON.stringify(input),
            JSON.stringify(snapshot),
          ],
        )
      ).rows[0]!;
      return work(row);
    });
  }
  async list(owner: string, id: string, q: EnrichmentPageQueryDto): Promise<EnrichmentPage> {
    return this.repository.transaction(owner, async (c) => {
      await this.item(c, owner, id);
      const rows = (
        await c.query<WorkRow>(
          'SELECT * FROM enrichment_work WHERE owner_id=$1 AND item_id=$2 AND ($3::uuid IS NULL OR id<$3) ORDER BY id DESC LIMIT $4',
          [owner, id, q.before ?? null, q.limit + 1],
        )
      ).rows;
      return {
        providerStatus: this.availableKinds.length ? 'available' : 'unconfigured',
        availableKinds: [...this.availableKinds],
        items: rows.slice(0, q.limit).map(work),
        nextBefore: rows.length > q.limit ? rows[q.limit - 1]!.id : null,
      };
    });
  }
  async history(
    owner: string,
    id: string,
    q: EnrichmentPageQueryDto,
  ): Promise<{ items: EnrichmentReviewEvent[]; nextBefore: string | null }> {
    return this.repository.transaction(owner, async (c) => {
      await this.item(c, owner, id);
      const rows = (
        await c.query<ReviewRow>(
          'SELECT * FROM enrichment_reviews WHERE owner_id=$1 AND item_id=$2 AND ($3::uuid IS NULL OR id<$3) ORDER BY id DESC LIMIT $4',
          [owner, id, q.before ?? null, q.limit + 1],
        )
      ).rows;
      return {
        items: rows.slice(0, q.limit).map(review),
        nextBefore: rows.length > q.limit ? rows[q.limit - 1]!.id : null,
      };
    });
  }
  async decide(
    owner: string,
    id: string,
    workId: string,
    dto: EnrichmentReviewDto,
  ): Promise<EnrichmentReviewEvent> {
    if (
      (dto.decision === 'correct') !== (dto.value !== undefined) ||
      (dto.decision === 'correct' &&
        (dto.field === 'image' || !validEnrichmentValue(dto.field, dto.value)))
    )
      throw new BadRequestException('INVALID_ENRICHMENT_REVIEW');
    const requestHash = hash([
      id,
      workId,
      dto.revision,
      dto.candidateId,
      dto.field,
      dto.decision,
      dto.value ?? null,
    ]);
    const apply = async (
      c: PoolClient,
      imageId?: string,
    ): Promise<EnrichmentReviewEvent | string> => {
      await this.item(c, owner, id);
      const prior = (
        await c.query<ReviewRow>(
          'SELECT * FROM enrichment_reviews WHERE owner_id=$1 AND command_id=$2',
          [owner, dto.commandId],
        )
      ).rows[0];
      if (prior) {
        if (prior.request_hash !== requestHash)
          throw new ConflictException('ENRICHMENT_COMMAND_CONFLICT');
        return review(prior);
      }
      const item = await this.item(c, owner, id, dto.revision);
      const job = (
        await c.query<WorkRow>(
          'SELECT * FROM enrichment_work WHERE id=$1 AND owner_id=$2 AND item_id=$3',
          [workId, owner, id],
        )
      ).rows[0];
      if (!job) throw new NotFoundException('ENRICHMENT_NOT_FOUND');
      if (job.state !== 'succeeded') throw new ConflictException('ENRICHMENT_NOT_REVIEWABLE');
      // Ordinary edits invalidate this work. Decisions on this work advance its review revision.
      const last = (
        await c.query<{ resulting_revision: number }>(
          'SELECT resulting_revision FROM enrichment_reviews WHERE work_id=$1 AND owner_id=$2 ORDER BY resulting_revision DESC LIMIT 1',
          [workId, owner],
        )
      ).rows[0];
      if (item.revision !== (last?.resulting_revision ?? job.base_revision))
        throw new ConflictException('STALE_ENRICHMENT_REVISION');
      const suggestion = job.candidates
        .find((candidate) => candidate.id === dto.candidateId)
        ?.fields.find((f) => f.field === dto.field);
      if (!suggestion || (receiptOnlyFields.includes(dto.field) && job.input.kind !== 'receipt'))
        throw new BadRequestException('ENRICHMENT_FIELD_NOT_FOUND');
      if (dto.field === 'image' && dto.decision === 'accept' && !imageId) return suggestion.value;
      const key = dto.field.startsWith('specification:') ? dto.field.slice(14) : null;
      const priorImage =
        dto.field === 'image'
          ? ((
              await c.query<{ confirmed_value: string | null }>(
                "SELECT confirmed_value FROM enrichment_reviews WHERE owner_id=$1 AND work_id=$2 AND candidate_id=$3 AND field='image' ORDER BY resulting_revision DESC LIMIT 1",
                [owner, workId, dto.candidateId],
              )
            ).rows[0]?.confirmed_value ?? null)
          : null;
      const rawPrevious = key
        ? item.specifications && Object.hasOwn(item.specifications, key)
          ? (item.specifications[key] ?? null)
          : null
        : dto.field === 'image'
          ? priorImage
          : currentValue(item, dto.field);
      const previous =
        rawPrevious === null || typeof rawPrevious === 'string'
          ? rawPrevious
          : JSON.stringify(rawPrevious);
      const confirmed =
        dto.decision === 'reject'
          ? previous
          : dto.decision === 'correct'
            ? dto.value!
            : dto.field === 'image'
              ? imageId!
              : suggestion.value;
      // Column identifiers come exclusively from the static allowlist, never from request text.
      if (dto.decision === 'reject' || dto.field === 'image') {
        await c.query(
          'UPDATE items SET revision=revision+1,updated_at=now() WHERE owner_id=$1 AND id=$2',
          [owner, id],
        );
      } else if (key) {
        const next = { ...item.specifications, [key]: confirmed };
        if (Buffer.byteLength(JSON.stringify(next)) > 16384 || Object.keys(next).length > 50)
          throw new BadRequestException('INVALID_ENRICHMENT_REVIEW');
        await c.query(
          'UPDATE items SET specifications=$3::jsonb,revision=revision+1,updated_at=now() WHERE owner_id=$1 AND id=$2',
          [owner, id, JSON.stringify(next)],
        );
      } else if (dto.field === 'pricePaid') {
        await this.applyPricePaid(c, owner, item, confirmed!);
      } else if (dto.field === 'purchaseDate') {
        const date = parsePurchaseDateValue(confirmed)!;
        await c.query(
          `UPDATE items SET purchase_date_precision=$3,purchase_year=$4,purchase_month=$5,purchase_day=$6,revision=revision+1,updated_at=now() WHERE owner_id=$1 AND id=$2`,
          [
            owner,
            id,
            date.precision,
            date.year,
            date.precision === 'year' ? null : date.month,
            date.precision === 'exact' ? date.day : null,
          ],
        );
      } else {
        await c.query(
          `UPDATE items SET ${fields[dto.field as keyof typeof fields]}=$3,revision=revision+1,updated_at=now() WHERE owner_id=$1 AND id=$2`,
          [owner, id, confirmed],
        );
      }
      const result = (
        await c.query<ReviewRow>(
          `INSERT INTO enrichment_reviews(owner_id,item_id,work_id,command_id,request_hash,candidate_id,field,decision,value,previous_value,confirmed_value,revision,resulting_revision) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12+1) RETURNING *`,
          [
            owner,
            id,
            workId,
            dto.commandId,
            requestHash,
            dto.candidateId,
            dto.field,
            dto.decision,
            dto.value ?? null,
            previous,
            confirmed,
            dto.revision,
          ],
        )
      ).rows[0]!;
      return review(result);
    };
    const result = await this.repository.transaction(owner, (c) => apply(c));
    if (typeof result !== 'string') return result;
    if (!this.photos || this.importingImage)
      throw new ServiceUnavailableException('ENRICHMENT_IMAGE_UNAVAILABLE');
    this.importingImage = true;
    try {
      await this.photos.authorize(owner, id);
      await this.uploadRate?.check(owner, 'enrichment-image');
      let remote;
      try {
        remote = await this.fetcher.fetch(
          result,
          ['image/jpeg', 'image/png', 'image/webp'],
          10 * 1024 * 1024,
          AbortSignal.timeout(4000),
        );
      } catch {
        throw new BadRequestException('ENRICHMENT_IMAGE_REJECTED');
      }
      let event: EnrichmentReviewEvent | undefined;
      const upload = await this.photos.upload(
        owner,
        id,
        dto.commandId,
        [
          {
            bytes: remote.bytes,
            mimeType: remote.mime,
            filename: `suggested.${remote.mime.split('/')[1]}`,
          },
        ],
        {
          revision: dto.revision,
          commit: async (c, photoId) => {
            const applied = await apply(c, photoId);
            if (typeof applied === 'string')
              throw new ConflictException('ENRICHMENT_IMAGE_UNAVAILABLE');
            event = applied;
          },
        },
      );
      if (!event || upload.results[0]?.error)
        throw new ConflictException('ENRICHMENT_IMAGE_UNAVAILABLE');
      return event;
    } finally {
      this.importingImage = false;
    }
  }
  /**
   * The confirmed receipt amount becomes the actual price paid. Recorded refunds keep the
   * currency fixed and the amount at or above their total, exactly as for manual edits.
   */
  private async applyPricePaid(
    c: PoolClient,
    owner: string,
    item: Item,
    value: string,
  ): Promise<void> {
    const paid = parsePricePaidValue(value)!;
    const refunds = (
      await c.query<{ currency: string; amountMinor: string }>(
        'SELECT currency,amount_minor AS "amountMinor" FROM item_refunds WHERE owner_id=$1 AND item_id=$2 LIMIT 51',
        [owner, item.id],
      )
    ).rows;
    if (refunds.length)
      domain(() =>
        refundTotals(
          {
            currency: paid.currency,
            pricePaidMinor: paid.minor.toString(),
            acquisitionType: item.acquisition_type,
          },
          refunds,
        ),
      );
    await c
      .query(
        'UPDATE items SET price_paid_minor=$3,currency=$4,revision=revision+1,updated_at=now() WHERE owner_id=$1 AND id=$2',
        [owner, item.id, paid.minor.toString(), paid.currency],
      )
      .catch((error: unknown) => {
        throw refundConstraintException(error) ?? error;
      });
  }
}
