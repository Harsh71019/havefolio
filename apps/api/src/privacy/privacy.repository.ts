import {
  HttpException,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
  ServiceUnavailableException,
  UnauthorizedException,
  type OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool, types, type PoolClient } from 'pg';
import type { OwnerContext } from '../auth/auth.context.js';
import { exportColumns, exportRow, exportTables, serializeExportRow } from './export-policy.js';
import type { DeletionStatusDto } from './privacy.dto.js';
import type { PrivateMediaStorage, ResourceType } from '../media/storage.js';

@Injectable()
export class PrivacyRepository implements OnModuleDestroy {
  private readonly pool?: Pool;
  constructor(config: ConfigService) {
    if (config.get<string>('DATABASE_URL')) {
      this.pool = new Pool({
        connectionString: config.getOrThrow<string>('DATABASE_URL'),
        max: 3,
        connectionTimeoutMillis: 3000,
        idleTimeoutMillis: 10000,
        statement_timeout: 10000,
        types: {
          getTypeParser: (oid, format): ((value: string) => unknown) =>
            [types.builtins.DATE, types.builtins.JSON, types.builtins.JSONB].includes(oid)
              ? (v: string) => v
              : (types.getTypeParser(oid, format) as (value: string) => unknown),
        },
      });
      this.pool.on('error', () => undefined);
    }
  }
  async transaction<T>(operation: (c: PoolClient) => Promise<T>, readOnly = false): Promise<T> {
    if (!this.pool) throw new ServiceUnavailableException('PRIVACY_UNAVAILABLE');
    const c = await this.pool.connect().catch(() => {
      throw new ServiceUnavailableException('PRIVACY_UNAVAILABLE');
    });
    try {
      await c.query(readOnly ? 'BEGIN ISOLATION LEVEL REPEATABLE READ' : 'BEGIN');
      const result = await operation(c);
      await c.query('COMMIT');
      return result;
    } catch (error) {
      await c.query('ROLLBACK').catch(() => undefined);
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException('PRIVACY_UNAVAILABLE');
    } finally {
      c.release();
    }
  }
  private async context(c: PoolClient, owner: string): Promise<void> {
    await c.query("SELECT set_config('havefolio.owner_id',$1,true)", [owner]);
  }
  private async session(c: PoolClient, owner: OwnerContext, lock: boolean): Promise<void> {
    const result = await c.query(
      `SELECT id FROM users WHERE id=$1 AND deletion_requested_at IS NULL ${lock ? 'FOR UPDATE' : 'FOR SHARE'}`,
      [owner.id],
    );
    if (!result.rowCount) throw new UnauthorizedException('AUTH_REQUIRED');
    const session = await c.query(
      `SELECT id FROM auth_sessions WHERE id=$1 AND owner_id=$2 AND revoked_at IS NULL AND idle_expires_at>clock_timestamp() AND absolute_expires_at>clock_timestamp() ${lock ? 'FOR UPDATE' : ''}`,
      [owner.sessionId, owner.id],
    );
    if (!session.rowCount) throw new UnauthorizedException('AUTH_REQUIRED');
    await this.context(c, owner.id);
  }
  async export(owner: OwnerContext): Promise<string> {
    return this.transaction(async (c) => {
      await this.session(c, owner, false);
      const data: Record<string, string> = {};
      data.owner = JSON.stringify(
        exportRow(
          'users',
          (
            await c.query<Record<string, unknown>>(
              'SELECT id,email,display_name,created_at,updated_at FROM users WHERE id=$1',
              [owner.id],
            )
          ).rows[0]!,
        ),
      );
      let size = 0;
      for (const table of exportTables) {
        const rows: string[] = [];
        // Constants only: never interpolate request input into an SQL identifier.
        await c.query(
          `DECLARE export_rows NO SCROLL CURSOR FOR SELECT ${exportColumns[table].join(',')} FROM ${table} WHERE owner_id=$1`,
          [owner.id],
        );
        for (;;) {
          const page = await c.query<Record<string, unknown>>('FETCH FORWARD 100 FROM export_rows');
          for (const row of page.rows) {
            const safe = serializeExportRow(table, row);
            size += Buffer.byteLength(safe);
            if (size > 16 * 1024 * 1024) throw new PayloadTooLargeException('EXPORT_TOO_LARGE');
            rows.push(safe);
          }
          if (page.rows.length < 100) break;
        }
        await c.query('CLOSE export_rows');
        data[table] = '[' + rows.join(',') + ']';
      }
      const result = JSON.stringify({
        format: 'havefolio-private-export',
        version: 1,
        exportedAt: new Date().toISOString(),
        attachments: 'metadata_only',
        money: 'integer minor units as decimal strings; ISO currency retained',
      });
      const complete =
        result.slice(0, -1) +
        ',"data":{' +
        Object.entries(data)
          .map(([key, value]) => JSON.stringify(key) + ':' + value)
          .join(',') +
        '}}';
      if (Buffer.byteLength(complete) > 16 * 1024 * 1024)
        throw new PayloadTooLargeException('EXPORT_TOO_LARGE');
      return complete;
    }, true);
  }
  async admit(
    owner: OwnerContext,
    receiptHash: string,
    verify: (hash: string | null) => Promise<boolean>,
  ): Promise<Array<{ desireId: string; scheduleVersion: number }>> {
    return this.transaction(async (c) => {
      await this.session(c, owner, true);
      const row = (
        await c.query<{ password_hash: string }>('SELECT password_hash FROM users WHERE id=$1', [
          owner.id,
        ])
      ).rows[0];
      if (!(await verify(row?.password_hash ?? null)))
        throw new UnauthorizedException('INVALID_CREDENTIALS');
      // Password verification may outlast a nearly expired session. Recheck at admission.
      await this.session(c, owner, true);
      const request = (
        await c.query<{ id: string }>(
          'INSERT INTO account_deletions(owner_id,receipt_hash) VALUES($1,$2) RETURNING id',
          [owner.id, receiptHash],
        )
      ).rows[0]!;
      // Snapshot before hiding metadata. Only ready means a positively acknowledged completed upload.
      await c.query(
        `INSERT INTO deletion_resources(attachment_id,deletion_id,finality_established) SELECT id,$2,state='ready' FROM media_attachments WHERE owner_id=$1`,
        [owner.id, request.id],
      );
      const reminders = (
        await c.query<{ desireId: string; scheduleVersion: number }>(
          'SELECT desire_id AS "desireId",schedule_version AS "scheduleVersion" FROM desire_reminders WHERE owner_id=$1',
          [owner.id],
        )
      ).rows;
      await c.query('DELETE FROM desire_reminders WHERE owner_id=$1', [owner.id]);
      await c.query(
        'UPDATE auth_sessions SET revoked_at=clock_timestamp() WHERE owner_id=$1 AND revoked_at IS NULL',
        [owner.id],
      );
      await c.query('UPDATE users SET deletion_requested_at=clock_timestamp() WHERE id=$1', [
        owner.id,
      ]);
      return reminders;
    });
  }
  async status(receiptHash: string): Promise<DeletionStatusDto> {
    return this.transaction(async (c) => {
      const row = (
        await c.query<{
          state: DeletionStatusDto['state'];
          completed_at: Date | null;
          remaining: string;
          uncertain: string;
        }>(
          `SELECT d.state,d.completed_at,
        (SELECT count(*) FROM deletion_resources r WHERE r.deletion_id=d.id AND r.cleaned_at IS NULL) AS remaining,
        (SELECT count(*) FROM deletion_resources r WHERE r.deletion_id=d.id AND NOT r.finality_established) AS uncertain
        FROM account_deletions d WHERE receipt_hash=$1 AND (completed_at IS NULL OR completed_at>now()-interval '30 days')`,
          [receiptHash],
        )
      ).rows[0];
      if (!row) throw new NotFoundException('DELETION_NOT_FOUND');
      return {
        state: row.state,
        remainingFiles: Number(row.remaining),
        awaitingFinality: Number(row.uncertain),
        completedAt: row.completed_at?.toISOString() ?? null,
      };
    }, true);
  }
  async reconcile(storage: PrivateMediaStorage): Promise<void> {
    await this.transaction(async (c) => {
      await c.query(
        "DELETE FROM account_deletions WHERE id IN (SELECT id FROM account_deletions WHERE completed_at<now()-interval '30 days' ORDER BY completed_at LIMIT 100)",
      );
      // Row lock leases one request across processes, including provider calls and completion.
      const d = (
        await c.query<{ id: string; owner_id: string }>(
          `SELECT id,owner_id FROM account_deletions WHERE state<>'completed' ORDER BY updated_at,id LIMIT 1 FOR UPDATE SKIP LOCKED`,
        )
      ).rows[0];
      if (!d) return;
      await c.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [d.owner_id]);
      await this.context(c, d.owner_id);
      const resource = (
        await c.query<{ attachment_id: string; object_key: string; resource_type: ResourceType }>(
          `SELECT r.attachment_id,m.object_key,m.resource_type FROM deletion_resources r JOIN media_attachments m ON m.id=r.attachment_id AND m.owner_id=$2
        WHERE r.deletion_id=$1 AND (r.cleaned_at IS NULL OR NOT r.finality_established)
        ORDER BY r.cleaned_at NULLS FIRST,m.parent_id NULLS LAST,r.attachment_id LIMIT 1`,
          [d.id, d.owner_id],
        )
      ).rows[0];
      if (resource) {
        await c.query(
          "UPDATE media_attachments SET state='deleting',updated_at=now() WHERE id=$1 AND owner_id=$2 AND state<>'deleted'",
          [resource.attachment_id, d.owner_id],
        );
        try {
          await storage.delete(resource.object_key, resource.resource_type);
          await c.query(
            "UPDATE media_attachments SET state='deleted',original_filename='deleted',alt_text=NULL,checksum=repeat('0',64),width=NULL,height=NULL,provider_asset_id=NULL,provider_version=NULL,updated_at=now() WHERE id=$1 AND owner_id=$2",
            [resource.attachment_id, d.owner_id],
          );
          await c.query(
            'UPDATE deletion_resources SET cleaned_at=now() WHERE attachment_id=$1 AND deletion_id=$2',
            [resource.attachment_id, d.id],
          );
        } catch {
          await c.query(
            "UPDATE account_deletions SET state='retrying',updated_at=now() WHERE id=$1",
            [d.id],
          );
          return;
        }
      }
      const pending = (
        await c.query<{ uncertain: boolean; pending: boolean }>(
          `SELECT coalesce(bool_or(NOT finality_established),false) AS uncertain,coalesce(bool_or(cleaned_at IS NULL),false) AS pending FROM deletion_resources WHERE deletion_id=$1`,
          [d.id],
        )
      ).rows[0]!;
      if (pending.uncertain || pending.pending) {
        await c.query('UPDATE account_deletions SET state=$2,updated_at=now() WHERE id=$1', [
          d.id,
          pending.uncertain ? 'awaiting_finality' : 'pending',
        ]);
        return;
      }
      await c.query("SELECT set_config('havefolio.erasing_owner_id',$1,true)", [d.owner_id]);
      await c.query('DELETE FROM deletion_resources WHERE deletion_id=$1', [d.id]);
      await c.query('DELETE FROM media_attachments WHERE owner_id=$1 AND parent_id IS NOT NULL', [
        d.owner_id,
      ]);
      await c.query('DELETE FROM media_attachments WHERE owner_id=$1', [d.owner_id]);
      // Parent erasure preserves ordinary append-only guards while cascading private histories.
      for (const table of [
        'desires',
        'goals',
        'items',
        'demo_datasets',
        'subcategories',
        'categories',
        'tags',
      ])
        await c.query(`DELETE FROM ${table} WHERE owner_id=$1`, [d.owner_id]);
      await c.query(
        "UPDATE account_deletions SET owner_id=NULL,state='completed',completed_at=now(),updated_at=now() WHERE id=$1",
        [d.id],
      );
      await c.query('DELETE FROM users WHERE id=$1', [d.owner_id]);
    });
  }
  async onModuleDestroy(): Promise<void> {
    await this.pool?.end();
  }
}
