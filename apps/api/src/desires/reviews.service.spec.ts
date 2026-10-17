import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import type { PoolClient } from 'pg';
import { EventLogger } from '@havefolio/logging';
import { ReviewsService } from './reviews.service.js';
import { DesiresRepository } from './desires.repository.js';
import { ReminderQueueService } from '../notifications/reminder-queue.service.js';

describe('Review commands and privacy', () => {
  let service: ReviewsService;
  const query = jest.fn<(sql: string, values?: unknown[]) => Promise<unknown>>();
  const apply = jest.fn<() => Promise<void>>();
  const emit = jest.fn();
  beforeEach(async () => {
    query.mockReset();
    apply.mockReset();
    emit.mockReset();
    query.mockResolvedValue({ rows: [], rowCount: 0 });
    apply.mockResolvedValue(undefined);
    const module = await Test.createTestingModule({
      providers: [
        ReviewsService,
        {
          provide: DesiresRepository,
          useValue: {
            transaction: (_owner: string, op: (c: PoolClient) => Promise<unknown>) =>
              op({ query } as unknown as PoolClient),
          },
        },
        { provide: ReminderQueueService, useValue: { apply } },
        { provide: EventLogger, useValue: { emit } },
      ],
    }).compile();
    service = module.get(ReviewsService);
  });
  it('hides foreign and missing desires on both commands and reads', async () => {
    await expect(service.list('owner', 'desire', {})).rejects.toThrow('DESIRE_NOT_FOUND');
    await expect(
      service.create('owner', 'desire', { commandId: 'command', revision: 1, outcome: 'declined' }),
    ).rejects.toThrow('DESIRE_NOT_FOUND');
    expect(apply).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
  });
  it('rejects stale commands before side effects', async () => {
    query.mockResolvedValueOnce({ rows: [{ revision: 2, status: 'waiting' }] });
    await expect(
      service.create('owner', 'desire', { commandId: 'command', revision: 1, outcome: 'bought' }),
    ).rejects.toThrow('STALE_DESIRE_REVISION');
    expect(apply).not.toHaveBeenCalled();
  });
  it('requires a correction for a resolved decision', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ revision: 2, status: 'declined' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'latest' }] });
    await expect(
      service.create('owner', 'desire', { commandId: 'command', revision: 2, outcome: 'bought' }),
    ).rejects.toThrow('REVIEW_CORRECTION_REQUIRED');
  });
  it('returns bounded empty history honestly', async () => {
    query.mockResolvedValueOnce({ rows: [{ revision: 1, status: 'considering' }] });
    expect(await service.list('owner', 'desire', {})).toEqual({
      items: [],
      nextBefore: null,
      currentEventId: null,
      estimatedNotSpentMinor: null,
      currency: null,
    });
  });
  it('commits before dispatch and emits no private identifiers, notes or amounts', async () => {
    const row = {
      id: 'event',
      sequence: 2,
      outcome: 'declined',
      occurred_at: new Date(),
      note: 'private note',
      linked_item_id: null,
      linked_item_name: null,
      review_at: null,
      supersedes_event_id: null,
      estimated_not_spent_minor: '123',
      currency: 'INR',
    };
    query
      .mockResolvedValueOnce({ rows: [{ revision: 1, status: 'waiting' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ schedule_version: 1 }] })
      .mockResolvedValueOnce({ rows: [row] })
      .mockResolvedValueOnce({ rows: [row] });
    apply.mockRejectedValueOnce(new Error('Queue unavailable'));
    expect(
      (
        await service.create('private-owner', 'private-desire', {
          commandId: 'command',
          revision: 1,
          outcome: 'declined',
          note: 'private note',
        })
      ).estimatedNotSpentMinor,
    ).toBe('123');
    expect(apply).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith('info', {
      event: 'desire_review_recorded',
      component: 'desires',
      operation: 'review',
      category: 'success',
    });
    expect(JSON.stringify(emit.mock.calls)).not.toMatch(/private|123|INR/);
  });
});
