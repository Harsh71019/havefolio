import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, describe, expect, it, jest } from '@jest/globals';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import request from 'supertest';
import sharp from 'sharp';
import { IntegrationRun, integrationConfiguration } from '@havefolio/test-utils';
import { validateApiEnvironment } from '@havefolio/config';
import { AuthModule } from '../src/auth/auth.module.js';
import { newToken, hashToken } from '../src/auth/session-cookie.service.js';
import { configureApplication } from '../src/app.setup.js';
import { ItemsModule } from '../src/items/items.module.js';
import { ItemsRepository } from '../src/items/items.repository.js';
import { PrivateMediaStorage, type StoreInput } from '../src/media/storage.js';
import { MediaService } from '../src/media/media.service.js';
import type { PhotoSnapshotDto, PhotoUploadDto } from '../src/media/item-photos.dto.js';
jest.setTimeout(60000);
describe('private item photo HTTP and recovery', () => {
  const run = new IntegrationRun(integrationConfiguration());
  const owner = randomUUID(),
    other = randomUUID(),
    token = newToken();
  let app: NestExpressApplication;
  let bytes: Buffer;
  const stored = new Map<string, Buffer>();
  const put = jest.fn(async (input: StoreInput) => {
    stored.set(input.key, Buffer.from(input.bytes));
    const m = await sharp(input.bytes).metadata();
    return { assetId: randomUUID(), version: 1, width: m.width, height: m.height };
  });
  const remove = jest.fn<(key: string) => Promise<void>>().mockResolvedValue(undefined);
  const http = (): ReturnType<typeof request> => request(app.getHttpServer());
  const create = async (): Promise<{ id: string; revision: number }> =>
    (
      await http()
        .post('/api/v1/items')
        .set('Cookie', `havefolio_session=${token}`)
        .send({ name: 'Synthetic photo item', currency: 'INR', ownershipStatus: 'owned' })
        .expect(201)
    ).body as { id: string; revision: number };
  const upload = (
    item: string,
    id = randomUUID(),
  ): ReturnType<ReturnType<typeof request>['post']> =>
    http()
      .post(`/api/v1/items/${item}/photos`)
      .set('Cookie', `havefolio_session=${token}`)
      .set('Upload-Id', id);
  const snapshot = async (item: string): Promise<PhotoSnapshotDto> =>
    (
      await http()
        .get(`/api/v1/items/${item}/photos`)
        .set('Cookie', `havefolio_session=${token}`)
        .expect(200)
    ).body as PhotoSnapshotDto;
  beforeAll(async () => {
    await run.start();
    await run.runtime.query(
      "INSERT INTO users(id,email,password_hash) VALUES($1,'photo-owner@example.test','$argon2id$fixture'),($2,NULL,NULL)",
      [owner, other],
    );
    await run.runtime.query(
      "INSERT INTO auth_sessions(owner_id,token_hash,idle_expires_at,absolute_expires_at) VALUES($1,$2,now()+interval '1 hour',now()+interval '1 day')",
      [owner, hashToken(token)],
    );
    const url = new URL(integrationConfiguration().runtimeUrl);
    url.searchParams.set('options', `-c search_path=${run.schema},pg_catalog`);
    const module = await Test.createTestingModule({
      imports: [
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
        download: () => 'https://example.test/short-lived-synthetic',
        read: (key: string) => Promise.resolve(Buffer.from(stored.get(key) ?? Buffer.alloc(0))),
      })
      .compile();
    app = module.createNestApplication<NestExpressApplication>({ logger: false });
    configureApplication(app);
    await app.init();
    bytes = await sharp({ create: { width: 80, height: 60, channels: 3, background: '#abcdef' } })
      .jpeg()
      .toBuffer();
  });
  afterAll(async () => {
    await app?.close();
    await run.close();
  });
  it('enforces authentication, ownership and multipart fields before provider work', async () => {
    const item = await create();
    await http()
      .post(`/api/v1/items/${item.id}/photos`)
      .set('Upload-Id', randomUUID())
      .attach('photos', bytes, 'synthetic.jpg')
      .expect(401);
    const foreign = (
      await run.runtime.query<{ id: string }>(
        "INSERT INTO items(owner_id,name,currency,original_entry,original_source) VALUES($1,'Foreign','INR','{}','manual') RETURNING id",
        [other],
      )
    ).rows[0]!.id;
    await upload(foreign).attach('photos', bytes, 'synthetic.jpg').expect(404);
    await upload(item.id)
      .field('ownerId', other)
      .attach('photos', bytes, 'synthetic.jpg')
      .expect(400);
    await upload(item.id).attach('unexpected', bytes, 'synthetic.jpg').expect(400);
    expect(put).not.toHaveBeenCalled();
  });
  it('atomically links three outputs, strips secrets, supports retry and short-lived access', async () => {
    const item = await create(),
      id = randomUUID();
    const res = await upload(item.id, id).attach('photos', bytes, 'synthetic.jpg').expect(201);
    const body = res.body as PhotoUploadDto;
    expect(body.results[0]!.photo?.cover).toBe(true);
    const count = put.mock.calls.length;
    const retry = await upload(item.id, id).attach('photos', bytes, 'synthetic.jpg').expect(201);
    expect(retry.body).toEqual(body);
    expect(put.mock.calls.length).toBe(count);
    const rows = await run.runtime.query<{
      owner_id: string;
      item_id: string;
      state: string;
      original_filename: string;
    }>('SELECT * FROM media_attachments WHERE item_id=$1', [item.id]);
    expect(rows.rows).toHaveLength(3);
    for (const row of rows.rows) {
      expect(row.owner_id).toBe(owner);
      expect(row.item_id).toBe(item.id);
      expect(row.state).toBe('ready');
      expect(row.original_filename).toBe('sanitized.webp');
    }
    expect(JSON.stringify(body)).not.toMatch(/havefolio\/|assetId|objectKey|cloudinary|https/);
    await http()
      .get(`/api/v1/items/${item.id}/photos/${body.results[0]!.photo!.id}/access/thumbnail`)
      .set('Cookie', `havefolio_session=${token}`)
      .expect(200);
  });
  it('reports partial format failure without raw uploads', async () => {
    const item = await create();
    const res = await upload(item.id)
      .attach('photos', bytes, 'synthetic.jpg')
      .attach('photos', bytes, { filename: 'spoof.png', contentType: 'image/png' })
      .expect(201);
    const body = res.body as PhotoUploadDto;
    expect(body.results[0]!.photo).toBeDefined();
    expect(body.results[1]!.error).toBe('PHOTO_FORMAT_MISMATCH');
    expect((await snapshot(item.id)).photos).toHaveLength(1);
  });
  it('serializes order and cover updates and chooses replacement after deletion', async () => {
    const item = await create();
    await upload(item.id)
      .attach('photos', bytes, 'one.jpg')
      .attach('photos', bytes, 'two.jpg')
      .expect(201);
    const state = await snapshot(item.id),
      ids = state.photos.map((p) => p.id).reverse();
    const updates = await Promise.all(
      [1, 2].map(() =>
        http()
          .patch(`/api/v1/items/${item.id}/photos/order`)
          .set('Cookie', `havefolio_session=${token}`)
          .send({ revision: state.revision, photoIds: ids }),
      ),
    );
    expect(updates.map((r) => r.status).sort()).toEqual([200, 409]);
    const ordered = await snapshot(item.id);
    expect(ordered.photos[0]!.id).toBe(ids[0]);
    expect(ordered.photos[0]!.cover).toBe(true);
    await http()
      .delete(`/api/v1/items/${item.id}/photos/${ids[0]}`)
      .set('Cookie', `havefolio_session=${token}`)
      .send({ revision: ordered.revision })
      .expect(200);
    expect((await snapshot(item.id)).photos[0]!.cover).toBe(true);
  });
  it('retains pending family after provider failure and reconciles exact keys', async () => {
    const item = await create();
    put.mockRejectedValueOnce(new Error('private provider detail'));
    const res = await upload(item.id).attach('photos', bytes, 'private-name.jpg').expect(201);
    expect(JSON.stringify(res.body)).not.toContain('private');
    const rows = (
      await run.runtime.query<{ state: string }>(
        'SELECT state FROM media_attachments WHERE item_id=$1',
        [item.id],
      )
    ).rows;
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.state === 'pending')).toBe(true);
    expect((await snapshot(item.id)).photos).toHaveLength(0);
    await run.runtime.query(
      "UPDATE media_attachments SET updated_at=now()-interval '20 minutes' WHERE item_id=$1",
      [item.id],
    );
    const media = app.get(MediaService);
    await media.reconcile();
    await media.reconcile();
    expect(
      (
        await run.runtime.query<{ state: string }>(
          'SELECT state FROM media_attachments WHERE item_id=$1',
          [item.id],
        )
      ).rows.every((r) => r.state === 'deleted'),
    ).toBe(true);
  });
  it('keeps intent on final database failure and retries without duplicates', async () => {
    const item = await create(),
      id = randomUUID();
    const repo = app.get(ItemsRepository),
      original = repo.transaction.bind(repo);
    let calls = 0;
    const spy = jest.spyOn(repo, 'transaction').mockImplementation(async (ownerId, operation) => {
      calls++;
      if (calls === 3) throw new Error('synthetic commit failure');
      return original(ownerId, operation);
    });
    const result = await upload(item.id, id).attach('photos', bytes, 'synthetic.jpg').expect(201);
    spy.mockRestore();
    expect((result.body as PhotoUploadDto).results[0]!.error).toBe('PHOTO_UPLOAD_FAILED');
    expect((await snapshot(item.id)).photos).toHaveLength(0);
    const retry = await upload(item.id, id).attach('photos', bytes, 'synthetic.jpg').expect(201);
    expect((retry.body as PhotoUploadDto).results[0]!.error).toBe('PHOTO_UPLOAD_PENDING');
  });
  it('recovers an ambiguous successful database commit without another provider write', async () => {
    const item = await create(),
      id = randomUUID();
    const repo = app.get(ItemsRepository),
      original = repo.transaction.bind(repo);
    let calls = 0;
    const spy = jest.spyOn(repo, 'transaction').mockImplementation(async (ownerId, operation) => {
      calls++;
      const result = await original(ownerId, operation);
      if (calls === 3) throw new Error('synthetic lost commit acknowledgement');
      return result;
    });
    await upload(item.id, id).attach('photos', bytes, 'synthetic.jpg').expect(201);
    spy.mockRestore();
    const count = put.mock.calls.length;
    const retry = await upload(item.id, id).attach('photos', bytes, 'synthetic.jpg').expect(201);
    expect((retry.body as PhotoUploadDto).results[0]!.photo).toBeDefined();
    expect(put.mock.calls.length).toBe(count);
  });
  it('accepts exactly four photo parts at the multipart boundary', async () => {
    const item = await create();
    const response = await upload(item.id)
      .attach('photos', bytes, '1.jpg')
      .attach('photos', bytes, '2.jpg')
      .attach('photos', bytes, '3.jpg')
      .attach('photos', bytes, '4.jpg')
      .expect(201);
    expect((response.body as PhotoUploadDto).results.every((result) => result.photo)).toBe(true);
    expect((await snapshot(item.id)).photos).toHaveLength(4);
  });
  it('rejects hard multipart request, per-file and file-count limits', async () => {
    const item = await create();
    await upload(item.id)
      .attach('photos', Buffer.alloc(10 * 1024 * 1024), 'one.jpg')
      .attach('photos', Buffer.alloc(10 * 1024 * 1024), 'two.jpg')
      .attach('photos', Buffer.alloc(2 * 1024 * 1024), 'three.jpg')
      .expect(413);
    await upload(item.id)
      .attach('photos', Buffer.alloc(10 * 1024 * 1024 + 1), 'oversize.jpg')
      .expect(413);
    await upload(item.id)
      .attach('photos', bytes, '1.jpg')
      .attach('photos', bytes, '2.jpg')
      .attach('photos', bytes, '3.jpg')
      .attach('photos', bytes, '4.jpg')
      .attach('photos', bytes, '5.jpg')
      .expect(413);
  });
  it('hides a partially deleted family and retries exact-key deletion', async () => {
    const item = await create();
    await upload(item.id).attach('photos', bytes, 'synthetic.jpg').expect(201);
    const state = await snapshot(item.id),
      photo = state.photos[0]!;
    remove.mockRejectedValueOnce(new Error('synthetic provider failure'));
    await http()
      .delete(`/api/v1/items/${item.id}/photos/${photo.id}`)
      .set('Cookie', `havefolio_session=${token}`)
      .send({ revision: state.revision })
      .expect(503);
    expect((await snapshot(item.id)).photos).toHaveLength(0);
    expect(
      (
        await run.runtime.query<{ state: string }>(
          'SELECT state FROM media_attachments WHERE item_id=$1',
          [item.id],
        )
      ).rows.every((r) => r.state === 'deleting'),
    ).toBe(true);
    await http()
      .get(`/api/v1/items/${item.id}/photos/${photo.id}/access/thumbnail`)
      .set('Cookie', `havefolio_session=${token}`)
      .expect(404);
    await http()
      .get(`/api/v1/items/${item.id}/photos/${photo.id}/access/original`)
      .set('Cookie', `havefolio_session=${token}`)
      .expect(404);
    await http()
      .delete(`/api/v1/items/${item.id}/photos/${photo.id}`)
      .set('Cookie', `havefolio_session=${token}`)
      .send({ revision: state.revision })
      .expect(200);
  });
  it('persists bounded owner alt text and explicit decorative state', async () => {
    const item = await create();
    await upload(item.id).attach('photos', bytes, 'IMG_0001.jpg').expect(201);
    let state = await snapshot(item.id);
    const photo = state.photos[0]!;
    expect(photo).toMatchObject({ altText: null, decorative: false });
    const describe = (body: object): ReturnType<ReturnType<typeof request>['patch']> =>
      http()
        .patch(`/api/v1/items/${item.id}/photos/${photo.id}`)
        .set('Cookie', `havefolio_session=${token}`)
        .send(body);
    state = (
      await describe({
        revision: state.revision,
        altText: '  Blue kettle on the counter  ',
        decorative: false,
      }).expect(200)
    ).body as PhotoSnapshotDto;
    expect(state.photos[0]).toMatchObject({
      altText: 'Blue kettle on the counter',
      decorative: false,
    });
    await describe({ revision: state.revision - 1, altText: 'Stale', decorative: false }).expect(
      409,
    );
    for (const invalid of [
      { revision: state.revision, altText: 'x'.repeat(251), decorative: false },
      { revision: state.revision, altText: 'Not empty', decorative: true },
      { revision: state.revision, altText: 'Tab\tcontrol', decorative: false },
      { revision: state.revision, decorative: false },
      { revision: state.revision, altText: 'Extra', decorative: false, ownerId: other },
    ])
      await describe(invalid).expect(400);
    await describe({ revision: state.revision, altText: '😀'.repeat(250), decorative: false })
      .expect(200)
      .then((r) => (state = r.body as PhotoSnapshotDto));
    state = (
      await describe({ revision: state.revision, altText: null, decorative: true }).expect(200)
    ).body as PhotoSnapshotDto;
    expect(state.photos[0]).toMatchObject({ altText: null, decorative: true });
    state = (
      await describe({ revision: state.revision, altText: '', decorative: false }).expect(200)
    ).body as PhotoSnapshotDto;
    expect(state.photos[0]).toMatchObject({ altText: null, decorative: false });
    await http()
      .patch(`/api/v1/items/${item.id}/photos/${randomUUID()}`)
      .set('Cookie', `havefolio_session=${token}`)
      .send({ revision: state.revision, altText: 'Missing', decorative: false })
      .expect(404);
    await expect(
      run.runtime.query("UPDATE media_attachments SET alt_text='Variant' WHERE parent_id=$1", [
        photo.id,
      ]),
    ).rejects.toThrow();
    await describe({ revision: state.revision, altText: 'Private words', decorative: false })
      .expect(200)
      .then((r) => (state = r.body as PhotoSnapshotDto));
    await http()
      .delete(`/api/v1/items/${item.id}/photos/${photo.id}`)
      .set('Cookie', `havefolio_session=${token}`)
      .send({ revision: state.revision })
      .expect(200);
    const tombstone = await run.runtime.query<{ alt_text: string | null }>(
      'SELECT alt_text FROM media_attachments WHERE id=$1',
      [photo.id],
    );
    expect(tombstone.rows[0]!.alt_text).toBeNull();
  });
  it('delivers verified same-origin variant bytes without provider details', async () => {
    const item = await create();
    await upload(item.id).attach('photos', bytes, 'synthetic.jpg').expect(201);
    const photo = (await snapshot(item.id)).photos[0]!;
    const path = `/api/v1/items/${item.id}/photos/${photo.id}/content`;
    const res = await http()
      .get(`${path}/thumbnail`)
      .set('Cookie', `havefolio_session=${token}`)
      .buffer(true)
      .expect(200);
    expect(res.headers['content-type']).toBe('image/webp');
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['content-disposition']).toBe('inline');
    expect(JSON.stringify(res.headers)).not.toMatch(/havefolio\/|cloudinary|example\.test/);
    expect((await sharp(res.body as Buffer).metadata()).format).toBe('webp');
    await http().get(`${path}/display`).set('Cookie', `havefolio_session=${token}`).expect(200);
    await http().get(`${path}/display`).expect(401);
    await http().get(`${path}/original`).set('Cookie', `havefolio_session=${token}`).expect(400);
    await http()
      .get(`/api/v1/items/${item.id}/photos/${randomUUID()}/content/thumbnail`)
      .set('Cookie', `havefolio_session=${token}`)
      .expect(404);
    for (const key of stored.keys()) stored.set(key, Buffer.from('tampered'));
    const tampered = await http()
      .get(`${path}/thumbnail`)
      .set('Cookie', `havefolio_session=${token}`)
      .expect(503);
    expect(JSON.stringify(tampered.body)).not.toMatch(/havefolio\/|cloudinary|example\.test/);
  });
  it('excludes receipts and warranties from gallery, cover, description and delivery', async () => {
    const item = await create();
    await upload(item.id).attach('photos', bytes, 'synthetic.jpg').expect(201);
    const documents: string[] = [];
    for (const kind of ['receipt', 'warranty']) {
      const id = randomUUID();
      documents.push(id);
      await run.runtime.query(
        "INSERT INTO media_attachments(id,owner_id,item_id,kind,variant,state,object_key,resource_type,format,provider_asset_id,provider_version,original_filename,mime_type,byte_size,checksum) VALUES($1,$2,$3,$4,'original','ready',$5,'raw','pdf',$6,1,'synthetic.pdf','application/pdf',10,$7)",
        [id, owner, item.id, kind, `havefolio/test/${id}.pdf`, randomUUID(), 'b'.repeat(64)],
      );
    }
    const state = await snapshot(item.id);
    expect(state.photos.map((p) => p.id)).not.toEqual(expect.arrayContaining(documents));
    expect(state.photos).toHaveLength(1);
    for (const id of documents) {
      await http()
        .patch(`/api/v1/items/${item.id}/photos/order`)
        .set('Cookie', `havefolio_session=${token}`)
        .send({ revision: state.revision, photoIds: [id, state.photos[0]!.id] })
        .expect(409);
      await http()
        .patch(`/api/v1/items/${item.id}/photos/${id}`)
        .set('Cookie', `havefolio_session=${token}`)
        .send({ revision: state.revision, altText: 'Receipt', decorative: false })
        .expect(404);
      await http()
        .get(`/api/v1/items/${item.id}/photos/${id}/content/display`)
        .set('Cookie', `havefolio_session=${token}`)
        .expect(404);
    }
    await expect(
      run.runtime.query("UPDATE media_attachments SET alt_text='Receipt' WHERE id=$1", [
        documents[0],
      ]),
    ).rejects.toThrow();
    expect((await snapshot(item.id)).photos[0]!.cover).toBe(true);
  });
  it('publishes multipart, response and failure contracts', () => {
    const doc = SwaggerModule.createDocument(app, new DocumentBuilder().addCookieAuth().build());
    const endpoint = doc.paths['/api/v1/items/{itemId}/photos']!.post!;
    expect(endpoint.requestBody).toHaveProperty('content.multipart/form-data');
    for (const code of ['201', '400', '401', '404', '409', '413', '503'])
      expect(endpoint.responses[code]).toBeDefined();
    const photo = doc.paths['/api/v1/items/{itemId}/photos/{photoId}']!;
    expect(photo.patch?.requestBody).toHaveProperty('content.application/json');
    expect(
      doc.paths['/api/v1/items/{itemId}/photos/{photoId}/content/{variant}']?.get,
    ).toBeDefined();
  });
});
