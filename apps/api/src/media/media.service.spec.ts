import { jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { apiEnvironmentSchema } from '@havefolio/config';
import { MediaService } from './media.service.js';
import {
  AttachmentRepository,
  type Attachment,
  type PendingAttachment,
} from './attachment.repository.js';
import { PrivateMediaStorage } from './storage.js';

type MockedPort<T> = {
  [Key in keyof T]: T[Key] extends (...args: infer Args) => infer Result
    ? jest.Mock<(...args: Args) => Result>
    : never;
};

const owner = randomUUID();
const photo = {
  kind: 'photo' as const,
  originalFilename: 'personal.jpg',
  mimeType: 'image/jpeg',
  bytes: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
};
function row(input: PendingAttachment): Attachment {
  return {
    ...input,
    parentId: null,
    itemId: null,
    position: 0,
    variant: 'original',
    provider: 'cloudinary',
    providerAssetId: null,
    providerVersion: null,
    state: 'pending',
    width: null,
    height: null,
    altText: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe('MediaService', () => {
  async function setup(): Promise<{
    service: MediaService;
    rows: Map<string, Attachment>;
    repository: MockedPort<AttachmentRepository>;
    storage: MockedPort<PrivateMediaStorage>;
  }> {
    const rows = new Map<string, Attachment>();
    const repository: MockedPort<AttachmentRepository> = {
      markPhotoFamilyDeleting: jest.fn<AttachmentRepository['markPhotoFamilyDeleting']>(
        (who, id) => {
          for (const row of rows.values())
            if (
              row.ownerId === who &&
              (row.id === id || row.parentId === id) &&
              ['ready', 'deleting'].includes(row.state)
            )
              row.state = 'deleting';
          return Promise.resolve();
        },
      ),
      insertPending: jest.fn<AttachmentRepository['insertPending']>((input: PendingAttachment) => {
        rows.set(input.id, row(input));
        return Promise.resolve();
      }),
      findOwned: jest.fn<AttachmentRepository['findOwned']>((who: string, id: string) => {
        const value = rows.get(id);
        return Promise.resolve(value?.ownerId === who ? value : undefined);
      }),
      markReady: jest.fn<AttachmentRepository['markReady']>(
        (
          _who: string,
          id: string,
          asset: { assetId: string; version: number; width: number | null; height: number | null },
        ) => {
          const pending = rows.get(id)!;
          const ready: Attachment = {
            ...pending,
            state: 'ready',
            providerAssetId: asset.assetId,
            providerVersion: asset.version,
            width: asset.width,
            height: asset.height,
            updatedAt: new Date(),
          };
          rows.set(id, ready);
          return Promise.resolve(ready);
        },
      ),
      markDeleting: jest.fn<AttachmentRepository['markDeleting']>((record: Attachment) => {
        const deleting: Attachment = { ...record, state: 'deleting' };
        rows.set(record.id, deleting);
        return Promise.resolve(deleting);
      }),
      markDeleted: jest.fn<AttachmentRepository['markDeleted']>((_who: string, id: string) => {
        rows.get(id)!.state = 'deleted';
        return Promise.resolve();
      }),
      hasChildren: jest.fn<AttachmentRepository['hasChildren']>(() => Promise.resolve(false)),
      recoveryCandidates: jest.fn<AttachmentRepository['recoveryCandidates']>(() =>
        Promise.resolve([...rows.values()].filter((r) => r.state !== 'ready')),
      ),
    };
    const storage: MockedPort<PrivateMediaStorage> = {
      read: jest.fn<PrivateMediaStorage['read']>(),
      put: jest.fn<PrivateMediaStorage['put']>(() =>
        Promise.resolve({ assetId: 'provider-id', version: 123, width: 2, height: 2 }),
      ),
      delete: jest.fn<PrivateMediaStorage['delete']>(() => Promise.resolve()),
      download: jest.fn(() => 'https://example.test/expiring-download'),
    };
    const module = await Test.createTestingModule({
      providers: [
        MediaService,
        { provide: AttachmentRepository, useValue: repository },
        { provide: PrivateMediaStorage, useValue: storage },
        { provide: ConfigService, useValue: { get: () => 'test' } },
      ],
    }).compile();
    return { service: module.get(MediaService), rows, repository, storage };
  }

  it('stores intent before provider upload, returns only ready public details and enforces owner access', async () => {
    const { service, rows, repository, storage } = await setup();
    storage.put.mockImplementation(() => {
      expect([...rows.values()][0]?.state).toBe('pending');
      return Promise.resolve({ assetId: 'provider-id', version: 123, width: 2, height: 2 });
    });
    const result = await service.create(owner, photo);
    expect(result).not.toHaveProperty('objectKey');
    expect(result).not.toHaveProperty('providerAssetId');
    expect(repository.markReady).toHaveBeenCalledTimes(1);
    expect(await service.download(owner, result.id)).toEqual({
      url: 'https://example.test/expiring-download',
      expiresIn: 60,
    });
    await expect(service.download(randomUUID(), result.id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(service.delete(randomUUID(), result.id)).rejects.toBeInstanceOf(NotFoundException);
    expect(storage.delete).not.toHaveBeenCalled();
  });

  it('keeps ambiguous provider failures pending and cleans them through bounded recovery', async () => {
    const { service, rows, storage, repository } = await setup();
    storage.put.mockRejectedValueOnce(new ServiceUnavailableException('MEDIA_STORAGE_UNAVAILABLE'));
    await expect(service.create(owner, photo)).rejects.toBeInstanceOf(ServiceUnavailableException);
    const pending = [...rows.values()][0]!;
    expect(pending.state).toBe('pending');
    expect(repository.markReady).not.toHaveBeenCalled();
    await expect(service.download(owner, pending.id)).rejects.toBeInstanceOf(ConflictException);
    await expect(service.delete(owner, pending.id)).rejects.toBeInstanceOf(ConflictException);
    expect(await service.reconcile()).toEqual({ completed: 1, failed: 0 });
    expect(pending.objectKey).toMatch(/^havefolio\/test\//);
    expect(rows.get(pending.id)?.state).toBe('deleted');
    expect(storage.delete).toHaveBeenCalledWith(pending.objectKey, 'image');
  });

  it('never deletes an asset on an ambiguous ready commit; preserves a potentially committed ready row', async () => {
    const { service, rows, storage, repository } = await setup();
    repository.markReady.mockImplementation((_who, id) => {
      rows.get(id)!.state = 'ready'; // Commit succeeded; connection then failed.
      return Promise.reject(new ServiceUnavailableException('MEDIA_METADATA_UNAVAILABLE'));
    });
    await expect(service.create(owner, photo)).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(storage.delete).not.toHaveBeenCalled();
    expect(await service.reconcile()).toEqual({ completed: 0, failed: 0 });
  });

  it('retains deleting state on provider failure and retries without losing the exact asset key', async () => {
    const { service, rows, storage } = await setup();
    const value = await service.create(owner, photo);
    storage.delete.mockRejectedValueOnce(
      new ServiceUnavailableException('MEDIA_STORAGE_UNAVAILABLE'),
    );
    await expect(service.delete(owner, value.id)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(rows.get(value.id)?.state).toBe('deleting');
    await expect(service.download(owner, value.id)).rejects.toBeInstanceOf(ConflictException);
    expect(await service.reconcile()).toEqual({ completed: 1, failed: 0 });
    await expect(service.download(owner, value.id)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('does not delete a stale candidate that changed state before recovery acquired it', async () => {
    const { service, repository, storage } = await setup();
    await service.create(owner, photo);
    repository.recoveryCandidates.mockResolvedValueOnce([
      row({
        id: randomUUID(),
        ownerId: owner,
        kind: 'photo',
        objectKey: 'stale',
        resourceType: 'image',
        format: 'jpg',
        originalFilename: 'old.jpg',
        mimeType: 'image/jpeg',
        byteSize: 4,
        checksum: 'a'.repeat(64),
      }),
    ]);
    repository.markDeleting.mockResolvedValueOnce(undefined);
    await service.reconcile();
    expect(storage.delete).not.toHaveBeenCalled();
  });

  it('rejects spoofed, empty and oversized inputs before persistence; stores PDFs as authenticated raw candidates', async () => {
    const { service, repository, storage } = await setup();
    await expect(
      service.create(owner, { ...photo, bytes: Buffer.from('not a photo') }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.create(owner, { ...photo, bytes: Buffer.alloc(0) }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.create(owner, { ...photo, bytes: Buffer.alloc(10 * 1024 * 1024 + 1) }),
    ).rejects.toMatchObject({ status: 413 });
    await expect(
      service.create(owner, { ...photo, originalFilename: '../secret.jpg' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repository.insertPending).not.toHaveBeenCalled();
    await service.create(owner, {
      kind: 'receipt',
      originalFilename: 'receipt.pdf',
      mimeType: 'application/pdf',
      bytes: Buffer.from('%PDF-1.7\n'),
    });
    expect(storage.put).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceType: 'raw',
        format: 'pdf',
        key: expect.stringMatching(/\.pdf$/),
      }),
    );
  });

  it('bounds active provider uploads to two and releases admission slots after failure', async () => {
    const { service, storage } = await setup();
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    storage.put.mockImplementation(async () => {
      await blocked;
      throw new ServiceUnavailableException();
    });
    const first = service.create(owner, photo);
    const second = service.create(owner, photo);
    const results = Promise.allSettled([first, second]);
    await expect(service.create(owner, photo)).rejects.toMatchObject({
      message: 'MEDIA_PROCESSING_BUSY',
    });
    release();
    await results;
    storage.put.mockResolvedValue({ assetId: 'restored', version: 124, width: 2, height: 2 });
    await expect(service.create(owner, photo)).resolves.toHaveProperty('id');
  });
});

describe('media configuration', () => {
  it('stays disabled by default, validates booleans and requires complete protected runtime configuration', () => {
    expect(apiEnvironmentSchema.parse({}).MEDIA_STORAGE_ENABLED).toBe(false);
    expect(apiEnvironmentSchema.safeParse({ MEDIA_STORAGE_ENABLED: 'typo' }).success).toBe(false);
    expect(apiEnvironmentSchema.safeParse({ MEDIA_STORAGE_ENABLED: true }).success).toBe(false);
    const valid = {
      MEDIA_STORAGE_ENABLED: 'true',
      CLOUDINARY_CLOUD_NAME: 'fixture',
      CLOUDINARY_API_KEY: 'fixture',
      CLOUDINARY_API_SECRET: 'fixture',
      DATABASE_URL: 'postgresql://fixture_runtime:fixture@localhost/havefolio_test',
    };
    expect(apiEnvironmentSchema.safeParse(valid).success).toBe(true);
    expect(
      apiEnvironmentSchema.safeParse({
        ...valid,
        DATABASE_URL: 'postgresql://postgres:fixture@localhost/havefolio_test',
      }).success,
    ).toBe(false);
    expect(
      apiEnvironmentSchema.safeParse({
        ...valid,
        DATABASE_URL: 'postgresql://fixture_migrate:fixture@localhost/havefolio_test',
      }).success,
    ).toBe(false);
  });
});
