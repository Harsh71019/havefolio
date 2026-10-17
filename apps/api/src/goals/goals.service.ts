import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { EventLogger } from '@havefolio/logging';
import { GoalsRepository } from './goals.repository.js';
import type {
  CreateGoalDto,
  PatchGoalDto,
  GoalsQueryDto,
  GoalDto,
  GoalsPageDto,
  CreateContributionDto,
  ContributionDto,
  ContributionsQueryDto,
  ContributionsPageDto,
} from './goals.dto.js';
interface GoalRow {
  id: string;
  name: string;
  target_minor: string;
  currency: string;
  target_date: string | null;
  notes: string | null;
  status: string;
  revision: number;
  created_at: Date;
  updated_at: Date;
  progress_minor?: string;
}
interface ContributionRow {
  id: string;
  sequence: number;
  kind: string;
  amount_minor: string;
  currency: string;
  supersedes_id: string | null;
  note: string | null;
  created_at: Date;
  request_hash: string;
}
const goalSelect = `SELECT g.*,g.target_date::text AS target_date,coalesce((SELECT sum(e.amount_minor) FROM goal_contributions e WHERE e.goal_id=g.id AND e.owner_id=g.owner_id AND NOT EXISTS(SELECT 1 FROM goal_contributions s WHERE s.supersedes_id=e.id AND s.owner_id=e.owner_id)),0)::text AS progress_minor FROM goals g`;
const goalMap = (g: GoalRow): GoalDto => ({
  id: g.id,
  name: g.name,
  targetMinor: g.target_minor,
  currency: g.currency,
  targetDate: g.target_date,
  notes: g.notes,
  status: g.status,
  revision: g.revision,
  createdAt: g.created_at.toISOString(),
  updatedAt: g.updated_at.toISOString(),
  progressMinor: g.progress_minor ?? '0',
});
const contributionMap = (e: ContributionRow): ContributionDto => ({
  id: e.id,
  sequence: e.sequence,
  kind: e.kind,
  amountMinor: e.amount_minor,
  currency: e.currency,
  supersedesId: e.supersedes_id,
  note: e.note,
  createdAt: e.created_at.toISOString(),
});
const maximum = 9223372036854775807n;
function amount(v: string): bigint {
  if (typeof v !== 'string' || !/^(0|[1-9][0-9]{0,18})$/.test(v) || BigInt(v) > maximum)
    throw new BadRequestException('INVALID_GOAL');
  return BigInt(v);
}
function clean(v: string): string {
  const result = v.trim();
  if (!result) throw new BadRequestException('INVALID_GOAL');
  return result;
}
@Injectable()
export class GoalsService {
  constructor(
    private readonly repo: GoalsRepository,
    private readonly logger: EventLogger,
  ) {}
  private emit(operation: string): void {
    this.logger.emit('info', {
      event: 'goal_command_completed',
      component: 'goals',
      operation,
      category: 'success',
    });
  }
  private async find(c: PoolClient, owner: string, id: string): Promise<GoalRow> {
    const row = (
      await c.query<GoalRow>(`${goalSelect} WHERE g.id=$1 AND g.owner_id=$2 FOR UPDATE OF g`, [
        id,
        owner,
      ])
    ).rows[0];
    if (!row) throw new NotFoundException('GOAL_NOT_FOUND');
    return row;
  }
  private revision(g: GoalRow, revision: number): void {
    if (g.revision !== revision) throw new ConflictException('STALE_GOAL_REVISION');
  }
  async create(owner: string, input: CreateGoalDto): Promise<GoalDto> {
    amount(input.targetMinor);
    const result = await this.repo.transaction(owner, async (c) => {
      const row = (
        await c.query<{ id: string }>(
          `INSERT INTO goals(owner_id,name,target_minor,currency,target_date,notes) VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,
          [
            owner,
            clean(input.name),
            input.targetMinor,
            input.currency,
            input.targetDate ?? null,
            input.notes == null ? null : clean(input.notes),
          ],
        )
      ).rows[0]!;
      return goalMap(await this.find(c, owner, row.id));
    });
    this.emit('create');
    return result;
  }
  async get(owner: string, id: string): Promise<GoalDto> {
    return this.repo.transaction(owner, async (c) => goalMap(await this.find(c, owner, id)));
  }
  async list(owner: string, q: GoalsQueryDto): Promise<GoalsPageDto> {
    return this.repo.transaction(owner, async (c) => {
      const limit = q.limit ?? 25;
      const rows = (
        await c.query<GoalRow>(
          `${goalSelect} WHERE g.owner_id=$1 AND ($2::uuid IS NULL OR g.id>$2) AND ($3::text IS NULL OR g.status=$3) ORDER BY g.id LIMIT $4`,
          [owner, q.after ?? null, q.status ?? null, limit + 1],
        )
      ).rows;
      const items = rows.slice(0, limit).map(goalMap);
      return { items, nextAfter: rows.length > limit ? items.at(-1)!.id : null };
    });
  }
  async update(owner: string, id: string, input: PatchGoalDto): Promise<GoalDto> {
    if (input.targetMinor !== undefined) amount(input.targetMinor);
    const result = await this.repo.transaction(owner, async (c) => {
      const g = await this.find(c, owner, id);
      this.revision(g, input.revision);
      if (
        input.currency !== undefined &&
        input.currency !== g.currency &&
        (
          await c.query(
            'SELECT 1 FROM goal_contributions WHERE goal_id=$1 AND owner_id=$2 LIMIT 1',
            [id, owner],
          )
        ).rowCount
      )
        throw new ConflictException('GOAL_CURRENCY_LOCKED');
      await c.query(
        `UPDATE goals SET name=$3,target_minor=$4,currency=$5,target_date=$6,notes=$7,status=$8,revision=revision+1,updated_at=now() WHERE id=$1 AND owner_id=$2`,
        [
          id,
          owner,
          input.name === undefined ? g.name : clean(input.name),
          input.targetMinor ?? g.target_minor,
          input.currency ?? g.currency,
          input.targetDate === undefined ? g.target_date : input.targetDate,
          input.notes === undefined ? g.notes : input.notes === null ? null : clean(input.notes),
          input.status ?? g.status,
        ],
      );
      return goalMap(await this.find(c, owner, id));
    });
    this.emit('update');
    return result;
  }
  async delete(owner: string, id: string, revision: number): Promise<void> {
    await this.repo.transaction(owner, async (c) => {
      const g = await this.find(c, owner, id);
      this.revision(g, revision);
      await c.query('DELETE FROM goals WHERE id=$1 AND owner_id=$2', [id, owner]);
    });
    this.emit('delete');
  }
  async contributions(
    owner: string,
    id: string,
    q: ContributionsQueryDto,
  ): Promise<ContributionsPageDto> {
    return this.repo.transaction(owner, async (c) => {
      await this.find(c, owner, id);
      const limit = q.limit ?? 25;
      const rows = (
        await c.query<ContributionRow>(
          `SELECT * FROM goal_contributions WHERE goal_id=$1 AND owner_id=$2 AND ($3::integer IS NULL OR sequence<$3) ORDER BY sequence DESC LIMIT $4`,
          [id, owner, q.before ?? null, limit + 1],
        )
      ).rows;
      const items = rows.slice(0, limit).map(contributionMap);
      return { items, nextBefore: rows.length > limit ? items.at(-1)!.sequence : null };
    });
  }
  async contribute(
    owner: string,
    id: string,
    input: CreateContributionDto,
  ): Promise<ContributionDto> {
    const value = amount(input.amountMinor),
      note = input.note === undefined ? null : clean(input.note);
    if (
      (input.kind === 'reversal' ? value !== 0n : value === 0n) ||
      (input.kind === 'contribution' ? input.supersedesId !== undefined : !input.supersedesId)
    )
      throw new BadRequestException('INVALID_CONTRIBUTION');
    const hash = createHash('sha256')
      .update(
        JSON.stringify([
          input.revision,
          input.kind,
          input.amountMinor,
          input.currency,
          input.supersedesId ?? null,
          note,
        ]),
      )
      .digest('hex');
    const result = await this.repo.transaction(owner, async (c) => {
      const g = await this.find(c, owner, id);
      const replay = (
        await c.query<ContributionRow>(
          'SELECT * FROM goal_contributions WHERE goal_id=$1 AND owner_id=$2 AND command_id=$3',
          [id, owner, input.commandId],
        )
      ).rows[0];
      if (replay) {
        if (replay.request_hash !== hash)
          throw new ConflictException('CONTRIBUTION_COMMAND_REUSED');
        return { event: contributionMap(replay), replay: true };
      }
      // Check references before state conflicts so foreign/missing IDs remain indistinguishable.
      if (input.supersedesId) {
        const previous = (
          await c.query<ContributionRow>(
            'SELECT * FROM goal_contributions WHERE id=$1 AND goal_id=$2 AND owner_id=$3',
            [input.supersedesId, id, owner],
          )
        ).rows[0];
        if (!previous) throw new NotFoundException('CONTRIBUTION_NOT_FOUND');
        if (
          (
            await c.query(
              'SELECT 1 FROM goal_contributions WHERE supersedes_id=$1 AND owner_id=$2',
              [previous.id, owner],
            )
          ).rowCount
        )
          throw new ConflictException('CONTRIBUTION_ALREADY_CORRECTED');
      }
      this.revision(g, input.revision);
      if (g.status === 'archived') throw new ConflictException('GOAL_ARCHIVED');
      if (g.currency !== input.currency) throw new ConflictException('GOAL_CURRENCY_MISMATCH');
      const e = (
        await c.query<ContributionRow>(
          `INSERT INTO goal_contributions(goal_id,owner_id,currency,amount_minor,command_id,request_hash,supersedes_id,kind,note,sequence) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
          [
            id,
            owner,
            input.currency,
            input.amountMinor,
            input.commandId,
            hash,
            input.supersedesId ?? null,
            input.kind,
            note,
            g.revision + 1,
          ],
        )
      ).rows[0]!;
      return { event: contributionMap(e), replay: false };
    });
    if (!result.replay) this.emit('contribution');
    return result.event;
  }
}
