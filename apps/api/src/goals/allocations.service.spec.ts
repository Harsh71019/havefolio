import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import type { PoolClient } from 'pg';
import { EventLogger } from '@havefolio/logging';
import { AllocationsService } from './allocations.service.js';
import { GoalsRepository } from './goals.repository.js';
import { GoalsService } from './goals.service.js';

describe('PER-31 allocation transaction boundaries', () => {
  const query = jest.fn<(...args: unknown[]) => Promise<{ rows: unknown[]; rowCount: number }>>();
  const getIn = jest.fn<() => Promise<unknown>>();
  const emit = jest.fn();
  const transaction = jest.fn(async (_owner: string, fn: (c: PoolClient) => Promise<unknown>) =>
    fn({ query } as unknown as PoolClient),
  );
  let service: AllocationsService;
  beforeEach(async () => {
    query.mockReset();
    getIn.mockReset();
    emit.mockReset();
    transaction.mockClear();
    const module = await Test.createTestingModule({
      providers: [
        AllocationsService,
        { provide: GoalsRepository, useValue: { transaction } },
        { provide: GoalsService, useValue: { getIn } },
        { provide: EventLogger, useValue: { emit } },
      ],
    }).compile();
    service = module.get(AllocationsService);
  });
  it('does not look up goals or emit when the source is missing', async () => {
    query.mockResolvedValue({ rows: [], rowCount: 0 });
    await expect(service.state('owner', 'missing')).rejects.toThrow('DESIRE_NOT_FOUND');
    expect(getIn).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
    expect(transaction.mock.calls[0]?.[0]).toBe('owner');
  });
  it('preserves unknown estimate without inventing a contribution', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ id: 'source' }], rowCount: 1 })
      .mockResolvedValue({ rows: [], rowCount: 0 });
    expect(await service.state('owner', 'source')).toEqual({
      currentReviewEventId: null,
      estimatedNotSpentMinor: null,
      currency: null,
      allocation: null,
    });
    expect(getIn).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
  });
  it('checks goal ownership and stale source before a ledger write', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ id: 'source' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ id: 'current', outcome: 'bought' }], rowCount: 1 })
      .mockResolvedValue({ rows: [], rowCount: 0 });
    getIn.mockResolvedValue({ id: 'goal', revision: 1 });
    await expect(
      service.confirm('owner', 'source', {
        commandId: 'cmd',
        reviewEventId: 'current',
        goalId: 'goal',
        goalRevision: 1,
        confirmed: true,
      }),
    ).rejects.toThrow('STALE_DECLINED_OUTCOME');
    expect(query.mock.calls.some(([sql]) => String(sql).includes('INSERT'))).toBe(false);
    expect(emit).not.toHaveBeenCalled();
  });
  it('propagates transaction failure without claiming success', async () => {
    query.mockRejectedValue(new Error('synthetic failure'));
    await expect(
      service.confirm('owner', 'source', {
        commandId: 'cmd',
        reviewEventId: 'event',
        goalId: 'goal',
        goalRevision: 1,
        confirmed: true,
      }),
    ).rejects.toThrow('synthetic failure');
    expect(emit).not.toHaveBeenCalled();
  });
  it('returns no history when no confirmed allocation exists', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ id: 'source' }], rowCount: 1 })
      .mockResolvedValue({ rows: [], rowCount: 0 });
    expect(await service.history('owner', 'source', { limit: 1 })).toEqual({
      items: [],
      nextBefore: null,
    });
  });
});
