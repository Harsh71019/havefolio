import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { IntegrationRun, integrationConfiguration } from '@havefolio/test-utils';
import {
  DatabaseAttachmentRepository,
  type AttachmentRepository,
  type PendingAttachment,
} from '../src/media/attachment.repository.js';

describe('private media metadata on real PostgreSQL', () => {
  it('applies from empty, enforces constraints and owner scoping, and protects ready objects from stale recovery', async () => {
    const config = integrationConfiguration();
    const run = new IntegrationRun(config);
    let module:
      Awaited<ReturnType<ReturnType<typeof Test.createTestingModule>['compile']>> | undefined;
    try {
      await run.start();
      const url = new URL(config.runtimeUrl);
      url.searchParams.set('options', `-c search_path=${run.schema},pg_catalog`);
      const settings = { MEDIA_STORAGE_ENABLED: true, DATABASE_URL: url.toString() };
      module = await Test.createTestingModule({
        providers: [
          DatabaseAttachmentRepository,
          {
            provide: ConfigService,
            useValue: {
              get: (key: keyof typeof settings) => settings[key],
              getOrThrow: (key: keyof typeof settings) => settings[key],
            },
          },
        ],
      }).compile();
      const repository: AttachmentRepository = module.get(DatabaseAttachmentRepository);
      const ownerId = randomUUID();
      const id = randomUUID();
      const record: PendingAttachment = {
        id,
        ownerId,
        kind: 'photo',
        objectKey: `havefolio/test/${id}`,
        resourceType: 'image',
        format: 'jpg',
        originalFilename: 'fixture.jpg',
        mimeType: 'image/jpeg',
        byteSize: 4,
        checksum: 'a'.repeat(64),
      };
      await repository.insertPending(record);
      const pending = await repository.findOwned(ownerId, id);
      expect(pending?.state).toBe('pending');
      expect(await repository.findOwned(randomUUID(), id)).toBeUndefined();
      await expect(
        run.runtime.query('UPDATE media_attachments SET state = $1 WHERE id = $2', ['ready', id]),
      ).rejects.toMatchObject({ code: '23514' });
      await expect(
        run.runtime.query('UPDATE media_attachments SET byte_size = 0 WHERE id = $1', [id]),
      ).rejects.toMatchObject({ code: '23514' });
      await expect(
        run.runtime.query('UPDATE media_attachments SET width = 1 WHERE id = $1', [id]),
      ).rejects.toMatchObject({ code: '23514' });
      await expect(repository.insertPending({ ...record, id: randomUUID() })).rejects.toMatchObject(
        { message: 'MEDIA_METADATA_UNAVAILABLE' },
      );
      const ready = await repository.markReady(ownerId, id, {
        assetId: 'provider-fixture',
        version: 123,
        width: 2,
        height: 2,
      });
      expect(ready?.state).toBe('ready');
      expect(await repository.markDeleting(pending!)).toBeUndefined(); // Stale state CAS fails.
      const candidates = await repository.recoveryCandidates(new Date(Date.now() + 60_000));
      expect(candidates.some((r) => r.id === id)).toBe(false);
      const childId = randomUUID();
      await repository.insertPending({
        ...record,
        id: childId,
        ownerId: randomUUID(),
        objectKey: `havefolio/test/${childId}`,
      });
      await expect(
        run.runtime.query(
          'UPDATE media_attachments SET parent_id = $1, variant = $2 WHERE id = $3',
          [id, 'thumbnail', childId],
        ),
      ).rejects.toMatchObject({ code: '23503' });
      const deleting = await repository.markDeleting(ready!);
      expect(deleting?.state).toBe('deleting');
      expect(
        await repository.markReady(ownerId, id, {
          assetId: 'too-late',
          version: 124,
          width: 2,
          height: 2,
        }),
      ).toBeUndefined();
      await repository.markDeleted(ownerId, id);
      const tombstone = await repository.findOwned(ownerId, id);
      expect(tombstone?.state).toBe('deleted');
      expect(tombstone?.originalFilename).toBe('deleted');
      expect(tombstone?.checksum).toBe('0'.repeat(64));
      expect(tombstone?.providerAssetId).toBeNull();
      // Pending rows use millisecond precision: date-based CAS remains valid after pg decoding.
      const secondId = randomUUID();
      await repository.insertPending({
        ...record,
        id: secondId,
        objectKey: `havefolio/test/${secondId}`,
      });
      const second = await repository.findOwned(ownerId, secondId);
      expect((await repository.markDeleting(second!))?.state).toBe('deleting');
    } finally {
      await module?.close();
      await run.close();
    }
  }, 60_000);
});
