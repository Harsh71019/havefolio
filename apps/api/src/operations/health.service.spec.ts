import { jest } from '@jest/globals';
import { HttpStatus } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import type { DependencyHealth } from '@havefolio/contracts';
import { HealthService } from './health.service.js';
import { HealthController } from './health.controller.js';
import { PrivateMediaStorage } from '../media/storage.js';

describe('HealthService & HealthController', () => {
  let service: HealthService;
  let controller: HealthController;
  let mockStorage: { checkReadiness: jest.Mock<() => Promise<DependencyHealth>> };

  beforeEach(async () => {
    mockStorage = {
      checkReadiness: jest
        .fn<() => Promise<DependencyHealth>>()
        .mockResolvedValue({ status: 'ok' }),
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        HealthService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'DATABASE_URL') return undefined; // don't open real pool in test
              if (key === 'VALKEY_HOST') return undefined;
              return undefined;
            }),
          },
        },
        {
          provide: PrivateMediaStorage,
          useValue: mockStorage,
        },
      ],
    }).compile();

    service = moduleRef.get(HealthService);
    controller = moduleRef.get(HealthController);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  describe('Liveness probe (GET /api/v1/health/live)', () => {
    it('returns the stable minimal liveness response', () => {
      const response = service.getLiveness();
      expect(response).toEqual({
        service: 'havefolio-api',
        status: 'ok',
      });
      expect(response).not.toHaveProperty('database');
      expect(response).not.toHaveProperty('valkey');
      expect(response).not.toHaveProperty('storage');
    });

    it('does not fail when external dependencies are unavailable or failing', () => {
      jest.spyOn(service, 'checkPostgres').mockRejectedValue(new Error('connection refused'));
      jest.spyOn(service, 'checkValkey').mockRejectedValue(new Error('AUTH failed'));
      mockStorage.checkReadiness.mockRejectedValue(new Error('Cloudinary unreachable'));

      const liveResponse = service.getLiveness();
      expect(liveResponse.status).toBe('ok');
      expect(liveResponse.service).toBe('havefolio-api');

      const controllerLive = controller.getLive();
      expect(controllerLive.status).toBe('ok');
    });

    it('contains no sensitive configuration, URLs, or hostnames', () => {
      const liveJson = JSON.stringify(service.getLiveness());
      expect(liveJson).not.toContain('password');
      expect(liveJson).not.toContain('secret');
      expect(liveJson).not.toContain('token');
      expect(liveJson).not.toContain('http://');
      expect(liveJson).not.toContain('https://');
    });
  });

  describe('Readiness probe (GET /api/v1/health/ready)', () => {
    it('reports status: ok when all dependencies are healthy', async () => {
      jest.spyOn(service, 'checkPostgres').mockResolvedValue({ status: 'ok' });
      jest.spyOn(service, 'checkValkey').mockResolvedValue({ status: 'ok' });
      jest.spyOn(service, 'checkStorage').mockResolvedValue({ status: 'ok' });

      const result = await service.getReadiness();
      expect(result.status).toBe('ok');
      expect(result.service).toBe('havefolio-api');
      expect(result.dependencies).toEqual({
        postgres: { status: 'ok' },
        valkey: { status: 'ok' },
        storage: { status: 'ok' },
      });
      expect(typeof result.durationMs).toBe('number');
    });

    it('reports status: unavailable when PostgreSQL is unavailable', async () => {
      jest.spyOn(service, 'checkPostgres').mockResolvedValue({
        status: 'unavailable',
        error: 'DATABASE_UNAVAILABLE',
      });
      jest.spyOn(service, 'checkValkey').mockResolvedValue({ status: 'ok' });
      jest.spyOn(service, 'checkStorage').mockResolvedValue({ status: 'ok' });

      const result = await service.getReadiness();
      expect(result.status).toBe('unavailable');
      expect(result.dependencies.postgres).toEqual({
        status: 'unavailable',
        error: 'DATABASE_UNAVAILABLE',
      });
      expect(result.dependencies.valkey.status).toBe('ok');
    });

    it('reports status: unavailable when PostgreSQL check times out', async () => {
      jest.spyOn(service, 'checkPostgres').mockResolvedValue({
        status: 'unavailable',
        error: 'TIMEOUT',
      });
      jest.spyOn(service, 'checkValkey').mockResolvedValue({ status: 'ok' });
      jest.spyOn(service, 'checkStorage').mockResolvedValue({ status: 'ok' });

      const result = await service.getReadiness();
      expect(result.status).toBe('unavailable');
      expect(result.dependencies.postgres).toEqual({
        status: 'unavailable',
        error: 'TIMEOUT',
      });
    });

    it('reports status: unavailable when Valkey is unavailable', async () => {
      jest.spyOn(service, 'checkPostgres').mockResolvedValue({ status: 'ok' });
      jest.spyOn(service, 'checkValkey').mockResolvedValue({
        status: 'unavailable',
        error: 'VALKEY_UNAVAILABLE',
      });
      jest.spyOn(service, 'checkStorage').mockResolvedValue({ status: 'ok' });

      const result = await service.getReadiness();
      expect(result.status).toBe('unavailable');
      expect(result.dependencies.valkey).toEqual({
        status: 'unavailable',
        error: 'VALKEY_UNAVAILABLE',
      });
    });

    it('reports status: unavailable when Valkey check times out', async () => {
      jest.spyOn(service, 'checkPostgres').mockResolvedValue({ status: 'ok' });
      jest.spyOn(service, 'checkValkey').mockResolvedValue({
        status: 'unavailable',
        error: 'TIMEOUT',
      });
      jest.spyOn(service, 'checkStorage').mockResolvedValue({ status: 'ok' });

      const result = await service.getReadiness();
      expect(result.status).toBe('unavailable');
      expect(result.dependencies.valkey).toEqual({
        status: 'unavailable',
        error: 'TIMEOUT',
      });
    });

    it('reports status: degraded when upload storage is unavailable', async () => {
      jest.spyOn(service, 'checkPostgres').mockResolvedValue({ status: 'ok' });
      jest.spyOn(service, 'checkValkey').mockResolvedValue({ status: 'ok' });
      jest.spyOn(service, 'checkStorage').mockResolvedValue({
        status: 'unavailable',
        error: 'STORAGE_UNAVAILABLE',
      });

      const result = await service.getReadiness();
      expect(result.status).toBe('degraded');
      expect(result.dependencies.storage).toEqual({
        status: 'unavailable',
        error: 'STORAGE_UNAVAILABLE',
      });
      expect(result.dependencies.postgres.status).toBe('ok');
      expect(result.dependencies.valkey.status).toBe('ok');
    });

    it('reports status: ok when upload storage is disabled', async () => {
      jest.spyOn(service, 'checkPostgres').mockResolvedValue({ status: 'ok' });
      jest.spyOn(service, 'checkValkey').mockResolvedValue({ status: 'ok' });
      jest.spyOn(service, 'checkStorage').mockResolvedValue({ status: 'disabled' });

      const result = await service.getReadiness();
      expect(result.status).toBe('ok');
      expect(result.dependencies.storage).toEqual({ status: 'disabled' });
    });

    it('reports multiple simultaneous failures independently without leaking raw errors', async () => {
      jest.spyOn(service, 'checkPostgres').mockResolvedValue({
        status: 'unavailable',
        error: 'DATABASE_UNAVAILABLE',
      });
      jest.spyOn(service, 'checkValkey').mockResolvedValue({
        status: 'unavailable',
        error: 'VALKEY_UNAVAILABLE',
      });
      jest.spyOn(service, 'checkStorage').mockResolvedValue({
        status: 'unavailable',
        error: 'STORAGE_UNAVAILABLE',
      });

      const result = await service.getReadiness();
      expect(result.status).toBe('unavailable');
      expect(result.dependencies.postgres.status).toBe('unavailable');
      expect(result.dependencies.valkey.status).toBe('unavailable');
      expect(result.dependencies.storage.status).toBe('unavailable');

      const json = JSON.stringify(result);
      expect(json).not.toContain('ECONNREFUSED');
      expect(json).not.toContain('postgres://');
      expect(json).not.toContain('redis://');
    });

    it('deduplicates concurrent calls using single-flight and caches responses for 2s', async () => {
      const pgSpy = jest
        .spyOn(service, 'checkPostgres')
        .mockImplementation(
          () => new Promise((resolve) => setTimeout(() => resolve({ status: 'ok' }), 50)),
        );
      jest.spyOn(service, 'checkValkey').mockResolvedValue({ status: 'ok' });
      jest.spyOn(service, 'checkStorage').mockResolvedValue({ status: 'ok' });

      // Run 3 concurrent requests
      const [res1, res2, res3] = await Promise.all([
        service.getReadiness(),
        service.getReadiness(),
        service.getReadiness(),
      ]);

      expect(res1).toBe(res2);
      expect(res2).toBe(res3);
      expect(pgSpy).toHaveBeenCalledTimes(1);

      // Call again within cache window
      const cached = await service.getReadiness();
      expect(cached).toBe(res1);
      expect(pgSpy).toHaveBeenCalledTimes(1);
    });

    it('logs state transitions when readiness status changes', async () => {
      const warnSpy = jest.spyOn(service['logger'], 'warn').mockImplementation(() => undefined);

      jest.spyOn(service, 'checkPostgres').mockResolvedValue({ status: 'ok' });
      jest.spyOn(service, 'checkValkey').mockResolvedValue({ status: 'ok' });
      jest.spyOn(service, 'checkStorage').mockResolvedValue({ status: 'ok' });
      await service.getReadiness();
      expect(warnSpy).not.toHaveBeenCalled();

      // Clear cache and transition to unavailable
      service.clearReadinessCache();
      jest.spyOn(service, 'checkPostgres').mockResolvedValue({
        status: 'unavailable',
        error: 'DATABASE_UNAVAILABLE',
      });
      await service.getReadiness();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Readiness state changed from ok to unavailable'),
      );
    });
  });

  describe('HealthController HTTP responses & status codes', () => {
    it('returns 200 for GET /api/v1/health with legacy contract', () => {
      const result = controller.getHealth();
      expect(result).toEqual({
        service: 'havefolio-api',
        status: 'ok',
        version: '1',
      });
    });

    it('returns 200 for GET /api/v1/health/live', () => {
      const result = controller.getLive();
      expect(result).toEqual({
        service: 'havefolio-api',
        status: 'ok',
      });
    });

    it('returns 200 with readiness body when status is ok', async () => {
      const statusSpy = jest.fn();
      const mockRes = { status: statusSpy } as unknown as Response;
      jest.spyOn(service, 'getReadiness').mockResolvedValue({
        service: 'havefolio-api',
        status: 'ok',
        dependencies: {
          postgres: { status: 'ok' },
          valkey: { status: 'ok' },
          storage: { status: 'ok' },
        },
      });

      const result = await controller.getReady(mockRes);
      expect(result.status).toBe('ok');
      expect(statusSpy).not.toHaveBeenCalled();
    });

    it('returns 200 with readiness body when status is degraded', async () => {
      const statusSpy = jest.fn();
      const mockRes = { status: statusSpy } as unknown as Response;
      jest.spyOn(service, 'getReadiness').mockResolvedValue({
        service: 'havefolio-api',
        status: 'degraded',
        dependencies: {
          postgres: { status: 'ok' },
          valkey: { status: 'ok' },
          storage: { status: 'unavailable', error: 'STORAGE_UNAVAILABLE' },
        },
      });

      const result = await controller.getReady(mockRes);
      expect(result.status).toBe('degraded');
      expect(statusSpy).not.toHaveBeenCalled();
    });

    it('sets HTTP 503 on response when status is unavailable', async () => {
      const statusSpy = jest.fn();
      const mockRes = { status: statusSpy } as unknown as Response;
      jest.spyOn(service, 'getReadiness').mockResolvedValue({
        service: 'havefolio-api',
        status: 'unavailable',
        dependencies: {
          postgres: { status: 'unavailable', error: 'DATABASE_UNAVAILABLE' },
          valkey: { status: 'ok' },
          storage: { status: 'ok' },
        },
      });

      const result = await controller.getReady(mockRes);
      expect(result.status).toBe('unavailable');
      expect(statusSpy).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
    });
  });
});
