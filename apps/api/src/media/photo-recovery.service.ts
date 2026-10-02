import { Logger, Injectable, type OnModuleInit, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ItemsRepository } from '../items/items.repository.js';
import { MediaService } from './media.service.js';
@Injectable()
export class PhotoRecoveryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PhotoRecoveryService.name);
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  constructor(
    private readonly config: ConfigService,
    private readonly repo: ItemsRepository,
    private readonly media: MediaService,
  ) {}
  onModuleInit(): void {
    if (
      this.config.get<string>('NODE_ENV') !== 'test' &&
      this.config.get<boolean>('MEDIA_STORAGE_ENABLED', false)
    ) {
      this.timer = setInterval(() => void this.tick(), 60_000);
      this.timer.unref();
    }
  }
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.repo.transaction('00000000-0000-4000-8000-000000000000', async (c) => {
        const lease = await c.query<{ locked: boolean }>(
          'SELECT pg_try_advisory_xact_lock(13130014) AS locked',
        );
        if (lease.rows[0]?.locked) {
          const result = await this.media.reconcile();
          if (result.completed || result.failed)
            this.logger.log({ event: 'photo_recovery', component: 'media', ...result });
        }
      });
    } catch {
      this.logger.warn({
        event: 'photo_recovery',
        component: 'media',
        code: 'RECOVERY_UNAVAILABLE',
      });
    } finally {
      this.running = false;
    }
  }
  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
