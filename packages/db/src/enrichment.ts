import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { EnrichmentInput, EnrichmentCandidate } from '@havefolio/domain';
import { enrichmentLimits } from '@havefolio/domain';

export interface EnrichmentClaim {
  id: string;
  ownerId: string;
  itemId: string;
  token: string;
  input: EnrichmentInput;
  attempts: number;
  baseRevision: number;
}
/** Storage identity of a ready private image original; never returned to browsers. */
export interface EnrichmentImage {
  objectKey: string;
  format: 'jpg' | 'png' | 'webp';
  byteSize: number;
  checksum: string;
}
/** All locks use owner -> item -> work, matching manual edit/deletion admission. */
export class EnrichmentStore {
  constructor(private readonly pool: Pool) {}
  /**
   * PER-45: resolves the queued opaque attachment ID strictly within the claimed owner and
   * item. Absent, deleted, PDF or wrong-kind media yields null; callers then fail the work.
   */
  async readyImage(
    ownerId: string,
    itemId: string,
    attachmentId: string,
    kind: 'photo' | 'receipt',
  ): Promise<EnrichmentImage | null> {
    const row = (
      await this.pool.query<{
        object_key: string;
        format: EnrichmentImage['format'];
        byte_size: string | number;
        checksum: string;
      }>(
        `SELECT m.object_key,m.format,m.byte_size,m.checksum FROM media_attachments m
        JOIN users u ON u.id=m.owner_id AND u.deletion_requested_at IS NULL
        WHERE m.id=$1 AND m.owner_id=$2 AND m.item_id=$3 AND m.kind=$4 AND m.variant='original'
        AND m.state='ready' AND m.resource_type='image'`,
        [attachmentId, ownerId, itemId, kind],
      )
    ).rows[0];
    return row
      ? {
          objectKey: row.object_key,
          format: row.format,
          byteSize: Number(row.byte_size),
          checksum: row.checksum,
        }
      : null;
  }
  private async transaction<T>(operation: (c: PoolClient) => Promise<T>): Promise<T> {
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      const result = await operation(c);
      await c.query('COMMIT');
      return result;
    } catch (error) {
      await c.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      c.release();
    }
  }
  async due(): Promise<string[]> {
    return (
      await this.pool.query<{ id: string }>(
        `SELECT w.id FROM enrichment_work w
      JOIN users u ON u.id=w.owner_id WHERE u.deletion_requested_at IS NULL AND
      ((w.state IN ('pending','retry') AND w.next_attempt_at<=now()) OR
       (w.state='processing' AND w.lease_until<=now()))
      ORDER BY w.next_attempt_at,w.id LIMIT $1`,
        [enrichmentLimits.batch],
      )
    ).rows.map((r) => r.id);
  }
  async claim(id: string): Promise<EnrichmentClaim | null> {
    return this.transaction(async (c) => {
      const identity = (
        await c.query<{ owner_id: string; item_id: string }>(
          'SELECT owner_id,item_id FROM enrichment_work WHERE id=$1',
          [id],
        )
      ).rows[0];
      if (!identity) return null;
      const owner = (
        await c.query<{ deletion_requested_at: Date | null }>(
          'SELECT deletion_requested_at FROM users WHERE id=$1 FOR UPDATE',
          [identity.owner_id],
        )
      ).rows[0];
      if (!owner || owner.deletion_requested_at) return null;
      const item = (
        await c.query<{ revision: number }>(
          'SELECT revision FROM items WHERE id=$1 AND owner_id=$2 FOR UPDATE',
          [identity.item_id, identity.owner_id],
        )
      ).rows[0];
      if (!item) return null;
      const w = (
        await c.query<{
          id: string;
          input: EnrichmentInput;
          attempts: number;
          base_revision: number;
        }>(
          `SELECT * FROM enrichment_work WHERE id=$1 AND
        ((state IN ('pending','retry') AND next_attempt_at<=now()) OR (state='processing' AND lease_until<=now())) FOR UPDATE`,
          [id],
        )
      ).rows[0];
      if (!w) return null;
      let stale = item.revision !== w.base_revision;
      if (w.input.kind === 'photo' || w.input.kind === 'receipt') {
        const media = await c.query(
          `SELECT id FROM media_attachments WHERE id=$1 AND owner_id=$2 AND item_id=$3 AND state='ready' AND variant='original' AND kind=$4`,
          [w.input.attachmentId, identity.owner_id, identity.item_id, w.input.kind],
        );
        stale ||= media.rowCount !== 1;
      }
      if (stale || w.attempts >= enrichmentLimits.attempts) {
        await c.query(
          `UPDATE enrichment_work SET state=$2,lease_token=null,lease_until=null,updated_at=now(),failure_code=$3 WHERE id=$1`,
          [id, stale ? 'stale' : 'failed', stale ? null : 'PROVIDER_FAILED'],
        );
        return null;
      }
      const token = randomUUID();
      await c.query(
        `UPDATE enrichment_work SET state='processing',attempts=attempts+1,lease_token=$2,lease_until=now()+interval '30 seconds',updated_at=now() WHERE id=$1`,
        [id, token],
      );
      return {
        id,
        ownerId: identity.owner_id,
        itemId: identity.item_id,
        token,
        input: w.input,
        attempts: w.attempts + 1,
        baseRevision: w.base_revision,
      };
    });
  }
  async finish(
    claim: EnrichmentClaim,
    outcome: 'succeeded' | 'failed' | 'unconfigured' | 'circuit',
    candidates: EnrichmentCandidate[] = [],
  ): Promise<void> {
    await this.transaction(async (c) => {
      const owner = (
        await c.query<{ deletion_requested_at: Date | null }>(
          'SELECT deletion_requested_at FROM users WHERE id=$1 FOR UPDATE',
          [claim.ownerId],
        )
      ).rows[0];
      if (!owner || owner.deletion_requested_at) return;
      const item = (
        await c.query<{ revision: number }>(
          'SELECT revision FROM items WHERE owner_id=$1 AND id=$2 FOR UPDATE',
          [claim.ownerId, claim.itemId],
        )
      ).rows[0];
      if (!item) return;
      const stale = item.revision !== claim.baseRevision;
      const retry =
        (outcome === 'failed' || outcome === 'circuit') &&
        claim.attempts < enrichmentLimits.attempts;
      await c.query(
        `UPDATE enrichment_work SET state=$3,candidates=$4::jsonb,
        failure_code=$5,lease_token=null,lease_until=null,next_attempt_at=now()+($6*interval '1 second'),updated_at=now()
        WHERE id=$1 AND lease_token=$2 AND state='processing'`,
        [
          claim.id,
          claim.token,
          stale ? 'stale' : retry ? 'retry' : outcome === 'circuit' ? 'failed' : outcome,
          JSON.stringify(stale ? [] : candidates),
          stale
            ? null
            : outcome === 'unconfigured'
              ? 'PROVIDER_UNCONFIGURED'
              : outcome === 'succeeded'
                ? null
                : 'PROVIDER_FAILED',
          outcome === 'circuit' ? 60 : 30 * claim.attempts,
        ],
      );
    });
  }
}
