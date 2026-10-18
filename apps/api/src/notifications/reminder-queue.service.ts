import type { DesireReminderJobData } from '@havefolio/domain';
import { desireReminderJob, desireReminderJobId, desireReminderQueue } from '@havefolio/domain';
import { correlatedJobData, EventLogger } from '@havefolio/logging';
import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';

export interface ReminderQueueIntent {
  desireId: string;
  scheduleVersion: number;
  scheduledFor: Date;
}

export interface ReminderQueueChange {
  desireId: string;
  current?: ReminderQueueIntent;
  obsoleteVersions: number[];
}

@Injectable()
export class ReminderQueueService implements OnModuleDestroy {
  private readonly queue?: Queue<DesireReminderJobData & { metadata: object }>;

  constructor(
    config: ConfigService,
    private readonly logger: EventLogger,
  ) {
    if (!config.get<boolean>('REMINDER_QUEUE_ENABLED', false)) return;
    const prefix = config.get<string>('VALKEY_PREFIX');
    if (!prefix) return;
    this.queue = new Queue(desireReminderQueue, {
      prefix,
      connection: {
        host: config.get<string>('VALKEY_HOST', 'shared-redis'),
        port: config.get<number>('VALKEY_PORT', 6379),
        username: config.get<string>('VALKEY_USERNAME'),
        password: config.get<string>('VALKEY_PASSWORD'),
        db: config.get<number>('VALKEY_DATABASE', 0),
        lazyConnect: true,
        enableOfflineQueue: false,
        maxRetriesPerRequest: 0,
        retryStrategy: () => null,
        connectTimeout: 750,
      },
    });
    this.queue.on('error', () => undefined);
  }

  async apply(change: ReminderQueueChange): Promise<void> {
    if (!this.queue) return;
    try {
      for (const version of new Set(change.obsoleteVersions)) {
        await this.queue.remove(desireReminderJobId(change.desireId, version));
      }
      const current = change.current;
      if (!current) return;
      const data = correlatedJobData({
        desireId: current.desireId,
        scheduleVersion: current.scheduleVersion,
        scheduledFor: current.scheduledFor.toISOString(),
      });
      await this.queue.add(desireReminderJob, data, {
        jobId: desireReminderJobId(current.desireId, current.scheduleVersion),
        delay: Math.max(0, current.scheduledFor.getTime() - Date.now()),
        attempts: 5,
        backoff: { type: 'exponential', delay: 30_000 },
        removeOnComplete: true,
        removeOnFail: { age: 7 * 24 * 60 * 60, count: 1000 },
      });
    } catch {
      this.logger.emit('warn', {
        event: 'reminder_dispatch_deferred',
        component: 'notifications',
        operation: 'schedule',
        category: 'dependency_unavailable',
        code: 'VALKEY_UNAVAILABLE',
      });
    }
  }

  async cancelForOwner(
    reminders: Array<{ desireId: string; scheduleVersion: number }>,
  ): Promise<void> {
    if (!this.queue) return;
    try {
      for (const reminder of reminders) {
        await this.queue.remove(desireReminderJobId(reminder.desireId, reminder.scheduleVersion));
      }
    } catch {
      this.logger.emit('warn', {
        event: 'reminder_cancel_deferred',
        component: 'notifications',
        operation: 'cancel',
        category: 'dependency_unavailable',
        code: 'VALKEY_UNAVAILABLE',
      });
    }
  }

  async reenqueueForOwner(
    reminders: Array<{ desireId: string; scheduleVersion: number; scheduledFor: Date }>,
  ): Promise<void> {
    if (!this.queue) return;
    try {
      for (const reminder of reminders) {
        const data = correlatedJobData({
          desireId: reminder.desireId,
          scheduleVersion: reminder.scheduleVersion,
          scheduledFor: reminder.scheduledFor.toISOString(),
        });
        await this.queue.add(desireReminderJob, data, {
          jobId: desireReminderJobId(reminder.desireId, reminder.scheduleVersion),
          delay: Math.max(0, reminder.scheduledFor.getTime() - Date.now()),
          attempts: 5,
          backoff: { type: 'exponential', delay: 30_000 },
          removeOnComplete: true,
          removeOnFail: { age: 7 * 24 * 60 * 60, count: 1000 },
        });
      }
    } catch {
      this.logger.emit('warn', {
        event: 'reminder_dispatch_deferred',
        component: 'notifications',
        operation: 'schedule',
        category: 'dependency_unavailable',
        code: 'VALKEY_UNAVAILABLE',
      });
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue?.close().catch(() => undefined);
  }
}
