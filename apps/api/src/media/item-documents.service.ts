import {
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { ItemsRepository } from '../items/items.repository.js';
import { MediaService } from './media.service.js';
import { PrivateMediaStorage } from './storage.js';
import { DocumentProcessor, DOCUMENT_LIMITS } from './document-processing.js';
import type { DocumentKind } from './document-multipart.js';
import type { PhotoInput } from './photo-processing.js';
import type { DocumentDto, DocumentSnapshotDto } from './item-documents.dto.js';
interface Row {
  id: string;
  owner_id: string;
  item_id: string;
  kind: DocumentKind;
  state: string;
  variant: string;
  checksum: string;
  mime_type: string;
  byte_size: string;
  width: number | null;
  height: number | null;
  object_key: string;
  resource_type: 'image' | 'raw';
  format: 'webp' | 'pdf';
}
@Injectable()
export class ItemDocumentsService {
  private activeDownloads = 0;
  constructor(
    private readonly repo: ItemsRepository,
    private readonly processor: DocumentProcessor,
    private readonly storage: PrivateMediaStorage,
    private readonly media: MediaService,
    private readonly config: ConfigService,
  ) {}
  private async item(
    c: PoolClient,
    owner: string,
    item: string,
    revision?: number,
  ): Promise<number> {
    const row = (
      await c.query<{ revision: number }>(
        'SELECT revision FROM items WHERE owner_id=$1 AND id=$2 FOR UPDATE',
        [owner, item],
      )
    ).rows[0];
    if (!row) throw new NotFoundException('ITEM_NOT_FOUND');
    if (revision !== undefined && revision !== row.revision)
      throw new ConflictException('STALE_ITEM_REVISION');
    return row.revision;
  }
  private details(row: Row): DocumentDto {
    return {
      id: row.id,
      kind: row.kind,
      mimeType: row.mime_type,
      byteSize: Number(row.byte_size),
      width: row.width,
      height: row.height,
    };
  }
  async authorize(owner: string, item: string): Promise<void> {
    if (!this.config.get<boolean>('MEDIA_STORAGE_ENABLED', false))
      throw new ServiceUnavailableException('MEDIA_STORAGE_DISABLED');
    await this.repo.transaction(owner, (c) => this.item(c, owner, item));
  }
  async snapshot(owner: string, item: string): Promise<DocumentSnapshotDto> {
    return this.repo.transaction(owner, async (c) => {
      const revision = await this.item(c, owner, item);
      const rows = (
        await c.query<Row>(
          "SELECT * FROM media_attachments WHERE owner_id=$1 AND item_id=$2 AND kind IN ('receipt','warranty') AND variant='original' AND state='ready' ORDER BY id LIMIT 16",
          [owner, item],
        )
      ).rows;
      return { revision, documents: rows.map((r) => this.details(r)) };
    });
  }
  async upload(
    owner: string,
    item: string,
    uploadId: string,
    kind: DocumentKind,
    input: PhotoInput,
  ): Promise<DocumentDto> {
    if (!['receipt', 'warranty'].includes(kind))
      throw new ConflictException('DOCUMENT_KIND_REQUIRED');
    const output = await this.processor.process(input);
    // Owner-scoped idempotency avoids cross-owner Upload-Id collisions.
    const hex = createHash('sha256').update(`document:${owner}:${uploadId}`).digest('hex');
    const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
    const key = `havefolio/${this.config.get<string>('NODE_ENV', 'development')}/${id}${output.format === 'pdf' ? '.pdf' : ''}`;
    try {
      const prior = await this.repo.transaction(owner, async (c) => {
        await this.item(c, owner, item);
        const row = (await c.query<Row>('SELECT * FROM media_attachments WHERE id=$1', [id]))
          .rows[0];
        if (row) {
          if (row.owner_id !== owner || row.item_id !== item || row.kind !== kind)
            throw new ConflictException('DOCUMENT_UPLOAD_ID_REUSED');
          if (row.state === 'deleted') throw new ConflictException('DOCUMENT_UPLOAD_RECOVERED');
          if (row.checksum !== output.checksum)
            throw new ConflictException('DOCUMENT_UPLOAD_ID_REUSED');
          if (row.state !== 'ready') throw new ConflictException('DOCUMENT_UPLOAD_PENDING');
          return row;
        }
        const usage = (
          await c.query<{ count: string; bytes: string }>(
            "SELECT count(*) FILTER (WHERE item_id=$2 AND kind IN ('receipt','warranty') AND variant='original') AS count,coalesce(sum(byte_size),0)::text AS bytes FROM media_attachments WHERE owner_id=$1 AND state<>'deleted'",
            [owner, item],
          )
        ).rows[0]!;
        if (
          Number(usage.count) >= DOCUMENT_LIMITS.perItem ||
          Number(usage.bytes) + output.bytes.length > 2 * 1024 ** 3
        )
          throw new ConflictException('DOCUMENT_QUOTA_EXCEEDED');
        await c.query('SELECT pg_advisory_xact_lock(13130013)');
        const total = (
          await c.query<{ bytes: string }>(
            "SELECT coalesce(sum(byte_size),0)::text AS bytes FROM media_attachments WHERE state<>'deleted'",
          )
        ).rows[0]!;
        if (Number(total.bytes) + output.bytes.length > 4 * 1024 ** 3)
          throw new ConflictException('DOCUMENT_QUOTA_EXCEEDED');
        await c.query(
          "INSERT INTO media_attachments(id,owner_id,item_id,kind,variant,object_key,resource_type,format,original_filename,mime_type,byte_size,checksum,width,height) VALUES($1,$2,$3,$4,'original',$5,$6,$7,$8,$9,$10,$11,$12,$13)",
          [
            id,
            owner,
            item,
            kind,
            key,
            output.resourceType,
            output.format,
            `${kind}.${output.format}`,
            output.mimeType,
            output.bytes.length,
            output.checksum,
            output.width,
            output.height,
          ],
        );
        return undefined;
      });
      if (prior) return this.details(prior);
      try {
        const asset = await this.storage.put({
          key,
          bytes: output.bytes,
          resourceType: output.resourceType,
          format: output.format,
          checksum: output.checksum,
        });
        return await this.repo.transaction(owner, async (c) => {
          await this.item(c, owner, item);
          const row = (
            await c.query<Row>(
              "UPDATE media_attachments SET state='ready',provider_asset_id=$1,provider_version=$2,updated_at=now() WHERE owner_id=$3 AND item_id=$4 AND id=$5 AND state='pending' RETURNING *",
              [asset.assetId, asset.version, owner, item, id],
            )
          ).rows[0];
          if (!row) throw new ConflictException('DOCUMENT_UPLOAD_PENDING');
          await c.query(
            'UPDATE items SET revision=revision+1,updated_at=now() WHERE owner_id=$1 AND id=$2',
            [owner, item],
          );
          return this.details(row);
        });
      } catch {
        // Re-read under owner/item locks before cleaning an ambiguous SQL acknowledgement.
        // If state cannot be established, the durable intent remains for PER-12 reconciliation.
        await this.repo
          .transaction(owner, async (c) => {
            const row = (
              await c.query<Row>('SELECT * FROM media_attachments WHERE owner_id=$1 AND id=$2', [
                owner,
                id,
              ])
            ).rows[0];
            if (row?.state === 'pending') await this.media.discardPending(owner, id);
          })
          .catch(() => undefined);
        throw new ServiceUnavailableException('DOCUMENT_UPLOAD_UNAVAILABLE');
      }
    } finally {
      output.bytes.fill(0);
      input.bytes.fill(0);
    }
  }
  async delete(
    owner: string,
    item: string,
    id: string,
    revision: number,
  ): Promise<DocumentSnapshotDto> {
    await this.repo.transaction(owner, async (c) => {
      await this.item(c, owner, item, revision);
      const row = (
        await c.query<Row>(
          "SELECT * FROM media_attachments WHERE owner_id=$1 AND item_id=$2 AND id=$3 AND kind IN ('receipt','warranty') AND variant='original' AND state IN ('ready','deleting','deleted')",
          [owner, item, id],
        )
      ).rows[0];
      if (!row) throw new NotFoundException('MEDIA_NOT_FOUND');
      if (row.state !== 'deleted') await this.media.delete(owner, id);
      await c.query(
        'UPDATE items SET revision=revision+1,updated_at=now() WHERE owner_id=$1 AND id=$2',
        [owner, item],
      );
    });
    return this.snapshot(owner, item);
  }
  async download(
    owner: string,
    item: string,
    id: string,
  ): Promise<{ bytes: Buffer; contentType: string; disposition: string; release: () => void }> {
    if (this.activeDownloads >= 2)
      throw new ServiceUnavailableException('DOCUMENT_PROCESSING_BUSY');
    this.activeDownloads++;
    let held: Buffer | undefined;
    let released = false;
    const release = (): void => {
      if (released) return;
      released = true;
      held?.fill(0);
      this.activeDownloads--;
    };
    try {
      const result = await this.repo.transaction(owner, async (c) => {
        await this.item(c, owner, item);
        const row = (
          await c.query<Row>(
            "SELECT * FROM media_attachments WHERE owner_id=$1 AND item_id=$2 AND id=$3 AND kind IN ('receipt','warranty') AND variant='original' AND state='ready'",
            [owner, item, id],
          )
        ).rows[0];
        if (!row) throw new NotFoundException('MEDIA_NOT_FOUND');
        const bytes = (held = await this.storage.read(
          row.object_key,
          row.resource_type,
          row.format,
          Number(row.byte_size),
        ));
        if (createHash('sha256').update(bytes).digest('hex') !== row.checksum) {
          bytes.fill(0);
          throw new ServiceUnavailableException('MEDIA_STORAGE_UNAVAILABLE');
        }
        // Generated ASCII filenames prevent original-name/path/header disclosure and injection.
        const filename = `${row.kind}.${row.format}`;
        return {
          bytes,
          contentType: row.mime_type,
          disposition: `attachment; filename="${filename}"; filename*=UTF-8''${filename}`,
        };
      });
      return { ...result, release };
    } catch (error) {
      release();
      throw error;
    }
  }
}
