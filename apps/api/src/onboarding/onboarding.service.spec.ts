import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import type { PoolClient } from 'pg';
import { ItemsRepository } from '../items/items.repository.js';
import { MediaService } from '../media/media.service.js';
import { OnboardingService } from './onboarding.service.js';

// SQL/constraint/concurrency correctness is covered against PostgreSQL in onboarding.e2e-spec.
// These probes focus on admission/cleanup failures without sending private content to telemetry.
describe('onboarding application boundaries', () => {
  let service: OnboardingService;
  const query = jest.fn<(sql: string, values?: unknown[]) => Promise<unknown>>();
  const remove = jest.fn<(owner: string, id: string) => Promise<void>>();
  const snapshot = {
    state: 'skipped',
    genuineItemCount: 0,
    demoItemCount: 6,
    browsedStore: false,
    reviewedItem: false,
    triedDemo: true,
    removedDemo: false,
  };
  beforeEach(async () => {
    query.mockReset();
    remove.mockReset();
    const module = await Test.createTestingModule({
      providers: [
        OnboardingService,
        {
          provide: ItemsRepository,
          useValue: {
            transaction: (_owner: string, operation: (c: PoolClient) => Promise<unknown>) =>
              operation({ query } as unknown as PoolClient),
          },
        },
        { provide: MediaService, useValue: { delete: remove } },
      ],
    }).compile();
    service = module.get(OnboardingService);
  });
  it('reading creates only private state, never a sample dataset', async () => {
    query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [snapshot] });
    expect(await service.read('owner')).toEqual(snapshot);
    expect(query.mock.calls.map(([sql]) => sql).join(' ')).not.toContain(
      'INSERT INTO demo_datasets',
    );
  });
  it('requires intentional revisiting after dismissal', async () => {
    query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [snapshot] });
    await expect(service.act('owner', 'start')).rejects.toThrow('INVALID_ONBOARDING_TRANSITION');
    expect(query).toHaveBeenCalledTimes(2);
  });
  it('an existing dataset is returned without another inventory write', async () => {
    query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'internal' }] })
      .mockResolvedValueOnce({ rows: [snapshot] });
    expect(await service.seed('owner')).toEqual(snapshot);
    expect(query).toHaveBeenCalledTimes(3);
  });
  it('pending provider assets block inventory deletion', async () => {
    query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'asset', state: 'pending' }] });
    await expect(service.remove('owner')).rejects.toThrow('ITEM_MEDIA_PENDING');
    expect(remove).not.toHaveBeenCalled();
    expect(query).toHaveBeenCalledTimes(2);
  });
  it('provider cleanup failure leaves database deletion unattempted and recoverable', async () => {
    query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'asset', state: 'ready' }] });
    remove.mockRejectedValueOnce(new Error('unavailable'));
    await expect(service.remove('owner')).rejects.toThrow('unavailable');
    expect(remove).toHaveBeenCalledWith('owner', 'asset');
    expect(query).toHaveBeenCalledTimes(2);
  });
});
