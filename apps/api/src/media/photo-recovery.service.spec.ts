import { describe, expect, it, jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ItemsRepository } from '../items/items.repository.js';
import { MediaService } from './media.service.js';
import { PhotoRecoveryService } from './photo-recovery.service.js';
describe('elected bounded recovery', () => {
  it('skips another replica lease and releases local admission on failure', async () => {
    let locked = false;
    const reconcile = jest
      .fn<() => Promise<{ completed: number; failed: number }>>()
      .mockResolvedValue({ completed: 0, failed: 0 });
    const transaction = jest
      .fn<ItemsRepository['transaction']>()
      .mockImplementation(async (_owner, operation) =>
        operation({ query: () => Promise.resolve({ rows: [{ locked }] }) } as never),
      );
    const module = await Test.createTestingModule({
      providers: [
        PhotoRecoveryService,
        { provide: ConfigService, useValue: new ConfigService({ NODE_ENV: 'test' }) },
        { provide: ItemsRepository, useValue: { transaction } },
        { provide: MediaService, useValue: { reconcile } },
      ],
    }).compile();
    const service = module.get(PhotoRecoveryService);
    await service.tick();
    expect(reconcile).not.toHaveBeenCalled();
    locked = true;
    await service.tick();
    expect(reconcile).toHaveBeenCalledTimes(1);
    await module.close();
  });
});
