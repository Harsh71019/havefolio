import { jest } from '@jest/globals';
import { HttpException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { validateApiEnvironment } from '@havefolio/config';
import { UploadRateService, UPLOAD_RATE_SCRIPT } from './upload-rate.service.js';

async function fixture(settings: Record<string, unknown> = {}): Promise<TestingModule> {
  const module = await Test.createTestingModule({
    providers: [
      UploadRateService,
      {
        provide: ConfigService,
        useValue: new ConfigService({ ...validateApiEnvironment({}), ...settings }),
      },
    ],
  }).compile();
  await module.init();
  return module;
}

describe('UploadRateService', () => {
  it('isolates HMAC keys and prevents leaking raw owner IDs or IP addresses', async () => {
    const module = await fixture({ AUTH_RATE_KEY_SECRET: 'synthetic-secret-key-fixture-32b!!' });
    try {
      const rate = module.get(UploadRateService);
      const owner = '11111111-1111-4111-8111-111111111111';
      const source = '198.51.100.42';
      const keys = rate.keys(owner, source);
      expect(keys[0]).toMatch(/^havefolio:dev:upload:owner:[0-9a-f]{64}$/);
      expect(keys[1]).toMatch(/^havefolio:dev:upload:source:[0-9a-f]{64}$/);
      expect(keys.join()).not.toContain(owner);
      expect(keys.join()).not.toContain(source);
      const otherKeys = rate.keys('22222222-2222-4222-8222-222222222222', source);
      expect(otherKeys[0]).not.toBe(keys[0]);
      expect(otherKeys[1]).toBe(keys[1]);
    } finally {
      await module.close();
    }
  });

  it('fails closed in production without Valkey client configuration', async () => {
    const module = await fixture({
      NODE_ENV: 'production',
      AUTH_RATE_KEY_SECRET: 'synthetic-secret-key-fixture-32b!!',
    });
    try {
      const rate = module.get(UploadRateService);
      await expect(rate.check('owner-1', '127.0.0.1')).rejects.toThrow(ServiceUnavailableException);
    } finally {
      await module.close();
    }
  });

  it('allows execution gracefully in dev/test without Valkey client configuration', async () => {
    const module = await fixture({
      NODE_ENV: 'development',
      AUTH_RATE_KEY_SECRET: 'synthetic-secret-key-fixture-32b!!',
    });
    try {
      const rate = module.get(UploadRateService);
      await expect(rate.check('owner-1', '127.0.0.1')).resolves.toBeUndefined();
    } finally {
      await module.close();
    }
  });

  it('enforces owner and source limits when Valkey reports exceeding counts', async () => {
    const module = await fixture({
      AUTH_RATE_KEY_SECRET: 'synthetic-secret-key-fixture-32b!!',
      UPLOAD_RATE_LIMIT: 20,
      UPLOAD_RATE_SOURCE_LIMIT: 30,
    });
    try {
      const rate = module.get(UploadRateService);
      const mockEval = jest.fn<(...args: unknown[]) => Promise<unknown>>();
      const mockConnect = jest.fn(() => Promise.resolve());
      const mockDisconnect = jest.fn();
      (rate as unknown as { client: unknown }).client = {
        connect: mockConnect,
        eval: mockEval,
        disconnect: mockDisconnect,
      };

      // Below limit
      mockEval.mockResolvedValueOnce([1, 1]);
      await expect(rate.check('owner-1', '198.51.100.1')).resolves.toBeUndefined();
      expect(mockEval).toHaveBeenCalledWith(
        UPLOAD_RATE_SCRIPT,
        2,
        expect.stringContaining('upload:owner:'),
        expect.stringContaining('upload:source:'),
        60,
      );

      // Exceeds owner limit (21 > 20)
      mockEval.mockResolvedValueOnce([21, 1]);
      await expect(rate.check('owner-1', '198.51.100.1')).rejects.toThrow(HttpException);

      // Exceeds source limit (31 > 30)
      mockEval.mockResolvedValueOnce([1, 31]);
      await expect(rate.check('owner-1', '198.51.100.1')).rejects.toThrow(HttpException);

      // Valkey evaluation failure fails closed
      mockEval.mockRejectedValueOnce(new Error('Connection lost'));
      await expect(rate.check('owner-1', '198.51.100.1')).rejects.toThrow(
        ServiceUnavailableException,
      );
    } finally {
      await module.close();
    }
  });
});
