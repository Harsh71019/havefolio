import {
  Injectable,
  HttpException,
  ServiceUnavailableException,
  type OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool, type PoolClient } from 'pg';
@Injectable()
export class ItemsRepository implements OnModuleDestroy {
  private readonly pool?: Pool;
  constructor(config: ConfigService) {
    const connectionString = config.get<string>('DATABASE_URL');
    if (connectionString) {
      this.pool = new Pool({
        connectionString,
        max: 3,
        connectionTimeoutMillis: 3000,
        idleTimeoutMillis: 10000,
        statement_timeout: 5000,
      });
      this.pool.on('error', () => undefined);
    }
  }
  async transaction<T>(owner: string, operation: (client: PoolClient) => Promise<T>): Promise<T> {
    if (!this.pool) throw new ServiceUnavailableException('ITEMS_UNAVAILABLE');
    let client: PoolClient | undefined;
    try {
      client = await this.pool.connect();
      await client.query('BEGIN');
      await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [owner]);
      const result = await operation(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client?.query('ROLLBACK').catch(() => undefined);
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException('ITEMS_UNAVAILABLE');
    } finally {
      client?.release();
    }
  }
  async onModuleDestroy(): Promise<void> {
    await this.pool?.end();
  }
}
