import {
  ConflictException,
  HttpException,
  Injectable,
  ServiceUnavailableException,
  type OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool, type PoolClient } from 'pg';
import type { OwnerPreferencesDto, SettingsDemoStatusDto } from './settings.dto.js';

interface SettingsRow {
  default_currency: string;
  notify_in_app: boolean;
  notify_ntfy: boolean;
  revision: number;
  updated_at: Date;
}

export interface StoredActiveReminder {
  desireId: string;
  scheduleVersion: number;
  scheduledFor: Date;
}

@Injectable()
export class SettingsRepository implements OnModuleDestroy {
  private readonly pool?: Pool;
  private closed = false;

  constructor(config: ConfigService) {
    if (config.get<string>('DATABASE_URL')) {
      this.pool = new Pool({
        connectionString: config.getOrThrow<string>('DATABASE_URL'),
        max: 3,
        connectionTimeoutMillis: 3000,
        idleTimeoutMillis: 10000,
        statement_timeout: 5000,
      });
      this.pool.on('error', () => undefined);
    }
  }

  private async run<T>(
    ownerId: string,
    operation: (client: PoolClient) => Promise<T>,
    transaction = false,
  ): Promise<T> {
    if (!this.pool) throw new ServiceUnavailableException('SETTINGS_UNAVAILABLE');
    let client: PoolClient | undefined;
    try {
      client = await this.pool.connect();
      if (transaction) await client.query('BEGIN');
      await client.query("SELECT set_config('havefolio.owner_id', $1, true)", [ownerId]);
      const result = await operation(client);
      if (transaction) await client.query('COMMIT');
      return result;
    } catch (error) {
      if (transaction && client) await client.query('ROLLBACK').catch(() => undefined);
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException('SETTINGS_UNAVAILABLE');
    } finally {
      client?.release();
    }
  }

  async readPreferences(ownerId: string): Promise<OwnerPreferencesDto> {
    return this.run(ownerId, async (client) => {
      const result = await client.query<SettingsRow>(
        `SELECT default_currency, notify_in_app, notify_ntfy, revision, updated_at
         FROM owner_settings
         WHERE owner_id = $1`,
        [ownerId],
      );
      const row = result.rows[0];
      if (!row) {
        return {
          defaultCurrency: 'INR',
          notifyInApp: true,
          notifyNtfy: true,
          revision: 1,
          updatedAt: new Date().toISOString(),
        };
      }
      return {
        defaultCurrency: row.default_currency,
        notifyInApp: row.notify_in_app,
        notifyNtfy: row.notify_ntfy,
        revision: row.revision,
        updatedAt: row.updated_at.toISOString(),
      };
    });
  }

  async updatePreferences(
    ownerId: string,
    revision: number,
    updates: {
      defaultCurrency?: string | undefined;
      notifyInApp?: boolean | undefined;
      notifyNtfy?: boolean | undefined;
    },
  ): Promise<{ preferences: OwnerPreferencesDto; changedInApp: boolean }> {
    return this.run(
      ownerId,
      async (client) => {
        // Lock user row to serialize concurrent preference updates
        await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [ownerId]);

        const existing = (
          await client.query<SettingsRow>(
            `SELECT default_currency, notify_in_app, notify_ntfy, revision, updated_at
           FROM owner_settings
           WHERE owner_id = $1
           FOR UPDATE`,
            [ownerId],
          )
        ).rows[0];

        let row: SettingsRow;
        let previousInApp = true;

        if (!existing) {
          if (revision !== 1) {
            throw new ConflictException('STALE_SETTINGS_REVISION');
          }
          const insert = await client.query<SettingsRow>(
            `INSERT INTO owner_settings (owner_id, default_currency, notify_in_app, notify_ntfy, revision, updated_at)
           VALUES ($1, coalesce($2, 'INR'), coalesce($3, true), coalesce($4, true), 2, now())
           RETURNING default_currency, notify_in_app, notify_ntfy, revision, updated_at`,
            [
              ownerId,
              updates.defaultCurrency ?? null,
              updates.notifyInApp ?? null,
              updates.notifyNtfy ?? null,
            ],
          );
          row = insert.rows[0]!;
        } else {
          if (existing.revision !== revision) {
            throw new ConflictException('STALE_SETTINGS_REVISION');
          }
          previousInApp = existing.notify_in_app;

          const update = await client.query<SettingsRow>(
            `UPDATE owner_settings
           SET default_currency = coalesce($2, default_currency),
               notify_in_app = coalesce($3, notify_in_app),
               notify_ntfy = coalesce($4, notify_ntfy),
               revision = revision + 1,
               updated_at = now()
           WHERE owner_id = $1 AND revision = $5
           RETURNING default_currency, notify_in_app, notify_ntfy, revision, updated_at`,
            [
              ownerId,
              updates.defaultCurrency ?? null,
              updates.notifyInApp ?? null,
              updates.notifyNtfy ?? null,
              revision,
            ],
          );
          if (update.rowCount !== 1) {
            throw new ConflictException('STALE_SETTINGS_REVISION');
          }
          row = update.rows[0]!;
        }

        return {
          preferences: {
            defaultCurrency: row.default_currency,
            notifyInApp: row.notify_in_app,
            notifyNtfy: row.notify_ntfy,
            revision: row.revision,
            updatedAt: row.updated_at.toISOString(),
          },
          changedInApp: previousInApp !== row.notify_in_app,
        };
      },
      true,
    );
  }

  async listActiveReminders(ownerId: string): Promise<StoredActiveReminder[]> {
    return this.run(ownerId, async (client) => {
      const result = await client.query<{
        desire_id: string;
        schedule_version: number;
        scheduled_for: Date;
      }>(
        `SELECT desire_id, schedule_version, scheduled_for
         FROM desire_reminders
         WHERE owner_id = $1 AND state IN ('pending', 'scheduled')`,
        [ownerId],
      );
      return result.rows.map((r) => ({
        desireId: r.desire_id,
        scheduleVersion: r.schedule_version,
        scheduledFor: r.scheduled_for,
      }));
    });
  }

  async getDemoStatus(ownerId: string): Promise<SettingsDemoStatusDto> {
    return this.run(ownerId, async (client) => {
      const result = await client.query<{
        demoItemCount: number;
        genuineItemCount: number;
        triedDemo: boolean;
        removedDemo: boolean;
      }>(
        `SELECT
          (SELECT count(*)::int FROM items WHERE owner_id=$1 AND demo_dataset_id IS NOT NULL) AS "demoItemCount",
          (SELECT count(*)::int FROM items WHERE owner_id=$1 AND demo_dataset_id IS NULL) AS "genuineItemCount",
          coalesce((SELECT tried_demo FROM owner_onboarding WHERE owner_id=$1), false) AS "triedDemo",
          coalesce((SELECT removed_demo FROM owner_onboarding WHERE owner_id=$1), false) AS "removedDemo"`,
        [ownerId],
      );
      return (
        result.rows[0] ?? {
          demoItemCount: 0,
          genuineItemCount: 0,
          triedDemo: false,
          removedDemo: false,
        }
      );
    });
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.closed) {
      this.closed = true;
      await this.pool?.end();
    }
  }
}
