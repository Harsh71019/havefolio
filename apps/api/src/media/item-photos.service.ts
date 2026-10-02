import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { ItemsRepository } from '../items/items.repository.js';
import { MediaService } from './media.service.js';
import { type StoredAsset, PrivateMediaStorage } from './storage.js';
import { PhotoProcessor, type PhotoInput } from './photo-processing.js';
import type { PhotoDto, PhotoSnapshotDto, PhotoUploadDto } from './item-photos.dto.js';
interface Row {
  id: string;
  position: number;
  width: number;
  height: number;
  byte_size: string;
  state: string;
  checksum: string;
  item_id: string;
  owner_id: string;
  alt_text: string | null;
}
interface Variant {
  object_key: string;
  resource_type: 'image';
  format: 'webp';
  byte_size: string;
  checksum: string;
}
// A variant is reachable only while its owner/item-scoped original is ready.
const readyVariant =
  "FROM media_attachments WHERE owner_id=$1 AND item_id=$2 AND kind='photo' AND state='ready' AND ((id=$3 AND variant='original') OR parent_id=$3) AND variant=$4 AND EXISTS (SELECT 1 FROM media_attachments p WHERE p.id=$3 AND p.owner_id=$1 AND p.item_id=$2 AND p.variant='original' AND p.state='ready')";
@Injectable()
export class ItemPhotosService {
  constructor(
    private readonly repo: ItemsRepository,
    private readonly processor: PhotoProcessor,
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
    const r = await c.query<{ revision: number }>(
      'SELECT revision FROM items WHERE id=$1 AND owner_id=$2 FOR UPDATE',
      [item, owner],
    );
    if (!r.rows[0]) throw new NotFoundException('ITEM_NOT_FOUND');
    if (revision !== undefined && revision !== r.rows[0].revision)
      throw new ConflictException('STALE_ITEM_REVISION');
    return r.rows[0].revision;
  }
  private details(r: Row, coverId: string): PhotoDto {
    return {
      id: r.id,
      position: r.position,
      cover: r.id === coverId,
      width: r.width,
      height: r.height,
      byteSize: Number(r.byte_size),
      mimeType: 'image/webp',
      altText: r.alt_text ? r.alt_text : null,
      decorative: r.alt_text === '',
    };
  }
  private async rows(c: PoolClient, owner: string, item: string): Promise<Row[]> {
    return (
      await c.query<Row>(
        "SELECT * FROM media_attachments WHERE owner_id=$1 AND item_id=$2 AND kind='photo' AND variant='original' AND state='ready' ORDER BY position,id LIMIT 8",
        [owner, item],
      )
    ).rows;
  }
  async snapshot(owner: string, item: string): Promise<PhotoSnapshotDto> {
    return this.repo.transaction(owner, async (c) => {
      const revision = await this.item(c, owner, item);
      const rows = await this.rows(c, owner, item);
      return { revision, photos: rows.map((r) => this.details(r, rows[0]?.id ?? '')) };
    });
  }
  async authorize(owner: string, item: string): Promise<void> {
    if (!this.config.get<boolean>('MEDIA_STORAGE_ENABLED', false))
      throw new ServiceUnavailableException('MEDIA_STORAGE_DISABLED');
    await this.repo.transaction(owner, (c) => this.item(c, owner, item));
  }
  async upload(
    owner: string,
    item: string,
    uploadId: string,
    files: PhotoInput[],
  ): Promise<PhotoUploadDto> {
    const results: PhotoUploadDto['results'] = [];
    for (const [index, file] of files.entries()) {
      let outputs: Awaited<ReturnType<PhotoProcessor['process']>> = [];
      try {
        outputs = await this.processor.process(file);
        const hex = createHash('sha256').update(`${uploadId}:${index}`).digest('hex');
        const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
        const ids = [id, randomUUID(), randomUUID()];
        const existing = await this.repo.transaction(owner, async (c) => {
          await this.item(c, owner, item);
          const prior = (await c.query<Row>('SELECT * FROM media_attachments WHERE id=$1', [id]))
            .rows[0];
          if (prior) {
            if (prior.owner_id === owner && prior.item_id === item && prior.state === 'deleted')
              throw new ConflictException('PHOTO_UPLOAD_RECOVERED');
            if (
              prior.owner_id !== owner ||
              prior.item_id !== item ||
              prior.checksum !== outputs[0]!.checksum
            )
              throw new ConflictException('PHOTO_UPLOAD_ID_REUSED');
            if (prior.state !== 'ready') throw new ConflictException('PHOTO_UPLOAD_PENDING');
            return prior;
          }
          const usage = (
            await c.query<{ count: string; bytes: string }>(
              "SELECT count(*) FILTER (WHERE item_id=$2 AND variant='original' AND kind='photo') AS count,coalesce(sum(byte_size),0)::text AS bytes FROM media_attachments WHERE owner_id=$1 AND state<>'deleted'",
              [owner, item],
            )
          ).rows[0]!;
          if (
            Number(usage.count) >= 8 ||
            Number(usage.bytes) + outputs.reduce((n, o) => n + o.bytes.length, 0) > 2 * 1024 ** 3
          )
            throw new ConflictException('PHOTO_QUOTA_EXCEEDED');
          // All photo reservations serialize the global storage quota across replicas.
          await c.query('SELECT pg_advisory_xact_lock(13130013)');
          const total = (
            await c.query<{ bytes: string }>(
              "SELECT coalesce(sum(byte_size),0)::text AS bytes FROM media_attachments WHERE state<>'deleted'",
            )
          ).rows[0]!;
          if (Number(total.bytes) + outputs.reduce((n, o) => n + o.bytes.length, 0) > 4 * 1024 ** 3)
            throw new ConflictException('PHOTO_QUOTA_EXCEEDED');
          for (const [i, o] of outputs.entries())
            await c.query(
              "INSERT INTO media_attachments(id,owner_id,item_id,parent_id,kind,variant,object_key,resource_type,format,original_filename,mime_type,byte_size,checksum,width,height) VALUES($1,$2,$3,$4,'photo',$5,$6,'image','webp','sanitized.webp','image/webp',$7,$8,$9,$10)",
              [
                ids[i],
                owner,
                item,
                i === 0 ? null : id,
                o.variant,
                `havefolio/${this.config.get<string>('NODE_ENV', 'development')}/${ids[i]}`,
                o.bytes.length,
                o.checksum,
                o.width,
                o.height,
              ],
            );
          return undefined;
        });
        if (!existing) {
          const assets: StoredAsset[] = [];
          for (const [i, o] of outputs.entries())
            assets.push(
              await this.storage.put({
                key: `havefolio/${this.config.get<string>('NODE_ENV', 'development')}/${ids[i]}`,
                bytes: o.bytes,
                checksum: o.checksum,
                resourceType: 'image',
                format: 'webp',
              }),
            );
          await this.repo.transaction(owner, async (c) => {
            await this.item(c, owner, item);
            const position = (
              await c.query<{ position: number }>(
                "SELECT coalesce(max(position)+1,0) AS position FROM media_attachments WHERE owner_id=$1 AND item_id=$2 AND kind='photo' AND variant='original' AND state='ready'",
                [owner, item],
              )
            ).rows[0]!.position;
            for (const [i, asset] of assets.entries()) {
              const r = await c.query(
                "UPDATE media_attachments SET state='ready',provider_asset_id=$1,provider_version=$2,position=$3,updated_at=now() WHERE id=$4 AND owner_id=$5 AND state='pending'",
                [asset.assetId, asset.version, position, ids[i], owner],
              );
              if (r.rowCount !== 1) throw new ConflictException('PHOTO_UPLOAD_PENDING');
            }
            await c.query(
              'UPDATE items SET revision=revision+1,updated_at=now() WHERE id=$1 AND owner_id=$2',
              [item, owner],
            );
          });
        }
        const state = await this.snapshot(owner, item);
        results.push({ index, photo: state.photos.find((p) => p.id === id)! });
      } catch (error) {
        const safe =
          error instanceof BadRequestException ||
          error instanceof ConflictException ||
          error instanceof ServiceUnavailableException ||
          error instanceof NotFoundException
            ? error.message
            : 'PHOTO_UPLOAD_FAILED';
        results.push({ index, error: safe });
      } finally {
        file.bytes.fill(0);
        outputs.forEach((o) => o.bytes.fill(0));
      }
    }
    return { results };
  }
  async reorder(
    owner: string,
    item: string,
    revision: number,
    ids: string[],
  ): Promise<PhotoSnapshotDto> {
    await this.repo.transaction(owner, async (c) => {
      await this.item(c, owner, item, revision);
      const rows = await this.rows(c, owner, item);
      if (
        ids.length !== rows.length ||
        new Set(ids).size !== ids.length ||
        ids.some((id) => !rows.some((r) => r.id === id))
      )
        throw new ConflictException('PHOTO_ORDER_CHANGED');
      for (const [position, id] of ids.entries())
        await c.query(
          'UPDATE media_attachments SET position=$1 WHERE owner_id=$2 AND item_id=$3 AND (id=$4 OR parent_id=$4)',
          [position, owner, item, id],
        );
      await c.query(
        'UPDATE items SET revision=revision+1,updated_at=now() WHERE id=$1 AND owner_id=$2',
        [item, owner],
      );
    });
    return this.snapshot(owner, item);
  }
  async delete(
    owner: string,
    item: string,
    id: string,
    revision: number,
  ): Promise<PhotoSnapshotDto> {
    await this.repo.transaction(owner, async (c) => {
      await this.item(c, owner, item, revision);
      const rows = (
        await c.query<Row>(
          "SELECT * FROM media_attachments WHERE owner_id=$1 AND item_id=$2 AND id=$3 AND kind='photo' AND variant='original' AND state IN ('ready','deleting')",
          [owner, item, id],
        )
      ).rows;
      if (!rows.some((r) => r.id === id)) throw new NotFoundException('MEDIA_NOT_FOUND');
      const variants = (
        await c.query<{ id: string }>(
          "SELECT id FROM media_attachments WHERE owner_id=$1 AND item_id=$2 AND parent_id=$3 AND state<>'deleted'",
          [owner, item, id],
        )
      ).rows;
      await this.media.beginPhotoDeletion(owner, id);
      for (const row of variants) await this.media.delete(owner, row.id);
      await this.media.delete(owner, id);
      await c.query(
        'UPDATE items SET revision=revision+1,updated_at=now() WHERE id=$1 AND owner_id=$2',
        [item, owner],
      );
    });
    return this.snapshot(owner, item);
  }
  async describe(
    owner: string,
    item: string,
    id: string,
    revision: number,
    altText: string | null,
    decorative: boolean,
  ): Promise<PhotoSnapshotDto> {
    const text = (altText ?? '').trim();
    if ([...text].length > 250 || /[\p{Cc}\p{Cf}]/u.test(text) || (decorative && text.length > 0))
      throw new BadRequestException('PHOTO_ALT_TEXT_INVALID');
    await this.repo.transaction(owner, async (c) => {
      await this.item(c, owner, item, revision);
      const r = await c.query(
        "UPDATE media_attachments SET alt_text=$1,updated_at=now() WHERE owner_id=$2 AND item_id=$3 AND id=$4 AND kind='photo' AND variant='original' AND state='ready'",
        [decorative ? '' : text || null, owner, item, id],
      );
      if (r.rowCount !== 1) throw new NotFoundException('MEDIA_NOT_FOUND');
      await c.query(
        'UPDATE items SET revision=revision+1,updated_at=now() WHERE id=$1 AND owner_id=$2',
        [item, owner],
      );
    });
    return this.snapshot(owner, item);
  }
  async access(
    owner: string,
    item: string,
    id: string,
    variant: string,
  ): Promise<{ url: string; expiresIn: number }> {
    return this.repo.transaction(owner, async (c) => {
      await this.item(c, owner, item);
      const r = (
        await c.query<{ id: string }>(`SELECT id ${readyVariant}`, [owner, item, id, variant])
      ).rows[0];
      if (!r) throw new NotFoundException('MEDIA_NOT_FOUND');
      return this.media.download(owner, r.id);
    });
  }
  // Authorize under the item lock, then fetch outside the transaction so slow delivery never holds it.
  async content(owner: string, item: string, id: string, variant: string): Promise<Buffer> {
    const row = await this.repo.transaction(owner, async (c) => {
      await this.item(c, owner, item);
      return (
        await c.query<Variant>(
          `SELECT object_key,resource_type,format,byte_size,checksum ${readyVariant}`,
          [owner, item, id, variant],
        )
      ).rows[0];
    });
    if (!row) throw new NotFoundException('MEDIA_NOT_FOUND');
    const bytes = await this.storage.read(
      row.object_key,
      row.resource_type,
      row.format,
      Number(row.byte_size),
    );
    if (createHash('sha256').update(bytes).digest('hex') !== row.checksum) {
      bytes.fill(0);
      throw new ServiceUnavailableException('MEDIA_STORAGE_UNAVAILABLE');
    }
    return bytes;
  }
}
