import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto';
import type { PoolClient } from 'pg';
import {
  deriveMatchHints,
  deriveSuggestedReason,
  isUsableAlternative,
  validateMatchReason,
  validateMatchRelevance,
  isDesireDomainError,
} from '@havefolio/domain';
import type { ItemCondition, ItemFrequency, ItemStatus } from '@havefolio/contracts';
import { EventLogger } from '@havefolio/logging';
import { DesiresRepository } from './desires.repository.js';
import type {
  CreateDesireMatchDto,
  DesireMatchDto,
  DesireMatchesPageDto,
  MatchCandidateItemDto,
  MatchCandidatesPageDto,
  MatchCandidatesQueryDto,
  MatchesQueryDto,
  PatchDesireMatchDto,
} from './desire-matches.dto.js';

interface Cursor {
  v: 1;
  scope: string;
  id: string;
  createdAt: string;
  expiresAt: number;
}

const badCursor = (): never => {
  throw new BadRequestException('INVALID_DESIRE_CURSOR');
};

@Injectable()
export class DesireMatchesService {
  private readonly key: Buffer;
  private clockFn: () => Date = () => new Date();

  constructor(
    private readonly repo: DesiresRepository,
    private readonly config: ConfigService,
    @Optional() private readonly logger?: EventLogger,
  ) {
    const secret = config.get<string>('AUTH_RATE_KEY_SECRET');
    this.key = secret
      ? createHmac('sha256', secret).update('havefolio.desire_matches.cursor.v1').digest()
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

  private scope(owner: string, query: Record<string, unknown>): string {
    const rest = { ...query };
    delete rest.after;
    return createHash('sha256')
      .update(JSON.stringify([owner, Object.entries(rest).sort(([a], [b]) => a.localeCompare(b))]))
      .digest('hex');
  }

  private encodeCursor(cursor: Cursor): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(Buffer.from('desire_matches.v1'));
    const body = Buffer.concat([cipher.update(JSON.stringify(cursor), 'utf8'), cipher.final()]);
    return 'v1.' + Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url');
  }

  private decodeCursor(value: string, expectedScope: string): Cursor {
    try {
      if (!/^v1\.[A-Za-z0-9_-]{40,2045}$/.test(value)) return badCursor();
      const data = Buffer.from(value.slice(3), 'base64url');
      if (data.toString('base64url') !== value.slice(3)) return badCursor();
      const decipher = createDecipheriv('aes-256-gcm', this.key, data.subarray(0, 12));
      decipher.setAAD(Buffer.from('desire_matches.v1'));
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

  private async fetchItemCoversAndTags(
    client: PoolClient,
    owner: string,
    itemIds: string[],
  ): Promise<{
    coverMap: Map<
      string,
      {
        photoId: string;
        width: number;
        height: number;
        altText: string | null;
        decorative: boolean;
      }
    >;
    tagMap: Map<string, string[]>;
  }> {
    if (itemIds.length === 0) {
      return { coverMap: new Map(), tagMap: new Map() };
    }

    const coversRes = await client.query<{
      item_id: string;
      id: string;
      width: number;
      height: number;
      alt_text: string | null;
    }>(
      `SELECT DISTINCT ON (item_id) item_id, id, width, height, alt_text
       FROM media_attachments
       WHERE owner_id = $1 AND item_id = ANY($2::uuid[]) AND kind = 'photo' AND variant = 'original' AND state = 'ready'
       ORDER BY item_id, position, id`,
      [owner, itemIds],
    );

    const tagsRes = await client.query<{
      item_id: string;
      tag_name: string;
    }>(
      `SELECT it.item_id, t.name AS tag_name
       FROM item_tags it
       JOIN tags t ON t.id = it.tag_id AND t.owner_id = it.owner_id
       WHERE it.owner_id = $1 AND it.item_id = ANY($2::uuid[])
       ORDER BY it.item_id, t.name`,
      [owner, itemIds],
    );

    const coverMap = new Map(
      coversRes.rows.map((r) => [
        r.item_id,
        {
          photoId: r.id,
          width: r.width,
          height: r.height,
          altText: r.alt_text || null,
          decorative: r.alt_text === '',
        },
      ]),
    );

    const tagMap = new Map<string, string[]>();
    for (const t of tagsRes.rows) {
      const existing = tagMap.get(t.item_id) ?? [];
      existing.push(t.tag_name);
      tagMap.set(t.item_id, existing);
    }

    return { coverMap, tagMap };
  }

  async list(
    owner: string,
    desireId: string,
    query: MatchesQueryDto,
  ): Promise<DesireMatchesPageDto> {
    const limit = Math.min(Math.max(query.limit ?? 20, 1), 50);
    const scopeStr = this.scope(owner, { desireId, limit });
    const cursor = query.after ? this.decodeCursor(query.after, scopeStr) : undefined;

    return this.repo.transaction(owner, async (client) => {
      // Confirm desire exists and belongs to owner
      const desireCheck = await client.query<{ id: string }>(
        'SELECT id FROM desires WHERE id = $1 AND owner_id = $2',
        [desireId, owner],
      );
      if (!desireCheck.rows[0]) {
        throw new NotFoundException('DESIRE_NOT_FOUND');
      }

      const totalRes = await client.query<{ count: string }>(
        'SELECT count(*)::int AS count FROM desire_item_matches WHERE owner_id = $1 AND desire_id = $2',
        [owner, desireId],
      );
      const totalCount = parseInt(totalRes.rows[0]?.count ?? '0', 10);

      const params: unknown[] = [owner, desireId, limit + 1];
      let cursorClause = '';
      if (cursor) {
        params.push(cursor.createdAt, cursor.id);
        cursorClause = `AND (m.created_at < $4 OR (m.created_at = $4 AND m.id < $5))`;
      }

      const sql = `
        SELECT
          m.id,
          m.desire_id,
          m.item_id,
          m.reason,
          m.relevance,
          m.source,
          m.created_at,
          m.updated_at,
          i.name AS item_name,
          i.brand AS item_brand,
          i.model AS item_model,
          i.ownership_status AS item_ownership_status,
          i.condition AS item_condition,
          i.use_frequency AS item_use_frequency,
          i.category_id,
          c.name AS category_name,
          i.subcategory_id,
          sc.name AS subcategory_name
        FROM desire_item_matches m
        JOIN items i ON i.id = m.item_id AND i.owner_id = m.owner_id
        LEFT JOIN categories c ON c.id = i.category_id AND c.owner_id = m.owner_id
        LEFT JOIN subcategories sc ON sc.id = i.subcategory_id AND sc.owner_id = m.owner_id
        WHERE m.owner_id = $1 AND m.desire_id = $2
        ${cursorClause}
        ORDER BY m.created_at DESC, m.id DESC
        LIMIT $3
      `;

      const result = await client.query<{
        id: string;
        desire_id: string;
        item_id: string;
        reason: string;
        relevance: 'relevant' | 'irrelevant';
        source: 'manual' | 'suggested';
        created_at: Date;
        updated_at: Date;
        item_name: string;
        item_brand: string | null;
        item_model: string | null;
        item_ownership_status: ItemStatus;
        item_condition: ItemCondition;
        item_use_frequency: ItemFrequency;
        category_id: string | null;
        category_name: string | null;
        subcategory_id: string | null;
        subcategory_name: string | null;
      }>(sql, params);

      const rows = result.rows.slice(0, limit);
      const hasMore = result.rows.length > limit;
      const itemIds = rows.map((r) => r.item_id);
      const { coverMap, tagMap } = await this.fetchItemCoversAndTags(client, owner, itemIds);

      const items: DesireMatchDto[] = rows.map((r) => {
        const tags = tagMap.get(r.item_id) ?? [];
        const hints = deriveMatchHints({
          categoryName: r.category_name,
          subcategoryName: r.subcategory_name,
          condition: r.item_condition,
          useFrequency: r.item_use_frequency,
          tags,
        });

        return {
          id: r.id,
          desireId: r.desire_id,
          itemId: r.item_id,
          reason: r.reason,
          relevance: r.relevance,
          source: r.source,
          item: {
            id: r.item_id,
            name: r.item_name,
            brand: r.item_brand,
            model: r.item_model,
            ownershipStatus: r.item_ownership_status,
            condition: r.item_condition,
            useFrequency: r.item_use_frequency,
            categoryId: r.category_id,
            categoryName: r.category_name,
            subcategoryId: r.subcategory_id,
            subcategoryName: r.subcategory_name,
            tags,
            cover: coverMap.get(r.item_id) ?? null,
            isUsableAlternative: isUsableAlternative(r.item_ownership_status, r.item_condition),
          },
          hints,
          createdAt: r.created_at.toISOString(),
          updatedAt: r.updated_at.toISOString(),
        };
      });

      let nextCursor: string | null = null;
      const last = rows[rows.length - 1];
      if (hasMore && last) {
        nextCursor = this.encodeCursor({
          v: 1,
          scope: scopeStr,
          id: last.id,
          createdAt: last.created_at.toISOString(),
          expiresAt: this.clock().getTime() + 24 * 60 * 60 * 1000,
        });
      }

      return {
        items,
        nextCursor,
        hasMore,
        totalCount,
      };
    });
  }

  async create(
    owner: string,
    desireId: string,
    input: CreateDesireMatchDto,
  ): Promise<DesireMatchDto> {
    let reason: string;
    let relevance: 'relevant' | 'irrelevant';
    try {
      reason = validateMatchReason(input.reason);
      relevance = validateMatchRelevance(input.relevance);
    } catch (err) {
      if (isDesireDomainError(err)) {
        throw new BadRequestException(err.code);
      }
      throw err;
    }

    return this.repo.transaction(owner, async (client) => {
      // Check desire exists
      const desireRes = await client.query<{ id: string }>(
        'SELECT id FROM desires WHERE id = $1 AND owner_id = $2 FOR UPDATE',
        [desireId, owner],
      );
      if (!desireRes.rows[0]) {
        throw new NotFoundException('DESIRE_NOT_FOUND');
      }

      // Check item exists
      const itemRes = await client.query<{
        id: string;
        name: string;
        brand: string | null;
        model: string | null;
        ownership_status: ItemStatus;
        condition: ItemCondition;
        use_frequency: ItemFrequency;
        category_id: string | null;
        category_name: string | null;
        subcategory_id: string | null;
        subcategory_name: string | null;
      }>(
        `SELECT
          i.id,
          i.name,
          i.brand,
          i.model,
          i.ownership_status,
          i.condition,
          i.use_frequency,
          i.category_id,
          c.name AS category_name,
          i.subcategory_id,
          sc.name AS subcategory_name
        FROM items i
        LEFT JOIN categories c ON c.id = i.category_id AND c.owner_id = i.owner_id
        LEFT JOIN subcategories sc ON sc.id = i.subcategory_id AND sc.owner_id = i.owner_id
        WHERE i.id = $1 AND i.owner_id = $2`,
        [input.itemId, owner],
      );
      const item = itemRes.rows[0];
      if (!item) {
        throw new NotFoundException('ITEM_NOT_FOUND');
      }

      // Check limit
      const countRes = await client.query<{ count: string }>(
        'SELECT count(*)::int AS count FROM desire_item_matches WHERE owner_id = $1 AND desire_id = $2',
        [owner, desireId],
      );
      if (parseInt(countRes.rows[0]?.count ?? '0', 10) >= 50) {
        throw new ConflictException('MATCH_LIMIT_EXCEEDED');
      }

      // Insert match
      let matchRes;
      try {
        matchRes = await client.query<{
          id: string;
          created_at: Date;
          updated_at: Date;
        }>(
          `INSERT INTO desire_item_matches (owner_id, desire_id, item_id, reason, relevance, source)
           VALUES ($1, $2, $3, $4, $5, 'manual')
           RETURNING id, created_at, updated_at`,
          [owner, desireId, input.itemId, reason, relevance],
        );
      } catch (error: unknown) {
        if ((error as { code?: string })?.code === '23505') {
          throw new ConflictException('MATCH_ALREADY_EXISTS');
        }
        if (error instanceof HttpException) throw error;
        throw new ServiceUnavailableException('MATCHES_UNAVAILABLE');
      }

      const matchRow = matchRes.rows[0];
      if (!matchRow) {
        throw new ServiceUnavailableException('MATCHES_UNAVAILABLE');
      }
      const { coverMap, tagMap } = await this.fetchItemCoversAndTags(client, owner, [item.id]);
      const tags = tagMap.get(item.id) ?? [];
      const hints = deriveMatchHints({
        categoryName: item.category_name ?? null,
        subcategoryName: item.subcategory_name ?? null,
        condition: item.condition ?? null,
        useFrequency: item.use_frequency ?? null,
        tags,
      });

      this.logger?.emit('info', {
        event: 'desire.match_created',
        desireId,
        matchId: matchRow.id,
        relevance,
        source: 'manual',
        isUsableAlternative: isUsableAlternative(item.ownership_status, item.condition),
      });

      return {
        id: matchRow.id,
        desireId,
        itemId: item.id,
        reason,
        relevance,
        source: 'manual',
        item: {
          id: item.id,
          name: item.name,
          brand: item.brand,
          model: item.model,
          ownershipStatus: item.ownership_status,
          condition: item.condition,
          useFrequency: item.use_frequency,
          categoryId: item.category_id,
          categoryName: item.category_name,
          subcategoryId: item.subcategory_id,
          subcategoryName: item.subcategory_name,
          tags,
          cover: coverMap.get(item.id) ?? null,
          isUsableAlternative: isUsableAlternative(item.ownership_status, item.condition),
        },
        hints,
        createdAt: matchRow.created_at.toISOString(),
        updatedAt: matchRow.updated_at.toISOString(),
      };
    });
  }

  async update(
    owner: string,
    desireId: string,
    matchId: string,
    input: PatchDesireMatchDto,
  ): Promise<DesireMatchDto> {
    let reason: string | undefined;
    let relevance: 'relevant' | 'irrelevant' | undefined;
    try {
      if (input.reason !== undefined && input.reason !== null) {
        reason = validateMatchReason(input.reason);
      }
      if (input.relevance !== undefined && input.relevance !== null) {
        relevance = validateMatchRelevance(input.relevance);
      }
    } catch (err) {
      if (isDesireDomainError(err)) {
        throw new BadRequestException(err.code);
      }
      throw err;
    }

    return this.repo.transaction(owner, async (client) => {
      // Check desire exists
      const desireRes = await client.query<{ id: string }>(
        'SELECT id FROM desires WHERE id = $1 AND owner_id = $2',
        [desireId, owner],
      );
      if (!desireRes.rows[0]) {
        throw new NotFoundException('DESIRE_NOT_FOUND');
      }

      // Check match exists
      const existingRes = await client.query<{
        id: string;
        item_id: string;
        reason: string;
        relevance: 'relevant' | 'irrelevant';
      }>(
        'SELECT id, item_id, reason, relevance FROM desire_item_matches WHERE id = $1 AND desire_id = $2 AND owner_id = $3 FOR UPDATE',
        [matchId, desireId, owner],
      );
      const existing = existingRes.rows[0];
      if (!existing) {
        throw new NotFoundException('MATCH_NOT_FOUND');
      }

      const updatedRes = await client.query<{
        id: string;
        desire_id: string;
        item_id: string;
        reason: string;
        relevance: 'relevant' | 'irrelevant';
        source: 'manual' | 'suggested';
        created_at: Date;
        updated_at: Date;
      }>(
        `UPDATE desire_item_matches
         SET reason = COALESCE($1, reason),
             relevance = COALESCE($2, relevance),
             updated_at = NOW()
         WHERE id = $3 AND desire_id = $4 AND owner_id = $5
         RETURNING id, desire_id, item_id, reason, relevance, source, created_at, updated_at`,
        [reason ?? null, relevance ?? null, matchId, desireId, owner],
      );
      const updatedRow = updatedRes.rows[0];
      if (!updatedRow) {
        throw new NotFoundException('MATCH_NOT_FOUND');
      }

      // Fetch item details
      const itemRes = await client.query<{
        id: string;
        name: string;
        brand: string | null;
        model: string | null;
        ownership_status: ItemStatus;
        condition: ItemCondition;
        use_frequency: ItemFrequency;
        category_id: string | null;
        category_name: string | null;
        subcategory_id: string | null;
        subcategory_name: string | null;
      }>(
        `SELECT
          i.id,
          i.name,
          i.brand,
          i.model,
          i.ownership_status,
          i.condition,
          i.use_frequency,
          i.category_id,
          c.name AS category_name,
          i.subcategory_id,
          sc.name AS subcategory_name
        FROM items i
        LEFT JOIN categories c ON c.id = i.category_id AND c.owner_id = i.owner_id
        LEFT JOIN subcategories sc ON sc.id = i.subcategory_id AND sc.owner_id = i.owner_id
        WHERE i.id = $1 AND i.owner_id = $2`,
        [updatedRow.item_id, owner],
      );
      const item = itemRes.rows[0];
      if (!item) {
        throw new NotFoundException('ITEM_NOT_FOUND');
      }

      const { coverMap, tagMap } = await this.fetchItemCoversAndTags(client, owner, [
        updatedRow.item_id,
      ]);
      const tags = tagMap.get(updatedRow.item_id) ?? [];
      const hints = deriveMatchHints({
        categoryName: item.category_name,
        subcategoryName: item.subcategory_name,
        condition: item.condition,
        useFrequency: item.use_frequency,
        tags,
      });

      this.logger?.emit('info', {
        event: 'desire.match_feedback_updated',
        desireId,
        matchId,
        relevance: updatedRow.relevance,
      });

      return {
        id: updatedRow.id,
        desireId,
        itemId: updatedRow.item_id,
        reason: updatedRow.reason,
        relevance: updatedRow.relevance,
        source: updatedRow.source,
        item: {
          id: updatedRow.item_id,
          name: item.name,
          brand: item.brand,
          model: item.model,
          ownershipStatus: item.ownership_status,
          condition: item.condition,
          useFrequency: item.use_frequency,
          categoryId: item.category_id,
          categoryName: item.category_name,
          subcategoryId: item.subcategory_id,
          subcategoryName: item.subcategory_name,
          tags,
          cover: coverMap.get(updatedRow.item_id) ?? null,
          isUsableAlternative: isUsableAlternative(item.ownership_status, item.condition),
        },
        hints,
        createdAt: updatedRow.created_at.toISOString(),
        updatedAt: updatedRow.updated_at.toISOString(),
      };
    });
  }

  async remove(owner: string, desireId: string, matchId: string): Promise<void> {
    return this.repo.transaction(owner, async (client) => {
      // Check desire exists
      const desireRes = await client.query<{ id: string }>(
        'SELECT id FROM desires WHERE id = $1 AND owner_id = $2',
        [desireId, owner],
      );
      if (!desireRes.rows[0]) {
        throw new NotFoundException('DESIRE_NOT_FOUND');
      }

      const result = await client.query(
        'DELETE FROM desire_item_matches WHERE id = $1 AND desire_id = $2 AND owner_id = $3',
        [matchId, desireId, owner],
      );

      if ((result.rowCount ?? 0) === 0) {
        throw new NotFoundException('MATCH_NOT_FOUND');
      }

      this.logger?.emit('info', {
        event: 'desire.match_removed',
        desireId,
        matchId,
      });
    });
  }

  async candidates(
    owner: string,
    desireId: string,
    query: MatchCandidatesQueryDto,
  ): Promise<MatchCandidatesPageDto> {
    const limit = Math.min(Math.max(query.limit ?? 20, 1), 50);
    const scopeStr = this.scope(owner, { desireId, ...query });
    const cursor = query.after ? this.decodeCursor(query.after, scopeStr) : undefined;
    const includeUnavailable = query.includeUnavailable === true;
    const qTrimmed = query.q?.trim() || null;

    return this.repo.transaction(owner, async (client) => {
      // Check desire exists
      const desireRes = await client.query<{ id: string }>(
        'SELECT id FROM desires WHERE id = $1 AND owner_id = $2',
        [desireId, owner],
      );
      if (!desireRes.rows[0]) {
        throw new NotFoundException('DESIRE_NOT_FOUND');
      }

      const params: unknown[] = [owner, desireId, includeUnavailable, limit + 1];
      let sqlConditions = `
        WHERE i.owner_id = $1
          AND ($3::boolean = true OR (i.ownership_status = 'owned' AND i.condition <> 'worn_out'))
      `;

      if (query.categoryId) {
        params.push(query.categoryId);
        sqlConditions += ` AND i.category_id = $${params.length}`;
      }

      if (qTrimmed) {
        params.push(`%${qTrimmed}%`);
        sqlConditions += ` AND (i.name ILIKE $${params.length} OR coalesce(i.brand, '') ILIKE $${params.length} OR coalesce(i.model, '') ILIKE $${params.length})`;
      }

      if (cursor) {
        params.push(cursor.createdAt, cursor.id);
        sqlConditions += ` AND (i.created_at < $${params.length - 1} OR (i.created_at = $${params.length - 1} AND i.id < $${params.length}))`;
      }

      const sql = `
        SELECT
          i.id,
          i.name,
          i.brand,
          i.model,
          i.ownership_status,
          i.condition,
          i.use_frequency,
          i.category_id,
          c.name AS category_name,
          i.subcategory_id,
          sc.name AS subcategory_name,
          i.created_at,
          (m.id IS NOT NULL) AS is_already_matched
        FROM items i
        LEFT JOIN categories c ON c.id = i.category_id AND c.owner_id = i.owner_id
        LEFT JOIN subcategories sc ON sc.id = i.subcategory_id AND sc.owner_id = i.owner_id
        LEFT JOIN desire_item_matches m ON m.item_id = i.id AND m.desire_id = $2 AND m.owner_id = i.owner_id
        ${sqlConditions}
        ORDER BY i.created_at DESC, i.id DESC
        LIMIT $4
      `;

      const result = await client.query<{
        id: string;
        name: string;
        brand: string | null;
        model: string | null;
        ownership_status: ItemStatus;
        condition: ItemCondition;
        use_frequency: ItemFrequency;
        category_id: string | null;
        category_name: string | null;
        subcategory_id: string | null;
        subcategory_name: string | null;
        created_at: Date;
        is_already_matched: boolean;
      }>(sql, params);

      const rows = result.rows.slice(0, limit);
      const hasMore = result.rows.length > limit;
      const itemIds = rows.map((r) => r.id);
      const { coverMap, tagMap } = await this.fetchItemCoversAndTags(client, owner, itemIds);

      const items: MatchCandidateItemDto[] = rows.map((r) => {
        const tags = tagMap.get(r.id) ?? [];
        const hints = deriveMatchHints({
          categoryName: r.category_name,
          subcategoryName: r.subcategory_name,
          condition: r.condition,
          useFrequency: r.use_frequency,
          tags,
        });

        return {
          id: r.id,
          name: r.name,
          brand: r.brand,
          model: r.model,
          ownershipStatus: r.ownership_status,
          condition: r.condition,
          useFrequency: r.use_frequency,
          categoryId: r.category_id,
          categoryName: r.category_name,
          subcategoryId: r.subcategory_id,
          subcategoryName: r.subcategory_name,
          tags,
          cover: coverMap.get(r.id) ?? null,
          isUsableAlternative: isUsableAlternative(r.ownership_status, r.condition),
          isAlreadyMatched: Boolean(r.is_already_matched),
          suggestedReason: deriveSuggestedReason({
            name: r.name,
            categoryName: r.category_name,
          }),
          hints,
        };
      });

      let nextCursor: string | null = null;
      const last = rows[rows.length - 1];
      if (hasMore && last) {
        nextCursor = this.encodeCursor({
          v: 1,
          scope: scopeStr,
          id: last.id,
          createdAt: last.created_at.toISOString(),
          expiresAt: this.clock().getTime() + 24 * 60 * 60 * 1000,
        });
      }

      return {
        items,
        nextCursor,
        hasMore,
      };
    });
  }
}
