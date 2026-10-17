import type { WorkerEnvironment } from '@havefolio/config';
import { EventLogger } from '@havefolio/logging';
import { Inject, Injectable } from '@nestjs/common';
import { WORKER_ENVIRONMENT } from '../worker.constants.js';
import { RemindersRepository } from './reminders.repository.js';

@Injectable()
export class NtfyNotifierService {
  constructor(
    @Inject(WORKER_ENVIRONMENT)
    private readonly environment: WorkerEnvironment,
    private readonly repository: RemindersRepository,
    private readonly logger: EventLogger,
  ) {}

  isEnabled(): boolean {
    return this.environment.NTFY_ENABLED && Boolean(this.environment.NTFY_ENDPOINT);
  }

  async deliver(notificationId: string): Promise<void> {
    if (!this.isEnabled()) return;
    if (!(await this.repository.claimNtfy(notificationId))) return;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    timer.unref();
    try {
      const response = await fetch(this.environment.NTFY_ENDPOINT!, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          Title: 'Havefolio reminder',
          Tags: 'hourglass_flowing_sand',
          Priority: 'default',
          ...(this.environment.NTFY_TOKEN
            ? { Authorization: `Bearer ${this.environment.NTFY_TOKEN}` }
            : {}),
        },
        body: 'A waiting period is ready for review in Havefolio.',
        signal: controller.signal,
      });
      if (!response.ok) throw new Error('NTFY_DELIVERY_FAILED');
      await this.repository.markNtfySent(notificationId);
      this.logger.emit('info', {
        event: 'reminder_notification_sent',
        component: 'notifications',
        operation: 'ntfy',
      });
    } catch (error) {
      await this.repository.markNtfyFailed(notificationId).catch(() => undefined);
      this.logger.emit('warn', {
        event: 'reminder_notification_retry',
        component: 'notifications',
        operation: 'ntfy',
        category: 'dependency_unavailable',
        code: 'NTFY_DELIVERY_FAILED',
      });
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}
