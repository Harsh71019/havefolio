import { TelemetryModule } from '@havefolio/logging';
import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, describe, expect, it, jest } from '@jest/globals';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import request from 'supertest';
import sharp from 'sharp';
import { PDF } from '@libpdf/core';
import { IntegrationRun, integrationConfiguration } from '@havefolio/test-utils';
import { validateApiEnvironment } from '@havefolio/config';
import { AuthModule } from '../src/auth/auth.module.js';
import { newToken, hashToken } from '../src/auth/session-cookie.service.js';
import { configureApplication } from '../src/app.setup.js';
import { ItemsModule } from '../src/items/items.module.js';
import { ItemsRepository } from '../src/items/items.repository.js';
import { PrivateMediaStorage, type StoreInput } from '../src/media/storage.js';
import { MediaService } from '../src/media/media.service.js';
import { PhotoRecoveryService } from '../src/media/photo-recovery.service.js';
import type { DocumentDto, DocumentSnapshotDto } from '../src/media/item-documents.dto.js';
import type { PhotoSnapshotDto } from '../src/media/item-photos.dto.js';
jest.setTimeout(60000);
describe('private receipt and warranty HTTP lifecycle', () => {
  const run = new IntegrationRun(integrationConfiguration());
  const owner = randomUUID(),
    other = randomUUID(),
    token = newToken();
  let foreignItem: string;
  let app: NestExpressApplication, pdf: Buffer, jpeg: Buffer;
  const objects = new Map<string, Buffer>();
  const put = jest.fn(async (input: StoreInput) => {
    objects.set(input.key, Buffer.from(input.bytes));
    const m: { width?: number; height?: number } =
      input.resourceType === 'image' ? await sharp(input.bytes).metadata() : {};
    return { assetId: randomUUID(), version: 1, width: m.width ?? null, height: m.height ?? null };
  });
  const remove = jest.fn((key: string) => {
    objects.delete(key);
    return Promise.resolve();
  });
  const read = jest.fn((key: string) => {
    const bytes = objects.get(key);
    if (!bytes) throw new Error('synthetic missing');
    return Promise.resolve(Buffer.from(bytes));
  });
  const http = (): ReturnType<typeof request> => request(app.getHttpServer());
  const cookie = (): string => `havefolio_session=${token}`;
  const create = async (): Promise<{ id: string; revision: number }> =>
    (
      await http()
        .post('/api/v1/items')
        .set('Cookie', cookie())
        .send({ name: 'Synthetic document item', currency: 'INR', ownershipStatus: 'owned' })
        .expect(201)
    ).body as { id: string; revision: number };
  const upload = (
    item: string,
    id = randomUUID(),
  ): ReturnType<ReturnType<typeof request>['post']> =>
    http().post(`/api/v1/items/${item}/documents`).set('Cookie', cookie()).set('Upload-Id', id);
  const send = async (item: string, kind = 'receipt', id = randomUUID()): Promise<DocumentDto> =>
    (
      await upload(item, id)
        .field('kind', kind)
        .attach('document', pdf, 'synthetic.pdf')
        .expect(201)
    ).body as DocumentDto;
  const snapshot = async (item: string): Promise<DocumentSnapshotDto> =>
    (await http().get(`/api/v1/items/${item}/documents`).set('Cookie', cookie()).expect(200))
      .body as DocumentSnapshotDto;
  const download = (item: string, id: string): ReturnType<ReturnType<typeof request>['get']> =>
    http().get(`/api/v1/items/${item}/documents/${id}/download`).set('Cookie', cookie());
  beforeAll(async () => {
    await run.start();
    await run.runtime.query(
      "INSERT INTO users(id,email,password_hash) VALUES($1,'document-owner@example.test','$argon2id$fixture'),($2,NULL,NULL)",
      [owner, other],
    );
    for (const [id, t] of [[owner, token]])
      await run.runtime.query(
        "INSERT INTO auth_sessions(owner_id,token_hash,idle_expires_at,absolute_expires_at) VALUES($1,$2,now()+interval '1 hour',now()+interval '1 day')",
        [id, hashToken(t!)],
      );
    foreignItem = (
      await run.runtime.query<{ id: string }>(
        "INSERT INTO items(owner_id,name,currency,original_entry,original_source) VALUES($1,'Foreign synthetic item','INR','{}','manual') RETURNING id",
        [other],
      )
    ).rows[0]!.id;
    const url = new URL(integrationConfiguration().runtimeUrl);
    url.searchParams.set('options', `-c search_path=${run.schema},pg_catalog`);
    const module = await Test.createTestingModule({
      imports: [
        TelemetryModule.register('api'),
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, ignoreEnvVars: true }),
        AuthModule,
        ItemsModule,
      ],
    })
      .overrideProvider(ConfigService)
      .useValue(
        new ConfigService({
          ...validateApiEnvironment({ NODE_ENV: 'test' }),
          DATABASE_URL: url.toString(),
          MEDIA_STORAGE_ENABLED: true,
        }),
      )
      .overrideProvider(PrivateMediaStorage)
      .useValue({
        put,
        delete: remove,
        read,
        download: () => {
          throw new Error('must never disclose signed URL');
        },
      })
      .compile();
    app = module.createNestApplication<NestExpressApplication>({ logger: false });
    configureApplication(app);
    await app.listen(0, '127.0.0.1');
    const doc = PDF.create();
    doc.addPage();
    pdf = Buffer.from(await doc.save());
    jpeg = await sharp({ create: { width: 40, height: 30, channels: 3, background: '#abcdef' } })
      .jpeg()
      .toBuffer();
  });
  afterAll(async () => {
    await app?.close();
    await run.close();
    objects.clear();
  });
  it('rejects unauthenticated, foreign item, spoofed fields and photo kind before storage', async () => {
    const item = await create(),
      count = put.mock.calls.length;
    await http()
      .post(`/api/v1/items/${item.id}/documents`)
      .set('Upload-Id', randomUUID())
      .field('kind', 'receipt')
      .attach('document', pdf, 'test.pdf')
      .expect(401);
    await http()
      .post(`/api/v1/items/${foreignItem}/documents`)
      .set('Cookie', cookie())
      .set('Upload-Id', randomUUID())
      .field('kind', 'receipt')
      .attach('document', pdf, 'test.pdf')
      .expect(404);
    await upload(item.id).field('kind', 'photo').attach('document', pdf, 'test.pdf').expect(400);
    await upload(item.id)
      .field('ownerId', other)
      .field('kind', 'receipt')
      .attach('document', pdf, 'test.pdf')
      .expect(400);
    await upload(item.id).attach('document', pdf, 'test.pdf').expect(400);
    await upload(item.id).field('kind', 'receipt').attach('photos', jpeg, 'test.jpg').expect(400);
    expect(put.mock.calls.length).toBe(count);
  });
  it.each(['jpeg', 'png', 'webp'] as const)(
    'stores validated private %s receipt/warranty without variants or original filenames',
    async (format) => {
      const item = await create();
      const bytes = await sharp(jpeg).toFormat(format).toBuffer();
      const result = await upload(item.id)
        .field('kind', format === 'jpeg' ? 'receipt' : 'warranty')
        .attach('document', bytes, `synthetic.${format}`)
        .expect(201);
      const body = result.body as DocumentDto;
      expect(body.mimeType).toBe('image/webp');
      const rows = (
        await run.runtime.query<{
          original_filename: string;
          resource_type: string;
          kind: string;
          variant: string;
        }>('SELECT * FROM media_attachments WHERE item_id=$1', [item.id])
      ).rows;
      expect(rows).toHaveLength(1);
      expect(rows[0]!.variant).toBe('original');
      expect(rows[0]!.resource_type).toBe('image');
      expect(rows[0]!.original_filename).toBe(`${body.kind}.webp`);
      expect(JSON.stringify(body)).not.toMatch(/object_key|havefolio\/|provider|filename|https/);
      const res = await download(item.id, body.id).expect(200);
      expect(res.headers['content-type']).toContain('image/webp');
      expect(res.headers['content-disposition']).toContain(
        `attachment; filename="${body.kind}.webp"`,
      );
    },
  );
  it('keeps warranty proof separate from warranty metadata and preserves explicit unknown dates', async () => {
    const item = await create();
    await send(item.id, 'warranty');
    expect((await snapshot(item.id)).documents[0]!.kind).toBe('warranty');
    expect(
      (await run.runtime.query('SELECT * FROM item_warranties WHERE item_id=$1', [item.id])).rows,
    ).toHaveLength(0);
  });
  it('deduplicates ready retries and rejects changed kind/content/item', async () => {
    const item = await create(),
      id = randomUUID();
    const doc = await send(item.id, 'receipt', id),
      count = put.mock.calls.length;
    expect(await send(item.id, 'receipt', id)).toEqual(doc);
    expect(put.mock.calls.length).toBe(count);
    await upload(item.id, id)
      .field('kind', 'warranty')
      .attach('document', pdf, 'synthetic.pdf')
      .expect(409);
    await upload((await create()).id, id)
      .field('kind', 'receipt')
      .attach('document', pdf, 'synthetic.pdf')
      .expect(409);
    await upload(item.id, id)
      .field('kind', 'receipt')
      .attach('document', jpeg, 'synthetic.jpg')
      .expect(409);
  });
  it('requires owner/item/document ownership for listing and download with safe headers', async () => {
    const item = await create(),
      doc = await send(item.id);
    await http().get(`/api/v1/items/${item.id}/documents`).expect(401);
    await http().get(`/api/v1/items/${foreignItem}/documents`).set('Cookie', cookie()).expect(404);
    await http()
      .get(`/api/v1/items/${foreignItem}/documents/${doc.id}/download`)
      .set('Cookie', cookie())
      .expect(404);
    await http().get(`/api/v1/items/${item.id}/documents/${doc.id}/download`).expect(401);
    await download((await create()).id, doc.id).expect(404);
    const response = await download(item.id, doc.id).expect(200);
    expect(response.headers['content-type']).toBe('application/pdf');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['cache-control']).toContain('no-store');
    expect(response.headers['content-disposition']).toBe(
      'attachment; filename="receipt.pdf"; filename*=UTF-8\'\'receipt.pdf',
    );
  });
  it('rejects header-injection/control/path filenames in processing and always generates response names', async () => {
    const item = await create();
    const doc = (
      await upload(item.id)
        .field('kind', 'receipt')
        .attach('document', pdf, { filename: 'odd";name.pdf', contentType: 'application/pdf' })
        .expect(201)
    ).body as DocumentDto;
    const response = await download(item.id, doc.id).expect(200);
    expect(response.headers['content-disposition']).not.toContain('odd');
  });
  it('enforces request, file count, image size and malformed/spoofed PDF limits', async () => {
    const item = await create(),
      count = put.mock.calls.length;
    await upload(item.id)
      .field('kind', 'receipt')
      .attach('document', pdf, 'test.pdf')
      .attach('document', pdf, 'two.pdf')
      .expect(413);
    await upload(item.id)
      .field('kind', 'receipt')
      .attach('document', Buffer.alloc(20 * 1024 * 1024 + 1), 'test.pdf')
      .expect(413);
    await upload(item.id)
      .field('kind', 'receipt')
      .attach('document', Buffer.alloc(22 * 1024 * 1024), 'test.pdf')
      .expect(413);
    await upload(item.id)
      .field('kind', 'receipt')
      .attach('document', Buffer.alloc(10 * 1024 * 1024 + 1), 'test.jpg')
      .expect(413);
    await upload(item.id)
      .field('kind', 'receipt')
      .attach('document', pdf, { filename: 'test.png', contentType: 'image/png' })
      .expect(400);
    await upload(item.id)
      .field('kind', 'receipt')
      .attach('document', pdf.subarray(0, -20), 'test.pdf')
      .expect(400);
    expect(put.mock.calls.length).toBe(count);
  });
  it('never lists documents as photos, serves them on photo routes, or accepts them in cover/order', async () => {
    const item = await create(),
      doc = await send(item.id);
    const photos = (
      await http().get(`/api/v1/items/${item.id}/photos`).set('Cookie', cookie()).expect(200)
    ).body as PhotoSnapshotDto;
    expect(photos.photos).toHaveLength(0);
    await http()
      .patch(`/api/v1/items/${item.id}/photos/order`)
      .set('Cookie', cookie())
      .send({ revision: photos.revision, photoIds: [doc.id] })
      .expect(409);
    await http()
      .get(`/api/v1/items/${item.id}/photos/${doc.id}/access/original`)
      .set('Cookie', cookie())
      .expect(404);
    await http()
      .delete(`/api/v1/items/${item.id}/photos/${doc.id}`)
      .set('Cookie', cookie())
      .send({ revision: photos.revision })
      .expect(404);
    const photoResponse = await http()
      .post(`/api/v1/items/${item.id}/photos`)
      .set('Cookie', cookie())
      .set('Upload-Id', randomUUID())
      .attach('photos', jpeg, 'photo.jpg')
      .expect(201);
    expect(
      (photoResponse.body as { results: { photo: { position: number } }[] }).results[0]!.photo
        .position,
    ).toBe(0);
    const photoId = (photoResponse.body as { results: { photo: { id: string } }[] }).results[0]!
      .photo.id;
    await download(item.id, photoId).expect(404);
    expect((await snapshot(item.id)).documents).toHaveLength(1);
  });
  it('cleans exact object on failed database publish and prevents duplicate retries', async () => {
    const item = await create(),
      id = randomUUID(),
      repo = app.get(ItemsRepository),
      original = repo.transaction.bind(repo);
    let calls = 0;
    const spy = jest.spyOn(repo, 'transaction').mockImplementation(async (ownerId, op) => {
      if (++calls === 3) throw new Error('synthetic commit failure /private/path');
      return original(ownerId, op);
    });
    const res = await upload(item.id, id)
      .field('kind', 'receipt')
      .attach('document', pdf, 'private-name.pdf')
      .expect(503);
    spy.mockRestore();
    expect(JSON.stringify(res.body)).not.toMatch(/private|path|provider|cloudinary/);
    const row = (
      await run.runtime.query<{ state: string; object_key: string; original_filename: string }>(
        'SELECT * FROM media_attachments WHERE item_id=$1',
        [item.id],
      )
    ).rows[0]!;
    expect(row.state).toBe('deleted');
    expect(row.original_filename).toBe('deleted');
    expect(objects.has(row.object_key)).toBe(false);
    await upload(item.id, id)
      .field('kind', 'receipt')
      .attach('document', pdf, 'synthetic.pdf')
      .expect(409);
  });
  it('preserves a ready object after ambiguous successful commit and recovers the response', async () => {
    const item = await create(),
      id = randomUUID(),
      repo = app.get(ItemsRepository),
      original = repo.transaction.bind(repo);
    let calls = 0;
    const spy = jest.spyOn(repo, 'transaction').mockImplementation(async (ownerId, op) => {
      const result = await original(ownerId, op);
      if (++calls === 3) throw new Error('lost ack');
      return result;
    });
    await upload(item.id, id)
      .field('kind', 'receipt')
      .attach('document', pdf, 'test.pdf')
      .expect(503);
    spy.mockRestore();
    const count = put.mock.calls.length;
    const result = await send(item.id, 'receipt', id);
    expect(result.id).toBeDefined();
    expect(put.mock.calls.length).toBe(count);
    await download(item.id, result.id).expect(200);
  });
  it('retains recoverable deleting intent after provider failures and runs existing scheduled reconciliation', async () => {
    const item = await create(),
      id = randomUUID();
    put.mockRejectedValueOnce(new Error('synthetic SDK private path'));
    remove.mockRejectedValueOnce(new Error('synthetic unavailable'));
    await upload(item.id, id)
      .field('kind', 'receipt')
      .attach('document', pdf, 'test.pdf')
      .expect(503);
    const row = (
      await run.runtime.query<{ id: string; state: string }>(
        'SELECT id,state FROM media_attachments WHERE item_id=$1',
        [item.id],
      )
    ).rows[0]!;
    expect(row.state).toBe('deleting');
    await download(item.id, row.id).expect(404);
    await run.runtime.query(
      "UPDATE media_attachments SET updated_at=now()-interval '20 minutes' WHERE item_id=$1",
      [item.id],
    );
    await app.get(PhotoRecoveryService).tick();
    expect(
      (
        await run.runtime.query<{ state: string }>(
          'SELECT state FROM media_attachments WHERE id=$1',
          [row.id],
        )
      ).rows[0]!.state,
    ).toBe('deleted');
  });
  it('keeps pending intent if failed publish cannot be re-read, then reconciles after recovery', async () => {
    const item = await create(),
      repo = app.get(ItemsRepository),
      original = repo.transaction.bind(repo);
    let calls = 0;
    const spy = jest.spyOn(repo, 'transaction').mockImplementation(async (ownerId, op) => {
      if (++calls >= 3) throw new Error('database down');
      return original(ownerId, op);
    });
    await upload(item.id).field('kind', 'receipt').attach('document', pdf, 'test.pdf').expect(503);
    spy.mockRestore();
    expect(
      (
        await run.runtime.query<{ state: string }>(
          'SELECT state FROM media_attachments WHERE item_id=$1',
          [item.id],
        )
      ).rows[0]!.state,
    ).toBe('pending');
    await run.runtime.query(
      "UPDATE media_attachments SET updated_at=now()-interval '20 minutes' WHERE item_id=$1",
      [item.id],
    );
    await app.get(MediaService).reconcile();
    expect(
      (
        await run.runtime.query<{ state: string }>(
          'SELECT state FROM media_attachments WHERE item_id=$1',
          [item.id],
        )
      ).rows[0]!.state,
    ).toBe('deleted');
  });
  it('hides deletion before provider failure, retries, scrubs metadata and survives item deletion', async () => {
    const item = await create(),
      doc = await send(item.id),
      state = await snapshot(item.id);
    remove.mockRejectedValueOnce(new Error('synthetic provider failure'));
    await http()
      .delete(`/api/v1/items/${item.id}/documents/${doc.id}`)
      .set('Cookie', cookie())
      .send({ revision: state.revision })
      .expect(503);
    expect((await snapshot(item.id)).documents).toHaveLength(0);
    await download(item.id, doc.id).expect(404);
    await http()
      .delete(`/api/v1/items/${item.id}/documents/${doc.id}`)
      .set('Cookie', cookie())
      .send({ revision: state.revision })
      .expect(200);
    const next = await send(item.id, 'warranty');
    const current = await snapshot(item.id);
    await http()
      .delete(`/api/v1/items/${item.id}`)
      .set('Cookie', cookie())
      .send({ revision: current.revision })
      .expect(204);
    expect(
      (await run.runtime.query('SELECT * FROM items WHERE id=$1', [item.id])).rows,
    ).toHaveLength(0);
    const rows = (
      await run.runtime.query<{ state: string; item_id: string | null; original_filename: string }>(
        'SELECT * FROM media_attachments WHERE id=ANY($1::uuid[])',
        [[doc.id, next.id]],
      )
    ).rows;
    expect(
      rows.every(
        (r) => r.state === 'deleted' && r.item_id === null && r.original_filename === 'deleted',
      ),
    ).toBe(true);
  });

  it('keeps deletion recoverable when the provider succeeds but metadata confirmation fails', async () => {
    const item = await create(),
      doc = await send(item.id),
      state = await snapshot(item.id);
    const { AttachmentRepository } = await import('../src/media/attachment.repository.js');
    const repo = app.get(AttachmentRepository);
    const spy = jest
      .spyOn(repo, 'markDeleted')
      .mockRejectedValueOnce(new Error('synthetic SQL detail'));
    await http()
      .delete(`/api/v1/items/${item.id}/documents/${doc.id}`)
      .set('Cookie', cookie())
      .send({ revision: state.revision })
      .expect(503);
    spy.mockRestore();
    expect(
      (
        await run.runtime.query<{ state: string }>(
          'SELECT state FROM media_attachments WHERE id=$1',
          [doc.id],
        )
      ).rows[0]!.state,
    ).toBe('deleting');
    await download(item.id, doc.id).expect(404);
    await http()
      .delete(`/api/v1/items/${item.id}/documents/${doc.id}`)
      .set('Cookie', cookie())
      .send({ revision: state.revision })
      .expect(200);
  });
  it('reserves bounded document quota and rejects stale deletion revisions', async () => {
    const item = await create(),
      doc = await send(item.id),
      state = await snapshot(item.id);
    await http()
      .delete(`/api/v1/items/${item.id}/documents/${doc.id}`)
      .set('Cookie', cookie())
      .send({ revision: state.revision - 1 })
      .expect(409);
    for (let n = 1; n < 16; n++) {
      const id = randomUUID();
      await run.runtime.query(
        "INSERT INTO media_attachments(id,owner_id,item_id,kind,variant,object_key,resource_type,format,original_filename,mime_type,byte_size,checksum) VALUES($1,$2,$3,'receipt','original',$4,'raw','pdf','receipt.pdf','application/pdf',1,$5)",
        [id, owner, item.id, `havefolio/test/${id}.pdf`, 'a'.repeat(64)],
      );
    }
    const count = put.mock.calls.length;
    await upload(item.id).field('kind', 'warranty').attach('document', pdf, 'test.pdf').expect(409);
    expect(put.mock.calls.length).toBe(count);
  });
  it('rejects changed provider bytes without delivering document contents', async () => {
    const item = await create(),
      doc = await send(item.id);
    read.mockResolvedValueOnce(Buffer.from('synthetic mismatched data'));
    const response = await download(item.id, doc.id).expect(503);
    expect(JSON.stringify(response.body)).not.toContain('mismatched');
  });

  it('erases an item even after many confirmed-deleted document tombstones', async () => {
    const item = await create();
    const doc = await send(item.id);
    const state = await snapshot(item.id);
    await run.runtime.query(
      "INSERT INTO media_attachments(id,owner_id,item_id,kind,variant,state,object_key,resource_type,format,original_filename,mime_type,byte_size,checksum) SELECT id,$1,$2,'receipt','original','deleted','havefolio/test/'||id||'.pdf','raw','pdf','deleted','application/pdf',1,$3 FROM (SELECT gen_random_uuid() AS id FROM generate_series(1,501)) s",
      [owner, item.id, '0'.repeat(64)],
    );
    const count = remove.mock.calls.length;
    await http()
      .delete(`/api/v1/items/${item.id}`)
      .set('Cookie', cookie())
      .send({ revision: state.revision })
      .expect(204);
    expect(remove.mock.calls.length).toBe(count + 1);
    expect(
      (await run.runtime.query('SELECT * FROM media_attachments WHERE item_id=$1', [item.id])).rows,
    ).toHaveLength(0);
    expect(
      (
        await run.runtime.query<{ state: string }>(
          'SELECT state FROM media_attachments WHERE id=$1',
          [doc.id],
        )
      ).rows[0]!.state,
    ).toBe('deleted');
  });
  it('publishes multipart and safe download OpenAPI contracts', () => {
    const schema = SwaggerModule.createDocument(app, new DocumentBuilder().addCookieAuth().build());
    const post = schema.paths['/api/v1/items/{itemId}/documents']!.post!;
    expect(post.requestBody).toHaveProperty('content.multipart/form-data.schema.required', [
      'kind',
      'document',
    ]);
    for (const code of ['201', '400', '401', '404', '409', '413', '503'])
      expect(post.responses[code]).toBeDefined();
    expect(
      schema.paths['/api/v1/items/{itemId}/documents/{documentId}/download']!.get!.responses['200'],
    ).toHaveProperty('headers.Content-Disposition');
  });
});
