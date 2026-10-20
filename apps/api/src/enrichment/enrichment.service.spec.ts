import { describe, expect, it, jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import type { PoolClient } from 'pg';
import { EnrichmentService } from './enrichment.service.js';
import { ItemsRepository } from '../items/items.repository.js';
describe('PER-43 enrichment admission boundaries', () => {
  async function fixture(): Promise<{
    service: EnrichmentService;
    query: ReturnType<typeof jest.fn<PoolClient['query']>>;
  }> {
    const query = jest.fn<PoolClient['query']>();
    const module = await Test.createTestingModule({
      providers: [
        EnrichmentService,
        {
          provide: ItemsRepository,
          useValue: {
            transaction: (_owner: string, fn: (c: PoolClient) => Promise<unknown>) =>
              fn({ query } as unknown as PoolClient),
          },
        },
      ],
    }).compile();
    return { service: module.get(EnrichmentService), query };
  }
  it.each(['request', 'list', 'history', 'decide'] as const)(
    'rejects foreign/missing item before %s can expose data',
    async (method) => {
      const { service, query } = await fixture();
      query
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'owner' }] } as never)
        .mockResolvedValueOnce({ rows: [] } as never);
      const command = {
        commandId: 'command',
        revision: 1,
        candidateId: 'a',
        field: 'name' as const,
        decision: 'accept' as const,
      };
      const call =
        method === 'request'
          ? service.request('owner', 'foreign', { commandId: 'command', revision: 1, kind: 'name' })
          : method === 'decide'
            ? service.decide('owner', 'foreign', 'work', command)
            : service[method]('owner', 'foreign', { limit: 10 });
      await expect(call).rejects.toThrow('ITEM_NOT_FOUND');
      expect(query).toHaveBeenCalledTimes(2);
    },
  );
  it('rejects empty/oversized corrections and unexpected value before any database access', async () => {
    const { service, query } = await fixture();
    for (const dto of [
      { decision: 'accept' as const, value: 'unexpected' },
      { decision: 'correct' as const, value: ' ' },
      { decision: 'correct' as const, value: 'x'.repeat(301) },
    ]) {
      await expect(
        service.decide('owner', 'item', 'work', {
          commandId: 'command',
          revision: 1,
          candidateId: 'a',
          field: 'name',
          ...dto,
        }),
      ).rejects.toThrow('INVALID_ENRICHMENT_REVIEW');
    }
    expect(query).not.toHaveBeenCalled();
  });
});
