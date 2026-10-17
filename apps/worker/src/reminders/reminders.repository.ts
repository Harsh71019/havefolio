import type { WorkerEnvironment } from '@havefolio/config';
import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { Pool, type PoolClient } from 'pg';
import { WORKER_ENVIRONMENT } from '../worker.constants.js';

export interface ReminderIntent {
  desireId: string;
  scheduleVersion: number;
  scheduledFor: Date;
}

export interface ReminderDelivery {
  status: 'delivered' | 'stale' | 'early';
  notificationId?: string;
}

interface ReminderRow {
  desire_id: string;
  schedule_version: number;
  scheduled_for: Date;
  state: 'pending' | 'scheduled' | 'delivered';
}

@Injectable()
export class RemindersRepository implements OnModuleDestroy {
  private readonly pool: Pool;

  constructor(
    @Inject(WORKER_ENVIRONMENT)
    environment: WorkerEnvironment,
  ) {
    if (!environment.DATABASE_URL) throw new Error('REMINDER_DATABASE_UNAVAILABLE');
    this.pool = new Pool({
      connectionString: environment.DATABASE_URL,
      max: 3,
      connectionTimeoutMillis: 3000,
      idleTimeoutMillis: 10000,
      statement_timeout: 5000,
    });
    this.pool.on('error', () => undefined);
  }

  private async transaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await operation(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async listActive(limit = 500): Promise<ReminderIntent[]> {
    const result = await this.pool.query<ReminderRow>(
      `SELECT desire_id,schedule_version,scheduled_for,state
       FROM desire_reminders
       WHERE state IN ('pending','scheduled')
       ORDER BY scheduled_for,desire_id
       LIMIT $1`,
      [Math.min(Math.max(limit, 1), 500)],
    );
    return result.rows.map((row) => ({
      desireId: row.desire_id,
      scheduleVersion: row.schedule_version,
      scheduledFor: row.scheduled_for,
    }));
  }

  async markScheduled(intent: ReminderIntent): Promise<void> {
    await this.pool.query(
      `UPDATE desire_reminders
       SET state='scheduled',last_enqueued_at=now(),updated_at=now()
       WHERE desire_id=$1 AND schedule_version=$2 AND scheduled_for=$3 AND state<>'delivered'`,
      [intent.desireId, intent.scheduleVersion, intent.scheduledFor],
    );
  }

  async deliver(intent: ReminderIntent, now = new Date()): Promise<ReminderDelivery> {
    return this.transaction(async (client) => {
      const reminder = (
        await client.query<ReminderRow>(
          `SELECT desire_id,schedule_version,scheduled_for,state
           FROM desire_reminders
           WHERE desire_id=$1
           FOR UPDATE`,
          [intent.desireId],
        )
      ).rows[0];
      if (
        !reminder ||
        reminder.schedule_version !== intent.scheduleVersion ||
        reminder.scheduled_for.getTime() !== intent.scheduledFor.getTime()
      ) {
        return { status: 'stale' };
      }
      if (reminder.scheduled_for.getTime() > now.getTime()) return { status: 'early' };

      const notification = await client.query<{ id: string }>(
        `INSERT INTO notifications(owner_id,desire_id,type,reminder_version,occurred_at)
         SELECT owner_id,desire_id,'desire_wait_ended',$2,scheduled_for
         FROM desire_reminders
         WHERE desire_id=$1 AND schedule_version=$2
         ON CONFLICT(desire_id,reminder_version,type)
         DO UPDATE SET updated_at=notifications.updated_at
         RETURNING id`,
        [intent.desireId, intent.scheduleVersion],
      );
      const notificationId = notification.rows[0]?.id;
      if (!notificationId) throw new Error('REMINDER_DELIVERY_UNAVAILABLE');

      await client.query(
        `UPDATE desire_reminders
         SET state='delivered',delivered_at=coalesce(delivered_at,$3),updated_at=now()
         WHERE desire_id=$1 AND schedule_version=$2`,
        [intent.desireId, intent.scheduleVersion, now],
      );
      return { status: 'delivered', notificationId };
    });
  }

  async claimNtfy(notificationId: string): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE notifications
       SET ntfy_state='sending',ntfy_attempts=ntfy_attempts+1,ntfy_claimed_at=now(),updated_at=now()
       WHERE id=$1
         AND EXISTS (SELECT 1 FROM desire_reminders r WHERE r.desire_id=notifications.desire_id AND r.schedule_version=notifications.reminder_version)
         AND ntfy_attempts < 20
         AND (ntfy_state IN ('pending','failed') OR (ntfy_state='sending' AND ntfy_claimed_at < now()-interval '10 minutes'))`,
      [notificationId],
    );
    return result.rowCount === 1;
  }

  async markNtfySent(notificationId: string): Promise<void> {
    await this.pool.query(
      `UPDATE notifications
       SET ntfy_state='sent',ntfy_claimed_at=null,ntfy_sent_at=now(),updated_at=now()
       WHERE id=$1 AND ntfy_state='sending'`,
      [notificationId],
    );
  }

  async markNtfyFailed(notificationId: string): Promise<void> {
    await this.pool.query(
      `UPDATE notifications
       SET ntfy_state='failed',ntfy_claimed_at=null,updated_at=now()
       WHERE id=$1 AND ntfy_state='sending'`,
      [notificationId],
    );
  }

  async listPendingNtfy(limit = 50): Promise<string[]> {
    const result = await this.pool.query<{ id: string }>(
      `SELECT id FROM notifications
       WHERE EXISTS (SELECT 1 FROM desire_reminders r WHERE r.desire_id=notifications.desire_id AND r.schedule_version=notifications.reminder_version)
         AND ntfy_attempts < 20
         AND (ntfy_state IN ('pending','failed') OR (ntfy_state='sending' AND ntfy_claimed_at < now()-interval '10 minutes'))
       ORDER BY created_at,id
       LIMIT $1`,
      [Math.min(Math.max(limit, 1), 50)],
    );
    return result.rows.map((row) => row.id);
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
