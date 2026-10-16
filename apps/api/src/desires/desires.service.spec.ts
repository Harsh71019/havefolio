import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import type { PoolClient } from 'pg';
import { DesiresRepository } from './desires.repository.js';
import { DesiresService } from './desires.service.js';
import { PhotoProcessor } from '../media/photo-processing.js';
import { PrivateMediaStorage } from '../media/storage.js';

describe('DesiresService application rules', () => {
  let service: DesiresService;
  const query = jest.fn<(sql: string, values?: unknown[]) => Promise<unknown>>();
  const storageDelete = jest.fn<(key: string, resType: string) => Promise<void>>();
  const storageRead = jest.fn<() => Promise<Buffer>>();
  const storagePut = jest.fn<() => Promise<unknown>>();
  const owner = 'f0000000-0000-4000-8000-000000000001';

  beforeEach(async () => {
    query.mockReset();
    storageDelete.mockReset();
    storageRead.mockReset();
    storagePut.mockReset();

    const module = await Test.createTestingModule({
      providers: [
        DesiresService,
        {
          provide: DesiresRepository,
          useValue: {
            transaction: (_owner: string, operation: (c: PoolClient) => Promise<unknown>) =>
              operation({ query } as unknown as PoolClient),
          },
        },
        {
          provide: PhotoProcessor,
          useValue: { process: jest.fn() },
        },
        {
          provide: PrivateMediaStorage,
          useValue: {
            delete: storageDelete,
            read: storageRead,
            put: storagePut,
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string, fallback?: unknown) => {
              if (key === 'AUTH_RATE_KEY_SECRET') return 'secret-key-32-characters-length!';
              if (key === 'MEDIA_STORAGE_ENABLED') return true;
              return fallback;
            },
          },
        },
      ],
    }).compile();

    service = module.get(DesiresService);
  });

  it('creating requires only a valid trimmed name', async () => {
    const row = {
      id: 'd0000000-0000-4000-8000-000000000001',
      owner_id: owner,
      name: 'Mechanical keyboard',
      classification: null,
      likely_price_minor: null,
      currency: null,
      product_url: null,
      reason: null,
      status: 'considering',
      waiting_started_at: null,
      review_at: null,
      revision: 1,
      created_at: new Date('2026-10-16T10:00:00Z'),
      updated_at: new Date('2026-10-16T10:00:00Z'),
    };
    query.mockResolvedValueOnce({ rows: [row] });

    const result = await service.create(owner, { name: '  Mechanical keyboard  ' });
    expect(result.name).toBe('Mechanical keyboard');
    expect(result.status).toBe('considering');
    expect(result.effectiveState).toBe('considering');
    expect(result.revision).toBe(1);
    expect(result.likelyPriceMinor).toBeNull();
    expect(result.photo).toBeNull();
  });

  it('rejects empty name or invalid classification on creation', async () => {
    await expect(service.create(owner, { name: '   ' })).rejects.toThrow('INVALID_DESIRE');
    await expect(
      // @ts-expect-error test invalid enum
      service.create(owner, { name: 'Item', classification: 'invalid' }),
    ).rejects.toThrow('INVALID_DESIRE');
  });

  it('rejects an otherwise empty patch', async () => {
    await expect(service.update(owner, 'id', { revision: 1 })).rejects.toThrow('INVALID_DESIRE');
  });

  it('rejects stale revision updates without writing', async () => {
    const row = {
      id: 'd0000000-0000-4000-8000-000000000001',
      owner_id: owner,
      name: 'Camera',
      revision: 3,
    };
    query.mockResolvedValueOnce({ rows: [row] });

    await expect(
      service.update(owner, row.id, { revision: 2, name: 'New camera' }),
    ).rejects.toThrow('STALE_DESIRE_REVISION');
  });

  it('waiting-state transitions: starts waiting, advances to ready_for_review, extends and cancels', async () => {
    const t0 = new Date('2026-10-16T10:00:00.000Z');
    service.setClock(() => t0);

    const rowWaiting = {
      id: 'd0000000-0000-4000-8000-000000000001',
      owner_id: owner,
      name: 'Tablet',
      classification: 'want',
      likely_price_minor: '5000000',
      currency: 'INR',
      product_url: null,
      reason: null,
      status: 'waiting',
      waiting_started_at: t0,
      review_at: new Date('2026-10-23T10:00:00.000Z'),
      revision: 1,
      created_at: t0,
      updated_at: t0,
    };

    // Get desire before review due date -> waiting
    query.mockResolvedValueOnce({ rows: [rowWaiting] }).mockResolvedValueOnce({ rows: [] });
    const beforeReview = await service.get(owner, rowWaiting.id);
    expect(beforeReview.status).toBe('waiting');
    expect(beforeReview.effectiveState).toBe('waiting');

    // Advance clock past reviewAt -> ready_for_review without database mutation
    const tPast = new Date('2026-10-24T10:00:00.000Z');
    service.setClock(() => tPast);
    query.mockResolvedValueOnce({ rows: [rowWaiting] }).mockResolvedValueOnce({ rows: [] });
    const afterReview = await service.get(owner, rowWaiting.id);
    expect(afterReview.status).toBe('waiting');
    expect(afterReview.effectiveState).toBe('ready_for_review');

    // Cancelling waiting period transitions back to considering
    const rowConsidering = {
      ...rowWaiting,
      status: 'considering',
      waiting_started_at: null,
      review_at: null,
      revision: 2,
    };
    query
      .mockResolvedValueOnce({ rows: [rowWaiting] })
      .mockResolvedValueOnce({ rows: [rowConsidering] })
      .mockResolvedValueOnce({ rows: [] });

    const cancelled = await service.update(owner, rowWaiting.id, {
      revision: 1,
      waitingPeriod: null,
    });
    expect(cancelled.status).toBe('considering');
    expect(cancelled.effectiveState).toBe('considering');
    expect(cancelled.waitingStartedAt).toBeNull();
    expect(cancelled.reviewAt).toBeNull();
  });

  it('repeated edits update the same desire and never produce avoided-spend or savings records', async () => {
    const t0 = new Date('2026-10-16T10:00:00.000Z');
    service.setClock(() => t0);

    const row = {
      id: 'd0000000-0000-4000-8000-000000000001',
      owner_id: owner,
      name: 'Headphones',
      classification: 'want',
      likely_price_minor: '2000000',
      currency: 'INR',
      product_url: 'https://example.com/hp',
      reason: 'Music listening',
      status: 'considering',
      waiting_started_at: null,
      review_at: null,
      revision: 1,
      created_at: t0,
      updated_at: t0,
    };

    query
      .mockResolvedValueOnce({ rows: [row] })
      .mockResolvedValueOnce({ rows: [{ ...row, name: 'Wireless Headphones', revision: 2 }] })
      .mockResolvedValueOnce({ rows: [] });

    const updated = await service.update(owner, row.id, {
      revision: 1,
      name: 'Wireless Headphones',
    });

    expect(updated.id).toBe(row.id);
    expect(updated.revision).toBe(2);

    // Verify SQL commands executed never reference savings, avoided spend or ledger
    const executedSql = query.mock.calls.map(([s]) => s.toLowerCase()).join(' ');
    expect(executedSql).not.toContain('saving');
    expect(executedSql).not.toContain('avoided');
    expect(executedSql).not.toContain('ledger');
    expect(executedSql).not.toContain('actual_price');
  });

  it('deletion rejects pending media attachments and safely cleans up ready media', async () => {
    const row = {
      id: 'd0000000-0000-4000-8000-000000000001',
      owner_id: owner,
      name: 'Watch',
      revision: 1,
    };

    // Case 1: Pending media prevents deletion
    query.mockResolvedValueOnce({ rows: [row] }).mockResolvedValueOnce({
      rows: [{ id: 'm1', state: 'pending', object_key: 'key1', variant: 'original' }],
    });

    await expect(service.delete(owner, row.id, 1)).rejects.toThrow('DESIRE_MEDIA_PENDING');

    // Case 2: Ready media cleaned up before desire is deleted
    query
      .mockResolvedValueOnce({ rows: [row] })
      .mockResolvedValueOnce({
        rows: [{ id: 'm1', state: 'ready', object_key: 'key1', variant: 'original' }],
      })
      .mockResolvedValueOnce({ rowCount: 1 }) // UPDATE media_attachments to deleting
      .mockResolvedValueOnce({ rowCount: 1 }) // UPDATE media_attachments to deleted
      .mockResolvedValueOnce({ rowCount: 1 }); // DELETE FROM desires

    storageDelete.mockResolvedValueOnce(undefined);

    await service.delete(owner, row.id, 1);
    expect(storageDelete).toHaveBeenCalledWith('key1', 'image');
  });
});
