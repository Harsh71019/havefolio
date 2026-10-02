import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import type { PoolClient } from 'pg';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ItemsRepository } from './items.repository.js';
import { InventoryQueryService, inventorySql, normalizeQuery } from './inventory-query.service.js';
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
  ] as ItemsQueryDto[])('rejects unsupported semantic combination %j', (q) => {
    expect(() => normalizeQuery(q)).toThrow('INVALID_ITEM_QUERY');
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
  ])('rejects invalid DTO input %j', async (input) => {
    expect((await validate(plainToInstance(ItemsQueryDto, input))).length).toBeGreaterThan(0);
  });
  it('rejects malformed cursors before touching SQL', async () => {
    await expect(service.list('owner', { after: 'v1.' + 'a'.repeat(60) })).rejects.toThrow(
      'INVALID_ITEM_CURSOR',
    );
    expect(query).not.toHaveBeenCalled();
  });
});
