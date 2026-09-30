import { Injectable, ServiceUnavailableException, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createDatabase, mediaAttachments } from '@havefolio/db';
import { and, asc, eq, inArray, lt, ne } from 'drizzle-orm';
import { Pool } from 'pg';
import type { StoredAsset } from './storage.js';

export type Attachment = typeof mediaAttachments.$inferSelect;
export type PendingAttachment = Pick<
  Attachment,
  | 'id'
  | 'ownerId'
  | 'kind'
  | 'objectKey'
  | 'resourceType'
  | 'format'
  | 'originalFilename'
  | 'mimeType'
  | 'byteSize'
  | 'checksum'
>;
export abstract class AttachmentRepository {
  abstract insertPending(input: PendingAttachment): Promise<void>;
  abstract findOwned(ownerId: string, id: string): Promise<Attachment | undefined>;
  abstract markReady(
    ownerId: string,
    id: string,
    asset: StoredAsset,
  ): Promise<Attachment | undefined>;
  abstract markDeleting(row: Attachment): Promise<Attachment | undefined>;
  abstract markDeleted(ownerId: string, id: string): Promise<void>;
  abstract hasChildren(ownerId: string, id: string): Promise<boolean>;
  abstract recoveryCandidates(before: Date): Promise<Attachment[]>;
}

@Injectable()
export class DatabaseAttachmentRepository extends AttachmentRepository implements OnModuleDestroy {
  private readonly pool: Pool | undefined;
  private readonly database: ReturnType<typeof createDatabase> | undefined;

  constructor(config: ConfigService) {
    super();
    if (config.get<boolean>('MEDIA_STORAGE_ENABLED', false)) {
      this.pool = new Pool({
        connectionString: config.getOrThrow<string>('DATABASE_URL'),
        max: 3,
        connectionTimeoutMillis: 5000,
        idleTimeoutMillis: 10000,
        statement_timeout: 5000,
      });
      this.pool.on('error', () => undefined); // Never log a connection string or SQL payload.
      this.database = createDatabase(this.pool);
    }
  }

  private async run<T>(
    operation: (database: ReturnType<typeof createDatabase>) => Promise<T>,
  ): Promise<T> {
    if (!this.database) throw new ServiceUnavailableException('MEDIA_STORAGE_DISABLED');
    try {
      return await operation(this.database);
    } catch {
      throw new ServiceUnavailableException('MEDIA_METADATA_UNAVAILABLE');
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool?.end();
  }

  async insertPending(input: PendingAttachment): Promise<void> {
    await this.run(async (db) => {
      await db.insert(mediaAttachments).values({ ...input, variant: 'original' });
    });
  }

  async findOwned(ownerId: string, id: string): Promise<Attachment | undefined> {
    return this.run(
      async (db) =>
        (
          await db
            .select()
            .from(mediaAttachments)
            .where(and(eq(mediaAttachments.ownerId, ownerId), eq(mediaAttachments.id, id)))
            .limit(1)
        )[0],
    );
  }

  async markReady(
    ownerId: string,
    id: string,
    asset: StoredAsset,
  ): Promise<Attachment | undefined> {
    return this.run(
      async (db) =>
        (
          await db
            .update(mediaAttachments)
            .set({
              state: 'ready',
              providerAssetId: asset.assetId,
              providerVersion: asset.version,
              width: asset.width,
              height: asset.height,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(mediaAttachments.ownerId, ownerId),
                eq(mediaAttachments.id, id),
                eq(mediaAttachments.state, 'pending'),
              ),
            )
            .returning()
        )[0],
    );
  }

  async markDeleting(row: Attachment): Promise<Attachment | undefined> {
    return this.run(
      async (db) =>
        (
          await db
            .update(mediaAttachments)
            .set({ state: 'deleting', updatedAt: new Date() })
            .where(
              and(
                eq(mediaAttachments.ownerId, row.ownerId),
                eq(mediaAttachments.id, row.id),
                eq(mediaAttachments.state, row.state),
                eq(mediaAttachments.updatedAt, row.updatedAt),
              ),
            )
            .returning()
        )[0],
    );
  }

  async markDeleted(ownerId: string, id: string): Promise<void> {
    await this.run(async (db) => {
      await db
        .update(mediaAttachments)
        .set({
          state: 'deleted',
          originalFilename: 'deleted',
          checksum: '0'.repeat(64),
          width: null,
          height: null,
          providerAssetId: null,
          providerVersion: null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(mediaAttachments.ownerId, ownerId),
            eq(mediaAttachments.id, id),
            eq(mediaAttachments.state, 'deleting'),
          ),
        );
    });
  }

  async hasChildren(ownerId: string, id: string): Promise<boolean> {
    return this.run(
      async (db) =>
        (
          await db
            .select({ id: mediaAttachments.id })
            .from(mediaAttachments)
            .where(
              and(
                eq(mediaAttachments.ownerId, ownerId),
                eq(mediaAttachments.parentId, id),
                ne(mediaAttachments.state, 'deleted'),
              ),
            )
            .limit(1)
        ).length > 0,
    );
  }

  async recoveryCandidates(before: Date): Promise<Attachment[]> {
    return this.run(async (db) =>
      db
        .select()
        .from(mediaAttachments)
        .where(
          and(
            inArray(mediaAttachments.state, ['pending', 'deleting', 'deleted']),
            lt(mediaAttachments.updatedAt, before),
          ),
        )
        .orderBy(asc(mediaAttachments.updatedAt))
        .limit(20),
    );
  }
}
