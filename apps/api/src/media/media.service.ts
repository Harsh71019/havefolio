import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomUUID } from 'node:crypto';
import {
  AttachmentRepository,
  type Attachment,
  type PendingAttachment,
} from './attachment.repository.js';
import { PrivateMediaStorage, type Format } from './storage.js';

export interface CreateAttachment {
  kind: 'photo' | 'receipt' | 'warranty';
  originalFilename: string;
  mimeType: string;
  bytes: Buffer;
}
export interface AttachmentDetails {
  id: string;
  kind: Attachment['kind'];
  mimeType: string;
  byteSize: number;
  width: number | null;
  height: number | null;
}
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

@Injectable()
export class MediaService {
  private readonly prefix: string;
  private activeUploads = 0;
  constructor(
    private readonly repository: AttachmentRepository,
    private readonly storage: PrivateMediaStorage,
    config: ConfigService,
  ) {
    this.prefix = `havefolio/${config.get<string>('NODE_ENV', 'development')}/`;
  }

  private validateId(value: string): void {
    if (!uuid.test(value)) throw new BadRequestException('INVALID_MEDIA_ID');
  }

  private details(row: Attachment): AttachmentDetails {
    return {
      id: row.id,
      kind: row.kind,
      mimeType: row.mimeType,
      byteSize: row.byteSize,
      width: row.width,
      height: row.height,
    };
  }

  private format(input: CreateAttachment): Format {
    const bytes = input.bytes;
    if (
      !['photo', 'receipt', 'warranty'].includes(input.kind) ||
      !input.originalFilename ||
      input.originalFilename.length > 255 ||
      /[/\\]/.test(input.originalFilename) ||
      [...input.originalFilename].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127) ||
      bytes.length === 0
    )
      throw new BadRequestException('INVALID_MEDIA');
    const isPdf = input.mimeType === 'application/pdf';
    if (bytes.length > (isPdf ? 20 : 10) * 1024 * 1024)
      throw new PayloadTooLargeException('FILE_TOO_LARGE');
    if (
      input.mimeType === 'image/jpeg' &&
      bytes[0] === 0xff &&
      bytes[1] === 0xd8 &&
      bytes[2] === 0xff
    )
      return 'jpg';
    if (
      input.mimeType === 'image/png' &&
      bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    )
      return 'png';
    if (
      input.mimeType === 'image/webp' &&
      bytes.subarray(0, 4).toString() === 'RIFF' &&
      bytes.subarray(8, 12).toString() === 'WEBP'
    )
      return 'webp';
    if (
      isPdf &&
      input.kind !== 'photo' &&
      /^%PDF-1\.[0-7]/.test(bytes.subarray(0, 8).toString('ascii'))
    )
      return 'pdf';
    throw new BadRequestException('INVALID_MEDIA');
  }

  // ownerId must come from the future authenticated principal, never a body/header claim.
  async create(ownerId: string, input: CreateAttachment): Promise<AttachmentDetails> {
    this.validateId(ownerId);
    const format = this.format(input);
    if (this.activeUploads >= 2) throw new ServiceUnavailableException('MEDIA_PROCESSING_BUSY');
    this.activeUploads++;
    try {
      const id = randomUUID();
      const record: PendingAttachment = {
        id,
        ownerId,
        kind: input.kind,
        originalFilename: input.originalFilename,
        mimeType: input.mimeType,
        byteSize: input.bytes.length,
        checksum: createHash('sha256').update(input.bytes).digest('hex'),
        format,
        resourceType: format === 'pdf' ? 'raw' : 'image',
        objectKey: `${this.prefix}${id}${format === 'pdf' ? '.pdf' : ''}`,
      };
      await this.repository.insertPending(record); // Durable intent exists before any external write.
      const asset = await this.storage.put({
        key: record.objectKey,
        bytes: input.bytes,
        resourceType: record.resourceType,
        format,
        checksum: record.checksum,
      });
      // If commit is ambiguous, leave intent for reconciliation. Never delete a potentially ready asset.
      const ready = await this.repository.markReady(ownerId, id, asset);
      if (!ready) throw new ServiceUnavailableException('MEDIA_METADATA_UNAVAILABLE');
      return this.details(ready);
    } finally {
      this.activeUploads--;
    }
  }

  private async owned(ownerId: string, id: string): Promise<Attachment> {
    this.validateId(ownerId);
    this.validateId(id);
    const row = await this.repository.findOwned(ownerId, id);
    if (!row || row.ownerId !== ownerId || row.state === 'deleted')
      throw new NotFoundException('MEDIA_NOT_FOUND');
    return row;
  }

  async download(ownerId: string, id: string): Promise<{ url: string; expiresIn: number }> {
    const row = await this.owned(ownerId, id);
    if (row.state !== 'ready') throw new ConflictException('MEDIA_NOT_READY');
    return {
      url: this.storage.download(row.objectKey, row.resourceType, row.format),
      expiresIn: 60,
    };
  }

  // Hide the original before deleting variants so partial failures never expose a ready family.
  async beginPhotoDeletion(ownerId: string, id: string): Promise<void> {
    const row = await this.owned(ownerId, id);
    if (row.kind !== 'photo' || row.variant !== 'original' || row.state === 'pending')
      throw new ConflictException('MEDIA_NOT_READY');
    await this.repository.markPhotoFamilyDeleting(ownerId, id);
  }

  async delete(ownerId: string, id: string): Promise<void> {
    const row = await this.owned(ownerId, id);
    if (row.state === 'pending') throw new ConflictException('MEDIA_NOT_READY');
    await this.cleanup(row);
  }

  // Internal document compensation only; re-read under owner locks before calling.
  async discardPending(ownerId: string, id: string): Promise<void> {
    const row = await this.owned(ownerId, id);
    if (row.kind === 'photo' || row.state !== 'pending')
      throw new ConflictException('MEDIA_NOT_READY');
    await this.cleanup(row);
  }

  private async cleanup(row: Attachment): Promise<void> {
    if (await this.repository.hasChildren(row.ownerId, row.id))
      throw new ConflictException('MEDIA_HAS_VARIANTS');
    const deleting = await this.repository.markDeleting(row);
    if (!deleting) return;
    await this.storage.delete(deleting.objectKey, deleting.resourceType);
    // Tombstones keep exact keys for repeated cleanup of an ambiguous/late provider write.
    await this.repository.markDeleted(row.ownerId, row.id);
  }

  // Internal operator/worker hook, deliberately has no HTTP route. Bounded and retryable.
  async reconcile(): Promise<{ completed: number; failed: number }> {
    const rows = await this.repository.recoveryCandidates(new Date(Date.now() - 15 * 60_000));
    let completed = 0;
    let failed = 0;
    for (const row of rows) {
      try {
        await this.cleanup(row);
        completed++;
      } catch {
        failed++;
      }
    }
    return { completed, failed };
  }
}
