import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import type { PoolClient } from 'pg';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ItemsRepository } from './items.repository.js';
import {
  InventoryQueryService,
  inventoryFacetSql,
  inventorySql,
  normalizeQuery,
} from './inventory-query.service.js';
import { ItemsQueryDto } from './inventory-query.dto.js';
describe('inventory query rules', () => {
  const query = jest.fn<PoolClient['query']>();
  let service: InventoryQueryService;
  beforeEach(async () => {
    query.mockReset();
    query.mockResolvedValue({ rows: [] } as never);
    const m = await Test.createTestingModule({
      providers: [
        InventoryQueryService,
        { provide: ConfigService, useValue: new ConfigService({}) },
        {
          provide: ItemsRepository,
          useValue: {
            transaction: (_o: string, fn: (c: PoolClient) => Promise<unknown>) =>
              fn({ query } as unknown as PoolClient),
          },
        },
      ],
    }).compile();
    service = m.get(InventoryQueryService);
  });
  it('uses exactly three bounded list/relationship queries independent of page size', async () => {
    expect(await service.list('owner', {})).toEqual({
      items: [],
      hasMore: false,
      nextCursor: null,
    });
    expect(query).toHaveBeenCalledTimes(3);
  });
  it('binds all external values and never puts private text in SQL', () => {
    const sql = inventorySql(
      'owner',
      normalizeQuery({ q: "private ' token", priceMin: '0', currency: 'INR' }),
    );
    expect(sql.text).not.toContain('private');
    expect(sql.values).toContain('private token');
    expect(sql.values).toContain('0');
  });
  it.each([
    { sort: 'price' },
    { priceMin: '0' },
    { priceMin: '3', priceMax: '2', currency: 'INR' },
    { priceMax: '9223372036854775808', currency: 'INR' },
    { priceMin: '0', currency: 'INR', priceKnown: 'only' },
    { purchasedFrom: '2023-02-29' },
    { purchasedFrom: '2024-05-01', purchasedTo: '2024-04-30' },
    { datePrecision: 'unknown', dateKnown: 'exclude' },
    { dateKnown: 'only', purchasedTo: '2024-01-01' },
    { direction: 'desc', sort: 'oldest' },
    { subcategoryId: 'child' },
    { spendingUnassigned: 'merchant' },
    {
      spendingScope: 'current-owned',
      spendingUnassigned: 'merchant',
      merchantId: '00000000-0000-0000-0000-000000000001',
    },
  ] as ItemsQueryDto[])('rejects unsupported semantic combination %j', (q) => {
    expect(() => normalizeQuery(q)).toThrow('INVALID_ITEM_QUERY');
  });
  it('binds merchantId and handles unassigned merchant drill-down SQL', () => {
    const merchantSql = inventorySql(
      'owner',
      normalizeQuery({
        spendingScope: 'current-owned',
        merchantId: '00000000-0000-0000-0000-000000000001',
      }),
    );
    expect(merchantSql.values).toContain('00000000-0000-0000-0000-000000000001');

    const unassignedSql = inventorySql(
      'owner',
      normalizeQuery({
        spendingScope: 'current-owned',
        spendingUnassigned: 'merchant',
      }),
    );
    expect(unassignedSql.text).toContain('merchant_id IS NULL');
  });
  it('rejects foreign merchant in taxonomy check', async () => {
    query.mockResolvedValueOnce({ rows: [{ valid: false }] } as never);
    await expect(
      service.list('owner', { merchantId: '00000000-0000-0000-0000-000000000002' }),
    ).rejects.toThrow('INVALID_ITEM_QUERY');
    expect(query).toHaveBeenCalledTimes(1);
  });
  it.each([
    { q: 'x'.repeat(201) },
    { limit: 101 },
    { limit: 0 },
    { limit: 1.2 },
    { sort: 'bad' },
    { priceMin: '-1' },
    { dateKnown: 'bad' },
    { after: 'x'.repeat(2049) },
    { brand: '   ' },
    { brand: 'b'.repeat(301) },
  ])('rejects invalid DTO input %j', async (input) => {
    expect((await validate(plainToInstance(ItemsQueryDto, input))).length).toBeGreaterThan(0);
  });
  it('rejects malformed cursors before touching SQL', async () => {
    await expect(service.list('owner', { after: 'v1.' + 'a'.repeat(60) })).rejects.toThrow(
      'INVALID_ITEM_CURSOR',
    );
    expect(query).not.toHaveBeenCalled();
  });
  it('binds a trimmed, case-insensitive brand and never puts it in SQL', () => {
    const sql = inventorySql('owner', normalizeQuery({ brand: ' Prestige ' }));
    expect(sql.text).toContain('lower(btrim(i.brand))=$2');
    expect(sql.text).not.toContain('prestige');
    expect(sql.values).toEqual(['owner', 'prestige', 26]);
  });
  it('drops each facet dimension own filter but keeps every other filter', () => {
    const q = normalizeQuery({
      ownershipStatus: 'owned',
      useFrequency: 'often',
      brand: 'Acme',
      priceMin: '100',
      currency: 'INR',
    });
    const status = inventoryFacetSql('owner', q, 'status');
    expect(status.text).not.toContain('i.ownership_status=');
    expect(status.values).toEqual(expect.arrayContaining(['often', 'acme', '100', 'INR']));
    const brand = inventoryFacetSql('owner', q, 'brand');
    expect(brand.values).not.toContain('acme');
    expect(brand.text).toContain('LIMIT 101');
    const price = inventoryFacetSql('owner', q, 'price');
    expect(price.values).not.toContain('100');
    expect(price.values).not.toContain('INR');
    expect(price.text).not.toContain('IS NULL)');
    const total = inventoryFacetSql('owner', q, 'total');
    expect(total.values).toEqual(expect.arrayContaining(['owned', 'often', 'acme', '100']));
  });
  it('maps facet rows and caps brands with a truncation flag', async () => {
    const brands = Array.from({ length: 101 }, (_, n) => ({ value: `Brand ${n}`, count: 1 }));
    query
      .mockResolvedValueOnce({ rows: [{ value: null, count: 7 }] } as never)
      .mockResolvedValueOnce({ rows: [{ value: 'owned', count: 6 }] } as never)
      .mockResolvedValueOnce({ rows: [{ value: 'often', count: 2 }] } as never)
      .mockResolvedValueOnce({ rows: [{ value: null, count: 3 }] } as never)
      .mockResolvedValueOnce({ rows: [{ value: 'sub', category_id: 'cat', count: 1 }] } as never)
      .mockResolvedValueOnce({ rows: brands } as never)
      .mockResolvedValueOnce({
        rows: [{ value: 'INR', min_minor: '100', max_minor: '900', count: 4 }],
      } as never);
    const facets = await service.facets('owner', {});
    expect(query).toHaveBeenCalledTimes(7);
    expect(facets).toMatchObject({
      total: 7,
      ownershipStatus: [{ value: 'owned', count: 6 }],
      useFrequency: [{ value: 'often', count: 2 }],
      categories: [{ value: null, count: 3 }],
      subcategories: [{ value: 'sub', categoryId: 'cat', count: 1 }],
      brandsTruncated: true,
      prices: [{ currency: 'INR', minMinor: '100', maxMinor: '900', count: 4 }],
    });
    expect(facets.brands).toHaveLength(100);
  });
});
