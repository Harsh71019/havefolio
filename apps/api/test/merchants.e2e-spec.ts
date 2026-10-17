import { TelemetryModule } from '@havefolio/logging';
import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, describe, expect, it, jest } from '@jest/globals';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import request, { type Test as HttpTest } from 'supertest';
import { IntegrationRun, integrationConfiguration } from '@havefolio/test-utils';
import { validateApiEnvironment } from '@havefolio/config';
import { AuthModule } from '../src/auth/auth.module.js';
import { newToken, hashToken } from '../src/auth/session-cookie.service.js';
import { configureApplication } from '../src/app.setup.js';
import { ItemsModule } from '../src/items/items.module.js';
import { MerchantsService } from '../src/merchants/merchants.service.js';
import { MerchantsModule } from '../src/merchants/merchants.module.js';
import type { ItemDto, EventsPageDto } from '../src/items/items.dto.js';
import type { MerchantDto, MerchantsPageDto } from '../src/merchants/merchants.dto.js';
jest.setTimeout(60000);
describe('owner-private purchase merchants and URLs', () => {
  const run = new IntegrationRun(integrationConfiguration());
  const owner = randomUUID(),
    other = randomUUID(),
    token = newToken(),
    otherToken = newToken();
  let app: NestExpressApplication;
  let merchants: MerchantsService;
  const http = (): ReturnType<typeof request> => request(app.getHttpServer());
  const auth = (): string => `havefolio_session=${token}`;
  const createMerchant = async (
    displayName: string,
    cookie = auth(),
    extra = {},
  ): Promise<MerchantDto> =>
    cookie === `havefolio_session=${otherToken}`
      ? merchants.create(other, { displayName, ...extra })
      : ((
          await http()
            .post('/api/v1/merchants')
            .set('Cookie', cookie)
            .send({ displayName, ...extra })
            .expect(201)
        ).body as MerchantDto);
  const createItem = async (extra = {}): Promise<ItemDto> =>
    (
      await http()
        .post('/api/v1/items')
        .set('Cookie', auth())
        .send({ name: 'Synthetic item', currency: 'INR', ownershipStatus: 'owned', ...extra })
        .expect(201)
    ).body as ItemDto;
  const patchItem = (item: ItemDto, changes: object): HttpTest =>
    http()
      .patch(`/api/v1/items/${item.id}`)
      .set('Cookie', auth())
      .send({ revision: item.revision, ...changes });
  const history = async (id: string): Promise<EventsPageDto> =>
    (await http().get(`/api/v1/items/${id}/history`).set('Cookie', auth()).expect(200))
      .body as EventsPageDto;
  const updateMerchant = (id: string, changes: object): HttpTest =>
    http().patch(`/api/v1/merchants/${id}`).set('Cookie', auth()).send(changes);
  beforeAll(async () => {
    await run.start();
    await run.runtime.query(
      "INSERT INTO users(id,email,password_hash) VALUES($1,'merchant-owner@example.test','$argon2id$fixture'),($2,NULL,NULL)",
      [owner, other],
    );
    for (const [id, value] of [
      [owner, token],
      [other, otherToken],
    ])
      await run.runtime.query(
        "INSERT INTO auth_sessions(owner_id,token_hash,idle_expires_at,absolute_expires_at) VALUES($1,$2,now()+interval '1 hour',now()+interval '1 day')",
        [id, hashToken(value!)],
      );
    const url = new URL(integrationConfiguration().runtimeUrl);
    url.searchParams.set('options', `-c search_path=${run.schema},pg_catalog`);
    const module = await Test.createTestingModule({
      imports: [
        TelemetryModule.register('api'),
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, ignoreEnvVars: true }),
        AuthModule,
        ItemsModule,
        MerchantsModule,
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
    merchants = module.get(MerchantsService);
    app = module.createNestApplication<NestExpressApplication>({ logger: false });
    configureApplication(app);
    await app.listen(0, '127.0.0.1');
  });
  afterAll(async () => {
    await app?.close();
    await run.close();
  });
  it('requires authentication and returns no-store responses', async () => {
    await http().get('/api/v1/merchants').expect(401);
    await http()
      .get('/api/v1/merchants')
      .set('Cookie', auth())
      .expect('Cache-Control', 'no-store')
      .expect(200);
  });
  it('reuses capitalization, Unicode and whitespace variants; preserves display and first host', async () => {
    const original = await createMerchant('  Amazon  ', auth(), {
      websiteHost: 'AMAZON.EXAMPLE.TEST',
    });
    for (const name of ['amazon', 'Ａｍａｚｏｎ', ' Amazon ']) {
      const duplicate = await createMerchant(name);
      expect(duplicate.id).toBe(original.id);
      expect(duplicate.displayName).toBe('Amazon');
      expect(duplicate.websiteHost).toBe('amazon.example.test');
    }
    const local = await createMerchant(' Local\u00a0\u00a0Shop ');
    expect(local.displayName).toBe('Local Shop');
    expect((await createMerchant('Amazon', `havefolio_session=${otherToken}`)).id).not.toBe(
      original.id,
    );
    expect((await createMerchant('Amazon India')).id).not.toBe(original.id);
  });
  it('hides foreign and missing merchants on reads, corrections and item assignment', async () => {
    const foreign = await createMerchant('Foreign seller', `havefolio_session=${otherToken}`);
    const item = await createItem();
    for (const id of [foreign.id, randomUUID()]) {
      expect(
        (await http().get(`/api/v1/merchants/${id}`).set('Cookie', auth()).expect(404)).body
          .message,
      ).toBe('MERCHANT_NOT_FOUND');
      expect(
        (await updateMerchant(id, { displayName: 'Corrected' }).expect(404)).body.message,
      ).toBe('MERCHANT_NOT_FOUND');
      expect((await patchItem(item, { merchantId: id }).expect(404)).body.message).toBe(
        'MERCHANT_NOT_FOUND',
      );
    }
    expect((await history(item.id)).events).toHaveLength(1);
  });
  it('assigns, replaces and clears independently with one details event per success', async () => {
    const a = await createMerchant('Source A'),
      b = await createMerchant('Source B');
    let item = await createItem();
    expect(item.merchantId).toBeNull();
    expect(item.purchaseUrl).toBeNull();
    const url = 'https://shop.example.test/product?ref=synthetic#details';
    item = (await patchItem(item, { merchantId: a.id, purchaseUrl: url }).expect(200))
      .body as ItemDto;
    expect(item.merchant?.displayName).toBe('Source A');
    expect(item.purchaseUrl).toBe(url);
    expect(item.revision).toBe(2);
    await patchItem({ ...item, revision: 1 }, { merchantId: b.id, purchaseUrl: null }).expect(409);
    item = (await patchItem(item, { merchantId: b.id }).expect(200)).body as ItemDto;
    expect(item.purchaseUrl).toBe(url);
    item = (await patchItem(item, { merchantId: null }).expect(200)).body as ItemDto;
    expect(item.purchaseUrl).toBe(url);
    item = (await patchItem(item, { purchaseUrl: null }).expect(200)).body as ItemDto;
    expect(item.merchantId).toBeNull();
    const events = (await history(item.id)).events;
    expect(events.filter((e) => e.eventType === 'details_updated')).toHaveLength(4);
    expect(JSON.stringify(events)).not.toContain(url);
    expect(events[1]?.metadata.fields).toEqual(['merchantId', 'purchaseUrl']);
  });
  it('keeps retired historical links, reserves names, blocks only new assignments', async () => {
    const merchant = await createMerchant('Historical seller');
    let item = await createItem({ merchantId: merchant.id });
    await updateMerchant(merchant.id, { state: 'retired' }).expect(200);
    expect((await createMerchant(' historical seller ')).state).toBe('retired');
    item = (
      await patchItem(item, {
        merchantId: merchant.id,
        purchaseUrl: 'http://shop.example.test/path',
      }).expect(200)
    ).body as ItemDto;
    expect(item.merchant?.state).toBe('retired');
    const otherItem = await createItem();
    await patchItem(otherItem, { merchantId: merchant.id }).expect(409);
    const all = (await http().get('/api/v1/merchants?state=all').set('Cookie', auth()).expect(200))
      .body as MerchantsPageDto;
    expect(all.merchants.some((m) => m.id === merchant.id)).toBe(true);
    const active = (
      await http().get('/api/v1/merchants?q=historical').set('Cookie', auth()).expect(200)
    ).body as MerchantsPageDto;
    expect(active.merchants).toHaveLength(0);
    await patchItem(item, { merchantId: null }).expect(200);
  });
  it('corrects display name and host, rejects collisions including retired names', async () => {
    const a = await createMerchant('Correction target'),
      b = await createMerchant('Reserved name');
    await updateMerchant(b.id, { state: 'retired' }).expect(200);
    await updateMerchant(a.id, { displayName: ' reserved NAME ' }).expect(409);
    const updated = (
      await updateMerchant(a.id, {
        displayName: 'Corrected Seller',
        websiteHost: 'SHOP.EXAMPLE.TEST.',
      }).expect(200)
    ).body as MerchantDto;
    expect(updated.displayName).toBe('Corrected Seller');
    expect(updated.websiteHost).toBe('shop.example.test');
    expect(
      (await updateMerchant(a.id, { websiteHost: null }).expect(200)).body.websiteHost,
    ).toBeNull();
    await updateMerchant(a.id, {}).expect(400);
    await updateMerchant(a.id, { displayName: null }).expect(400);
  });
  it.each([
    'ftp://shop.example.test',
    'javascript:alert(1)',
    '//shop.example.test',
    'https://',
    'https://user:pass@shop.example.test',
    'https://@shop.example.test',
    'https://shop.example.test/' + 'x'.repeat(2048),
    'https://shop.example.test/\nprivate',
  ])('rejects unsafe purchase URL without history', async (purchaseUrl) => {
    const item = await createItem();
    await patchItem(item, { purchaseUrl }).expect(400);
    await http()
      .post('/api/v1/items')
      .set('Cookie', auth())
      .send({ name: 'Synthetic item', currency: 'INR', ownershipStatus: 'owned', purchaseUrl })
      .expect(400);
    expect((await history(item.id)).events).toHaveLength(1);
  });
  it('keeps source fields out of lightweight list and OpenAPI list contracts', async () => {
    await createItem({ purchaseUrl: 'https://shop.example.test/synthetic' });
    const response = await http().get('/api/v1/items').set('Cookie', auth()).expect(200);
    for (const item of response.body.items)
      for (const field of ['merchantId', 'merchant', 'purchaseUrl'])
        expect(item).not.toHaveProperty(field);
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle('Synthetic').setVersion('1').build(),
    );
    expect(document.paths['/api/v1/merchants']).toBeDefined();
    expect(document.paths['/api/v1/merchants/{id}']?.patch).toBeDefined();
    const schema = document.components!.schemas!;
    expect((schema.CreateItemDto as { properties: object }).properties).toHaveProperty(
      'merchantId',
    );
    expect((schema.ItemDto as { properties: object }).properties).toHaveProperty('purchaseUrl');
    expect((schema.ItemListEntryDto as { properties: object }).properties).not.toHaveProperty(
      'purchaseUrl',
    );
    expect((schema.MerchantDto as { properties: object }).properties).not.toHaveProperty(
      'normalizedName',
    );
  });
  it('paginates all matching names without leaking owner, search or state through cursors', async () => {
    for (let n = 0; n < 4; n++) await createMerchant(`Page seller ${n}`);
    let after: string | null = null;
    const names: string[] = [];
    do {
      const query = new URLSearchParams({
        q: 'page seller',
        limit: '2',
        ...(after ? { after } : {}),
      });
      const page = (
        await http().get(`/api/v1/merchants?${query}`).set('Cookie', auth()).expect(200)
      ).body as MerchantsPageDto;
      names.push(...page.merchants.map((m) => m.displayName));
      after = page.nextCursor;
      if (after) {
        await http()
          .get(`/api/v1/merchants?${query}&state=all&after=${after}`)
          .set('Cookie', auth())
          .expect(400);
        expect(() => merchants.list(other, { q: 'page seller', limit: 2, after: after! })).toThrow(
          'INVALID_MERCHANT_CURSOR',
        );
      }
    } while (after);
    expect(names).toEqual(['Page seller 0', 'Page seller 1', 'Page seller 2', 'Page seller 3']);
    await http().get('/api/v1/merchants?limit=51').set('Cookie', auth()).expect(400);
  });
  it('enforces composite owner FK, name/state/normalization/host constraints and indexes in PostgreSQL', async () => {
    const foreign = await createMerchant('Database foreign', `havefolio_session=${otherToken}`),
      item = await createItem();
    await expect(
      run.runtime.query('UPDATE items SET merchant_id=$1 WHERE id=$2', [foreign.id, item.id]),
    ).rejects.toMatchObject({ code: '23503' });
    for (const [name, normalized, state, host] of [
      ['Bad', 'wrong', 'active', null],
      ['Bad', 'bad', 'invalid', null],
      [' Bad ', ' bad ', 'active', null],
      ['Bad', 'bad', 'active', 'https://bad.test'],
    ]) {
      await expect(
        run.runtime.query(
          'INSERT INTO merchants(owner_id,display_name,normalized_name,state,website_host) VALUES($1,$2,$3,$4,$5)',
          [owner, name, normalized, state, host],
        ),
      ).rejects.toMatchObject({ code: '23514' });
    }
    const merchant = await createMerchant('Unique DB');
    await expect(
      run.runtime.query(
        "INSERT INTO merchants(owner_id,display_name,normalized_name) VALUES($1,'unique db','unique db')",
        [owner],
      ),
    ).rejects.toMatchObject({ code: '23505' });
    await patchItem(item, { merchantId: merchant.id }).expect(200);
    await expect(
      run.runtime.query('DELETE FROM merchants WHERE id=$1', [merchant.id]),
    ).rejects.toMatchObject({ code: '23001' });
    const indexes = (
      await run.runtime.query('SELECT indexname FROM pg_indexes WHERE schemaname=$1', [run.schema])
    ).rows.map((r) => r.indexname as string);
    expect(indexes).toEqual(
      expect.arrayContaining([
        'merchant_owner_name_unique',
        'merchant_owner_state_name_idx',
        'item_owner_merchant_idx',
      ]),
    );
  });
});
