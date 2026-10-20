import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  HttpException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import type { EnrichmentWork, EnrichmentPage, EnrichmentReviewEvent } from '@havefolio/contracts';
import {
  validEnrichmentValue,
  type EnrichmentInput,
  type EnrichmentCandidate,
} from '@havefolio/domain';
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
}
interface WorkRow {
  id: string;
  item_id: string;
  base_revision: number;
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
  constructor(private readonly repository: ItemsRepository) {}
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
        (!['photo', 'receipt'].includes(dto.kind) && dto.attachmentId !== undefined)
      )
        throw new BadRequestException('INVALID_ENRICHMENT_INPUT');
      let input: EnrichmentInput;
      switch (dto.kind) {
        case 'name':
          input = { kind: 'name', name: item.name };
          break;
        case 'url':
          if (!item.purchase_url) throw new BadRequestException('ENRICHMENT_URL_REQUIRED');
          input = { kind: 'url', url: item.purchase_url };
          break;
        case 'barcode':
          if (!dto.barcode) throw new BadRequestException('ENRICHMENT_BARCODE_REQUIRED');
          input = { kind: 'barcode', barcode: dto.barcode };
          break;
        default:
          if (!dto.attachmentId) throw new BadRequestException('ENRICHMENT_ATTACHMENT_REQUIRED');
          if (
            (
              await c.query(
                `SELECT id FROM media_attachments WHERE id=$1 AND owner_id=$2 AND item_id=$3 AND kind=$4 AND variant='original' AND state='ready'`,
                [dto.attachmentId, owner, id, dto.kind],
              )
            ).rowCount !== 1
          )
            throw new NotFoundException('ENRICHMENT_ATTACHMENT_NOT_FOUND');
          input = { kind: dto.kind, attachmentId: dto.attachmentId };
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
        providerStatus: 'unconfigured',
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
      (dto.decision === 'correct' && !validEnrichmentValue(dto.field, dto.value))
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
    return this.repository.transaction(owner, async (c) => {
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
      if (!suggestion) throw new BadRequestException('ENRICHMENT_FIELD_NOT_FOUND');
      const previous = item[dto.field];
      const confirmed =
        dto.decision === 'reject'
          ? previous
          : dto.decision === 'correct'
            ? dto.value!
            : suggestion.value;
      // Column identifiers come exclusively from the static allowlist, never from request text.
      await c.query(
        `UPDATE items SET ${fields[dto.field]}=$3,revision=revision+1,updated_at=now() WHERE owner_id=$1 AND id=$2`,
        [owner, id, confirmed],
      );
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
    });
  }
}
