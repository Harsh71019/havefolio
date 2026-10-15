import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import type { PoolClient } from 'pg';
import { ItemsRepository } from './items.repository.js';
import { SpendingService, normalizeSpendingQuery, spendingSql } from './spending.service.js';
import type { SpendingQueryDto } from './spending.dto.js';

describe('spending contract boundaries', () => {
  const query = jest.fn<PoolClient['query']>();
  let service: SpendingService;
  beforeEach(async () => {
    query.mockReset();
    query.mockResolvedValue({ rows: [] } as never);
    const module = await Test.createTestingModule({
      providers: [
        SpendingService,
        {
          provide: ItemsRepository,
          useValue: {
            transaction: (_owner: string, fn: (c: PoolClient) => Promise<unknown>) =>
              fn({ query } as unknown as PoolClient),
          },
        },
      ],
    }).compile();
    service = module.get(SpendingService);
  });
  it('requires an explicit scope and uses one bounded aggregate query', async () => {
    expect(await service.report('owner', { scope: 'all-history' })).toEqual({
      scope: 'all-history',
      grouping: 'overall',
      basis: 'purchase-date',
      purchasedFrom: null,
      purchasedTo: null,
      buckets: [],
    });
    expect(query).toHaveBeenCalledTimes(1);
    expect(spendingSql('owner', { scope: 'current-owned' }).text).toContain('LIMIT 1001');
  });
  it.each([
    { scope: 'bad' },
    { scope: 'all-history', currency: 'XXX' },
    { scope: 'all-history', purchasedFrom: '2023-02-29' },
    { scope: 'all-history', purchasedFrom: '2024-12-01', purchasedTo: '2024-01-01' },
    { scope: 'all-history', subcategoryId: 'child' },
    { scope: 'all-history', grouping: 'day' },
  ])('rejects invalid semantics %j', (q) => {
    expect(() => normalizeSpendingQuery(q as SpendingQueryDto)).toThrow('INVALID_SPENDING_QUERY');
  });
  it('binds owner, scope, dates and taxonomy without interpolation', () => {
    const sql = spendingSql('private-owner', {
      scope: 'current-owned',
      categoryId: 'private-category',
      purchasedFrom: '2024-02-29',
    });
    expect(sql.text).not.toContain('private');
    expect(sql.values).toContain('private-category');
    expect(sql.values).toContainEqual(['owned']);
  });
  it('rejects foreign taxonomy before aggregation', async () => {
    query.mockResolvedValueOnce({ rows: [{ valid: false }] } as never);
    await expect(
      service.report('owner', { scope: 'all-history', categoryId: 'foreign' }),
    ).rejects.toThrow('INVALID_SPENDING_QUERY');
    expect(query).toHaveBeenCalledTimes(1);
  });
  it('rejects excessive buckets instead of returning truncated totals', async () => {
    query.mockResolvedValueOnce({ rows: Array.from({ length: 1001 }, () => ({})) } as never);
    await expect(service.report('owner', { scope: 'all-history' })).rejects.toThrow(
      'SPENDING_BUCKET_LIMIT',
    );
  });
  it('rejects invented monthly precision', async () => {
    query.mockResolvedValueOnce({ rows: [{ hasYearPrecision: true }] } as never);
    await expect(
      service.report('owner', { scope: 'all-history', grouping: 'month' }),
    ).rejects.toThrow('SPENDING_PRECISION_UNREPRESENTABLE');
  });
});
