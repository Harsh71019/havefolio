import type { DependencyHealth, ReadinessStatus } from '@havefolio/contracts';
import { Injectable, Logger, Optional, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool, type PoolClient } from 'pg';
import { Redis } from 'ioredis';
import { PrivateMediaStorage } from '../media/storage.js';
import {
  HealthResponseDto,
  LivenessResponseDto,
  ReadinessResponseDto,
} from './health-response.dto.js';

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error('TIMEOUT');
      err.name = 'TimeoutError';
      reject(err);
    }, ms);
    timer.unref();
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    clearTimeout(timer);
  });
}

@Injectable()
export class HealthService implements OnModuleDestroy {
  private readonly logger = new Logger(HealthService.name);
  private readonly pgPool?: Pool;
  private readonly valkeyClient?: Redis;
  private previousStatus: ReadinessStatus | null = null;
  private cachedReadiness: { expiresAt: number; result: ReadinessResponseDto } | null = null;
  private inFlightReadiness: Promise<ReadinessResponseDto> | null = null;

  constructor(
    private readonly config: ConfigService,
    @Optional() private readonly storage?: PrivateMediaStorage,
  ) {
    const dbUrl = this.config.get<string>('DATABASE_URL');
    if (dbUrl) {
      this.pgPool = new Pool({
        connectionString: dbUrl,
        max: 2,
        connectionTimeoutMillis: 2000,
        idleTimeoutMillis: 10000,
        statement_timeout: 2000,
      });
      this.pgPool.on('error', () => undefined);
    }

    const valkeyHost = this.config.get<string>('VALKEY_HOST');
    if (valkeyHost) {
      this.valkeyClient = new Redis({
        host: valkeyHost,
        port: Number(this.config.get<number>('VALKEY_PORT') || 6379),
        username: this.config.get<string>('VALKEY_USERNAME'),
        password: this.config.get<string>('VALKEY_PASSWORD'),
        db: 0,
        lazyConnect: true,
        enableReadyCheck: false,
        enableOfflineQueue: false,
        maxRetriesPerRequest: 0,
        retryStrategy: () => null,
        connectTimeout: 2000,
        commandTimeout: 2000,
      });
      this.valkeyClient.on('error', () => undefined);
    }
  }

  getStatus(): HealthResponseDto {
    return new HealthResponseDto();
  }

  getLiveness(): LivenessResponseDto {
    return new LivenessResponseDto();
  }

  clearReadinessCache(): void {
    this.cachedReadiness = null;
    this.inFlightReadiness = null;
  }

  async checkPostgres(): Promise<DependencyHealth> {
    if (!this.pgPool) {
      return { status: 'unavailable', error: 'DATABASE_UNAVAILABLE' };
    }
    let client: PoolClient | undefined;
    try {
      client = await withTimeout(this.pgPool.connect(), 2000);
      await withTimeout(client.query('SELECT 1 FROM users LIMIT 1'), 2000);
      return { status: 'ok' };
    } catch (error) {
      const isTimeout =
        (error instanceof Error &&
          (error.message === 'TIMEOUT' || error.name === 'TimeoutError')) ||
        (typeof error === 'object' && error !== null && 'code' in error && error.code === '57014');
      return {
        status: 'unavailable',
        error: isTimeout ? 'TIMEOUT' : 'DATABASE_UNAVAILABLE',
      };
    } finally {
      client?.release();
    }
  }

  async checkValkey(): Promise<DependencyHealth> {
    if (!this.valkeyClient) {
      return { status: 'unavailable', error: 'VALKEY_UNAVAILABLE' };
    }
    try {
      if (this.valkeyClient.status === 'wait') {
        await withTimeout(this.valkeyClient.connect(), 2000);
      }
      const pong = await withTimeout(this.valkeyClient.ping(), 2000);
      if (pong === 'PONG') {
        return { status: 'ok' };
      }
      return { status: 'unavailable', error: 'VALKEY_UNAVAILABLE' };
    } catch (error) {
      const isTimeout =
        error instanceof Error && (error.message === 'TIMEOUT' || error.name === 'TimeoutError');
      return {
        status: 'unavailable',
        error: isTimeout ? 'TIMEOUT' : 'VALKEY_UNAVAILABLE',
      };
    }
  }

  async checkStorage(): Promise<DependencyHealth> {
    if (!this.storage) {
      return { status: 'disabled' };
    }
    try {
      return await withTimeout(this.storage.checkReadiness(), 2000);
    } catch (error) {
      const isTimeout =
        error instanceof Error && (error.message === 'TIMEOUT' || error.name === 'TimeoutError');
      return {
        status: 'unavailable',
        error: isTimeout ? 'TIMEOUT' : 'STORAGE_UNAVAILABLE',
      };
    }
  }

  async getReadiness(): Promise<ReadinessResponseDto> {
    const now = Date.now();
    if (this.cachedReadiness && this.cachedReadiness.expiresAt > now) {
      return this.cachedReadiness.result;
    }
    if (this.inFlightReadiness) {
      return this.inFlightReadiness;
    }

    this.inFlightReadiness = this.executeReadinessCheck()
      .then((result) => {
        this.cachedReadiness = {
          expiresAt: Date.now() + 2000,
          result,
        };
        return result;
      })
      .finally(() => {
        this.inFlightReadiness = null;
      });

    return this.inFlightReadiness;
  }

  private async executeReadinessCheck(): Promise<ReadinessResponseDto> {
    const start = performance.now();
    let postgres: DependencyHealth;
    let valkey: DependencyHealth;
    let storage: DependencyHealth;

    try {
      [postgres, valkey, storage] = await withTimeout(
        Promise.all([this.checkPostgres(), this.checkValkey(), this.checkStorage()]),
        2500,
      );
    } catch {
      postgres = { status: 'unavailable', error: 'TIMEOUT' };
      valkey = { status: 'unavailable', error: 'TIMEOUT' };
      storage = { status: 'unavailable', error: 'TIMEOUT' };
    }

    const durationMs = Math.round(performance.now() - start);

    const postgresOk = postgres.status === 'ok';
    const valkeyOk = valkey.status === 'ok';
    const storageOk = storage.status === 'ok' || storage.status === 'disabled';

    let status: ReadinessStatus;
    if (!postgresOk || !valkeyOk) {
      status = 'unavailable';
    } else if (!storageOk) {
      status = 'degraded';
    } else {
      status = 'ok';
    }

    if (this.previousStatus !== null && this.previousStatus !== status) {
      this.logger.warn(`Readiness state changed from ${this.previousStatus} to ${status}`);
    }
    this.previousStatus = status;

    return {
      service: 'havefolio-api',
      status,
      dependencies: {
        postgres,
        valkey,
        storage,
      },
      durationMs,
    };
  }

  async onModuleDestroy(): Promise<void> {
    await this.pgPool?.end().catch(() => undefined);
    this.valkeyClient?.disconnect();
  }
}
