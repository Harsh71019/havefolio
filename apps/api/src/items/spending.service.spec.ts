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
  it('rejects foreign merchant before aggregation', async () => {
    query.mockResolvedValueOnce({ rows: [{ valid: false }] } as never);
    await expect(
      service.report('owner', {
        scope: 'all-history',
        merchantId: '00000000-0000-0000-0000-000000000001',
      }),
    ).rejects.toThrow('INVALID_SPENDING_QUERY');
    expect(query).toHaveBeenCalledTimes(1);
  });
  it('generates merchant grouping SQL with merchant join and stable ordering', () => {
    const sql = spendingSql('owner', { scope: 'current-owned', grouping: 'merchant' });
    expect(sql.text).toContain('LEFT JOIN merchants m ON m.id=s.merchant_id AND m.owner_id=$1');
    expect(sql.text).toContain(
      'ORDER BY currency,(s.merchant_id IS NULL) ASC,m.normalized_name ASC NULLS LAST,relation',
    );
    expect(sql.text).toContain('"missingMerchantCount"');
  });
  it('attaches merchant metadata on merchant grouping and parses counts', async () => {
    query.mockResolvedValueOnce({
      rows: [
        {
          currency: 'INR',
          key: 'm-1',
          dateBucket: 'dated',
          grossMinor: '10000',
          refundedMinor: '0',
          netMinor: '10000',
          pricedItemCount: '1',
          unknownPriceCount: '0',
          notSpendingCount: '0',
          explicitZeroCount: '0',
          knownDateCount: '1',
          unknownDateCount: '0',
          missingMerchantCount: '0',
          totalItemCount: '1',
          merchant: { id: 'm-1', displayName: 'Amazon', websiteHost: 'amazon.in', state: 'active' },
        },
        {
          currency: 'INR',
          key: null,
          dateBucket: 'dated',
          grossMinor: '5000',
          refundedMinor: '0',
          netMinor: '5000',
          pricedItemCount: '1',
          unknownPriceCount: '0',
          notSpendingCount: '0',
          explicitZeroCount: '0',
          knownDateCount: '1',
          unknownDateCount: '0',
          missingMerchantCount: '1',
          totalItemCount: '1',
          merchant: null,
        },
      ],
    } as never);
    const result = await service.report('owner', { scope: 'current-owned', grouping: 'merchant' });
    expect(result.buckets).toHaveLength(2);
    expect(result.buckets[0]?.merchant).toEqual({
      id: 'm-1',
      displayName: 'Amazon',
      websiteHost: 'amazon.in',
      state: 'active',
    });
    expect(result.buckets[0]?.missingMerchantCount).toBe(0);
    expect(result.buckets[1]?.merchant).toBeNull();
    expect(result.buckets[1]?.missingMerchantCount).toBe(1);
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
