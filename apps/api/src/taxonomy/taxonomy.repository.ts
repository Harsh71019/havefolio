import {
  ConflictException,
  HttpException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  type OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool, type PoolClient } from 'pg';
import type {
  TaxonomyEntry,
  SubcategoryEntry,
  TagEntry,
  TaxonomySnapshot,
} from '@havefolio/contracts';

export type TaxonomyKind = 'categories' | 'subcategories' | 'tags';
export interface StoredEntry {
  id: string;
  name: string;
  position?: number;
  retired_at?: Date | null;
  category_id?: string;
}
export const TAXONOMY_LIMIT = 500;

@Injectable()
export class TaxonomyRepository implements OnModuleDestroy {
  private readonly pool?: Pool;
  constructor(config: ConfigService) {
    const connectionString = config.get<string>('DATABASE_URL');
    if (connectionString) {
      this.pool = new Pool({
        connectionString,
        max: 3,
        connectionTimeoutMillis: 3000,
        idleTimeoutMillis: 10000,
        statement_timeout: 5000,
      });
      this.pool.on('error', () => undefined);
    }
  }
  async transaction<T>(ownerId: string, operation: (client: PoolClient) => Promise<T>): Promise<T> {
    if (!this.pool) throw new ServiceUnavailableException('TAXONOMY_UNAVAILABLE');
    let client: PoolClient | undefined;
    try {
      client = await this.pool.connect();
      await client.query('BEGIN');
      // Serializes mutations, ordering and seed admission for this owner across API processes.
      const owner = await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [ownerId]);
      if (!owner.rowCount) throw new NotFoundException('TAXONOMY_NOT_FOUND');
      const result = await operation(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client?.query('ROLLBACK').catch(() => undefined);
      if (error instanceof HttpException) throw error;
      const code = (error as { code?: string }).code;
      if (code === '23505') throw new ConflictException('NAME_ALREADY_EXISTS');
      if (code === '23503') throw new ConflictException('TAXONOMY_IN_USE');
      throw new ServiceUnavailableException('TAXONOMY_UNAVAILABLE');
    } finally {
      client?.release();
    }
  }
  async entries(client: PoolClient, owner: string, kind: TaxonomyKind): Promise<StoredEntry[]> {
    // kind is an internal closed union; never provided by request input.
    const rows = (
      await client.query<StoredEntry>(
        `SELECT * FROM ${kind} WHERE owner_id=$1 ORDER BY ${kind === 'tags' ? 'lower(name), id' : 'position, id'} LIMIT 501`,
        [owner],
      )
    ).rows;
    if (rows.length > TAXONOMY_LIMIT) throw new ConflictException('TAXONOMY_LIMIT_EXCEEDED');
    return rows;
  }
  async snapshot(client: PoolClient, owner: string): Promise<TaxonomySnapshot> {
    const categories = (
      await client.query<TaxonomyEntry>(
        `SELECT c.id,c.name,c.position,c.is_demo AS "isDemo",c.retired_at AS "retiredAt",(SELECT count(*)::int FROM items i WHERE i.owner_id=$1 AND i.category_id=c.id) AS "itemCount" FROM categories c WHERE c.owner_id=$1 ORDER BY c.position,c.id LIMIT 501`,
        [owner],
      )
    ).rows;
    const subcategories = (
      await client.query<SubcategoryEntry>(
        `SELECT s.id,s.name,s.position,s.category_id AS "categoryId",false AS "isDemo",s.retired_at AS "retiredAt",(SELECT count(*)::int FROM items i WHERE i.owner_id=$1 AND i.subcategory_id=s.id) AS "itemCount" FROM subcategories s WHERE s.owner_id=$1 ORDER BY s.category_id,s.position,s.id LIMIT 501`,
        [owner],
      )
    ).rows;
    const tags = (
      await client.query<TagEntry>(
        `SELECT t.id,t.name,(SELECT count(*)::int FROM item_tags it WHERE it.owner_id=$1 AND it.tag_id=t.id) AS "itemCount" FROM tags t WHERE t.owner_id=$1 ORDER BY lower(t.name),t.id LIMIT 501`,
        [owner],
      )
    ).rows;
    if ([categories, subcategories, tags].some((rows) => rows.length > TAXONOMY_LIMIT))
      throw new ConflictException('TAXONOMY_LIMIT_EXCEEDED');
    const user = await client.query<{ seeded: boolean }>(
      'SELECT taxonomy_defaults_seeded_at IS NOT NULL AS seeded FROM users WHERE id=$1',
      [owner],
    );
    return { categories, subcategories, tags, defaultsSeeded: user.rows[0]!.seeded };
  }
  async create(
    client: PoolClient,
    owner: string,
    kind: TaxonomyKind,
    name: string,
    position = 0,
    categoryId?: string,
    demo = false,
  ): Promise<void> {
    if (kind === 'categories')
      await client.query(
        'INSERT INTO categories(owner_id,name,position,is_demo) VALUES ($1,$2,$3,$4)',
        [owner, name, position, demo],
      );
    else if (kind === 'subcategories')
      await client.query(
        'INSERT INTO subcategories(owner_id,name,position,category_id) VALUES ($1,$2,$3,$4)',
        [owner, name, position, categoryId],
      );
    else await client.query('INSERT INTO tags(owner_id,name) VALUES ($1,$2)', [owner, name]);
  }
  async rename(
    client: PoolClient,
    owner: string,
    kind: TaxonomyKind,
    id: string,
    name: string,
  ): Promise<void> {
    await client.query(`UPDATE ${kind} SET name=$1 WHERE id=$2 AND owner_id=$3`, [name, id, owner]);
  }
  async retire(
    client: PoolClient,
    owner: string,
    kind: 'categories' | 'subcategories',
    id: string,
    retired: boolean,
  ): Promise<void> {
    await client.query(
      `UPDATE ${kind} SET retired_at=${retired ? 'coalesce(retired_at,now())' : 'NULL'} WHERE id=$1 AND owner_id=$2`,
      [id, owner],
    );
  }
  async reorder(
    client: PoolClient,
    owner: string,
    kind: 'categories' | 'subcategories',
    ids: string[],
  ): Promise<void> {
    await client.query(
      `UPDATE ${kind} t SET position=ordered.n::int-1 FROM unnest($1::uuid[]) WITH ORDINALITY ordered(id,n) WHERE t.id=ordered.id AND t.owner_id=$2`,
      [ids, owner],
    );
  }
  async countItems(
    client: PoolClient,
    owner: string,
    kind: TaxonomyKind,
    id: string,
  ): Promise<number> {
    const result = await client.query<{ count: number }>(
      kind === 'tags'
        ? 'SELECT count(*)::int AS count FROM item_tags WHERE tag_id=$1 AND owner_id=$2'
        : `SELECT count(*)::int AS count FROM items WHERE ${kind === 'categories' ? 'category_id' : 'subcategory_id'}=$1 AND owner_id=$2`,
      [id, owner],
    );
    return result.rows[0]!.count;
  }
  async reassign(
    client: PoolClient,
    owner: string,
    kind: 'categories' | 'subcategories',
    id: string,
    replacement: string,
  ): Promise<void> {
    const assignment =
      kind === 'categories' ? 'category_id=$1,subcategory_id=NULL' : 'subcategory_id=$1';
    const column = kind === 'categories' ? 'category_id' : 'subcategory_id';
    // One SQL CTE moves any number of items and appends history without loading item IDs into memory.
    await client.query(
      `WITH moved AS (UPDATE items SET ${assignment},revision=revision+1 WHERE ${column}=$2 AND owner_id=$3 RETURNING id) INSERT INTO lifecycle_events(owner_id,item_id,event_type,occurred_at,metadata) SELECT $3,id,'details_updated',now(),$4::jsonb FROM moved`,
      [
        replacement,
        id,
        owner,
        JSON.stringify({
          reason: 'taxonomy_reassignment',
          kind,
          fromId: id,
          toId: replacement,
          clearedSubcategory: kind === 'categories',
        }),
      ],
    );
  }
  async remove(client: PoolClient, owner: string, kind: TaxonomyKind, id: string): Promise<void> {
    if (kind === 'categories')
      await client.query('DELETE FROM subcategories WHERE owner_id=$1 AND category_id=$2', [
        owner,
        id,
      ]);
    if (kind === 'tags')
      await client.query('DELETE FROM item_tags WHERE owner_id=$1 AND tag_id=$2', [owner, id]);
    await client.query(`DELETE FROM ${kind} WHERE owner_id=$1 AND id=$2`, [owner, id]);
  }
  async claimDefaults(client: PoolClient, owner: string): Promise<boolean> {
    return Boolean(
      (
        await client.query(
          'UPDATE users SET taxonomy_defaults_seeded_at=now() WHERE id=$1 AND taxonomy_defaults_seeded_at IS NULL RETURNING id',
          [owner],
        )
      ).rowCount,
    );
  }
  async onModuleDestroy(): Promise<void> {
    await this.pool?.end();
  }
}
