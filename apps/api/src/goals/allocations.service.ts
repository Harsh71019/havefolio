import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { AllocationContribution, DesireAllocationState } from '@havefolio/contracts';
import { EventLogger } from '@havefolio/logging';
import { GoalsRepository } from './goals.repository.js';
import { GoalsService } from './goals.service.js';
import type { ContributionsPageDto, ContributionsQueryDto } from './goals.dto.js';
import type { ConfirmAllocationDto } from './allocations.dto.js';

interface ReviewRow {
  id: string;
  outcome: string;
  estimated_not_spent_minor: string | null;
  currency: string | null;
}
interface LinkRow {
  review_event_id: string;
  goal_id: string;
  contribution_id: string;
  command_id: string;
  request_hash: string;
}
interface EntryRow {
  id: string;
  sequence: number;
  kind: string;
  amount_minor: string;
  currency: string;
  supersedes_id: string | null;
  note: string | null;
  created_at: Date;
}
@Injectable()
export class AllocationsService {
  constructor(
    private readonly repo: GoalsRepository,
    private readonly goals: GoalsService,
    private readonly logger: EventLogger,
  ) {}

  private async source(c: PoolClient, owner: string, id: string): Promise<ReviewRow | null> {
    const d = await c.query('SELECT id FROM desires WHERE id=$1 AND owner_id=$2 FOR UPDATE', [
      id,
      owner,
    ]);
    if (!d.rowCount) throw new NotFoundException('DESIRE_NOT_FOUND');
    return (
      (
        await c.query<ReviewRow>(
          'SELECT * FROM desire_review_events WHERE desire_id=$1 AND owner_id=$2 ORDER BY sequence DESC LIMIT 1',
          [id, owner],
        )
      ).rows[0] ?? null
    );
  }
  private async link(c: PoolClient, owner: string, id: string): Promise<LinkRow | null> {
    return (
      (
        await c.query<LinkRow>(
          'SELECT * FROM desire_goal_allocations WHERE desire_id=$1 AND owner_id=$2',
          [id, owner],
        )
      ).rows[0] ?? null
    );
  }
  private async stateIn(c: PoolClient, owner: string, id: string): Promise<DesireAllocationState> {
    const review = await this.source(c, owner, id);
    const link = await this.link(c, owner, id);
    let allocation: DesireAllocationState['allocation'] = null;
    if (link) {
      // Reuse the exact PER-30 projection in this same owner-locked transaction.
      const goal = await this.goals.getIn(c, owner, link.goal_id);
      const leaf = goal
        ? (
            await c.query<EntryRow>(
              `WITH RECURSIVE chain AS (
        SELECT * FROM goal_contributions WHERE id=$1 AND owner_id=$2 AND goal_id=$3
        UNION ALL SELECT e.* FROM goal_contributions e JOIN chain p ON e.supersedes_id=p.id
        WHERE e.owner_id=$2 AND e.goal_id=$3
      ) SELECT * FROM chain ORDER BY sequence DESC LIMIT 1`,
              [link.contribution_id, owner, link.goal_id],
            )
          ).rows[0]
        : undefined;
      const entry: AllocationContribution | null = leaf
        ? {
            id: leaf.id,
            sequence: leaf.sequence,
            kind: leaf.kind,
            amountMinor: leaf.amount_minor,
            currency: leaf.currency,
            supersedesId: leaf.supersedes_id,
            note: leaf.note,
            createdAt: leaf.created_at.toISOString(),
          }
        : null;
      allocation = {
        sourceReviewEventId: link.review_event_id,
        sourceChanged: review?.id !== link.review_event_id,
        goal: goal
          ? {
              id: goal.id,
              name: goal.name,
              targetMinor: goal.targetMinor,
              progressMinor: goal.progressMinor,
              currency: goal.currency,
              status: goal.status,
              revision: goal.revision,
            }
          : null,
        rootContributionId: goal ? link.contribution_id : null,
        currentContribution: entry,
      };
    }
    return {
      currentReviewEventId: review?.id ?? null,
      estimatedNotSpentMinor: review?.estimated_not_spent_minor ?? null,
      currency: review?.currency ?? null,
      allocation,
    };
  }
  async state(owner: string, id: string): Promise<DesireAllocationState> {
    return this.repo.transaction(owner, (c) => this.stateIn(c, owner, id));
  }
  async history(
    owner: string,
    id: string,
    q: ContributionsQueryDto,
  ): Promise<ContributionsPageDto> {
    return this.repo.transaction(owner, async (c) => {
      await this.source(c, owner, id);
      const link = await this.link(c, owner, id);
      if (!link) return { items: [], nextBefore: null };
      const limit = q.limit ?? 25;
      const rows = (
        await c.query<EntryRow>(
          `WITH RECURSIVE chain AS (
        SELECT * FROM goal_contributions WHERE id=$1 AND owner_id=$2 AND goal_id=$3
        UNION ALL SELECT e.* FROM goal_contributions e JOIN chain p ON e.supersedes_id=p.id WHERE e.owner_id=$2 AND e.goal_id=$3
      ) SELECT * FROM chain WHERE ($4::integer IS NULL OR sequence<$4) ORDER BY sequence DESC LIMIT $5`,
          [link.contribution_id, owner, link.goal_id, q.before ?? null, limit + 1],
        )
      ).rows;
      const items = rows.slice(0, limit).map((e) => ({
        id: e.id,
        sequence: e.sequence,
        kind: e.kind,
        amountMinor: e.amount_minor,
        currency: e.currency,
        supersedesId: e.supersedes_id,
        note: e.note,
        createdAt: e.created_at.toISOString(),
      }));
      return { items, nextBefore: rows.length > limit ? items.at(-1)!.sequence : null };
    });
  }
  async confirm(
    owner: string,
    id: string,
    input: ConfirmAllocationDto,
  ): Promise<DesireAllocationState> {
    const commandId = input.commandId.toLowerCase();
    const reviewEventId = input.reviewEventId.toLowerCase();
    const goalId = input.goalId.toLowerCase();
    const hash = createHash('sha256')
      .update(
        JSON.stringify([
          id.toLowerCase(),
          reviewEventId,
          goalId,
          input.goalRevision,
          input.confirmed,
        ]),
      )
      .digest('hex');
    const result = await this.repo.transaction(owner, async (c) => {
      const review = await this.source(c, owner, id);
      const existing = await this.link(c, owner, id);
      if (existing?.command_id === commandId) {
        if (existing.request_hash !== hash)
          throw new ConflictException('ALLOCATION_COMMAND_REUSED');
        return { state: await this.stateIn(c, owner, id), replay: true };
      }
      if (
        (
          await c.query(
            'SELECT 1 FROM desire_goal_allocations WHERE owner_id=$1 AND command_id=$2',
            [owner, commandId],
          )
        ).rowCount
      )
        throw new ConflictException('ALLOCATION_COMMAND_REUSED');
      if (existing) throw new ConflictException('ALLOCATION_ALREADY_EXISTS');
      const goal = await this.goals.getIn(c, owner, goalId);
      if (!goal) throw new NotFoundException('GOAL_NOT_FOUND');
      if (
        (
          await c.query(
            'SELECT 1 FROM goal_contributions WHERE owner_id=$1 AND goal_id=$2 AND command_id=$3',
            [owner, goal.id, commandId],
          )
        ).rowCount
      )
        throw new ConflictException('ALLOCATION_COMMAND_REUSED');
      if (!review || review.id !== reviewEventId || review.outcome !== 'declined')
        throw new ConflictException('STALE_DECLINED_OUTCOME');
      if (
        review.estimated_not_spent_minor === null ||
        BigInt(review.estimated_not_spent_minor) === 0n
      )
        throw new ConflictException('ALLOCATION_ESTIMATE_REQUIRED');
      if (goal.revision !== input.goalRevision) throw new ConflictException('STALE_GOAL_REVISION');
      if (goal.status === 'archived') throw new ConflictException('GOAL_ARCHIVED');
      if (goal.currency !== review.currency) throw new ConflictException('GOAL_CURRENCY_MISMATCH');
      const entry = (
        await c.query<{ id: string }>(
          `INSERT INTO goal_contributions(goal_id,owner_id,currency,amount_minor,command_id,request_hash,kind,sequence) VALUES($1,$2,$3,$4,$5,$6,'contribution',$7) RETURNING id`,
          [
            goal.id,
            owner,
            review.currency,
            review.estimated_not_spent_minor,
            commandId,
            hash,
            goal.revision + 1,
          ],
        )
      ).rows[0]!;
      await c.query(
        'INSERT INTO desire_goal_allocations(desire_id,owner_id,review_event_id,goal_id,contribution_id,command_id,request_hash) VALUES($1,$2,$3,$4,$5,$6,$7)',
        [id, owner, review.id, goal.id, entry.id, commandId, hash],
      );
      return { state: await this.stateIn(c, owner, id), replay: false };
    });
    if (!result.replay)
      this.logger.emit('info', {
        event: 'goal_command_completed',
        component: 'goals',
        operation: 'allocate',
        category: 'success',
      });
    return result.state;
  }
}
