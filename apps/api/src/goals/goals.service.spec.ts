import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import type { PoolClient } from 'pg';
import { EventLogger } from '@havefolio/logging';
import { GoalsService } from './goals.service.js';
import { GoalsRepository } from './goals.repository.js';

// SQL constraints, sums, concurrency and owner isolation are exercised against PostgreSQL in goals.e2e-spec.ts.
describe('GoalsService application boundaries', () => {
  let service: GoalsService;
  const query = jest.fn<(...args: unknown[]) => Promise<{ rows: unknown[]; rowCount: number }>>();
  const emit = jest.fn();
  const transaction = jest.fn(
    async (_owner: string, operation: (c: PoolClient) => Promise<unknown>) =>
      operation({ query } as unknown as PoolClient),
  );
  const row = {
    id: 'goal',
    name: 'Synthetic',
    target_minor: '1',
    currency: 'INR',
    target_date: null,
    notes: null,
    status: 'active',
    revision: 1,
    progress_minor: '0',
    created_at: new Date('2026-01-01Z'),
    updated_at: new Date('2026-01-01Z'),
  };
  beforeEach(async () => {
    query.mockReset();
    emit.mockClear();
    transaction.mockClear();
    const module = await Test.createTestingModule({
      providers: [
        GoalsService,
        { provide: GoalsRepository, useValue: { transaction } },
        { provide: EventLogger, useValue: { emit } },
      ],
    }).compile();
    service = module.get(GoalsService);
  });
  it('creates only through an owner transaction and emits fixed fields after success', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ id: 'goal' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [row], rowCount: 1 });
    expect(
      await service.create('owner', { name: ' Synthetic ', targetMinor: '1', currency: 'INR' }),
    ).toMatchObject({ name: 'Synthetic', progressMinor: '0' });
    expect(transaction.mock.calls[0]?.[0]).toBe('owner');
    expect(emit).toHaveBeenCalledWith('info', {
      event: 'goal_command_completed',
      component: 'goals',
      operation: 'create',
      category: 'success',
    });
  });
  it('reads exact values without emitting private content', async () => {
    query.mockResolvedValue({
      rows: [{ ...row, progress_minor: '18446744073709551614' }],
      rowCount: 1,
    });
    expect((await service.get('owner', 'goal')).progressMinor).toBe('18446744073709551614');
    expect(emit).not.toHaveBeenCalled();
  });
  it('lists bounded pages and returns an exclusive cursor', async () => {
    query.mockResolvedValue({ rows: [row, { ...row, id: 'second' }], rowCount: 2 });
    expect(await service.list('owner', { limit: 1 })).toMatchObject({
      nextAfter: 'goal',
      items: [{ id: 'goal' }],
    });
    expect(query.mock.calls[0]?.[1]).toEqual(['owner', null, null, 2]);
  });
  it('rejects stale updates and deletes before writing', async () => {
    query.mockResolvedValue({ rows: [row], rowCount: 1 });
    await expect(
      service.update('owner', 'goal', { revision: 2, targetMinor: '2' }),
    ).rejects.toThrow('STALE_GOAL_REVISION');
    await expect(service.delete('owner', 'goal', 2)).rejects.toThrow('STALE_GOAL_REVISION');
    expect(emit).not.toHaveBeenCalled();
  });
  it('paginates history only after owner goal lookup', async () => {
    query
      .mockResolvedValueOnce({ rows: [row], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });
    expect(await service.contributions('owner', 'goal', { before: 3, limit: 1 })).toEqual({
      items: [],
      nextBefore: null,
    });
    expect(query.mock.calls[1]?.[1]).toEqual(['goal', 'owner', 3, 2]);
  });
  it('rejects a foreign or missing goal before progress or ledger access', async () => {
    query.mockResolvedValue({ rows: [], rowCount: 0 });
    await expect(service.get('owner', 'foreign')).rejects.toThrow('GOAL_NOT_FOUND');
    await expect(service.contributions('owner', 'foreign', {})).rejects.toThrow('GOAL_NOT_FOUND');
  });
  it('does not emit success when deletion fails', async () => {
    query
      .mockResolvedValueOnce({ rows: [row], rowCount: 1 })
      .mockRejectedValueOnce(new Error('failure'));
    await expect(service.delete('owner', 'goal', 1)).rejects.toThrow('failure');
    expect(emit).not.toHaveBeenCalled();
  });
  it('rejects money outside bigint and non-explicit correction shapes before a transaction', async () => {
    await expect(
      service.create('owner', {
        name: 'Synthetic',
        targetMinor: '9223372036854775808',
        currency: 'INR',
      }),
    ).rejects.toThrow('INVALID_GOAL');
    await expect(
      service.contribute('owner', 'goal', {
        revision: 1,
        commandId: 'command',
        kind: 'reversal',
        currency: 'INR',
        amountMinor: '0',
      }),
    ).rejects.toThrow('INVALID_CONTRIBUTION');
    expect(transaction).not.toHaveBeenCalled();
  });
});
