import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { EventLogger } from '@havefolio/logging';
import type { PoolClient } from 'pg';
import { DesiresRepository } from './desires.repository.js';
import {
  ReminderQueueService,
  type ReminderQueueChange,
} from '../notifications/reminder-queue.service.js';
import type {
  CreateReviewDto,
  ReviewsQueryDto,
  ReviewEventDto,
  ReviewHistoryPageDto,
} from './reviews.dto.js';
interface Row {
  id: string;
  sequence: number;
  outcome: ReviewEventDto['outcome'];
  occurred_at: Date;
  note: string | null;
  linked_item_id: string | null;
  linked_item_name: string | null;
  review_at: Date | null;
  supersedes_event_id: string | null;
  estimated_not_spent_minor: string | null;
  currency: string | null;
  request_hash: string;
}
const map = (r: Row): ReviewEventDto => ({
  id: r.id,
  sequence: r.sequence,
  outcome: r.outcome,
  occurredAt: r.occurred_at.toISOString(),
  note: r.note,
  linkedItemId: r.linked_item_id,
  linkedItemName: r.linked_item_name ?? null,
  reviewAt: r.review_at?.toISOString() ?? null,
  supersedesEventId: r.supersedes_event_id,
  estimatedNotSpentMinor: r.estimated_not_spent_minor,
  currency: r.currency,
});
const select = `SELECT e.*,i.name AS linked_item_name FROM desire_review_events e LEFT JOIN items i ON i.id=e.linked_item_id AND i.owner_id=e.owner_id AND i.ownership_status='owned'`;
@Injectable()
export class ReviewsService {
  constructor(
    private readonly repo: DesiresRepository,
    private readonly reminders: ReminderQueueService,
    private readonly logger: EventLogger,
  ) {}
  private async desire(
    c: PoolClient,
    owner: string,
    id: string,
  ): Promise<{ revision: number; status: string }> {
    const row = (
      await c.query<{ revision: number; status: string }>(
        'SELECT revision,status FROM desires WHERE id=$1 AND owner_id=$2 FOR UPDATE',
        [id, owner],
      )
    ).rows[0];
    if (!row) throw new NotFoundException('DESIRE_NOT_FOUND');
    return row;
  }
  async list(owner: string, id: string, q: ReviewsQueryDto): Promise<ReviewHistoryPageDto> {
    return this.repo.transaction(owner, async (c) => {
      await this.desire(c, owner, id);
      const latest = (
        await c.query<Row>(
          `${select} WHERE e.desire_id=$1 AND e.owner_id=$2 ORDER BY e.sequence DESC LIMIT 1`,
          [id, owner],
        )
      ).rows[0];
      const limit = q.limit ?? 25;
      const rows = (
        await c.query<Row>(
          `${select} WHERE e.desire_id=$1 AND e.owner_id=$2 AND ($3::integer IS NULL OR e.sequence<$3) ORDER BY e.sequence DESC LIMIT $4`,
          [id, owner, q.before ?? null, limit + 1],
        )
      ).rows;
      const items = rows.slice(0, limit).map(map);
      return {
        items,
        nextBefore: rows.length > limit ? items.at(-1)!.sequence : null,
        currentEventId: latest?.id ?? null,
        estimatedNotSpentMinor: latest?.estimated_not_spent_minor ?? null,
        currency: latest?.currency ?? null,
      };
    });
  }
  async create(owner: string, id: string, input: CreateReviewDto): Promise<ReviewEventDto> {
    // Hash the complete canonical command, including its original revision. Replays are checked before stale-state validation.
    const note = input.note?.trim() ?? null;
    if (input.note !== undefined && !note) throw new BadRequestException('INVALID_REVIEW');
    const hash = createHash('sha256')
      .update(
        JSON.stringify([
          input.revision,
          input.outcome,
          note,
          input.linkedItemId ?? null,
          input.reviewAt ?? null,
          input.supersedesEventId ?? null,
        ]),
      )
      .digest('hex');
    const result = await this.repo.transaction(owner, async (c) => {
      const d = await this.desire(c, owner, id);
      const replay = (
        await c.query<Row>(`${select} WHERE e.desire_id=$1 AND e.owner_id=$2 AND e.command_id=$3`, [
          id,
          owner,
          input.commandId,
        ])
      ).rows[0];
      if (replay) {
        if (replay.request_hash !== hash) throw new ConflictException('REVIEW_COMMAND_REUSED');
        return { event: map(replay), change: null };
      }
      if (d.revision !== input.revision) throw new ConflictException('STALE_DESIRE_REVISION');
      const latest = (
        await c.query<{ id: string }>(
          'SELECT id FROM desire_review_events WHERE desire_id=$1 AND owner_id=$2 ORDER BY sequence DESC LIMIT 1',
          [id, owner],
        )
      ).rows[0];
      if (
        (input.supersedesEventId && latest?.id !== input.supersedesEventId) ||
        (['bought', 'declined', 'used_owned'].includes(d.status) && !input.supersedesEventId)
      )
        throw new ConflictException('REVIEW_CORRECTION_REQUIRED');
      const delayed = input.outcome === 'delayed';
      if (
        delayed
          ? !input.reviewAt ||
            !Number.isFinite(new Date(input.reviewAt).getTime()) ||
            new Date(input.reviewAt).getTime() <= Date.now()
          : input.reviewAt !== undefined
      )
        throw new BadRequestException('INVALID_REVIEW_DATE');
      if (
        (input.outcome === 'used_owned' && !input.linkedItemId) ||
        (input.linkedItemId && !['used_owned', 'bought'].includes(input.outcome))
      )
        throw new BadRequestException('INVALID_REVIEW_ITEM');
      if (input.linkedItemId) {
        const item = await c.query(
          "SELECT id FROM items WHERE id=$1 AND owner_id=$2 AND ownership_status='owned' FOR SHARE",
          [input.linkedItemId, owner],
        );
        if (!item.rowCount) throw new NotFoundException('REVIEW_ITEM_UNAVAILABLE');
      }
      const old = (
        await c.query<{ schedule_version: number }>(
          'SELECT schedule_version FROM desire_reminders WHERE desire_id=$1 AND owner_id=$2 FOR UPDATE',
          [id, owner],
        )
      ).rows[0];
      const inserted = (
        await c.query<Row>(
          `INSERT INTO desire_review_events(desire_id,owner_id,command_id,request_hash,sequence,outcome,note,linked_item_id,review_at,supersedes_event_id,estimated_not_spent_minor,currency)
    SELECT id,owner_id,$3,$4,revision+1,$5,$6,$7,$8,$9,CASE WHEN $5='declined' THEN likely_price_minor END,CASE WHEN $5='declined' THEN currency END
    FROM desires WHERE id=$1 AND owner_id=$2 RETURNING *`,
          [
            id,
            owner,
            input.commandId,
            hash,
            input.outcome,
            note,
            input.linkedItemId ?? null,
            input.reviewAt ?? null,
            input.supersedesEventId ?? null,
          ],
        )
      ).rows[0]!;
      const change: ReminderQueueChange = {
        desireId: id,
        obsoleteVersions: old ? [old.schedule_version] : [],
        ...(delayed
          ? {
              current: {
                desireId: id,
                scheduleVersion: inserted.sequence,
                scheduledFor: inserted.review_at!,
              },
            }
          : {}),
      };
      const event = (
        await c.query<Row>(`${select} WHERE e.id=$1 AND e.owner_id=$2`, [inserted.id, owner])
      ).rows[0]!;
      return { event: map(event), change };
    });
    if (result.change) {
      await this.reminders.apply(result.change).catch(() => undefined);
      this.logger.emit('info', {
        event: 'desire_review_recorded',
        component: 'desires',
        operation: 'review',
        category: 'success',
      });
    }
    return result.event;
  }
}
