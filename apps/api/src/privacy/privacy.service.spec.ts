import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { Test, type TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { PrivacyService } from './privacy.service.js';
import { PrivacyRepository } from './privacy.repository.js';
import { PasswordService } from '../auth/password.service.js';
import { AuthRateService } from '../auth/auth-rate.service.js';
import { PrivateMediaStorage } from '../media/storage.js';
import { ReminderQueueService } from '../notifications/reminder-queue.service.js';
import { hashToken } from '../auth/session-cookie.service.js';
const owner = {
  id: 'owner',
  email: 'synthetic@example.test',
  displayName: null,
  sessionId: 'session',
};
describe('privacy application orchestration', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });
  async function fixture(): Promise<{
    service: PrivacyService;
    module: TestingModule;
    repository: {
      export: jest.Mock<(...args: unknown[]) => Promise<string>>;
      admit: jest.Mock<(...args: unknown[]) => Promise<unknown[]>>;
      status: jest.Mock<(...args: unknown[]) => Promise<object>>;
      reconcile: jest.Mock<(...args: unknown[]) => Promise<void>>;
    };
    passwords: { verify: jest.Mock<(...args: unknown[]) => Promise<boolean>> };
    rate: { check: jest.Mock<(...args: unknown[]) => Promise<void>> };
    queue: { cancelForOwner: jest.Mock<(...args: unknown[]) => Promise<void>> };
  }> {
    const repository = {
      export: jest.fn<(...args: unknown[]) => Promise<string>>().mockResolvedValue('{}'),
      admit: jest.fn<(...args: unknown[]) => Promise<unknown[]>>().mockResolvedValue([]),
      status: jest
        .fn<(...args: unknown[]) => Promise<object>>()
        .mockResolvedValue({ state: 'pending' }),
      reconcile: jest.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined),
    };
    const passwords = {
      verify: jest.fn<(...args: unknown[]) => Promise<boolean>>().mockResolvedValue(true),
    };
    const rate = {
      check: jest.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined),
    };
    const queue = {
      cancelForOwner: jest.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined),
    };
    const module = await Test.createTestingModule({
      providers: [
        PrivacyService,
        { provide: PrivacyRepository, useValue: repository },
        { provide: PasswordService, useValue: passwords },
        { provide: AuthRateService, useValue: rate },
        { provide: ReminderQueueService, useValue: queue },
        { provide: PrivateMediaStorage, useValue: {} },
        { provide: ConfigService, useValue: new ConfigService({ NODE_ENV: 'test' }) },
      ],
    }).compile();
    return { service: module.get(PrivacyService), module, repository, passwords, rate, queue };
  }
  it('hashes status receipts and rate limits deletion before password verification', async () => {
    const f = await fixture();
    const receipt = 'a'.repeat(64);
    await f.service.delete(
      owner,
      { receipt, password: 'synthetic', confirmation: 'DELETE MY ACCOUNT' },
      'loopback',
    );
    expect(f.rate.check).toHaveBeenCalledWith('delete', 'loopback', owner.email);
    expect(f.repository.admit).toHaveBeenCalledWith(
      owner,
      hashToken(receipt),
      expect.any(Function),
    );
    expect(f.queue.cancelForOwner).toHaveBeenCalledWith([]);
    await f.service.status(receipt);
    expect(f.repository.status).toHaveBeenLastCalledWith(hashToken(receipt));
    await f.module.close();
  });
  it('bounds exports and releases the concurrency slot after failure', async () => {
    const f = await fixture();
    let release!: (v: string) => void;
    f.repository.export.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const first = f.service.export(owner);
    await expect(f.service.export(owner)).rejects.toThrow('EXPORT_BUSY');
    release('{}');
    await first;
    f.repository.export.mockRejectedValueOnce(new Error('unavailable'));
    await expect(f.service.export(owner)).rejects.toThrow();
    await expect(f.service.export(owner)).resolves.toBe('{}');
    await f.module.close();
  });
  it('does not overlap reconciliation or expose provider failures', async () => {
    const f = await fixture();
    f.repository.reconcile.mockRejectedValueOnce(new Error('private provider failure'));
    await expect(f.service.tick()).resolves.toBeUndefined();
    await f.service.tick();
    expect(f.repository.reconcile).toHaveBeenCalledTimes(2);
    f.service.onModuleInit();
    f.service.onModuleDestroy();
    await f.module.close();
  });
});
