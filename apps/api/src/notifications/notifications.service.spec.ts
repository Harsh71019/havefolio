import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { PoolClient } from 'pg';
import { NotificationsRepository } from './notifications.repository.js';
import { NotificationsService } from './notifications.service.js';

describe('NotificationsService owner-scoped in-app reminders', () => {
  const ownerId = 'f0000000-0000-4000-8000-000000000001';
  const notificationId = 'a0000000-0000-4000-8000-000000000001';
  const desireId = 'd0000000-0000-4000-8000-000000000001';
  const query = jest.fn<(sql: string, values?: unknown[]) => Promise<unknown>>();
  let service: NotificationsService;

  beforeEach(async () => {
    query.mockReset();
    query.mockResolvedValue({ rows: [], rowCount: 0 });
    const module = await Test.createTestingModule({
      providers: [
        NotificationsService,
        {
          provide: NotificationsRepository,
          useValue: {
            transaction: (_ownerId: string, operation: (client: PoolClient) => Promise<unknown>) =>
              operation({ query } as unknown as PoolClient),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) =>
              key === 'AUTH_RATE_KEY_SECRET' ? 'notification-test-key-32-characters' : undefined,
          },
        },
      ],
    }).compile();
    service = module.get(NotificationsService);
  });

  it('returns bounded private metadata and an unread count without desire content', async () => {
    const createdAt = new Date('2026-10-23T10:00:00.000Z');
    query
      .mockResolvedValueOnce({
        rows: [
          {
            id: notificationId,
            type: 'desire_wait_ended',
            desire_id: desireId,
            occurred_at: createdAt,
            read_at: null,
            created_at: createdAt,
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ count: '1' }] });

    const result = await service.list(ownerId, { limit: 25 });
    expect(result).toEqual({
      items: [
        {
          id: notificationId,
          type: 'desire_wait_ended',
          desireId,
          occurredAt: createdAt.toISOString(),
          readAt: null,
          createdAt: createdAt.toISOString(),
        },
      ],
      nextCursor: null,
      hasMore: false,
      unreadCount: 1,
    });
    expect(JSON.stringify(result)).not.toContain('name');
    expect(JSON.stringify(result)).not.toContain('reason');
    expect(query.mock.calls[0]?.[1]?.[0]).toBe(ownerId);
  });

  it('marks only an owner-scoped notification read and is idempotent', async () => {
    const occurredAt = new Date('2026-10-23T10:00:00.000Z');
    const readAt = new Date('2026-10-23T10:01:00.000Z');
    query.mockResolvedValueOnce({
      rows: [
        {
          id: notificationId,
          type: 'desire_wait_ended',
          desire_id: desireId,
          occurred_at: occurredAt,
          read_at: readAt,
          created_at: occurredAt,
        },
      ],
    });

    const result = await service.markRead(ownerId, notificationId);
    expect(result.readAt).toBe(readAt.toISOString());
    expect(query.mock.calls[0]?.[1]).toEqual([notificationId, ownerId]);
    expect(query.mock.calls[0]?.[0]).toContain('coalesce(read_at,now())');
  });

  it('rejects malformed cursors before a database query', async () => {
    await expect(service.list(ownerId, { after: 'not-a-cursor' })).rejects.toThrow(
      'INVALID_NOTIFICATION_CURSOR',
    );
    expect(query).not.toHaveBeenCalled();
  });
});
