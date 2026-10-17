import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { Merchant, MerchantsPage } from '@havefolio/contracts';
import { MerchantsRepository } from './merchants.repository.js';
import type { CreateMerchantDto, UpdateMerchantDto, MerchantsQueryDto } from './merchants.dto.js';

export function merchantName(value: string): string {
  const name = value.normalize('NFKC').trim().replace(/\s+/gu, ' ');
  if (!name || name.length > 120 || /\p{Cc}|\p{Cf}/u.test(name))
    throw new BadRequestException('INVALID_MERCHANT');
  return name;
}
export function merchantHost(value: string | null | undefined): string | null {
  if (value == null) return null;
  try {
    if (value.length > 253 || /[\s/@?#:\\]/u.test(value)) throw new Error();
    const host = new URL(`https://${value}`).hostname.toLowerCase().replace(/\.$/, '');
    if (
      !/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/.test(host) ||
      host.length > 253 ||
      host.split('.').some((p) => !p || p.length > 63 || p.startsWith('-') || p.endsWith('-'))
    )
      throw new Error();
    return host;
  } catch {
    throw new BadRequestException('INVALID_MERCHANT_HOST');
  }
}
const select = `SELECT id,display_name AS "displayName",website_host AS "websiteHost",state,created_at AS "createdAt",updated_at AS "updatedAt" FROM merchants`;
interface Cursor {
  scope: string;
  name: string;
  id: string;
  expires: number;
}
@Injectable()
export class MerchantsService {
  private readonly key: Buffer;
  constructor(
    private readonly repository: MerchantsRepository,
    config: ConfigService,
  ) {
    const secret = config.get<string>('AUTH_RATE_KEY_SECRET');
    this.key = secret
      ? createHmac('sha256', secret).update('havefolio.merchants.cursor.v1').digest()
      : randomBytes(32);
  }
  private encode(cursor: Cursor): string {
    const iv = randomBytes(12),
      cipher = createCipheriv('aes-256-gcm', this.key, iv);
    return Buffer.concat([
      iv,
      cipher.update(JSON.stringify(cursor)),
      cipher.final(),
      cipher.getAuthTag(),
    ]).toString('base64url');
  }
  private decode(value: string, scope: string): Cursor {
    try {
      const raw = Buffer.from(value, 'base64url');
      const cipher = createDecipheriv('aes-256-gcm', this.key, raw.subarray(0, 12));
      cipher.setAuthTag(raw.subarray(-16));
      const cursor = JSON.parse(
        Buffer.concat([cipher.update(raw.subarray(12, -16)), cipher.final()]).toString(),
      ) as Cursor;
      if (
        cursor.scope !== scope ||
        cursor.expires < Date.now() ||
        typeof cursor.name !== 'string' ||
        !/^[0-9a-f-]{36}$/.test(cursor.id)
      )
        throw new Error();
      return cursor;
    } catch {
      throw new BadRequestException('INVALID_MERCHANT_CURSOR');
    }
  }
  private async owned(c: PoolClient, owner: string, id: string): Promise<Merchant> {
    const row = (await c.query<Merchant>(`${select} WHERE owner_id=$1 AND id=$2`, [owner, id]))
      .rows[0];
    if (!row) throw new NotFoundException('MERCHANT_NOT_FOUND');
    return row;
  }
  read(owner: string, id: string): Promise<Merchant> {
    return this.repository.transaction(owner, (c) => this.owned(c, owner, id));
  }
  list(owner: string, input: MerchantsQueryDto): Promise<MerchantsPage> {
    const q = input.q?.normalize('NFKC').trim().replace(/\s+/gu, ' ') ?? '';
    const state = input.state ?? 'active',
      limit = input.limit ?? 25;
    const scope = createHmac('sha256', this.key)
      .update(JSON.stringify([owner, q, state, limit]))
      .digest('hex');
    const cursor = input.after ? this.decode(input.after, scope) : undefined;
    return this.repository.transaction(owner, async (c) => {
      const rows = (
        await c.query<Merchant & { normalized_name: string }>(
          `${select.replace('SELECT id,', 'SELECT normalized_name,id,')} WHERE owner_id=$1 AND ($2='all' OR state=$2) AND starts_with(normalized_name,lower($3)) AND ($4::text IS NULL OR (normalized_name COLLATE "C",id)>($4 COLLATE "C",$5::uuid)) ORDER BY normalized_name COLLATE "C",id LIMIT $6`,
          [owner, state, q, cursor?.name ?? null, cursor?.id ?? null, limit + 1],
        )
      ).rows;
      const page = rows.slice(0, limit),
        last = page.at(-1);
      return {
        merchants: page.map((row) => ({
          id: row.id,
          displayName: row.displayName,
          websiteHost: row.websiteHost,
          state: row.state,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        })),
        hasMore: rows.length > limit,
        nextCursor:
          rows.length > limit && last
            ? this.encode({
                scope,
                name: last.normalized_name,
                id: last.id,
                expires: Date.now() + 7 * 86400000,
              })
            : null,
      };
    });
  }
  create(owner: string, input: CreateMerchantDto): Promise<Merchant> {
    const name = merchantName(input.displayName),
      host = merchantHost(input.websiteHost);
    return this.repository.transaction(owner, async (c) => {
      // Exact normalized duplicate reuse supports common suggestions and uncertain network retries.
      const row = (
        await c.query<{ id: string }>(
          `INSERT INTO merchants(owner_id,display_name,normalized_name,website_host) VALUES($1,$2,lower($2),$3) ON CONFLICT(owner_id,normalized_name) DO UPDATE SET normalized_name=EXCLUDED.normalized_name RETURNING id`,
          [owner, name, host],
        )
      ).rows[0]!;
      return this.owned(c, owner, row.id);
    });
  }
  update(owner: string, id: string, input: UpdateMerchantDto): Promise<Merchant> {
    if (Object.values(input).every((value) => value === undefined))
      throw new BadRequestException('INVALID_MERCHANT');
    const name = input.displayName === undefined ? undefined : merchantName(input.displayName);
    const host = input.websiteHost === undefined ? undefined : merchantHost(input.websiteHost);
    return this.repository.transaction(owner, async (c) => {
      const old = await this.owned(c, owner, id);
      await c.query(
        'UPDATE merchants SET display_name=$3,normalized_name=lower($3),website_host=$4,state=$5,updated_at=clock_timestamp() WHERE owner_id=$1 AND id=$2',
        [
          owner,
          id,
          name ?? old.displayName,
          host === undefined ? old.websiteHost : host,
          input.state ?? old.state,
        ],
      );
      return this.owned(c, owner, id);
    });
  }
}
