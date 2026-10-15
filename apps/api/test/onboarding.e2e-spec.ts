import { TelemetryModule } from '@havefolio/logging';
import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, describe, expect, it } from '@jest/globals';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import request from 'supertest';
import { IntegrationRun, integrationConfiguration } from '@havefolio/test-utils';
import { validateApiEnvironment } from '@havefolio/config';
import { AuthModule } from '../src/auth/auth.module.js';
import { newToken, hashToken } from '../src/auth/session-cookie.service.js';
import { configureApplication } from '../src/app.setup.js';
import { ItemsModule } from '../src/items/items.module.js';
import { OnboardingService } from '../src/onboarding/onboarding.service.js';
import { ItemPhotosService } from '../src/media/item-photos.service.js';
import { ItemDocumentsService } from '../src/media/item-documents.service.js';
import { SpendingService } from '../src/items/spending.service.js';
import type { OnboardingStatus, ItemResponse, ItemsPage } from '@havefolio/contracts';

describe('PER-19 owner-private demos and onboarding', () => {
  const run = new IntegrationRun(integrationConfiguration());
  const owner = randomUUID(),
    other = randomUUID(),
    token = newToken();
  let app: NestExpressApplication, service: OnboardingService, spending: SpendingService;
  let genuine: ItemResponse, demos: ItemResponse[];
  const http = (): ReturnType<typeof request> => request(app.getHttpServer());
  const get = (path: string): request.Test =>
    http()
      .get('/api/v1/' + path)
      .set('Cookie', `havefolio_session=${token}`);
  const post = (path: string, body: object = {}): request.Test =>
    http()
      .post('/api/v1/' + path)
      .set('Cookie', `havefolio_session=${token}`)
      .send(body);
  const remove = (): request.Test =>
    http().delete('/api/v1/onboarding/demo').set('Cookie', `havefolio_session=${token}`);
  const payload = {
    name: 'Synthetic genuine',
    ownershipStatus: 'owned',
    currency: 'INR',
    pricePaidMinor: '10000',
    purchaseDate: { precision: 'month', year: 2024, month: 2 },
  };
  beforeAll(async () => {
    await run.start();
    await run.runtime.query(
      "INSERT INTO users(id,email,password_hash) VALUES($1,'onboarding@example.test','$argon2id$fixture'),($2,NULL,NULL)",
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
        }),
      )
      .compile();
    service = module.get(OnboardingService);
    spending = module.get(SpendingService);
    app = module.createNestApplication<NestExpressApplication>({ logger: false });
    configureApplication(app);
    await app.listen(0, '127.0.0.1');
  }, 60000);
  afterAll(async () => {
    await app?.close();
    await run.close();
  });
  it('requires authentication on every onboarding endpoint', async () => {
    await http().get('/api/v1/onboarding').expect(401);
    await http().post('/api/v1/onboarding/demo').expect(401);
    await http().delete('/api/v1/onboarding/demo').expect(401);
    await http().post('/api/v1/onboarding/actions').send({ action: 'skip' }).expect(401);
  });
  it('starts independently of inventory, validates actions, and never seeds on read', async () => {
    expect((await get('onboarding').expect(200)).body).toMatchObject({
      state: 'not_started',
      demoItemCount: 0,
      genuineItemCount: 0,
    });
    await post('onboarding/actions', { action: 'unknown' }).expect(400);
    await post('onboarding/actions', { action: 'skip', ownerId: other }).expect(400);
    await post('onboarding/actions', { action: 'review_item' })
      .expect(200)
      .expect((r) => expect(r.body.reviewedItem).toBe(false));
    genuine = (await post('items', payload).expect(201)).body as ItemResponse;
    expect(genuine.isDemo).toBe(false);
    expect((await get('onboarding').expect(200)).body.state).toBe('not_started');
    await post('items', { ...payload, isDemo: true }).expect(400);
    await post('items', { ...payload, demoDatasetId: randomUUID() }).expect(400);
  });
  it('supports explicit, idempotent skip/complete/revisit transitions', async () => {
    await post('onboarding/actions', { action: 'start' }).expect(200);
    await post('onboarding/actions', { action: 'skip' }).expect(200);
    await post('onboarding/actions', { action: 'skip' }).expect(200);
    await post('onboarding/actions', { action: 'start' })
      .expect(409)
      .expect((r) => expect(r.body.message).toBe('INVALID_ONBOARDING_TRANSITION'));
    await post('onboarding/actions', { action: 'browse_store' })
      .expect(200)
      .expect((r) => expect(r.body.state).toBe('skipped'));
    await post('onboarding/actions', { action: 'revisit' }).expect(200);
    await post('onboarding/actions', { action: 'complete' }).expect(200);
    expect((await get('onboarding').expect(200)).body.state).toBe('completed');
  });
  it('serializes concurrent opt-in, uses durable same-owner identity and exposes no dataset IDs', async () => {
    const results = await Promise.all(Array.from({ length: 5 }, () => service.seed(owner)));
    for (const result of results)
      expect(result).toMatchObject({
        state: 'completed',
        demoItemCount: 6,
        genuineItemCount: 1,
        triedDemo: true,
      });
    expect(
      (
        await run.runtime.query('SELECT count(*)::int AS n FROM demo_datasets WHERE owner_id=$1', [
          owner,
        ])
      ).rows[0].n,
    ).toBe(1);
    demos = [];
    let cursor: string | null = null;
    do {
      const r = await get('items')
        .query({ limit: 2, ...(cursor ? { after: cursor } : {}) })
        .expect(200);
      const page = r.body as ItemsPage;
      for (const item of page.items) {
        expect(typeof item.isDemo).toBe('boolean');
        expect(item).not.toHaveProperty('demoDatasetId');
        expect(item).not.toHaveProperty('demo_dataset_id');
        if (item.isDemo)
          demos.push((await get('items/' + item.id).expect(200)).body as ItemResponse);
      }
      cursor = page.nextCursor;
    } while (cursor);
    expect(demos).toHaveLength(6);
    const searched = await get('items').query({ q: 'kettle' }).expect(200);
    expect(searched.body.items[0].isDemo).toBe(true);
    expect(await service.read(other)).toMatchObject({
      demoItemCount: 0,
      genuineItemCount: 0,
      state: 'not_started',
    });
    await expect(
      run.runtime.query(
        'UPDATE items SET demo_dataset_id=(SELECT id FROM demo_datasets WHERE owner_id=$1) WHERE owner_id=$2',
        [owner, other],
      ),
    ).resolves.toBeDefined();
    // A concrete foreign-item FK attempt cannot cross the dataset-owner boundary.
    await expect(
      run.runtime.query(
        "INSERT INTO items(owner_id,demo_dataset_id,name,currency,original_entry,original_source) VALUES($1,(SELECT id FROM demo_datasets WHERE owner_id=$2),'Foreign sample','INR','{}','import')",
        [other, owner],
      ),
    ).rejects.toMatchObject({ code: '23503' });
    await expect(service.read(other)).resolves.toMatchObject({ demoItemCount: 0 });
  });
  it('rejects item edits, lifecycle, individual delete, refunds and media admission', async () => {
    const item = demos[0]!;
    await http()
      .patch('/api/v1/items/' + item.id)
      .set('Cookie', `havefolio_session=${token}`)
      .send({ revision: 1, name: 'Change' })
      .expect(409)
      .expect((r) => expect(r.body.message).toBe('DEMO_ITEM_READ_ONLY'));
    await post('items/' + item.id + '/actions', { revision: 1, action: 'used' }).expect(409);
    await http()
      .delete('/api/v1/items/' + item.id)
      .set('Cookie', `havefolio_session=${token}`)
      .send({ revision: 1 })
      .expect(409);
    await post('items/' + item.id + '/refunds', {
      revision: 1,
      currency: 'INR',
      amountMinor: '100',
    }).expect(409);
    // Internal admission always enforces identity, even when provider storage is enabled.
    const config = app.get(ConfigService);
    config.set('MEDIA_STORAGE_ENABLED', true);
    await expect(app.get(ItemPhotosService).authorize(owner, item.id)).rejects.toThrow(
      'DEMO_ITEM_READ_ONLY',
    );
    await expect(app.get(ItemDocumentsService).authorize(owner, item.id)).rejects.toThrow(
      'DEMO_ITEM_READ_ONLY',
    );
    config.set('MEDIA_STORAGE_ENABLED', false);
    await expect(app.get(ItemPhotosService).snapshot(other, item.id)).rejects.toThrow(
      'ITEM_NOT_FOUND',
    );
    expect((await get('items/' + item.id).expect(200)).body.revision).toBe(1);
  });
  it('excludes every sample lifecycle/refund/date/unknown count before grouping and precision checks', async () => {
    const before = await spending.report(owner, { scope: 'all-history' });
    expect(before.buckets).toHaveLength(1);
    expect(before.buckets[0]).toMatchObject({
      netMinor: '10000',
      totalItemCount: 1,
      unknownPriceCount: 0,
      unknownDateCount: 0,
    });
    const priced = demos.find((d) => d.pricePaidMinor !== null)!;
    await run.runtime.query(
      "INSERT INTO item_refunds(owner_id,item_id,currency,amount_minor) VALUES($1,$2,'INR',100)",
      [owner, priced.id],
    );
    for (const status of ['owned', 'sold', 'donated', 'disposed', 'lost', 'returned']) {
      await run.runtime.query(
        'UPDATE items SET ownership_status=$2 WHERE owner_id=$1 AND demo_dataset_id IS NOT NULL',
        [owner, status],
      );
      for (const scope of ['current-owned', 'all-history'] as const)
        for (const grouping of ['overall', 'category', 'subcategory', 'year', 'month'] as const) {
          const r = await spending.report(owner, { scope, grouping });
          expect(r.buckets).toHaveLength(1);
          expect(r.buckets[0]).toMatchObject({
            grossMinor: '10000',
            refundedMinor: '0',
            netMinor: '10000',
            totalItemCount: 1,
            unknownPriceCount: 0,
            unknownDateCount: 0,
          });
        }
    }
    expect(await spending.report(owner, { scope: 'all-history' })).toEqual(before);
  });
  it('removes only the owner dataset and cascading relationships, preserves genuine items and taxonomy, and explicitly reseeds', async () => {
    await service.seed(other);
    const taxonomyBefore = (
      await run.runtime.query('SELECT id FROM categories WHERE owner_id=$1 ORDER BY id', [owner])
    ).rows;
    const result = (await remove().expect(200)).body as OnboardingStatus;
    expect(result).toMatchObject({
      demoItemCount: 0,
      genuineItemCount: 1,
      removedDemo: true,
      state: 'completed',
    });
    expect((await remove().expect(200)).body).toEqual(result);
    expect(await service.read(other)).toMatchObject({ demoItemCount: 6 });
    await get('items/' + genuine.id).expect(200);
    await get('items/' + demos[0]!.id).expect(404);
    expect(
      (await run.runtime.query('SELECT id FROM categories WHERE owner_id=$1 ORDER BY id', [owner]))
        .rows,
    ).toEqual(taxonomyBefore);
    expect(
      (
        await run.runtime.query('SELECT count(*)::int AS n FROM item_refunds WHERE owner_id=$1', [
          owner,
        ])
      ).rows[0].n,
    ).toBe(0);
    expect((await get('onboarding').expect(200)).body.demoItemCount).toBe(0);
    await post('onboarding/demo')
      .expect(200)
      .expect((r) => expect(r.body.demoItemCount).toBe(6));
    await remove().expect(200);
    await service.remove(other);
  });
  it('publishes complete authenticated, private contracts with no identity input', () => {
    const doc = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .addCookieAuth('havefolio_session', { type: 'apiKey' }, 'ownerSession')
        .build(),
    );
    expect(doc.paths['/api/v1/onboarding']?.get?.security).toEqual([{ ownerSession: [] }]);
    for (const path of [
      '/api/v1/onboarding',
      '/api/v1/onboarding/actions',
      '/api/v1/onboarding/demo',
    ])
      expect(doc.paths[path]).toBeDefined();
    expect(doc.components?.schemas?.OnboardingStatusDto).toMatchObject({
      required: expect.arrayContaining(['demoItemCount']),
    });
    expect(JSON.stringify(doc.components?.schemas?.OnboardingStatusDto)).not.toMatch(
      /ownerId|datasetId/i,
    );
    expect(doc.components?.schemas?.ItemDto).toMatchObject({
      required: expect.arrayContaining(['isDemo']),
    });
  });
});
