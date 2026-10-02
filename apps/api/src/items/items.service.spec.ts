import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { InventoryQueryService } from './inventory-query.service.js';
import { ItemsService } from './items.service.js';
import { ItemsRepository } from './items.repository.js';
import { MediaService } from '../media/media.service.js';
import { CreateItemDto, UpdateItemDto } from './items.dto.js';
const base = { name: 'Kettle', ownershipStatus: 'owned' as const, currency: 'INR' };
describe('item rules and safe failures', () => {
  let service: ItemsService;
  const query = jest.fn<PoolClient['query']>();
  const client = { query } as unknown as PoolClient;
  const transaction =
    jest.fn<(owner: string, fn: (c: PoolClient) => Promise<unknown>) => Promise<unknown>>();
  const mediaDelete = jest.fn<(owner: string, id: string) => Promise<void>>();
  beforeEach(async () => {
    query.mockReset();
    transaction.mockReset();
    mediaDelete.mockReset();
    transaction.mockImplementation((_owner, fn) => fn(client));
    const module = await Test.createTestingModule({
      providers: [
        ItemsService,
        {
          provide: InventoryQueryService,
          useValue: {
            list: jest
              .fn<() => Promise<unknown>>()
              .mockResolvedValue({ items: [], nextCursor: null, hasMore: false }),
          },
        },
        { provide: ItemsRepository, useValue: { transaction } },
        { provide: MediaService, useValue: { delete: mediaDelete } },
      ],
    }).compile();
    service = module.get(ItemsService);
  });
  it.each(['ZZZ', 'XXX', 'XTS', 'inr'])(
    'rejects unsupported currency %s before storage',
    async (currency) => {
      await expect(service.create('owner', { ...base, currency })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(transaction).not.toHaveBeenCalled();
    },
  );
  it('rejects money beyond PostgreSQL bigint and oversized specifications', async () => {
    await expect(
      service.create('owner', { ...base, pricePaidMinor: '9223372036854775808' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.create('owner', { ...base, specifications: { text: 'a'.repeat(16385) } }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
  it.each([
    { precision: 'unknown', year: 2024 },
    { precision: 'year' },
    { precision: 'year', year: 2024, month: 1 },
    { precision: 'month', year: 2024 },
    { precision: 'month', year: 2024, month: 2, day: 1 },
    { precision: 'exact', year: 2023, month: 2, day: 29 },
    { precision: 'exact', year: 1900, month: 2, day: 29 },
    { precision: 'exact', year: 2024, month: 4, day: 31 },
  ])('rejects incompatible calendar components %j', async (purchaseDate) => {
    await expect(service.create('owner', { ...base, purchaseDate })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(transaction).not.toHaveBeenCalled();
  });
  it('rejects empty updates and malformed action times', async () => {
    await expect(service.update('owner', 'item', { revision: 1 })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(
      service.action('owner', 'item', {
        revision: 1,
        action: 'used',
        occurredAt: 'private garbage',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.action('owner', 'item', { revision: 1, action: 'used', ownershipStatus: 'lost' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
  it('returns safe not-found across reads, history, update, action and deletion', async () => {
    query.mockResolvedValue({ rows: [], rowCount: 0 } as never);
    for (const operation of [
      () => service.read('owner', 'foreign'),
      () => service.history('owner', 'foreign', {}),
      () => service.update('owner', 'foreign', { revision: 1, name: 'New' }),
      () => service.action('owner', 'foreign', { revision: 1, action: 'used' }),
      () => service.delete('owner', 'foreign', 1),
    ]) {
      await expect(operation()).rejects.toBeInstanceOf(NotFoundException);
    }
    expect(mediaDelete).not.toHaveBeenCalled();
  });
  it('checks stale versions before any mutation or provider call', async () => {
    query.mockResolvedValue({ rows: [{ revision: 2 }], rowCount: 1 } as never);
    await expect(
      service.update('owner', 'id', { revision: 1, name: 'New' }),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      service.action('owner', 'id', { revision: 1, action: 'used' }),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(service.delete('owner', 'id', 1)).rejects.toBeInstanceOf(ConflictException);
    expect(mediaDelete).not.toHaveBeenCalled();
  });
  it('returns an explicit empty bounded page', async () => {
    query.mockResolvedValue({ rows: [], rowCount: 0 } as never);
    await expect(service.list('owner', {})).resolves.toEqual({
      items: [],
      nextCursor: null,
      hasMore: false,
    });
    expect(query).not.toHaveBeenCalled();
  });
  it.each([
    { ...base, ownershipStatus: undefined },
    { ...base, ownerId: 'injected' },
    { ...base, currency: null },
    { ...base, pricePaidMinor: 0 },
    { ...base, pricePaidMinor: '1.20' },
    { ...base, purchaseDate: null },
    { ...base, tagIds: null },
  ])('validates malformed creation DTO %j', async (input) => {
    expect(
      (
        await validate(plainToInstance(CreateItemDto, input), {
          whitelist: true,
          forbidNonWhitelisted: true,
        })
      ).length,
    ).toBeGreaterThan(0);
  });
  it('rejects null for nonnullable update fields but permits explicit clearing and zero', async () => {
    for (const field of [
      'name',
      'currency',
      'condition',
      'useFrequency',
      'purchaseDate',
      'tagIds',
    ]) {
      expect(
        (await validate(plainToInstance(UpdateItemDto, { revision: 1, [field]: null }))).length,
      ).toBeGreaterThan(0);
    }
    expect(
      await validate(
        plainToInstance(UpdateItemDto, {
          revision: 1,
          categoryId: null,
          pricePaidMinor: '0',
          notes: null,
        }),
      ),
    ).toEqual([]);
  });
});
