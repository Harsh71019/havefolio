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
import { TaxonomyModule } from '../src/taxonomy/taxonomy.module.js';
import { TaxonomyService } from '../src/taxonomy/taxonomy.service.js';
import { ItemsModule } from '../src/items/items.module.js';
import { ItemsService } from '../src/items/items.service.js';
import { PrivateMediaStorage } from '../src/media/storage.js';
import { MediaService } from '../src/media/media.service.js';
import type { ItemDto, ItemsPageDto } from '../src/items/items.dto.js';
jest.setTimeout(60000);
describe('owned item HTTP, concurrency and media recovery', () => {
  const run = new IntegrationRun(integrationConfiguration());
  const owner = randomUUID(),
    other = randomUUID(),
    token = newToken();
  let app: NestExpressApplication;
  let service: ItemsService;
  let media: MediaService;
  let taxonomy: TaxonomyService;
  let category: string,
    child: string,
    tag: string,
    foreignCategory: string,
    foreignChild: string,
    foreignTag: string;
  const providerDelete = jest.fn<(key: string) => Promise<void>>();
  const http = (): ReturnType<typeof request> => request(app.getHttpServer());
  const post = (path: string, body: object): HttpTest =>
    http()
      .post('/api/v1/items' + path)
      .set('Cookie', `havefolio_session=${token}`)
      .send(body);
  const patch = (id: string, body: object): HttpTest =>
    http()
      .patch('/api/v1/items/' + id)
      .set('Cookie', `havefolio_session=${token}`)
      .send(body);
  const get = (path: string): HttpTest =>
    http()
      .get('/api/v1/items' + path)
      .set('Cookie', `havefolio_session=${token}`);
  const remove = (id: string, revision: number): HttpTest =>
    http()
      .delete('/api/v1/items/' + id)
      .set('Cookie', `havefolio_session=${token}`)
      .send({ revision });
  const base = { name: 'Synthetic kettle', ownershipStatus: 'owned', currency: 'INR' };
  const create = async (input: object = {}): Promise<ItemDto> =>
    (await post('', { ...base, ...input }).expect(201)).body as ItemDto;
  beforeAll(async () => {
    await run.start();
    await run.runtime.query(
      "INSERT INTO users(id,email,password_hash) VALUES($1,'item-owner@example.test','$argon2id$fixture'),($2,NULL,NULL)",
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
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, ignoreEnvVars: true }),
        AuthModule,
        ItemsModule,
        TaxonomyModule,
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
      .useValue({ delete: providerDelete })
      .compile();
    service = module.get(ItemsService);
    media = module.get(MediaService);
    taxonomy = module.get(TaxonomyService);
    app = module.createNestApplication<NestExpressApplication>({ logger: false });
    configureApplication(app);
    await app.init();
    const roots = (
      await run.runtime.query<{ id: string }>(
        "INSERT INTO categories(owner_id,name) VALUES($1,'Kitchen'),($2,'Foreign') RETURNING id",
        [owner, other],
      )
    ).rows;
    category = roots[0]!.id;
    foreignCategory = roots[1]!.id;
    const children = (
      await run.runtime.query<{ id: string }>(
        "INSERT INTO subcategories(owner_id,category_id,name) VALUES($1,$2,'Appliances'),($3,$4,'Foreign child') RETURNING id",
        [owner, category, other, foreignCategory],
      )
    ).rows;
    child = children[0]!.id;
    foreignChild = children[1]!.id;
    const tags = (
      await run.runtime.query<{ id: string }>(
        "INSERT INTO tags(owner_id,name) VALUES($1,'Daily'),($2,'Foreign') RETURNING id",
        [owner, other],
      )
    ).rows;
    tag = tags[0]!.id;
    foreignTag = tags[1]!.id;
  });
  afterAll(async () => {
    await app?.close();
    await run.close();
  });
  it('requires authentication on every endpoint and rejects caller identities', async () => {
    const id = randomUUID();
    await http().post('/api/v1/items').send(base).expect(401);
    await http().get('/api/v1/items').expect(401);
    await http()
      .get('/api/v1/items/' + id)
      .expect(401);
    await http().get(`/api/v1/items/${id}/history`).expect(401);
    await http()
      .patch('/api/v1/items/' + id)
      .send({ revision: 1, name: 'Changed' })
      .expect(401);
    await http()
      .post(`/api/v1/items/${id}/actions`)
      .send({ revision: 1, action: 'used' })
      .expect(401);
    await http()
      .delete('/api/v1/items/' + id)
      .send({ revision: 1 })
      .expect(401);
    await post('', { ...base, ownerId: other }).expect(400);
    await post('', { ...base, id }).expect(400);
    await post('', { ...base, originalSource: 'import' }).expect(400);
    await post('', { ...base, ownershipStatus: undefined }).expect(400);
  });
  it('creates manually without dependencies, preserves unknown/zero/bigint and original provenance', async () => {
    const minimal = await create();
    expect(minimal).toMatchObject({
      pricePaidMinor: null,
      purchaseDate: { precision: 'unknown', year: null, month: null, day: null },
      condition: 'unknown',
      useFrequency: 'unknown',
      originalEntry: base,
      originalSource: 'manual',
      revision: 1,
    });
    for (const [pricePaidMinor, currency] of [
      [null, 'USD'],
      ['0', 'INR'],
      ['9223372036854775807', 'JPY'],
      ['120', 'DEM'],
    ]) {
      const item = await create({ pricePaidMinor, currency, acquisitionType: 'gift' });
      expect(item).toMatchObject({ pricePaidMinor, currency, acquisitionType: 'gift' });
      expect((await get('/' + item.id).expect(200)).body.pricePaidMinor).toBe(pricePaidMinor);
    }
    for (const input of [
      { currency: 'ZZZ' },
      { currency: 'XXX' },
      { currency: 'inr' },
      { pricePaidMinor: '9223372036854775808' },
      { pricePaidMinor: 1 },
      { pricePaidMinor: '-1' },
      { pricePaidMinor: '1.2' },
      { name: ' ' },
      { tagIds: Array(51).fill(tag) },
      { specifications: { text: 'a'.repeat(16385) } },
    ])
      await post('', { ...base, ...input }).expect(400);
    const history = await get(`/${minimal.id}/history`).expect(200);
    expect(history.body.events).toHaveLength(1);
    expect(history.body.events[0]).toMatchObject({
      eventType: 'created',
      metadata: { source: 'user', ownershipStatus: 'owned' },
    });
  });
  it.each([
    { precision: 'unknown' },
    { precision: 'year', year: 2000 },
    { precision: 'month', year: 2024, month: 2 },
    { precision: 'exact', year: 2024, month: 2, day: 29 },
    { precision: 'exact', year: 2000, month: 2, day: 29 },
    { precision: 'exact', year: 1, month: 1, day: 1 },
  ])('preserves calendar precision %j', async (purchaseDate) => {
    const item = await create({ purchaseDate });
    expect(item.purchaseDate).toEqual({ year: null, month: null, day: null, ...purchaseDate });
  });
  it.each([
    { precision: 'unknown', year: 2024 },
    { precision: 'year' },
    { precision: 'year', year: 2024, day: 1 },
    { precision: 'month', year: 2024 },
    { precision: 'month', year: 2024, month: 2, day: 1 },
    { precision: 'exact', year: 2023, month: 2, day: 29 },
    { precision: 'exact', year: 1900, month: 2, day: 29 },
    { precision: 'exact', year: 2024, month: 4, day: 31 },
    { precision: 'exact', year: 2024, month: 1 },
    { precision: 'month', year: 0, month: 2 },
  ])('rejects invalid precision %j', async (purchaseDate) => {
    await post('', { ...base, purchaseDate }).expect(400);
  });
  it('isolates owner reads, edits, lifecycle, history and deletion with indistinguishable not-found', async () => {
    const foreign = await service.create(other, { ...base, ownershipStatus: 'owned' });
    const missing = randomUUID();
    for (const id of [foreign.id, missing]) {
      expect((await get('/' + id).expect(404)).body.message).toBe('ITEM_NOT_FOUND');
      await get('/' + id + '/history').expect(404);
      await patch(id, { revision: 1, name: 'Private' }).expect(404);
      await post('/' + id + '/actions', { revision: 1, action: 'used' }).expect(404);
      await remove(id, 1).expect(404);
    }
    expect((await get('').expect(200)).body.items.map((i: ItemDto) => i.id)).not.toContain(
      foreign.id,
    );
    expect((await service.read(other, foreign.id)).revision).toBe(1);
  });
  it('validates taxonomy ownership, active selections and parent relationship; retains retired assignments', async () => {
    for (const input of [
      { categoryId: foreignCategory },
      { categoryId: category, subcategoryId: foreignChild },
      { tagIds: [foreignTag] },
    ])
      await post('', { ...base, ...input }).expect(404);
    await post('', { ...base, subcategoryId: child }).expect(400);
    const otherRoot = (
      await run.runtime.query<{ id: string }>(
        "INSERT INTO categories(owner_id,name) VALUES($1,'Bedroom') RETURNING id",
        [owner],
      )
    ).rows[0]!.id;
    await post('', { ...base, categoryId: otherRoot, subcategoryId: child }).expect(400);
    let item = await create({ categoryId: category, subcategoryId: child, tagIds: [tag] });
    await run.runtime.query('UPDATE categories SET retired_at=now() WHERE id=$1', [category]);
    await post('', { ...base, categoryId: category }).expect(409);
    expect((await get('/' + item.id).expect(200)).body.categoryId).toBe(category);
    item = (
      await patch(item.id, { revision: 1, name: 'Correction', categoryId: category }).expect(200)
    ).body as ItemDto;
    await patch(item.id, { revision: 2, categoryId: foreignCategory, subcategoryId: null }).expect(
      404,
    );
    await patch(item.id, { revision: 2, tagIds: [foreignTag] }).expect(404);
    await patch(item.id, { revision: 2, categoryId: null }).expect(400);
    const cleared = await patch(item.id, { revision: 2, subcategoryId: null }).expect(200);
    expect(cleared.body).toMatchObject({ revision: 3, categoryId: category, subcategoryId: null });
    await patch(item.id, { revision: 3, subcategoryId: child }).expect(409);
    await patch(item.id, { revision: 3, categoryId: null, subcategoryId: null, tagIds: [] }).expect(
      200,
    );
    await run.runtime.query('UPDATE categories SET retired_at=NULL WHERE id=$1', [category]);
    await run.runtime.query('UPDATE subcategories SET retired_at=now() WHERE id=$1', [child]);
    await post('', { ...base, categoryId: category, subcategoryId: child }).expect(409);
    await run.runtime.query('UPDATE subcategories SET retired_at=NULL WHERE id=$1', [child]);
  });
  it('edits all mutable facts independently with immutable original and timestamps', async () => {
    const item = await create({
      condition: 'working',
      useFrequency: 'often',
      pricePaidMinor: '5000',
      purchaseDate: { precision: 'month', year: 2020, month: 5 },
      categoryId: category,
    });
    const body = {
      revision: 1,
      name: 'Corrected',
      currency: 'USD',
      pricePaidMinor: '0',
      purchaseDate: { precision: 'unknown' },
      acquisitionType: 'gift',
      condition: 'broken',
      brand: 'Brand',
      model: 'Model',
      notes: 'Private note',
      description: 'Corrected description',
      specifications: { colour: 'blue' },
      tagIds: [tag],
      subcategoryId: child,
    };
    const edited = (await patch(item.id, body).expect(200)).body as ItemDto;
    expect(edited).toMatchObject({
      revision: 2,
      ownershipStatus: 'owned',
      useFrequency: 'often',
      condition: 'broken',
      pricePaidMinor: '0',
      currency: 'USD',
      originalEntry: item.originalEntry,
      tagIds: [tag],
    });
    expect(Date.parse(edited.updatedAt)).toBeGreaterThanOrEqual(Date.parse(item.updatedAt));
    const usage = (
      await patch(item.id, {
        revision: 2,
        useFrequency: 'never',
        pricePaidMinor: null,
        notes: null,
        brand: null,
        model: null,
        description: null,
        specifications: null,
        tagIds: [],
      }).expect(200)
    ).body as ItemDto;
    expect(usage).toMatchObject({
      ownershipStatus: 'owned',
      condition: 'broken',
      useFrequency: 'never',
      revision: 3,
      pricePaidMinor: null,
      notes: null,
      tagIds: [],
    });
    for (const input of [
      { ownerId: other },
      { id: randomUUID() },
      { originalEntry: {} },
      { originalSource: 'url' },
      { ownershipStatus: 'sold' },
      { revision: undefined },
      { name: null },
      { currency: null },
      { purchaseDate: null },
      { tagIds: null },
    ])
      await patch(item.id, { revision: 3, ...input }).expect(400);
    await patch(item.id, { revision: 3 }).expect(400);
    const history = await get(`/${item.id}/history`).expect(200);
    expect(history.body.events.map((e: { eventType: string }) => e.eventType).sort()).toEqual(
      [
        'created',
        'details_updated',
        'condition_changed',
        'details_updated',
        'usage_changed',
      ].sort(),
    );
  });
  it('invalidates item revisions and records history for external taxonomy relationship removal', async () => {
    const item = await create({ tagIds: [tag] });
    await taxonomy.remove(owner, 'tags', tag, undefined, true);
    const current = (await get('/' + item.id).expect(200)).body as ItemDto;
    expect(current).toMatchObject({ revision: 2, tagIds: [] });
    await patch(item.id, { revision: 1, name: 'Stale' }).expect(409);
    const history = await get(`/${item.id}/history`).expect(200);
    expect(history.body.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: 'details_updated',
          metadata: { reason: 'taxonomy_tag_removed', tagId: tag },
        }),
      ]),
    );
    // Restore a fresh tag for later independent scenarios.
    await taxonomy.create(owner, 'tags', 'Daily');
    tag = (await taxonomy.list(owner)).tags.find((t) => t.name === 'Daily')!.id;
  });
  it('atomically rejects stale simultaneous updates and update/delete races', async () => {
    const item = await create();
    const updates = await Promise.all([
      patch(item.id, { revision: 1, name: 'A' }),
      patch(item.id, { revision: 1, name: 'B' }),
    ]);
    expect(updates.map((r) => r.status).sort()).toEqual([200, 409]);
    expect((await get('/' + item.id).expect(200)).body.revision).toBe(2);
    expect((await get(`/${item.id}/history`).expect(200)).body.events).toHaveLength(2);
    await remove(item.id, 1).expect(409);
    const races = await Promise.all([
      patch(item.id, { revision: 2, name: 'Race' }),
      remove(item.id, 2),
    ]);
    expect(races.map((r) => r.status).sort()).toEqual(
      races[1].status === 204 ? [204, 404] : [200, 409],
    );
  });
  it.each(['sold', 'donated', 'disposed', 'lost', 'returned'])(
    'preserves purchase history through %s and recovery, deduplicates retries',
    async (status) => {
      const item = await create({
        pricePaidMinor: '12500',
        currency: 'EUR',
        purchaseDate: { precision: 'year', year: 2018 },
        acquisitionType: 'secondhand',
        condition: 'needs_repair',
        useFrequency: 'rarely',
      });
      const action = {
        revision: 1,
        action: 'ownership_changed',
        ownershipStatus: status,
        occurredAt: '2024-01-02T03:04:05Z',
      };
      const changed = (await post(`/${item.id}/actions`, action).expect(200)).body as ItemDto;
      expect(changed).toMatchObject({
        ownershipStatus: status,
        pricePaidMinor: '12500',
        currency: 'EUR',
        purchaseDate: item.purchaseDate,
        acquisitionType: 'secondhand',
        condition: 'needs_repair',
        useFrequency: 'rarely',
        originalEntry: item.originalEntry,
        revision: 2,
      });
      await post(`/${item.id}/actions`, action).expect(409);
      await post(`/${item.id}/actions`, {
        revision: 2,
        action: 'ownership_changed',
        ownershipStatus: status,
      }).expect(409);
      await post(`/${item.id}/actions`, {
        revision: 2,
        action: 'ownership_changed',
        ownershipStatus: status === 'lost' ? 'sold' : 'lost',
      }).expect(409);
      await post(`/${item.id}/actions`, { revision: 2, action: 'used' }).expect(409);
      expect((await get(`/${item.id}/history`).expect(200)).body.events).toHaveLength(2);
      await post(`/${item.id}/actions`, {
        revision: 2,
        action: 'ownership_changed',
        ownershipStatus: 'owned',
      }).expect(200);
    },
  );
  it('records use and repair without changing condition, frequency or ownership', async () => {
    let item = await create({ condition: 'broken', useFrequency: 'never' });
    for (const action of ['used', 'repaired']) {
      item = (
        await post(`/${item.id}/actions`, {
          revision: item.revision,
          action,
          note: 'Synthetic action',
          occurredAt: '2024-02-29T12:00:00Z',
        }).expect(200)
      ).body as ItemDto;
      expect(item).toMatchObject({
        ownershipStatus: 'owned',
        condition: 'broken',
        useFrequency: 'never',
      });
    }
    expect(
      (await get(`/${item.id}/history`).expect(200)).body.events
        .map((e: { eventType: string }) => e.eventType)
        .sort(),
    ).toEqual(['created', 'used', 'repaired'].sort());
    for (const input of [
      { action: 'used', ownershipStatus: 'sold' },
      { action: 'ownership_changed' },
      { action: 'used', occurredAt: '2023-02-29T12:00:00Z' },
      { action: 'used', occurredAt: 'bad' },
    ])
      await post(`/${item.id}/actions`, { revision: item.revision, ...input }).expect(400);
  });
  it('paginates deterministic complete owner inventory and history with bounds', async () => {
    const ids: string[] = [];
    let after: string | undefined;
    do {
      const result = await get('?limit=3' + (after ? '&after=' + after : '')).expect(200);
      const page = result.body as ItemsPageDto;
      expect(page.items.length).toBeLessThanOrEqual(3);
      ids.push(...page.items.map((i) => i.id));
      after = page.nextCursor ?? undefined;
      expect(page.hasMore).toBe(Boolean(after));
    } while (after);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual([...ids].sort());
    const actual = (
      await run.runtime.query<{ id: string }>(
        'SELECT id FROM items WHERE owner_id=$1 ORDER BY id',
        [owner],
      )
    ).rows.map((i) => i.id);
    expect(ids).toEqual(actual);
    for (const query of [
      'limit=0',
      'limit=101',
      'limit=1.5',
      'after=bad',
      'ownerId=' + other,
      'sort=name',
    ])
      await get('?' + query).expect(400);
    const item = await create();
    await post(`/${item.id}/actions`, { revision: 1, action: 'used' }).expect(200);
    const first = await get(`/${item.id}/history?limit=1`).expect(200);
    expect(first.body.hasMore).toBe(true);
    const second = await get(`/${item.id}/history?limit=1&after=${first.body.nextCursor}`).expect(
      200,
    );
    expect(second.body.hasMore).toBe(false);
    expect(second.body.events[0].id).not.toBe(first.body.events[0].id);
  });
  const attach = async (
    item: string,
    state: string,
    parent: string | null = null,
  ): Promise<string> => {
    const id = randomUUID();
    await run.runtime.query(
      "INSERT INTO media_attachments(id,owner_id,item_id,kind,variant,parent_id,state,object_key,resource_type,format,original_filename,mime_type,byte_size,checksum,provider_asset_id,provider_version) VALUES($1,$2,$3,'photo',$4,$5,$6,$7,'image','jpg','synthetic.jpg','image/jpeg',4,$8,$9,1)",
      [
        id,
        owner,
        item,
        parent ? 'thumbnail' : 'original',
        parent,
        state,
        `havefolio/test/${id}`,
        'a'.repeat(64),
        state === 'ready' ? id : null,
      ],
    );
    return id;
  };
  it('erases private item and dependent records while retaining detached exact-key deletion recovery', async () => {
    providerDelete.mockReset();
    providerDelete.mockResolvedValue();
    const item = await create({ tagIds: [tag] });
    const original = await attach(item.id, 'ready'),
      variant = await attach(item.id, 'ready', original);
    await run.runtime.query(
      "INSERT INTO item_suggestions(owner_id,item_id,provider,suggested_values) VALUES($1,$2,'fixture','{}')",
      [owner, item.id],
    );
    await run.runtime.query('INSERT INTO item_warranties(owner_id,item_id) VALUES($1,$2)', [
      owner,
      item.id,
    ]);
    await remove(item.id, 1).expect(204);
    expect(providerDelete.mock.calls.map((c) => c[0])).toEqual([
      `havefolio/test/${variant}`,
      `havefolio/test/${original}`,
    ]);
    await get('/' + item.id).expect(404);
    for (const table of [
      'items',
      'item_tags',
      'lifecycle_events',
      'item_suggestions',
      'item_warranties',
    ]) {
      expect(
        (
          await run.runtime.query(
            `SELECT * FROM ${table} WHERE ${table === 'items' ? 'id' : 'item_id'}=$1`,
            [item.id],
          )
        ).rowCount,
      ).toBe(0);
    }
    const tombstones = (
      await run.runtime.query(
        'SELECT state,item_id,original_filename,checksum FROM media_attachments WHERE id=ANY($1::uuid[])',
        [[original, variant]],
      )
    ).rows;
    expect(tombstones).toHaveLength(2);
    expect(
      tombstones.every(
        (r) =>
          r.state === 'deleted' &&
          r.item_id === null &&
          r.original_filename === 'deleted' &&
          r.checksum === '0'.repeat(64),
      ),
    ).toBe(true);
    await expect(
      run.runtime.query('UPDATE media_attachments SET item_id=$1 WHERE id=$2', [
        (await create()).id,
        original,
      ]),
    ).rejects.toMatchObject({ code: '23514' });
    await run.runtime.query(
      "UPDATE media_attachments SET updated_at=now()-interval '16 minutes' WHERE id=ANY($1::uuid[])",
      [[original, variant]],
    );
    expect((await media.reconcile()).failed).toBe(0);
  });
  it('blocks pending assets and makes partial provider failures recoverable without losing intent', async () => {
    providerDelete.mockReset();
    providerDelete.mockResolvedValue();
    const pending = await create();
    await attach(pending.id, 'pending');
    await remove(pending.id, 1).expect(409);
    expect(providerDelete).not.toHaveBeenCalled();
    const item = await create(),
      original = await attach(item.id, 'ready'),
      variant = await attach(item.id, 'ready', original);
    await remove(item.id, 2).expect(409);
    expect(providerDelete).not.toHaveBeenCalled();
    providerDelete
      .mockResolvedValueOnce()
      .mockRejectedValueOnce(new Error('private provider details'));
    const failed = await remove(item.id, 1).expect(503);
    expect(JSON.stringify(failed.body)).not.toContain('private provider details');
    expect((await get('/' + item.id).expect(200)).body.revision).toBe(1);
    expect(
      (await run.runtime.query('SELECT state FROM media_attachments WHERE id=$1', [variant]))
        .rows[0].state,
    ).toBe('deleted');
    expect(
      (await run.runtime.query('SELECT state FROM media_attachments WHERE id=$1', [original]))
        .rows[0].state,
    ).toBe('deleting');
    await remove(item.id, 1).expect(204);
    expect(
      (await run.runtime.query('SELECT item_id FROM media_attachments WHERE id=$1', [original]))
        .rows[0].item_id,
    ).toBeNull();
  });
  it('publishes request/response, money/date, revision and all error contracts without provider fields', () => {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .addCookieAuth('havefolio_session', { type: 'apiKey', in: 'cookie' }, 'ownerSession')
        .build(),
    );
    for (const [path, method] of [
      ['/api/v1/items', 'post'],
      ['/api/v1/items', 'get'],
      ['/api/v1/items/{id}', 'get'],
      ['/api/v1/items/{id}', 'patch'],
      ['/api/v1/items/{id}', 'delete'],
      ['/api/v1/items/{id}/actions', 'post'],
      ['/api/v1/items/{id}/history', 'get'],
    ] as const) {
      const operation = document.paths[path]![method]!;
      for (const status of ['400', '401', '404', '409', '413', '503'])
        expect(operation.responses[status]).toBeDefined();
      expect(operation.security).toEqual([{ ownerSession: [] }]);
    }
    const schemas = document.components!.schemas!;
    for (const name of [
      'CreateItemDto',
      'UpdateItemDto',
      'PurchaseDateDto',
      'RevisionDto',
      'ItemActionDto',
      'ItemDto',
      'ItemEventDto',
      'ItemsPageDto',
      'EventsPageDto',
      'ItemErrorDto',
    ])
      expect(schemas[name]).toBeDefined();
    for (const field of ['ownerId', 'objectKey', 'providerAssetId', 'password', 'url'])
      expect(
        (schemas.ItemDto as { properties: Record<string, unknown> }).properties,
      ).not.toHaveProperty(field);
    expect(JSON.stringify(schemas.CreateItemDto)).toContain('9223372036854775807');
  });
});
