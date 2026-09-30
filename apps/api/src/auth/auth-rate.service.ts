import {
  HttpException,
  Injectable,
  ServiceUnavailableException,
  type OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'node:crypto';
import { Redis } from 'ioredis';

// Both counters and their TTLs are atomic; no attacker-controlled account-wide lockout.
export const RATE_SCRIPT = `
local counts = {}
for i, key in ipairs(KEYS) do
  local count = redis.call('INCR', key)
  if count == 1 then redis.call('EXPIRE', key, ARGV[1]) end
  counts[i] = count
end
return counts`;

@Injectable()
export class AuthRateService implements OnModuleDestroy {
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
  keys(action: 'login' | 'register', source: string, email: string): [string, string] {
    const secret = this.config.get<string>('AUTH_RATE_KEY_SECRET');
    if (!secret) throw new ServiceUnavailableException('AUTH_UNAVAILABLE');
    const digest = (value: string): string =>
      createHmac('sha256', secret).update(value).digest('hex');
    const environment =
      this.config.get<string>('NODE_ENV') === 'development'
        ? 'dev'
        : this.config.get<string>('NODE_ENV');
    const prefix = this.config.get<string>('VALKEY_PREFIX', `havefolio:${environment}`);
    return [
      `${prefix}:auth:${action}:source:${digest(source)}`,
      `${prefix}:auth:${action}:account-source:${digest(JSON.stringify([source, email]))}`,
    ];
  }
  async check(action: 'login' | 'register', source: string, email: string): Promise<void> {
    if (!this.client) throw new ServiceUnavailableException('AUTH_UNAVAILABLE');
    let counts: number[];
    try {
      this.connected ??= this.client.connect();
      await this.connected;
      counts = (await this.client.eval(
        RATE_SCRIPT,
        2,
        ...this.keys(action, source, email),
        this.config.getOrThrow<number>('AUTH_RATE_WINDOW_SECONDS'),
      )) as number[];
    } catch {
      throw new ServiceUnavailableException('AUTH_UNAVAILABLE');
    }
    if (
      counts[0]! > this.config.getOrThrow<number>('AUTH_RATE_SOURCE_LIMIT') ||
      counts[1]! > this.config.getOrThrow<number>('AUTH_RATE_ACCOUNT_SOURCE_LIMIT')
    )
      throw new HttpException('AUTH_RATE_LIMITED', 429);
  }
  onModuleDestroy(): void {
    this.client?.disconnect();
  }
}
