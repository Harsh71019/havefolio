import { describe, expect, it, jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { createHash, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { ItemsRepository } from '../items/items.repository.js';
import { ItemDocumentsService } from './item-documents.service.js';
import { DocumentProcessor } from './document-processing.js';
import { MediaService } from './media.service.js';
import { PrivateMediaStorage } from './storage.js';
import type { DocumentKind } from './document-multipart.js';
describe('document service boundaries and download memory leases', () => {
  async function setup(enabled = true): Promise<{
    service: ItemDocumentsService;
    read: ReturnType<typeof jest.fn<PrivateMediaStorage['read']>>;
    remove: ReturnType<typeof jest.fn<MediaService['delete']>>;
    process: ReturnType<typeof jest.fn<DocumentProcessor['process']>>;
    owner: string;
    item: string;
    id: string;
  }> {
    const owner = randomUUID(),
      item = randomUUID(),
      id = randomUUID(),
      bytes = Buffer.from('synthetic');
    const row = {
      id,
      owner_id: owner,
      item_id: item,
      kind: 'receipt',
      state: 'ready',
      variant: 'original',
      checksum: createHash('sha256').update(bytes).digest('hex'),
      mime_type: 'application/pdf',
      byte_size: String(bytes.length),
      width: null,
      height: null,
      object_key: `havefolio/test/${id}.pdf`,
      resource_type: 'raw',
      format: 'pdf',
    };
    const client = {
      query: jest.fn((sql: string) =>
        Promise.resolve({
          rows: sql.startsWith('SELECT revision')
            ? [{ revision: 1 }]
            : sql.startsWith('SELECT *')
              ? [row]
              : [],
          rowCount: 1,
        }),
      ),
    } as unknown as PoolClient;
    const transaction: ItemsRepository['transaction'] = async (_owner, op) => await op(client);
    const read = jest.fn<PrivateMediaStorage['read']>(() => Promise.resolve(Buffer.from(bytes)));
    const remove = jest.fn<MediaService['delete']>(() => Promise.resolve());
    const process = jest.fn<DocumentProcessor['process']>();
    const module = await Test.createTestingModule({
      providers: [
        ItemDocumentsService,
        { provide: ItemsRepository, useValue: { transaction } },
        { provide: DocumentProcessor, useValue: { process } },
        { provide: PrivateMediaStorage, useValue: { read } },
        { provide: MediaService, useValue: { delete: remove } },
        { provide: ConfigService, useValue: new ConfigService({ MEDIA_STORAGE_ENABLED: enabled }) },
      ],
    }).compile();
    return { service: module.get(ItemDocumentsService), read, remove, process, owner, item, id };
  }
  it('fails closed when provider is disabled before upload body processing', async () => {
    const { service, owner, item } = await setup(false);
    await expect(service.authorize(owner, item)).rejects.toThrow('MEDIA_STORAGE_DISABLED');
  });
  it('does not accept photo classification through internal service calls', async () => {
    const { service, owner, item, process } = await setup();
    await expect(
      service.upload(owner, item, randomUUID(), 'photo' as DocumentKind, {
        bytes: Buffer.from('synthetic'),
        filename: 'synthetic.pdf',
        mimeType: 'application/pdf',
      }),
    ).rejects.toThrow('DOCUMENT_KIND_REQUIRED');
    expect(process).not.toHaveBeenCalled();
  });
  it('exposes safe metadata and rejects stale deletion without invoking provider', async () => {
    const { service, owner, item, id, remove } = await setup();
    await service.authorize(owner, item);
    const result = await service.snapshot(owner, item);
    expect(result.documents[0]).toMatchObject({ id, kind: 'receipt' });
    expect(JSON.stringify(result)).not.toMatch(/object_key|provider|havefolio\//);
    await expect(service.delete(owner, item, id, 2)).rejects.toThrow('STALE_ITEM_REVISION');
    expect(remove).not.toHaveBeenCalled();
    await service.delete(owner, item, id, 1);
    expect(remove).toHaveBeenCalledWith(owner, id);
  });
  it('bounds resident download buffers, scrubs on idempotent release and restores admission after failure', async () => {
    const { service, owner, item, id, read } = await setup();
    const first = await service.download(owner, item, id),
      second = await service.download(owner, item, id);
    await expect(service.download(owner, item, id)).rejects.toThrow('DOCUMENT_PROCESSING_BUSY');
    first.release();
    first.release();
    expect(first.bytes.every((b) => b === 0)).toBe(true);
    read.mockRejectedValueOnce(new Error('synthetic unavailable'));
    await expect(service.download(owner, item, id)).rejects.toThrow('synthetic unavailable');
    const third = await service.download(owner, item, id);
    second.release();
    third.release();
  });
});
