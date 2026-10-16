import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto';
import type {
  NotificationDto,
  NotificationsPageDto,
  NotificationsQueryDto,
} from './notifications.dto.js';
import { NotificationsRepository } from './notifications.repository.js';

interface NotificationRow {
  id: string;
  type: NotificationDto['type'];
  desire_id: string;
  occurred_at: Date;
  read_at: Date | null;
  created_at: Date;
}

interface Cursor {
  v: 1;
  scope: string;
  id: string;
  createdAt: string;
  expiresAt: number;
}

const invalidCursor = (): never => {
  throw new BadRequestException('INVALID_NOTIFICATION_CURSOR');
};

@Injectable()
export class NotificationsService {
  private readonly cursorKey: Buffer;
  private clock: () => Date = () => new Date();

  constructor(
    private readonly repository: NotificationsRepository,
    config: ConfigService,
  ) {
    const secret = config.get<string>('AUTH_RATE_KEY_SECRET');
    this.cursorKey = secret
      ? createHmac('sha256', secret).update('havefolio.notifications.cursor.v1').digest()
      : randomBytes(32);
  }

  setClock(clock: () => Date): void {
    this.clock = clock;
  }

  resetClock(): void {
    this.clock = () => new Date();
  }

  private map(row: NotificationRow): NotificationDto {
    return {
      id: row.id,
      type: row.type,
      desireId: row.desire_id,
      occurredAt: row.occurred_at.toISOString(),
      readAt: row.read_at?.toISOString() ?? null,
      createdAt: row.created_at.toISOString(),
    };
  }

  private scope(ownerId: string, unreadOnly: boolean): string {
    return createHash('sha256')
      .update(`${ownerId}:${unreadOnly ? 'unread' : 'all'}`)
      .digest('hex');
  }

  private encode(cursor: Cursor): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.cursorKey, iv);
    cipher.setAAD(Buffer.from('notifications.v1'));
    const body = Buffer.concat([cipher.update(JSON.stringify(cursor), 'utf8'), cipher.final()]);
    return `v1.${Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url')}`;
  }

  private decode(value: string, expectedScope: string): Cursor {
    try {
      if (!/^v1\.[A-Za-z0-9_-]{40,2045}$/.test(value)) return invalidCursor();
      const data = Buffer.from(value.slice(3), 'base64url');
      if (data.toString('base64url') !== value.slice(3)) return invalidCursor();
      const decipher = createDecipheriv('aes-256-gcm', this.cursorKey, data.subarray(0, 12));
      decipher.setAAD(Buffer.from('notifications.v1'));
      decipher.setAuthTag(data.subarray(12, 28));
      const cursor = JSON.parse(
        Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString(),
      ) as Cursor;
      if (
        cursor.v !== 1 ||
        cursor.scope !== expectedScope ||
        !Number.isSafeInteger(cursor.expiresAt) ||
        cursor.expiresAt <= this.clock().getTime() ||
        !/^[a-f0-9-]{36}$/.test(cursor.id) ||
        !Number.isFinite(Date.parse(cursor.createdAt))
      ) {
        return invalidCursor();
      }
      return cursor;
    } catch {
      return invalidCursor();
    }
  }

  async list(ownerId: string, input: NotificationsQueryDto): Promise<NotificationsPageDto> {
    const limit = Math.min(Math.max(input.limit ?? 25, 1), 100);
    const unreadOnly = input.unreadOnly === 'true';
    const scope = this.scope(ownerId, unreadOnly);
    const cursor = input.after ? this.decode(input.after, scope) : undefined;

    return this.repository.transaction(ownerId, async (client) => {
      const values: unknown[] = [ownerId];
      const clauses = ['owner_id=$1'];
      if (unreadOnly) clauses.push('read_at IS NULL');
      if (cursor) {
        values.push(new Date(cursor.createdAt), cursor.id);
        const createdIndex = values.length - 1;
        const idIndex = values.length;
        clauses.push(
          `(created_at < $${createdIndex} OR (created_at = $${createdIndex} AND id > $${idIndex}))`,
        );
      }
      values.push(limit + 1);
      const result = await client.query<NotificationRow>(
        `SELECT id,type,desire_id,occurred_at,read_at,created_at
         FROM notifications
         WHERE ${clauses.join(' AND ')}
         ORDER BY created_at DESC,id ASC
         LIMIT $${values.length}`,
        values,
      );
      const unread = await client.query<{ count: string }>(
        'SELECT count(*)::text AS count FROM notifications WHERE owner_id=$1 AND read_at IS NULL',
        [ownerId],
      );
      const hasMore = result.rows.length > limit;
      const rows = result.rows.slice(0, limit);
      const last = rows.at(-1);
      return {
        items: rows.map((row) => this.map(row)),
        hasMore,
        nextCursor:
          hasMore && last
            ? this.encode({
                v: 1,
                scope,
                id: last.id,
                createdAt: last.created_at.toISOString(),
                expiresAt: this.clock().getTime() + 7 * 24 * 60 * 60 * 1000,
              })
            : null,
        unreadCount: Number(unread.rows[0]?.count ?? 0),
      };
    });
  }

  async markRead(ownerId: string, id: string): Promise<NotificationDto> {
    return this.repository.transaction(ownerId, async (client) => {
      const result = await client.query<NotificationRow>(
        `UPDATE notifications
         SET read_at=coalesce(read_at,now()),updated_at=now()
         WHERE id=$1 AND owner_id=$2
         RETURNING id,type,desire_id,occurred_at,read_at,created_at`,
        [id, ownerId],
      );
      const row = result.rows[0];
      if (!row) throw new NotFoundException('NOTIFICATION_NOT_FOUND');
      if (!row.read_at) throw new ConflictException('NOTIFICATIONS_UNAVAILABLE');
      return this.map(row);
    });
  }
}
