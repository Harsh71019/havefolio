import {
  HttpException,
  Injectable,
  ServiceUnavailableException,
  type OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'node:crypto';
import { Redis } from 'ioredis';

export const UPLOAD_RATE_SCRIPT = `
local counts = {}
for i, key in ipairs(KEYS) do
  local count = redis.call('INCR', key)
  if count == 1 then redis.call('EXPIRE', key, ARGV[1]) end
  counts[i] = count
end
return counts`;

@Injectable()
export class UploadRateService implements OnModuleDestroy {
  private readonly client?: Redis;
  private connected?: Promise<unknown>;

  constructor(private readonly config: ConfigService) {
    if (
      config.get<string>('VALKEY_PASSWORD') &&
      config.get<string>('VALKEY_USERNAME') &&
      config.get<string>('AUTH_RATE_KEY_SECRET')
    ) {
      const authentication = config.getOrThrow<string>('VALKEY_PASSWORD');
      this.client = new Redis({
        host: config.getOrThrow<string>('VALKEY_HOST'),
        port: config.getOrThrow<number>('VALKEY_PORT'),
        username: config.getOrThrow<string>('VALKEY_USERNAME'),
        password: authentication,
        db: 0,
        lazyConnect: true,
        enableReadyCheck: false,
        enableOfflineQueue: false,
        maxRetriesPerRequest: 0,
        retryStrategy: () => null,
        connectTimeout: 2000,
        commandTimeout: 2000,
      });
      this.client.on('error', () => undefined);
    }
  }

  keys(ownerId: string, source: string): [string, string] {
    const secret = this.config.get<string>('AUTH_RATE_KEY_SECRET');
    if (!secret) throw new ServiceUnavailableException('MEDIA_STORAGE_UNAVAILABLE');
    const digest = (value: string): string =>
      createHmac('sha256', secret).update(value).digest('hex');
    const environment =
      this.config.get<string>('NODE_ENV') === 'development'
        ? 'dev'
        : this.config.get<string>('NODE_ENV');
    const prefix = this.config.get<string>('VALKEY_PREFIX', `havefolio:${environment}`);
    return [
      `${prefix}:upload:owner:${digest(ownerId)}`,
      `${prefix}:upload:source:${digest(source)}`,
    ];
  }

  async check(ownerId: string, source: string): Promise<void> {
    if (!this.client) {
      if (this.config.get<string>('NODE_ENV') === 'production') {
        throw new ServiceUnavailableException('MEDIA_STORAGE_UNAVAILABLE');
      }
      return;
    }
    let counts: number[];
    try {
      this.connected ??= this.client.connect();
      await this.connected;
      const windowSeconds = this.config.get<number>('UPLOAD_RATE_WINDOW_SECONDS', 60);
      counts = (await this.client.eval(
        UPLOAD_RATE_SCRIPT,
        2,
        ...this.keys(ownerId, source),
        windowSeconds,
      )) as number[];
    } catch {
      throw new ServiceUnavailableException('MEDIA_STORAGE_UNAVAILABLE');
    }
    const ownerLimit = this.config.get<number>('UPLOAD_RATE_LIMIT', 20);
    const sourceLimit = this.config.get<number>('UPLOAD_RATE_SOURCE_LIMIT', 30);
    if (counts[0]! > ownerLimit || counts[1]! > sourceLimit) {
      throw new HttpException('UPLOAD_RATE_LIMITED', 429);
    }
  }

  onModuleDestroy(): void {
    this.client?.disconnect();
  }
}
