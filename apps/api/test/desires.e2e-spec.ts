import { TelemetryModule } from '@havefolio/logging';
import { randomUUID } from 'node:crypto';
import { beforeAll, beforeEach, afterAll, describe, expect, it, jest } from '@jest/globals';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import request, { type Test as HttpTest } from 'supertest';
import sharp from 'sharp';
import { IntegrationRun, integrationConfiguration } from '@havefolio/test-utils';
import { validateApiEnvironment } from '@havefolio/config';
import { AuthModule } from '../src/auth/auth.module.js';
import { newToken, hashToken } from '../src/auth/session-cookie.service.js';
import { configureApplication } from '../src/app.setup.js';
import { DesiresModule } from '../src/desires/desires.module.js';
import { DesiresService } from '../src/desires/desires.service.js';
import { PrivateMediaStorage, type StoreInput } from '../src/media/storage.js';
import type {
  DesireDto,
  DesiresPageDto,
  DesirePhotoDto,
  CreateDesireDto,
} from '../src/desires/desires.dto.js';

jest.setTimeout(60000);

describe('desire records, waiting periods, keyset pagination and private photo lifecycle', () => {
  const run = new IntegrationRun(integrationConfiguration());
  const owner = randomUUID(),
    other = randomUUID(),
    token = newToken();
  let app: NestExpressApplication;
  let service: DesiresService;
  let samplePhotoBytes: Buffer;
  const storedMedia = new Map<string, Buffer>();

  const put = jest.fn(async (input: StoreInput) => {
    storedMedia.set(input.key, Buffer.from(input.bytes));
    const m = await sharp(input.bytes).metadata();
    return {
      assetId: randomUUID(),
      version: 1,
      width: m.width ?? 80,
      height: m.height ?? 60,
    };
  });
  const providerDelete = jest
    .fn<(key: string, resourceType?: string) => Promise<void>>()
    .mockResolvedValue(undefined);

  const http = (): ReturnType<typeof request> => request(app.getHttpServer());

  const post = (path: string, body: object): HttpTest =>
    http()
      .post('/api/v1/desires' + path)
      .set('Cookie', `havefolio_session=${token}`)
      .send(body);

  const get = (path: string): HttpTest =>
    http()
      .get('/api/v1/desires' + path)
      .set('Cookie', `havefolio_session=${token}`);

  const patch = (id: string, body: object): HttpTest =>
    http()
      .patch('/api/v1/desires/' + id)
      .set('Cookie', `havefolio_session=${token}`)
      .send(body);

  const remove = (id: string, revision: number): HttpTest =>
    http()
      .delete('/api/v1/desires/' + id)
      .set('Cookie', `havefolio_session=${token}`)
      .send({ revision });

  const createMinimal = async (name = 'Synthetic desire'): Promise<DesireDto> =>
    (await post('', { name }).expect(201)).body as DesireDto;

  beforeAll(async () => {
    await run.start();
    await run.runtime.query(
      "INSERT INTO users(id,email,password_hash) VALUES($1,'desire-owner@example.test','$argon2id$fixture'),($2,NULL,NULL)",
      [owner, other],
    );
    await run.runtime.query(
      "INSERT INTO auth_sessions(owner_id,token_hash,idle_expires_at,absolute_expires_at) VALUES($1,$2,now()+interval '1 hour',now()+interval '1 day')",
      [owner, hashToken(token)],
    );

    const config = integrationConfiguration(),
      url = new URL(config.runtimeUrl);
    url.searchParams.set('options', `-c search_path=${run.schema},pg_catalog`);

    const module = await Test.createTestingModule({
      imports: [
        TelemetryModule.register('api'),
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, ignoreEnvVars: true }),
        AuthModule,
        DesiresModule,
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
        delete: providerDelete,
        download: () => 'https://example.test/short-lived-synthetic',
        read: (key: string) =>
          Promise.resolve(Buffer.from(storedMedia.get(key) ?? Buffer.alloc(0))),
      })
      .compile();

    service = module.get(DesiresService);
    app = module.createNestApplication<NestExpressApplication>({ logger: false });
    configureApplication(app);
    await app.listen(0, '127.0.0.1');

    samplePhotoBytes = await sharp({
      create: { width: 100, height: 80, channels: 3, background: '#123456' },
    })
      .jpeg()
      .toBuffer();
  });

  afterAll(async () => {
    service?.resetClock();
    await app?.close();
    await run.close();
  });

  it('requires authentication on every endpoint and rejects caller identities', async () => {
    const id = randomUUID();
    await http().post('/api/v1/desires').send({ name: 'Unauthenticated' }).expect(401);
    await http().get('/api/v1/desires').expect(401);
    await http()
      .get('/api/v1/desires/' + id)
      .expect(401);
    await http()
      .patch('/api/v1/desires/' + id)
      .send({ revision: 1, name: 'Changed' })
      .expect(401);
    await http()
      .delete('/api/v1/desires/' + id)
      .send({ revision: 1 })
      .expect(401);
    await http().post(`/api/v1/desires/${id}/photo`).expect(401);
    await http().get(`/api/v1/desires/${id}/photo`).expect(401);
    await http().get(`/api/v1/desires/${id}/photo/content/thumbnail`).expect(401);
    await http().delete(`/api/v1/desires/${id}/photo`).expect(401);

    // Caller identity injection rejection
    await post('', { name: 'Attempted spoof', ownerId: other }).expect(400);
    await post('', { name: 'Attempted id', id }).expect(400);
  });

  it('creates minimal desire with only name, returning default values and Cache-Control: no-store', async () => {
    const res = await post('', { name: '  Espresso Machine  ' }).expect(201);
    expect(res.headers['cache-control']).toBe('no-store');
    const desire = res.body as DesireDto;

    expect(desire).toMatchObject({
      name: 'Espresso Machine',
      classification: null,
      likelyPriceMinor: null,
      currency: null,
      productUrl: null,
      reason: null,
      status: 'considering',
      effectiveState: 'considering',
      waitingStartedAt: null,
      reviewAt: null,
      photo: null,
      revision: 1,
    });
    expect(desire.id).toBeDefined();
    expect(desire.createdAt).toBeDefined();
    expect(desire.updatedAt).toBeDefined();

    // Sensitive or invalid fields must not exist
    expect(desire).not.toHaveProperty('ownerId');
    expect(desire).not.toHaveProperty('actualPricePaid');
    expect(desire).not.toHaveProperty('savedMoney');
    expect(desire).not.toHaveProperty('avoidedSpend');
  });

  it('creates full desire with all optional fields and valid waiting period', async () => {
    const now = new Date();
    const waitingStartedAt = new Date(now.getTime() - 1000).toISOString();
    const reviewAt = new Date(now.getTime() + 7 * 24 * 3600 * 1000).toISOString();

    const input: CreateDesireDto = {
      name: 'Ergonomic Chair',
      classification: 'want',
      likelyPriceMinor: '2500000',
      currency: 'INR',
      productUrl: 'https://example.com/products/chair?ref=123',
      reason: 'Support lower back during long programming sessions',
      waitingPeriod: {
        startedAt: waitingStartedAt,
        reviewAt,
      },
    };

    const res = await post('', input).expect(201);
    const desire = res.body as DesireDto;

    expect(desire).toMatchObject({
      name: 'Ergonomic Chair',
      classification: 'want',
      likelyPriceMinor: '2500000',
      currency: 'INR',
      productUrl: 'https://example.com/products/chair?ref=123',
      reason: 'Support lower back during long programming sessions',
      status: 'waiting',
      effectiveState: 'waiting',
      waitingStartedAt,
      reviewAt,
      photo: null,
      revision: 1,
    });
    const intent = await run.runtime.query<{
      schedule_version: number;
      scheduled_for: Date;
      state: string;
    }>(
      'SELECT schedule_version,scheduled_for,state FROM desire_reminders WHERE desire_id=$1 AND owner_id=$2',
      [desire.id, owner],
    );
    expect(intent.rows).toEqual([
      {
        schedule_version: 1,
        scheduled_for: new Date(reviewAt),
        state: 'pending',
      },
    ]);
  });

  it('validates likely price semantics: explicit zero, bigint, pair constraints, and rejects invalid inputs', async () => {
    // Explicit zero is allowed
    const zeroPrice = await post('', {
      name: 'Free Software Trial',
      likelyPriceMinor: '0',
      currency: 'USD',
    }).expect(201);
    expect(zeroPrice.body.likelyPriceMinor).toBe('0');
    expect(zeroPrice.body.currency).toBe('USD');

    // Max bigint is allowed
    const maxBigint = await post('', {
      name: 'Very Expensive Aircraft',
      likelyPriceMinor: '9223372036854775807',
      currency: 'JPY',
    }).expect(201);
    expect(maxBigint.body.likelyPriceMinor).toBe('9223372036854775807');

    // Rejections
    for (const invalid of [
      { name: 'Missing currency', likelyPriceMinor: '500' },
      { name: 'Missing price', currency: 'INR' },
      { name: 'Negative price', likelyPriceMinor: '-1', currency: 'INR' },
      { name: 'Float price', likelyPriceMinor: '12.50', currency: 'INR' },
      { name: 'Over max bigint', likelyPriceMinor: '9223372036854775808', currency: 'INR' },
      { name: 'Invalid currency code', likelyPriceMinor: '500', currency: 'ZZZ' },
      { name: 'Lowercase currency code', likelyPriceMinor: '500', currency: 'inr' },
      { name: 'Numeric currency code', likelyPriceMinor: '500', currency: '356' },
    ]) {
      await post('', invalid).expect(400);
    }
  });

  it('validates URLs, names, classifications and waiting period constraints on creation', async () => {
    for (const invalid of [
      { name: '' },
      { name: '   ' },
      { name: 'a'.repeat(301) },
      { name: 'Valid', classification: 'luxury' },
      { name: 'Valid', productUrl: 'ftp://files.example.com/item' },
      { name: 'Valid', productUrl: 'javascript:alert(1)' },
      { name: 'Valid', productUrl: 'not-a-url' },
      { name: 'Valid', reason: 'a'.repeat(2001) },
      // Invalid waiting period: reviewAt before startedAt
      {
        name: 'Valid',
        waitingPeriod: {
          startedAt: new Date(Date.now() + 10000).toISOString(),
          reviewAt: new Date(Date.now() + 5000).toISOString(),
        },
      },
      // Invalid waiting period: reviewAt in the past
      {
        name: 'Valid',
        waitingPeriod: {
          startedAt: new Date(Date.now() - 20000).toISOString(),
          reviewAt: new Date(Date.now() - 10000).toISOString(),
        },
      },
    ]) {
      await post('', invalid).expect(400);
    }
  });

  it('isolates owners: foreign resources return 404 indistinguishable from missing', async () => {
    const foreign = await service.create(other, { name: 'Foreign Secret Desire' });
    const foreignId = foreign.id;
    const missingId = randomUUID();

    for (const id of [foreignId, missingId]) {
      const getRes = await get('/' + id).expect(404);
      expect(getRes.body.message).toBe('DESIRE_NOT_FOUND');

      const patchRes = await patch(id, { revision: 1, name: 'Hack' }).expect(404);
      expect(patchRes.body.message).toBe('DESIRE_NOT_FOUND');

      const delRes = await remove(id, 1).expect(404);
      expect(delRes.body.message).toBe('DESIRE_NOT_FOUND');

      await http()
        .post(`/api/v1/desires/${id}/photo`)
        .set('Cookie', `havefolio_session=${token}`)
        .set('Upload-Id', randomUUID())
        .attach('photo', samplePhotoBytes, 'test.jpg')
        .expect(404);

      await http()
        .get(`/api/v1/desires/${id}/photo`)
        .set('Cookie', `havefolio_session=${token}`)
        .expect(404);

      await http()
        .delete(`/api/v1/desires/${id}/photo`)
        .set('Cookie', `havefolio_session=${token}`)
        .send({ revision: 1 })
        .expect(404);
    }

    // List never includes foreign desires
    const listRes = await get('').expect(200);
    const ids = (listRes.body as DesiresPageDto).items.map((i) => i.id);
    expect(ids).not.toContain(foreignId);
  });

  it('implements bounded keyset pagination with deterministic order and cursor validation', async () => {
    const ids: string[] = [];
    let after: string | undefined;

    do {
      const result = await get(
        '?limit=2' + (after ? '&after=' + encodeURIComponent(after) : ''),
      ).expect(200);
      const page = result.body as DesiresPageDto;
      expect(page.items.length).toBeLessThanOrEqual(2);
      ids.push(...page.items.map((i) => i.id));
      after = page.nextCursor ?? undefined;
      expect(page.hasMore).toBe(Boolean(after));
    } while (after);

    expect(new Set(ids).size).toBe(ids.length);

    // Rejects cursor tampering / mismatch
    await get('?after=invalid-cursor-string').expect(400);

    // Query mismatch with cursor
    const p1 = (await get('?limit=1').expect(200)).body as DesiresPageDto;
    if (p1.nextCursor) {
      await get(`?after=${encodeURIComponent(p1.nextCursor)}&effectiveState=waiting`).expect(400);
    }

    // Invalid limits
    await get('?limit=0').expect(400);
    await get('?limit=101').expect(400);
  });

  it('filters desires by effective state and classification', async () => {
    const d1 = await post('', { name: 'Filtered Need Desire', classification: 'need' }).expect(201);
    const d2 = await post('', {
      name: 'Filtered Want Waiting Desire',
      classification: 'want',
      waitingPeriod: {
        reviewAt: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
      },
    }).expect(201);

    // Filter by classification
    const needRes = (await get('?classification=need').expect(200)).body as DesiresPageDto;
    expect(needRes.items.map((i) => i.id)).toContain(d1.body.id);
    expect(needRes.items.map((i) => i.id)).not.toContain(d2.body.id);

    const wantRes = (await get('?classification=want').expect(200)).body as DesiresPageDto;
    expect(wantRes.items.map((i) => i.id)).toContain(d2.body.id);

    // Filter by effectiveState
    const consideringRes = (await get('?effectiveState=considering').expect(200))
      .body as DesiresPageDto;
    expect(consideringRes.items.map((i) => i.id)).toContain(d1.body.id);
    expect(consideringRes.items.map((i) => i.id)).not.toContain(d2.body.id);

    const waitingRes = (await get('?effectiveState=waiting').expect(200)).body as DesiresPageDto;
    expect(waitingRes.items.map((i) => i.id)).toContain(d2.body.id);
    expect(waitingRes.items.map((i) => i.id)).not.toContain(d1.body.id);
  });

  it('supports optimistic concurrency with revision control and rejects stale mutations', async () => {
    const desire = await createMinimal('Concurrency Test Item');
    expect(desire.revision).toBe(1);

    // Stale revision returns 409
    const staleRes = await patch(desire.id, { revision: 999, name: 'Stale' }).expect(409);
    expect(staleRes.body.message).toBe('STALE_DESIRE_REVISION');

    // Empty patch rejected
    await patch(desire.id, { revision: 1 }).expect(400);

    // Successful patch increments revision to 2
    const updated = (
      await patch(desire.id, { revision: 1, name: 'Updated Concurrency Item' }).expect(200)
    ).body as DesireDto;
    expect(updated.revision).toBe(2);
    expect(updated.name).toBe('Updated Concurrency Item');

    // Old revision 1 now fails
    await patch(desire.id, { revision: 1, name: 'Try again with rev 1' }).expect(409);
  });

  it('allows clearing optional fields (classification, price, url, reason) explicitly with null', async () => {
    const full = (
      await post('', {
        name: 'Full Item to Clear',
        classification: 'greed',
        likelyPriceMinor: '9900',
        currency: 'USD',
        productUrl: 'https://example.com/clear',
        reason: 'Temporary impulse',
      }).expect(201)
    ).body as DesireDto;

    // Clearing one by one
    const p1 = (
      await patch(full.id, {
        revision: 1,
        classification: null,
      }).expect(200)
    ).body as DesireDto;
    expect(p1.classification).toBeNull();
    expect(p1.revision).toBe(2);

    const p2 = (
      await patch(full.id, {
        revision: 2,
        likelyPriceMinor: null,
        currency: null,
      }).expect(200)
    ).body as DesireDto;
    expect(p2.likelyPriceMinor).toBeNull();
    expect(p2.currency).toBeNull();
    expect(p2.revision).toBe(3);

    const p3 = (
      await patch(full.id, {
        revision: 3,
        productUrl: null,
        reason: null,
      }).expect(200)
    ).body as DesireDto;
    expect(p3.productUrl).toBeNull();
    expect(p3.reason).toBeNull();
    expect(p3.revision).toBe(4);

    // Partial price clearing rejected: cannot clear price without currency
    await patch(full.id, {
      revision: 4,
      likelyPriceMinor: '500',
      currency: null,
    }).expect(400);

    await patch(full.id, {
      revision: 4,
      likelyPriceMinor: null,
      currency: 'USD',
    }).expect(400);
  });

  it('transitions waiting periods and evaluates effective state dynamically as time advances', async () => {
    const desire = await createMinimal('Time Transition Desire');
    expect(desire.status).toBe('considering');
    expect(desire.effectiveState).toBe('considering');

    const startTime = new Date('2026-06-01T10:00:00.000Z');
    const reviewTime = new Date('2026-06-08T10:00:00.000Z');
    const extendedReviewTime = new Date('2026-06-10T10:00:00.000Z');

    service.setClock(() => startTime);

    const waitingDesire = (
      await patch(desire.id, {
        revision: 1,
        waitingPeriod: {
          startedAt: startTime.toISOString(),
          reviewAt: reviewTime.toISOString(),
        },
      }).expect(200)
    ).body as DesireDto;

    expect(waitingDesire.status).toBe('waiting');
    expect(waitingDesire.effectiveState).toBe('waiting');
    expect(waitingDesire.waitingStartedAt).toBe(startTime.toISOString());
    expect(waitingDesire.reviewAt).toBe(reviewTime.toISOString());
    expect(
      (
        await run.runtime.query(
          'SELECT schedule_version,scheduled_for,state FROM desire_reminders WHERE desire_id=$1',
          [desire.id],
        )
      ).rows,
    ).toEqual([
      {
        schedule_version: 2,
        scheduled_for: reviewTime,
        state: 'pending',
      },
    ]);

    // Advance simulated clock to 3 days later: still waiting
    service.setClock(() => new Date('2026-06-04T10:00:00.000Z'));
    const midCheck = (await get('/' + desire.id).expect(200)).body as DesireDto;
    expect(midCheck.status).toBe('waiting');
    expect(midCheck.effectiveState).toBe('waiting');

    const rescheduled = (
      await patch(desire.id, {
        revision: 2,
        waitingPeriod: {
          startedAt: startTime.toISOString(),
          reviewAt: extendedReviewTime.toISOString(),
        },
      }).expect(200)
    ).body as DesireDto;
    expect(rescheduled.reviewAt).toBe(extendedReviewTime.toISOString());
    expect(rescheduled.revision).toBe(3);
    expect(
      (
        await run.runtime.query(
          'SELECT schedule_version,scheduled_for,state FROM desire_reminders WHERE desire_id=$1',
          [desire.id],
        )
      ).rows,
    ).toEqual([
      {
        schedule_version: 3,
        scheduled_for: extendedReviewTime,
        state: 'pending',
      },
    ]);

    // Advance simulated clock past reviewAt: dynamically ready_for_review WITHOUT DB mutation!
    service.setClock(() => new Date('2026-06-10T10:00:01.000Z'));
    const dueCheck = (await get('/' + desire.id).expect(200)).body as DesireDto;
    expect(dueCheck.status).toBe('waiting');
    expect(dueCheck.effectiveState).toBe('ready_for_review');

    // Filter query by effectiveState=ready_for_review includes it
    const dueList = (await get('?effectiveState=ready_for_review').expect(200))
      .body as DesiresPageDto;
    expect(dueList.items.map((i) => i.id)).toContain(desire.id);

    // Cancel waiting: status returns to considering
    const cancelled = (
      await patch(desire.id, {
        revision: 3,
        waitingPeriod: null,
      }).expect(200)
    ).body as DesireDto;

    expect(cancelled.status).toBe('considering');
    expect(cancelled.effectiveState).toBe('considering');
    expect(cancelled.waitingStartedAt).toBeNull();
    expect(cancelled.reviewAt).toBeNull();
    expect(cancelled.revision).toBe(4);
    expect(
      (
        await run.runtime.query('SELECT desire_id FROM desire_reminders WHERE desire_id=$1', [
          desire.id,
        ])
      ).rows,
    ).toHaveLength(0);

    service.resetClock();
  });

  it('manages private desire photo lifecycle: upload, idempotency, streaming content/thumbnail, replacement, and deletion', async () => {
    const desire = await createMinimal('Photo Lifecycle Item');
    const uploadId = randomUUID();

    // 1. Upload photo
    const uploadRes = await http()
      .post(`/api/v1/desires/${desire.id}/photo`)
      .set('Cookie', `havefolio_session=${token}`)
      .set('Upload-Id', uploadId)
      .attach('photo', samplePhotoBytes, 'test-photo.jpg')
      .expect(201);

    const photoDto = uploadRes.body as DesirePhotoDto;
    expect(photoDto.id).toBeDefined();
    expect(photoDto.byteSize).toBeGreaterThan(0);
    expect(photoDto.mimeType).toBe('image/webp');
    expect(photoDto.width).toBeGreaterThan(0);
    expect(photoDto.height).toBeGreaterThan(0);

    // Verify desire now has photo
    const refreshed = (await get('/' + desire.id).expect(200)).body as DesireDto;
    expect(refreshed.photo).toMatchObject({
      id: photoDto.id,
      byteSize: photoDto.byteSize,
      mimeType: 'image/webp',
    });

    // 2. Idempotent retry with same Upload-Id returns same result without re-uploading
    const retryRes = await http()
      .post(`/api/v1/desires/${desire.id}/photo`)
      .set('Cookie', `havefolio_session=${token}`)
      .set('Upload-Id', uploadId)
      .attach('photo', samplePhotoBytes, 'test-photo.jpg')
      .expect(201);

    expect(retryRes.body.id).toBe(photoDto.id);

    // 3. Authenticated photo content delivery
    const contentRes = await http()
      .get(`/api/v1/desires/${desire.id}/photo/content/display`)
      .set('Cookie', `havefolio_session=${token}`)
      .expect(200);

    expect(contentRes.headers['content-type']).toBe('image/webp');
    expect(contentRes.headers['cache-control']).toBe('private, no-store');
    expect(Buffer.isBuffer(contentRes.body)).toBe(true);

    // 4. Authenticated thumbnail delivery
    const thumbRes = await http()
      .get(`/api/v1/desires/${desire.id}/photo/content/thumbnail`)
      .set('Cookie', `havefolio_session=${token}`)
      .expect(200);

    expect(thumbRes.headers['content-type']).toBe('image/webp');
    expect(thumbRes.headers['cache-control']).toBe('private, no-store');

    // 5. Replace photo with a new one
    const newBytes = await sharp({
      create: { width: 120, height: 90, channels: 3, background: '#654321' },
    })
      .jpeg()
      .toBuffer();

    const newUploadId = randomUUID();
    const replaceRes = await http()
      .post(`/api/v1/desires/${desire.id}/photo`)
      .set('Cookie', `havefolio_session=${token}`)
      .set('Upload-Id', newUploadId)
      .attach('photo', newBytes, 'replaced.jpg')
      .expect(201);

    expect(replaceRes.body.id).not.toBe(photoDto.id);

    // 6. Delete photo explicitly with current revision
    const afterReplace = (await get('/' + desire.id).expect(200)).body as DesireDto;
    await http()
      .delete(`/api/v1/desires/${desire.id}/photo`)
      .set('Cookie', `havefolio_session=${token}`)
      .send({ revision: afterReplace.revision })
      .expect(200);

    const postDeleteDesire = (await get('/' + desire.id).expect(200)).body as DesireDto;
    expect(postDeleteDesire.photo).toBeNull();

    await http()
      .get(`/api/v1/desires/${desire.id}/photo`)
      .set('Cookie', `havefolio_session=${token}`)
      .expect(404);
  });

  it('deletes desire with revision check and cleans up associated media', async () => {
    const created = await createMinimal('Desire to Delete');
    const startedAt = new Date('2026-07-01T10:00:00.000Z');
    const reviewAt = new Date('2026-07-08T10:00:00.000Z');
    service.setClock(() => startedAt);
    const desire = (
      await patch(created.id, {
        revision: created.revision,
        waitingPeriod: {
          startedAt: startedAt.toISOString(),
          reviewAt: reviewAt.toISOString(),
        },
      }).expect(200)
    ).body as DesireDto;

    // Attach a photo
    await http()
      .post(`/api/v1/desires/${desire.id}/photo`)
      .set('Cookie', `havefolio_session=${token}`)
      .set('Upload-Id', randomUUID())
      .attach('photo', samplePhotoBytes, 'delete-photo.jpg')
      .expect(201);

    const desireWithPhoto = (await get('/' + desire.id).expect(200)).body as DesireDto;

    // Stale revision on delete fails
    await remove(desire.id, 99).expect(409);

    // Valid delete succeeds with updated revision
    await remove(desire.id, desireWithPhoto.revision).expect(204);

    // Subsequent access returns 404
    await get('/' + desire.id).expect(404);
    await patch(desire.id, { revision: 1, name: 'Rebirth' }).expect(404);
    await remove(desire.id, 1).expect(404);

    // Media attachments for this desire must be in 'deleted' state
    const mediaRows = (
      await run.runtime.query(
        'SELECT state, desire_id FROM media_attachments WHERE desire_id = $1',
        [desire.id],
      )
    ).rows;
    expect(mediaRows).toHaveLength(0); // Detached upon soft-delete tombstone
    expect(
      (
        await run.runtime.query('SELECT desire_id FROM desire_reminders WHERE desire_id=$1', [
          desire.id,
        ])
      ).rows,
    ).toHaveLength(0);
    service.resetClock();
  });

  describe('PER-25: manual owned-item matching with explainable reasons', () => {
    const insertItem = async (
      itemOwner: string,
      name = 'Owned French Press',
      status = 'owned',
    ): Promise<string> => {
      const id = randomUUID();
      await run.runtime.query(
        `INSERT INTO items(id, owner_id, name, currency, ownership_status, original_entry, original_source)
         VALUES ($1, $2, $3, 'INR', $4, '{"name":"test"}'::jsonb, 'manual')`,
        [id, itemOwner, name, status],
      );
      return id;
    };

    it('manages match lifecycle: add, duplicate check, candidate list, update feedback, and remove', async () => {
      const desire = await createMinimal('Espresso Machine');
      const ownedItemId = await insertItem(owner, 'Stove Espresso Pot', 'owned');
      const unavailableItemId = await insertItem(owner, 'Old Broken Moka', 'disposed');
      const otherOwnerItemId = await insertItem(other, 'Foreign Kettle', 'owned');

      // 1. Cross-owner item matching must return 404
      await post(`/${desire.id}/matches`, { itemId: otherOwnerItemId }).expect(404);

      // 2. Add manual match to owned item
      const created = (
        await post(`/${desire.id}/matches`, {
          itemId: ownedItemId,
          reason: 'Serves daily coffee purpose without automated steaming.',
        }).expect(201)
      ).body;

      expect(created.desireId).toBe(desire.id);
      expect(created.itemId).toBe(ownedItemId);
      expect(created.reason).toBe('Serves daily coffee purpose without automated steaming.');
      expect(created.relevance).toBe('relevant');
      expect(created.source).toBe('manual');
      expect(created.item.name).toBe('Stove Espresso Pot');
      expect(created.item.isUsableAlternative).toBe(true);

      // 3. Duplicate match rejected with 409 Conflict
      const dup = await post(`/${desire.id}/matches`, { itemId: ownedItemId }).expect(409);
      expect(dup.body.message).toBe('MATCH_ALREADY_EXISTS');

      // 4. List matches for desire
      const list = (await get(`/${desire.id}/matches`).expect(200)).body;
      expect(list.totalCount).toBe(1);
      expect(list.items).toHaveLength(1);
      expect(list.items[0].id).toBe(created.id);

      // 5. Candidates endpoint defaults to available items only
      const candidatesDefault = (await get(`/${desire.id}/matches/candidates`).expect(200))
        .body as { items: Array<{ id: string; isAlreadyMatched: boolean }> };
      const defaultIds = candidatesDefault.items.map((i) => i.id);
      expect(defaultIds).toContain(ownedItemId);
      expect(defaultIds).not.toContain(unavailableItemId); // Disposed excluded by default
      const matchedCandidate = candidatesDefault.items.find((i) => i.id === ownedItemId);
      expect(matchedCandidate?.isAlreadyMatched).toBe(true);

      // 6. Candidates endpoint with includeUnavailable=true includes disposed item
      const candidatesAll = (
        await get(`/${desire.id}/matches/candidates?includeUnavailable=true`).expect(200)
      ).body as { items: Array<{ id: string }> };
      const allIds = candidatesAll.items.map((i) => i.id);
      expect(allIds).toContain(ownedItemId);
      expect(allIds).toContain(unavailableItemId);

      // 7. Update match feedback (mark irrelevant)
      const updated = (
        await patch(`/${desire.id}/matches/${created.id}`, {
          relevance: 'irrelevant',
          reason: 'Does not steam milk; not an alternative.',
        }).expect(200)
      ).body;
      expect(updated.relevance).toBe('irrelevant');
      expect(updated.reason).toBe('Does not steam milk; not an alternative.');

      // 8. Delete match
      await http()
        .delete(`/api/v1/desires/${desire.id}/matches/${created.id}`)
        .set('Cookie', `havefolio_session=${token}`)
        .expect(204);

      // 9. Subsequent delete returns 404
      await http()
        .delete(`/api/v1/desires/${desire.id}/matches/${created.id}`)
        .set('Cookie', `havefolio_session=${token}`)
        .expect(404);

      // 10. List matches is now empty
      const emptyList = (await get(`/${desire.id}/matches`).expect(200)).body;
      expect(emptyList.totalCount).toBe(0);
      expect(emptyList.items).toHaveLength(0);
    });
  });

  it('publishes complete OpenAPI contract without exposing sensitive or avoided-spend fields', () => {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .addCookieAuth('havefolio_session', { type: 'apiKey', in: 'cookie' }, 'ownerSession')
        .build(),
    );

    // Check paths
    for (const [path, method] of [
      ['/api/v1/desires', 'post'],
      ['/api/v1/desires', 'get'],
      ['/api/v1/desires/{id}', 'get'],
      ['/api/v1/desires/{id}/reviews', 'get'],
      ['/api/v1/desires/{id}/reviews', 'post'],
      ['/api/v1/desires/{id}', 'patch'],
      ['/api/v1/desires/{id}', 'delete'],
      ['/api/v1/desires/{id}/photo', 'post'],
      ['/api/v1/desires/{id}/photo', 'get'],
      ['/api/v1/desires/{id}/photo', 'delete'],
      ['/api/v1/desires/{id}/photo/content/{variant}', 'get'],
      ['/api/v1/desires/{id}/matches', 'get'],
      ['/api/v1/desires/{id}/matches', 'post'],
      ['/api/v1/desires/{id}/matches/candidates', 'get'],
      ['/api/v1/desires/{id}/matches/{matchId}', 'patch'],
      ['/api/v1/desires/{id}/matches/{matchId}', 'delete'],
    ] as const) {
      const operation = document.paths[path]?.[method];
      expect(operation).toBeDefined();
      expect(operation?.security).toEqual([{ ownerSession: [] }]);
    }

    // Check schemas
    const schemas = document.components!.schemas!;
    for (const name of [
      'CreateReviewDto',
      'ReviewEventDto',
      'ReviewHistoryPageDto',
      'CreateDesireDto',
      'PatchDesireDto',
      'DesireDto',
      'DesiresPageDto',
      'DesirePhotoDto',
      'WaitingPeriodInputDto',
      'DesireErrorDto',
      'CreateDesireMatchDto',
      'PatchDesireMatchDto',
      'DesireMatchDto',
      'DesireMatchesPageDto',
      'MatchCandidatesPageDto',
    ]) {
      expect(schemas[name]).toBeDefined();
    }

    // Sensitive or private fields must NOT be exposed
    const desireProps = (schemas.DesireDto as { properties: Record<string, unknown> }).properties;
    for (const forbidden of [
      'ownerId',
      'objectKey',
      'providerAssetId',
      'password',
      'avoidedSpend',
      'savedMoney',
      'actualPricePaid',
      'savings',
    ]) {
      expect(desireProps).not.toHaveProperty(forbidden);
    }
  });
  describe('PER-28 immutable review history', () => {
    const future = (): string => new Date(Date.now() + 86400000).toISOString();
    const review = (id: string, revision: number, outcome: string, extra: object = {}): HttpTest =>
      post(`/${id}/reviews`, { commandId: randomUUID(), revision, outcome, ...extra });
    const ownedItem = async (who = owner): Promise<string> =>
      (
        await run.runtime.query<{ id: string }>(
          "INSERT INTO items(owner_id,name,currency,original_entry,original_source) VALUES($1,'Synthetic owned item','INR','{}','manual') RETURNING id",
          [who],
        )
      ).rows[0]!.id;
    beforeEach(() => service.resetClock());

    it('requires authentication, rejects identity injection and hides foreign desires/history', async () => {
      const id = randomUUID();
      await http().get(`/api/v1/desires/${id}/reviews`).expect(401);
      await http().post(`/api/v1/desires/${id}/reviews`).send({}).expect(401);
      const foreign = (
        await run.runtime.query<{ id: string }>(
          "INSERT INTO desires(owner_id,name) VALUES($1,'Other private desire') RETURNING id",
          [other],
        )
      ).rows[0]!.id;
      for (const target of [foreign, id]) {
        await get(`/${target}/reviews`).expect(404);
        await review(target, 1, 'declined').expect(404);
      }
      const d = await createMinimal();
      await review(d.id, 1, 'declined', { ownerId: other }).expect(400);
      expect((await get(`/${d.id}/reviews`).expect(200)).headers['cache-control']).toBe('no-store');
    });

    it.each(['bought', 'declined', 'used_owned'] as const)(
      'derives %s from an immutable event and cancels the reminder',
      async (outcome) => {
        const d = (
          await post('', { name: 'Review outcome', waitingPeriod: { reviewAt: future() } }).expect(
            201,
          )
        ).body as DesireDto;
        const e = (
          await review(
            d.id,
            d.revision,
            outcome,
            outcome === 'used_owned'
              ? { linkedItemId: await ownedItem() }
              : { note: 'Private reflection' },
          ).expect(201)
        ).body as { id: string };
        const current = (await get(`/${d.id}`).expect(200)).body as DesireDto;
        expect(current.status).toBe(outcome);
        expect(current.effectiveState).toBe(outcome);
        expect(current.reviewAt).toBeNull();
        expect(current.revision).toBe(2);
        const history = (await get(`/${d.id}/reviews`).expect(200)).body;
        expect(history.items).toHaveLength(1);
        expect(history.currentEventId).toBe(e.id);
        expect(JSON.stringify(history)).not.toContain('owner_id');
        expect(
          (await run.runtime.query('SELECT * FROM desire_reminders WHERE desire_id=$1', [d.id]))
            .rowCount,
        ).toBe(0);
        await review(d.id, 2, 'bought').expect(409);
      },
    );

    it('schedules delayed outcomes, reschedules them, paginates and preserves notes', async () => {
      const d = await createMinimal();
      const date = future();
      const e = (
        await review(d.id, 1, 'delayed', { reviewAt: date, note: '  Keep thinking  ' }).expect(201)
      ).body;
      expect(e.note).toBe('Keep thinking');
      expect(e.reviewAt).toBe(date);
      const nextDate = new Date(Date.now() + 172800000).toISOString();
      await review(d.id, 2, 'delayed', { reviewAt: nextDate }).expect(201);
      const current = (await get(`/${d.id}`).expect(200)).body;
      expect(current.status).toBe('waiting');
      expect(current.reviewAt).toBe(nextDate);
      const intent = (
        await run.runtime.query(
          'SELECT schedule_version,scheduled_for FROM desire_reminders WHERE desire_id=$1',
          [d.id],
        )
      ).rows[0];
      expect(intent.schedule_version).toBe(3);
      expect(intent.scheduled_for.toISOString()).toBe(nextDate);
      const page = (await get(`/${d.id}/reviews?limit=1`).expect(200)).body;
      expect(page.items[0].sequence).toBe(3);
      expect(page.nextBefore).toBe(3);
      const earlier = (await get(`/${d.id}/reviews?before=${page.nextBefore}&limit=1`).expect(200))
        .body;
      expect(earlier.items[0].id).toBe(e.id);
      expect(earlier.currentEventId).toBe(page.currentEventId);
      expect(earlier.nextBefore).toBeNull();
      await patch(d.id, { revision: 3, waitingPeriod: null }).expect(409);
      await get(`/${d.id}/reviews?limit=101`).expect(400);
    });

    it('deduplicates concurrent retries and rejects a reused command with a changed body', async () => {
      const d = await createMinimal();
      const body = {
        commandId: randomUUID(),
        revision: 1,
        outcome: 'declined',
        note: 'Original note',
      };
      const results = await Promise.all([
        post(`/${d.id}/reviews`, body),
        post(`/${d.id}/reviews`, body),
      ]);
      expect(results.map((r) => r.status)).toEqual([201, 201]);
      expect(results[0].body.id).toBe(results[1].body.id);
      await post(`/${d.id}/reviews`, { ...body, note: 'Changed' }).expect(409);
      expect((await get(`/${d.id}/reviews`)).body.items).toHaveLength(1);
      expect((await get(`/${d.id}`)).body.revision).toBe(2);
    });

    it.each([
      ['9223372036854775807', 'INR'],
      ['101', 'USD'],
      ['0', 'JPY'],
      [null, null],
    ])(
      'snapshots exact money %s %s and counts only the current declined estimate',
      async (amount, currency) => {
        const d = (
          await post('', {
            name: 'Exact estimated amount',
            likelyPriceMinor: amount,
            currency,
          }).expect(201)
        ).body;
        const first = (await review(d.id, 1, 'declined').expect(201)).body;
        let history = (await get(`/${d.id}/reviews`)).body;
        expect(history.estimatedNotSpentMinor).toBe(amount);
        expect(history.currency).toBe(currency);
        const correction = (
          await review(d.id, 2, 'declined', {
            supersedesEventId: first.id,
            note: 'Correction, retaining estimate',
          }).expect(201)
        ).body;
        history = (await get(`/${d.id}/reviews`)).body;
        expect(history.items).toHaveLength(2);
        expect(history.estimatedNotSpentMinor).toBe(amount);
        expect(history.currency).toBe(currency);
        await review(d.id, 3, 'bought', { supersedesEventId: first.id }).expect(409);
        await review(d.id, 3, 'bought', { supersedesEventId: correction.id }).expect(201);
        history = (await get(`/${d.id}/reviews`)).body;
        expect(history.estimatedNotSpentMinor).toBeNull();
        expect(history.currency).toBeNull();
        expect(history.items[2].estimatedNotSpentMinor).toBe(amount);
        expect(history.items[2].id).toBe(first.id);
      },
    );

    it('keeps recorded estimates stable across metadata edits until explicitly corrected', async () => {
      const d = (
        await post('', {
          name: 'Snapshot estimate',
          likelyPriceMinor: '101',
          currency: 'INR',
        }).expect(201)
      ).body;
      const e = (await review(d.id, 1, 'declined').expect(201)).body;
      await patch(d.id, { revision: 2, likelyPriceMinor: '202', currency: 'USD' }).expect(200);
      expect((await get(`/${d.id}/reviews`)).body).toMatchObject({
        estimatedNotSpentMinor: '101',
        currency: 'INR',
      });
      await review(d.id, 3, 'declined', { supersedesEventId: e.id }).expect(201);
      const history = (await get(`/${d.id}/reviews`)).body;
      expect(history).toMatchObject({ estimatedNotSpentMinor: '202', currency: 'USD' });
      expect(history.items[1]).toMatchObject({ estimatedNotSpentMinor: '101', currency: 'INR' });
    });

    it('can reopen a resolved review with a correction and never reuses a cancelled reminder version', async () => {
      const d = (await post('', { name: 'Reopen', waitingPeriod: { reviewAt: future() } })).body;
      const e = (await review(d.id, 1, 'declined').expect(201)).body;
      const date = future();
      await review(d.id, 2, 'delayed', { reviewAt: date, supersedesEventId: e.id }).expect(201);
      const r = (
        await run.runtime.query(
          'SELECT schedule_version FROM desire_reminders WHERE desire_id=$1',
          [d.id],
        )
      ).rows[0];
      expect(r.schedule_version).toBe(3);
      expect((await get(`/${d.id}`)).body.reviewAt).toBe(date);
    });

    it('rejects missing, foreign, and non-owned linked items and retains an unavailable link after deletion', async () => {
      const d = await createMinimal();
      await review(d.id, 1, 'used_owned').expect(400);
      await review(d.id, 1, 'used_owned', { linkedItemId: randomUUID() }).expect(404);
      await review(d.id, 1, 'used_owned', { linkedItemId: await ownedItem(other) }).expect(404);
      const id = await ownedItem();
      await run.runtime.query("UPDATE items SET ownership_status='sold' WHERE id=$1", [id]);
      await review(d.id, 1, 'used_owned', { linkedItemId: id }).expect(404);
      await run.runtime.query("UPDATE items SET ownership_status='owned' WHERE id=$1", [id]);
      const e = (await review(d.id, 1, 'used_owned', { linkedItemId: id }).expect(201)).body;
      expect(e.linkedItemName).toBe('Synthetic owned item');
      await run.runtime.query('DELETE FROM items WHERE id=$1', [id]);
      const history = (await get(`/${d.id}/reviews`)).body;
      expect(history.items[0].linkedItemId).toBe(id);
      expect(history.items[0].linkedItemName).toBeNull();
    });

    it('supports bought with an optional owned-item link without creating an inventory purchase', async () => {
      const d = await createMinimal();
      const id = await ownedItem();
      const e = (await review(d.id, 1, 'bought', { linkedItemId: id }).expect(201)).body;
      expect(e.linkedItemId).toBe(id);
      expect(e.estimatedNotSpentMinor).toBeNull();
      expect(
        (await run.runtime.query('SELECT price_paid_minor FROM items WHERE id=$1', [id])).rows[0]
          .price_paid_minor,
      ).toBeNull();
    });

    it('validates outcome/date/note combinations and stale revisions without changing state', async () => {
      const d = await createMinimal();
      for (const [outcome, extra] of [
        ['invalid', {}],
        ['delayed', {}],
        ['delayed', { reviewAt: '2027-01-01' }],
        ['delayed', { reviewAt: '2000-01-01T00:00:00Z' }],
        ['bought', { reviewAt: future() }],
        ['declined', { linkedItemId: randomUUID() }],
        ['declined', { note: ' ' }],
        ['declined', { note: null }],
        ['declined', { note: 'a'.repeat(2001) }],
      ] as const) {
        await review(d.id, 1, outcome, extra).expect(400);
      }
      await review(d.id, 10, 'declined').expect(409);
      expect((await get(`/${d.id}/reviews`)).body.items).toEqual([]);
    });

    it('enforces database isolation, immutable history, projection, constraints and parent erasure', async () => {
      const d = await createMinimal();
      const e = (await review(d.id, 1, 'declined').expect(201)).body;
      expect(
        (await run.runtime.query('SELECT * FROM desire_review_events WHERE desire_id=$1', [d.id]))
          .rows,
      ).toEqual([]);
      await run.runtime.query("SELECT set_config('havefolio.owner_id',$1,false)", [other]);
      expect(
        (await run.runtime.query('SELECT * FROM desire_review_events WHERE desire_id=$1', [d.id]))
          .rows,
      ).toEqual([]);
      await run.runtime.query("SELECT set_config('havefolio.owner_id',$1,false)", [owner]);
      await expect(
        run.runtime.query("UPDATE desire_review_events SET note='Changed' WHERE id=$1", [e.id]),
      ).rejects.toMatchObject({ code: '23514' });
      await expect(
        run.runtime.query('DELETE FROM desire_review_events WHERE id=$1', [e.id]),
      ).rejects.toMatchObject({ code: '23514' });
      // Projection guard sees history even without a caller owner context.
      await run.runtime.query("SELECT set_config('havefolio.owner_id','',false)");
      await expect(
        run.runtime.query("UPDATE desires SET status='considering' WHERE id=$1", [d.id]),
      ).rejects.toMatchObject({ code: '23514' });
      await run.runtime.query("SELECT set_config('havefolio.owner_id',$1,false)", [owner]);
      const insert = `INSERT INTO desire_review_events(desire_id,owner_id,command_id,request_hash,sequence,outcome,supersedes_event_id,linked_item_id) VALUES($1,$2,$3,$4,3,'bought',$5,$6)`;
      await expect(
        run.runtime.query(insert, [d.id, other, randomUUID(), 'a'.repeat(64), e.id, null]),
      ).rejects.toMatchObject({ code: '23503' });
      await expect(
        run.runtime.query(insert, [
          d.id,
          owner,
          randomUUID(),
          'a'.repeat(64),
          e.id,
          await ownedItem(other),
        ]),
      ).rejects.toMatchObject({ code: '23503' });
      const originalCommand = (
        await run.runtime.query<{ command_id: string }>(
          'SELECT command_id FROM desire_review_events WHERE id=$1',
          [e.id],
        )
      ).rows[0]!.command_id;
      await expect(
        run.runtime.query(insert, [d.id, owner, originalCommand, 'a'.repeat(64), e.id, null]),
      ).rejects.toMatchObject({ code: '23505', constraint: 'review_command_unique' });
      for (const [requestHash, note, outcome, reviewAt, constraint] of [
        ['invalid', null, 'bought', null, 'review_hash_check'],
        ['a'.repeat(64), ' ', 'bought', null, 'review_note_check'],
        ['a'.repeat(64), null, 'unknown', null, 'review_link_check'],
        ['a'.repeat(64), null, 'bought', future(), 'review_date_check'],
      ] as const) {
        await expect(
          run.runtime.query(
            `INSERT INTO desire_review_events(desire_id,owner_id,command_id,request_hash,sequence,outcome,supersedes_event_id,note,review_at) VALUES($1,$2,$3,$4,3,$5,$6,$7,$8)`,
            [d.id, owner, randomUUID(), requestHash, outcome, e.id, note, reviewAt],
          ),
        ).rejects.toMatchObject({ code: '23514', constraint });
      }
      const indexes = (
        await run.runtime.query<{ indexname: string }>(
          "SELECT indexname FROM pg_indexes WHERE schemaname=$1 AND tablename='desire_review_events'",
          [run.schema],
        )
      ).rows.map((r) => r.indexname);
      expect(indexes).toEqual(
        expect.arrayContaining([
          'review_sequence_unique',
          'review_command_unique',
          'review_owner_desire_order_idx',
          'review_identity_unique',
        ]),
      );
      await run.runtime.query("SELECT set_config('havefolio.owner_id','',false)");
      const corrected = await review(d.id, 2, 'bought', { supersedesEventId: e.id }).expect(201);
      expect(corrected.body.supersedesEventId).toBe(e.id);
      await remove(d.id, 3).expect(204);
      await get(`/${d.id}/reviews`).expect(404);
    });
  });
});
