import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import type { PoolClient } from 'pg';
import { merchantHost, merchantName, MerchantsService } from './merchants.service.js';
import { MerchantsRepository } from './merchants.repository.js';
import { isPurchaseUrl } from '@havefolio/contracts';

describe('private merchant rules', () => {
  it.each(['Amazon', ' amazon ', 'Ａｍａｚｏｎ', 'Amazon  '])(
    'normalizes %s without losing capitalization',
    (value) => {
      expect(merchantName(value).toLowerCase()).toBe('amazon');
    },
  );
  it('normalizes repeated Unicode whitespace and preserves display case', () => {
    expect(merchantName('  Local\u00a0\u00a0Shop  ')).toBe('Local Shop');
  });
  it.each(['', '  ', 'x'.repeat(121), 'hidden\u200bname', 'bad\u0000name'])(
    'rejects invalid display names',
    (value) => expect(() => merchantName(value)).toThrow(),
  );
  it.each(['shop.example.test', 'SHOP.EXAMPLE.TEST', 'shop.example.test.'])(
    'normalizes optional host %s',
    (value) => expect(merchantHost(value)).toBe('shop.example.test'),
  );
  it.each([
    'https://shop.example.test',
    'shop.example.test/path',
    'user@shop.example.test',
    'shop.example.test?x=1',
    'bad..host',
    '-bad.test',
    'bad.test:443',
  ])('rejects host with non-host data %s', (value) => expect(() => merchantHost(value)).toThrow());
  it.each([
    'https://shop.example.test/product?ref=synthetic#details',
    'http://localhost/item',
    'HTTPS://shop.example.test/path',
  ])('accepts safe provenance without rewriting %s', (value) =>
    expect(isPurchaseUrl(value)).toBe(true),
  );
  it.each([
    'ftp://shop.example.test',
    'javascript:alert(1)',
    'https://user:pass@shop.example.test',
    'https://@shop.example.test',
    'https://',
    '//shop.example.test',
    'https://shop.example.test/ bad',
    'https://shop.example.test/\u0000',
    'https:\\shop.example.test',
    'https://shop.example.test/' + 'x'.repeat(2048),
  ])('rejects unsafe or malformed URL', (value) => expect(isPurchaseUrl(value)).toBe(false));
  let service: MerchantsService;
  const query = jest.fn<PoolClient['query']>();
  const transaction =
    jest.fn<(owner: string, fn: (c: PoolClient) => Promise<unknown>) => Promise<unknown>>();
  const merchant = {
    id: '11111111-1111-4111-8111-111111111111',
    displayName: 'Amazon',
    websiteHost: null,
    state: 'active',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  beforeEach(async () => {
    query.mockReset();
    transaction.mockReset();
    transaction.mockImplementation((_owner, fn) => fn({ query } as unknown as PoolClient));
    const module = await Test.createTestingModule({
      providers: [
        MerchantsService,
        { provide: MerchantsRepository, useValue: { transaction } },
        { provide: ConfigService, useValue: new ConfigService() },
      ],
    }).compile();
    service = module.get(MerchantsService);
  });
  it('reads only owner scope and hides missing records', async () => {
    query.mockResolvedValueOnce({ rows: [merchant] } as never);
    expect(await service.read('owner', merchant.id)).toEqual(merchant);
    expect(query.mock.calls[0]?.[1]).toEqual(['owner', merchant.id]);
    query.mockResolvedValueOnce({ rows: [] } as never);
    await expect(service.read('owner', 'missing')).rejects.toThrow('MERCHANT_NOT_FOUND');
  });
  it('creates using normalized conflict reuse without overwriting entered details', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ id: merchant.id }] } as never)
      .mockResolvedValueOnce({ rows: [merchant] } as never);
    expect(await service.create('owner', { displayName: ' Amazon ' })).toEqual(merchant);
    expect(query.mock.calls[0]?.[0]).toContain('ON CONFLICT');
    expect(query.mock.calls[0]?.[1]).toEqual(['owner', 'Amazon', null]);
  });
  it('updates and retires only the requested owner merchant', async () => {
    query
      .mockResolvedValueOnce({ rows: [merchant] } as never)
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({ rows: [{ ...merchant, state: 'retired' }] } as never);
    expect((await service.update('owner', merchant.id, { state: 'retired' })).state).toBe(
      'retired',
    );
    expect(query.mock.calls[1]?.[1]).toEqual(['owner', merchant.id, 'Amazon', null, 'retired']);
  });
  it('binds encrypted pagination to owner, normalized search, state and page size', async () => {
    const row = { ...merchant, normalized_name: 'amazon' };
    query.mockResolvedValue({
      rows: [row, { ...row, id: '22222222-2222-4222-8222-222222222222' }],
    } as never);
    const page = await service.list('owner', { limit: 1 });
    expect(page.hasMore).toBe(true);
    expect(page.merchants[0]).not.toHaveProperty('normalized_name');
    expect(page.nextCursor).not.toContain('amazon');
    for (const [owner, input] of [
      ['other', { limit: 1 }],
      ['owner', { limit: 2 }],
      ['owner', { limit: 1, q: 'amazon' }],
      ['owner', { limit: 1, state: 'all' }],
    ] as const) {
      expect(() => service.list(owner, { ...input, after: page.nextCursor! })).toThrow(
        'INVALID_MERCHANT_CURSOR',
      );
    }
    await service.list('owner', { limit: 1, after: page.nextCursor! });
  });
});
