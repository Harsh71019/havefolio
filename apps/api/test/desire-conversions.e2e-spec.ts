import { EventLogger, TelemetryModule } from '@havefolio/logging';
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { ConflictException } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import request, { type Test as HttpTest } from 'supertest';
import sharp from 'sharp';
import { IntegrationRun, integrationConfiguration } from '@havefolio/test-utils';
import { validateApiEnvironment } from '@havefolio/config';
import type {
  ConvertDesireRequest,
  DesireConversion,
  DesireConversionState,
  ItemResponse,
} from '@havefolio/contracts';
import { AuthModule } from '../src/auth/auth.module.js';
import { newToken, hashToken } from '../src/auth/session-cookie.service.js';
import { configureApplication } from '../src/app.setup.js';
import { DesiresModule } from '../src/desires/desires.module.js';
import { DesireConversionsService } from '../src/desires/desire-conversions.service.js';
import { ItemsService } from '../src/items/items.service.js';
import { PrivateMediaStorage, type StoreInput } from '../src/media/storage.js';
import { MediaService } from '../src/media/media.service.js';

jest.setTimeout(90000);

describe('PER-29 bought desire to owned item conversion', () => {
  const run = new IntegrationRun(integrationConfiguration());
  const owner = randomUUID(),
    other = randomUUID(),
    token = newToken();
  let app: NestExpressApplication;
  let conversions: DesireConversionsService;
  let items: ItemsService;
  let media: MediaService;
  let photoBytes: Buffer;
  const stored = new Map<string, Buffer>();
  const emitted: unknown[] = [];

  const put = jest.fn(async (input: StoreInput) => {
    stored.set(input.key, Buffer.from(input.bytes));
    const m = await sharp(input.bytes).metadata();
    return { assetId: randomUUID(), version: 1, width: m.width ?? 1, height: m.height ?? 1 };
  });
  const read = jest.fn((key: string) => {
    const bytes = stored.get(key);
    return bytes ? Promise.resolve(Buffer.from(bytes)) : Promise.reject(new Error('missing'));
  });
  const providerDelete = jest.fn((key: string) => {
    stored.delete(key);
    return Promise.resolve();
  });

  const http = (): ReturnType<typeof request> => request(app.getHttpServer());
  const auth = (t: HttpTest): HttpTest => t.set('Cookie', `havefolio_session=${token}`);
  const getState = (id: string): HttpTest => auth(http().get(`/api/v1/desires/${id}/conversion`));
  const convert = (id: string, body: object): HttpTest =>
    auth(http().post(`/api/v1/desires/${id}/conversion`)).send(body);
  const resume = (id: string): HttpTest =>
    auth(http().post(`/api/v1/desires/${id}/conversion/photo`));

  const desire = async (
    body: object = {
      name: 'Synthetic kettle',
      likelyPriceMinor: '129900',
      currency: 'INR',
      reason: 'Synthetic private reason',
      productUrl: 'https://shop.example.test/kettle?ref=private',
    },
  ): Promise<{ id: string; revision: number }> =>
    (await auth(http().post('/api/v1/desires')).send(body).expect(201)).body as {
      id: string;
      revision: number;
    };
  const revisionOf = async (id: string): Promise<number> =>
    ((await auth(http().get(`/api/v1/desires/${id}`)).expect(200)).body as { revision: number })
      .revision;
  const review = async (
    id: string,
    outcome: string,
    extra: Record<string, unknown> = {},
  ): Promise<{ id: string }> =>
    (
      await auth(http().post(`/api/v1/desires/${id}/reviews`))
        .send({ commandId: randomUUID(), revision: await revisionOf(id), outcome, ...extra })
        .expect(201)
    ).body as { id: string };
  const boughtDesire = async (): Promise<{ id: string; event: string }> => {
    const d = await desire();
    return { id: d.id, event: (await review(d.id, 'bought')).id };
  };
  const uploadPhoto = async (id: string): Promise<void> => {
    await auth(http().post(`/api/v1/desires/${id}/photo`))
      .set('Upload-Id', randomUUID())
      .attach('photo', photoBytes, 'desire.jpg')
      .expect(201);
    put.mockClear(); // Count only conversion copies.
  };
  const body = (
    event: string,
    item: Partial<ConvertDesireRequest['item']> = {},
    extra: Partial<ConvertDesireRequest> = {},
  ): ConvertDesireRequest => ({
    commandId: randomUUID(),
    boughtEventId: event,
    copyPhoto: false,
    item: {
      name: 'Synthetic kettle',
      ownershipStatus: 'owned',
      currency: 'INR',
      pricePaid: { state: 'unknown' },
      purchaseDate: { precision: 'unknown' },
      acquisitionType: 'bought',
      condition: 'working',
      useFrequency: 'often',
      ...item,
    },
    ...extra,
  });
  const itemOf = async (id: string): Promise<ItemResponse> =>
    (await auth(http().get(`/api/v1/items/${id}`)).expect(200)).body as ItemResponse;
  const count = async (sql: string, params: unknown[] = []): Promise<number> =>
    Number(
      (await run.migration.query<{ n: string }>(`SELECT count(*)::text AS n FROM ${sql}`, params))
        .rows[0]!.n,
    );
  const ownerItems = (): Promise<number> => count('items WHERE owner_id=$1', [owner]);

  beforeAll(async () => {
    await run.start();
    await run.runtime.query(
      "INSERT INTO users(id,email,password_hash) VALUES($1,'conversion-owner@example.test','$argon2id$fixture'),($2,NULL,NULL)",
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
        read,
        delete: providerDelete,
        download: () => 'https://example.test/short-lived-synthetic',
      })
      .compile();
    conversions = module.get(DesireConversionsService);
    items = module.get(ItemsService);
    media = module.get(MediaService);
    const logger = module.get(EventLogger);
    const original = logger.emit.bind(logger);
    jest.spyOn(logger, 'emit').mockImplementation((level, event) => {
      emitted.push(event);
      original(level, event);
    });
    app = module.createNestApplication<NestExpressApplication>({ logger: false });
    configureApplication(app);
    await app.listen(0, '127.0.0.1');
    photoBytes = await sharp({
      create: { width: 120, height: 90, channels: 3, background: '#335577' },
    })
      .jpeg()
      .toBuffer();
  });

  afterEach(() => {
    put.mockClear();
    read.mockClear();
  });

  afterAll(async () => {
    await app?.close();
    await run.close();
  });

  it('requires authentication and hides foreign and missing desires identically', async () => {
    const id = randomUUID();
    await http().get(`/api/v1/desires/${id}/conversion`).expect(401);
    await http().post(`/api/v1/desires/${id}/conversion`).send({}).expect(401);
    await http().post(`/api/v1/desires/${id}/conversion/photo`).expect(401);
    // A foreign desire with an effective bought outcome, written in the other owner's context.
    const foreign = randomUUID();
    await run.migration.query("INSERT INTO desires(id,owner_id,name) VALUES($1,$2,'Foreign')", [
      foreign,
      other,
    ]);
    const foreignEvent = (
      await run.migration.query<{ id: string }>(
        "INSERT INTO desire_review_events(desire_id,owner_id,command_id,request_hash,sequence,outcome) VALUES($1,$2,$3,$4,2,'bought') RETURNING id",
        [foreign, other, randomUUID(), 'a'.repeat(64)],
      )
    ).rows[0]!.id;
    for (const target of [foreign, id]) {
      const responses = [
        await getState(target).expect(404),
        await convert(target, body(foreignEvent)).expect(404),
        await resume(target).expect(404),
      ];
      for (const r of responses) expect(r.body.message).toBe('DESIRE_NOT_FOUND');
    }
    expect(await count('items WHERE owner_id=$1', [other])).toBe(0);
    // Caller-supplied identity, unknown fields and malformed IDs are rejected.
    const own = await boughtDesire();
    await convert(own.id, { ...body(own.event), ownerId: other }).expect(400);
    await convert(own.id, body(own.event, { itemId: randomUUID() } as never)).expect(400);
    await auth(http().get('/api/v1/desires/not-a-uuid/conversion')).expect(400);
    expect(await count('desire_conversions WHERE desire_id=$1', [own.id])).toBe(0);
  });

  it('offers suggestions without converting, keeps bought valid alone and never uses likely price', async () => {
    const d = await desire();
    const before = (await getState(d.id).expect(200)).body as DesireConversionState;
    expect(before).toMatchObject({
      eligibility: 'not_bought',
      boughtEventId: null,
      conversion: null,
    });
    const event = (await review(d.id, 'bought')).id;
    const state = (await getState(d.id).expect(200)).body as DesireConversionState;
    expect(state).toEqual({
      desireId: d.id,
      eligibility: 'eligible',
      boughtEventId: event,
      suggestions: {
        name: 'Synthetic kettle',
        notes: 'Synthetic private reason',
        productUrl: 'https://shop.example.test/kettle?ref=private',
        photo: null,
        likelyPriceMinor: '129900',
        likelyCurrency: 'INR',
      },
      conversion: null,
    });
    // Recording bought created nothing in inventory.
    expect(await ownerItems()).toBe(0);
    const created = (await convert(d.id, body(event)).expect(201)).body as DesireConversion;
    const item = await itemOf(created.itemId);
    expect(item.pricePaidMinor).toBeNull();
    expect(item.currency).toBe('INR');
    expect(item.purchaseDate).toEqual({ precision: 'unknown', year: null, month: null, day: null });
    expect(JSON.stringify(item)).not.toContain('129900');
  });

  it('requires an explicit price, currency, date precision and lifecycle fields', async () => {
    const d = await boughtDesire();
    const base = body(d.event);
    const drop = (key: string): object => {
      const i = { ...base.item } as Record<string, unknown>;
      delete i[key];
      return { ...base, item: i };
    };
    for (const key of [
      'pricePaid',
      'currency',
      'purchaseDate',
      'acquisitionType',
      'condition',
      'useFrequency',
      'ownershipStatus',
      'name',
    ])
      await convert(d.id, drop(key)).expect(400);
    const noPhoto: Partial<ConvertDesireRequest> = { ...base };
    delete noPhoto.copyPhoto;
    await convert(d.id, noPhoto).expect(400);
    for (const pricePaid of [
      { state: 'known' },
      { state: 'known', minor: '-1' },
      { state: 'known', minor: '1.5' },
      { state: 'known', minor: '9223372036854775808' },
      { state: 'unknown', minor: '100' },
      { state: 'estimated', minor: '100' },
    ])
      await convert(d.id, body(d.event, { pricePaid } as never)).expect(400);
    for (const currency of ['inr', 'RUPEE', 'ZZZ'])
      await convert(d.id, body(d.event, { currency })).expect(400);
    for (const purchaseDate of [
      { precision: 'exact', year: 2025, month: 2, day: 29 },
      { precision: 'year', year: 2026, month: 3 },
      { precision: 'month', year: 2026 },
      { precision: 'unknown', year: 2026 },
    ])
      await convert(d.id, body(d.event, { purchaseDate } as never)).expect(400);
    expect(await count('desire_conversions WHERE desire_id=$1', [d.id])).toBe(0);
  });

  it('preserves explicit zero, very large minor units, other currencies, gifts and partial dates', async () => {
    const cases: [Partial<ConvertDesireRequest['item']>, Partial<ItemResponse>][] = [
      [
        { pricePaid: { state: 'known', minor: '0' }, acquisitionType: 'gift' },
        { pricePaidMinor: '0', acquisitionType: 'gift' },
      ],
      [
        { pricePaid: { state: 'unknown' }, acquisitionType: 'gift' },
        { pricePaidMinor: null, acquisitionType: 'gift' },
      ],
      [
        {
          pricePaid: { state: 'known', minor: '9223372036854775807' },
          purchaseDate: { precision: 'year', year: 2026 },
        },
        {
          pricePaidMinor: '9223372036854775807',
          purchaseDate: { precision: 'year', year: 2026, month: null, day: null },
        },
      ],
      [
        {
          currency: 'JPY',
          pricePaid: { state: 'known', minor: '15800' },
          purchaseDate: { precision: 'month', year: 2026, month: 2 },
          acquisitionType: 'secondhand',
          condition: 'needs_repair',
          useFrequency: 'rarely',
          ownershipStatus: 'returned',
        },
        {
          currency: 'JPY',
          pricePaidMinor: '15800',
          purchaseDate: { precision: 'month', year: 2026, month: 2, day: null },
          acquisitionType: 'secondhand',
          condition: 'needs_repair',
          useFrequency: 'rarely',
          ownershipStatus: 'returned',
        },
      ],
      [
        { purchaseDate: { precision: 'exact', year: 2024, month: 2, day: 29 } },
        { purchaseDate: { precision: 'exact', year: 2024, month: 2, day: 29 } },
      ],
    ];
    for (const [input, expected] of cases) {
      const d = await boughtDesire();
      const c = (await convert(d.id, body(d.event, input)).expect(201)).body as DesireConversion;
      expect(await itemOf(c.itemId)).toMatchObject(expected);
    }
  });

  it('records provenance, links desire and item history, and survives review corrections', async () => {
    const d = await boughtDesire();
    const category = (
      await run.migration.query<{ id: string }>(
        "INSERT INTO categories(owner_id,name) VALUES($1,'Synthetic kitchen') RETURNING id",
        [owner],
      )
    ).rows[0]!.id;
    const created = (
      await convert(
        d.id,
        body(d.event, {
          name: 'Edited kettle name',
          notes: 'Synthetic private reason',
          categoryId: category,
        }),
      ).expect(201)
    ).body as DesireConversion;
    expect(created).toMatchObject({
      desireId: d.id,
      itemName: 'Edited kettle name',
      boughtEventId: d.event,
      boughtOutcomeCurrent: true,
      photo: 'not_requested',
    });
    const item = await itemOf(created.itemId);
    expect(item.categoryId).toBe(category);
    expect(item.originalSource).toBe('manual');
    expect(item.originalEntry).toMatchObject({
      name: 'Edited kettle name',
      pricePaidMinor: null,
      provenance: {
        source: 'desire_conversion',
        fields: { name: 'owner', notes: 'desire_suggestion', photo: null },
      },
    });
    const history = (await auth(http().get(`/api/v1/items/${created.itemId}/history`)).expect(200))
      .body as { events: { eventType: string; metadata: Record<string, unknown> }[] };
    expect(history.events).toHaveLength(1);
    expect(history.events[0]).toMatchObject({
      eventType: 'created',
      metadata: { source: 'desire_conversion', desireId: d.id, conversionId: created.id },
    });
    // Correcting the outcome appends history and keeps the item and link.
    await review(d.id, 'declined', { supersedesEventId: d.event });
    const state = (await getState(d.id).expect(200)).body as DesireConversionState;
    expect(state.eligibility).toBe('converted');
    expect(state.boughtEventId).toBeNull();
    expect(state.conversion).toMatchObject({ id: created.id, boughtOutcomeCurrent: false });
    await itemOf(created.itemId);
    const events = (await auth(http().get(`/api/v1/desires/${d.id}/reviews`)).expect(200)).body as {
      items: { id: string }[];
    };
    expect(events.items.map((e) => e.id)).toContain(d.event);
  });

  it('rejects non-bought, corrected-away and stale bought outcomes', async () => {
    const plain = await desire();
    await convert(plain.id, body(randomUUID())).expect(409, /DESIRE_NOT_BOUGHT/);
    const delayed = await desire();
    await review(delayed.id, 'delayed', {
      reviewAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
    await convert(delayed.id, body(randomUUID())).expect(409, /DESIRE_NOT_BOUGHT/);
    const away = await boughtDesire();
    await review(away.id, 'used_owned', {
      supersedesEventId: away.event,
      linkedItemId: (
        await items.create(owner, {
          name: 'Owned alternative',
          ownershipStatus: 'owned',
          currency: 'INR',
        })
      ).id,
    });
    await convert(away.id, body(away.event)).expect(409, /DESIRE_NOT_BOUGHT/);
    const rebought = await boughtDesire();
    const second = await review(rebought.id, 'bought', { supersedesEventId: rebought.event });
    await convert(rebought.id, body(rebought.event)).expect(409, /STALE_BOUGHT_OUTCOME/);
    await convert(rebought.id, body(second.id)).expect(201);
    expect(
      await count('desire_conversions WHERE desire_id=ANY($1)', [[plain.id, delayed.id, away.id]]),
    ).toBe(0);
  });

  it('returns the same conversion for retries and concurrent attempts, never duplicate items', async () => {
    const d = await boughtDesire();
    const before = await ownerItems();
    const command = body(d.event, { pricePaid: { state: 'known', minor: '99900' } });
    const results = await Promise.all(Array.from({ length: 6 }, () => convert(d.id, command)));
    expect(results.map((r) => r.status)).toEqual(Array(6).fill(201));
    expect(new Set(results.map((r) => (r.body as DesireConversion).id)).size).toBe(1);
    expect(await ownerItems()).toBe(before + 1);
    // A replay resolves even after the outcome is corrected away.
    await review(d.id, 'declined', { supersedesEventId: d.event });
    const replay = (await convert(d.id, command).expect(201)).body as DesireConversion;
    expect(replay.id).toBe((results[0]!.body as DesireConversion).id);
    // A changed body with the same key, or the same key on another desire, is rejected.
    await convert(d.id, { ...command, item: { ...command.item, name: 'Changed' } }).expect(
      409,
      /CONVERSION_COMMAND_REUSED/,
    );
    const otherDesire = await boughtDesire();
    await convert(otherDesire.id, { ...command, boughtEventId: otherDesire.event }).expect(
      409,
      /CONVERSION_COMMAND_REUSED/,
    );
    // Concurrent fresh commands: exactly one conversion, the rest identify the existing one.
    const race = await boughtDesire();
    const racing = await Promise.all(
      Array.from({ length: 5 }, () => convert(race.id, body(race.event))),
    );
    expect(racing.filter((r) => r.status === 201)).toHaveLength(1);
    for (const r of racing.filter((x) => x.status !== 201))
      expect(r.body).toMatchObject({ statusCode: 409, message: 'DESIRE_ALREADY_CONVERTED' });
    expect(await ownerItems()).toBe(before + 2);
    expect(
      ((await getState(race.id).expect(200)).body as DesireConversionState).conversion?.id,
    ).toBe((racing.find((r) => r.status === 201)!.body as DesireConversion).id);
  });

  it('rolls back item, history, link and media intent at every failure boundary', async () => {
    const snapshot = async (): Promise<number[]> =>
      Promise.all([
        ownerItems(),
        count('lifecycle_events WHERE owner_id=$1', [owner]),
        count('desire_conversions WHERE owner_id=$1', [owner]),
        count('media_attachments WHERE owner_id=$1 AND item_id IS NOT NULL', [owner]),
      ]);
    const d = await boughtDesire();
    await uploadPhoto(d.id);
    const before = await snapshot();
    // 1. Item validation inside the transaction (foreign/missing taxonomy, impossible date).
    const foreignCategory = (
      await run.migration.query<{ id: string }>(
        "INSERT INTO categories(owner_id,name) VALUES($1,'Foreign category') RETURNING id",
        [other],
      )
    ).rows[0]!.id;
    for (const categoryId of [foreignCategory, randomUUID()])
      await convert(d.id, body(d.event, { categoryId })).expect(404, /ITEM_TAXONOMY_NOT_FOUND/);
    // 2. After the item and created event are written.
    const insert = items.insert.bind(items);
    jest.spyOn(items, 'insert').mockImplementationOnce(async (...args) => {
      await insert(...args);
      throw new Error('synthetic failure after item insert');
    });
    await convert(d.id, body(d.event, {}, { copyPhoto: true })).expect(503);
    // 3. After the link is written, while reserving photo intent.
    jest
      .spyOn(conversions as unknown as { reserve: () => Promise<void> }, 'reserve')
      .mockRejectedValueOnce(new ConflictException('PHOTO_QUOTA_EXCEEDED'));
    await convert(d.id, body(d.event, {}, { copyPhoto: true })).expect(409, /PHOTO_QUOTA_EXCEEDED/);
    expect(await snapshot()).toEqual(before);
    expect(put).not.toHaveBeenCalled();
    // Finally a clean conversion still succeeds.
    await convert(d.id, body(d.event)).expect(201);
  });

  it('copies the desire photo into private item media, preserving the original desire photo', async () => {
    const d = await boughtDesire();
    await uploadPhoto(d.id);
    const desirePhoto = (await getState(d.id).expect(200)).body as DesireConversionState;
    expect(desirePhoto.suggestions.photo).toMatchObject({ mimeType: 'image/webp' });
    expect(JSON.stringify(desirePhoto)).not.toMatch(/havefolio\/test|objectKey|providerAssetId/);
    const desireMediaBefore = (
      await run.migration.query(
        'SELECT id,state,object_key,checksum FROM media_attachments WHERE desire_id=$1 ORDER BY id',
        [d.id],
      )
    ).rows;
    const c = (await convert(d.id, body(d.event, {}, { copyPhoto: true })).expect(201))
      .body as DesireConversion;
    expect(c.photo).toBe('copied');
    expect(put).toHaveBeenCalledTimes(3);
    const photos = (await auth(http().get(`/api/v1/items/${c.itemId}/photos`)).expect(200))
      .body as {
      photos: { id: string; altText: string | null }[];
    };
    expect(photos.photos).toHaveLength(1);
    expect(JSON.stringify(photos)).not.toMatch(/havefolio\/test|cloudinary/i);
    const thumb = await auth(
      http().get(`/api/v1/items/${c.itemId}/photos/${photos.photos[0]!.id}/content/thumbnail`),
    ).expect(200);
    expect(thumb.headers['cache-control']).toContain('no-store');
    // Distinct keys and media rows; the desire family is untouched.
    const itemMedia = (
      await run.migration.query<{ object_key: string; state: string }>(
        'SELECT object_key,state FROM media_attachments WHERE item_id=$1',
        [c.itemId],
      )
    ).rows;
    expect(itemMedia.map((m) => m.state)).toEqual(['ready', 'ready', 'ready']);
    expect(
      itemMedia.some((m) => desireMediaBefore.some((o) => o.object_key === m.object_key)),
    ).toBe(false);
    expect(
      (
        await run.migration.query(
          'SELECT id,state,object_key,checksum FROM media_attachments WHERE desire_id=$1 ORDER BY id',
          [d.id],
        )
      ).rows,
    ).toEqual(desireMediaBefore);
    // Replays never copy again.
    put.mockClear();
    await resume(d.id).expect(201);
    expect(put).not.toHaveBeenCalled();
  });

  it('keeps a resumable pending copy after provider failure and recovers without orphans', async () => {
    const d = await boughtDesire();
    await uploadPhoto(d.id);
    put.mockRejectedValueOnce(new Error('synthetic provider outage'));
    const c = (await convert(d.id, body(d.event, {}, { copyPhoto: true })).expect(201))
      .body as DesireConversion;
    expect(c.photo).toBe('pending');
    // The item exists; the photo copy is durable pending intent, never a half-ready family.
    const pending = (
      await run.migration.query<{ state: string }>(
        'SELECT state FROM media_attachments WHERE item_id=$1',
        [c.itemId],
      )
    ).rows;
    expect(pending.map((p) => p.state)).toEqual(['pending', 'pending', 'pending']);
    // Read failures during resume surface a safe 503 and keep the copy pending.
    read.mockRejectedValueOnce(new Error('synthetic read failure'));
    await resume(d.id).expect(503, /MEDIA_STORAGE_UNAVAILABLE/);
    // Simulate recovery reclaiming the stale attempt, then resume with a fresh bounded attempt.
    await run.migration.query(
      "UPDATE media_attachments SET updated_at=now()-interval '1 hour' WHERE item_id=$1",
      [c.itemId],
    );
    for (let i = 0; i < 3; i++) await media.reconcile();
    expect(
      (
        await run.migration.query<{ state: string }>(
          "SELECT state FROM media_attachments WHERE item_id=$1 AND state<>'deleted'",
          [c.itemId],
        )
      ).rows,
    ).toEqual([]);
    const resumed = (await resume(d.id).expect(201)).body as DesireConversion;
    expect(resumed.photo).toBe('copied');
    expect(await count("media_attachments WHERE item_id=$1 AND state='ready'", [c.itemId])).toBe(3);
    // Desire photo remains intact.
    expect(await count("media_attachments WHERE desire_id=$1 AND state='ready'", [d.id])).toBe(3);
  });

  it('marks the copy unavailable when the desire photo disappears, without substituting another', async () => {
    const d = await boughtDesire();
    await uploadPhoto(d.id);
    put.mockRejectedValueOnce(new Error('synthetic provider outage'));
    const c = (await convert(d.id, body(d.event, {}, { copyPhoto: true })).expect(201))
      .body as DesireConversion;
    expect(c.photo).toBe('pending');
    await auth(http().delete(`/api/v1/desires/${d.id}/photo`))
      .send({ revision: await revisionOf(d.id) })
      .expect(200);
    expect(((await resume(d.id).expect(201)).body as DesireConversion).photo).toBe('unavailable');
    // Requesting a copy with no photo converts the item and reports the copy as unavailable.
    const none = await boughtDesire();
    expect(
      (
        (await convert(none.id, body(none.event, {}, { copyPhoto: true })).expect(201))
          .body as DesireConversion
      ).photo,
    ).toBe('unavailable');
  });

  it('keeps items on desire deletion and frees the desire link on item deletion', async () => {
    const d = await boughtDesire();
    const c = (await convert(d.id, body(d.event)).expect(201)).body as DesireConversion;
    const item = await itemOf(c.itemId);
    await auth(http().delete(`/api/v1/items/${c.itemId}`))
      .send({ revision: item.revision })
      .expect(204);
    const state = (await getState(d.id).expect(200)).body as DesireConversionState;
    expect(state).toMatchObject({ eligibility: 'eligible', conversion: null });
    const again = (await convert(d.id, body(d.event)).expect(201)).body as DesireConversion;
    await auth(http().delete(`/api/v1/desires/${d.id}`))
      .send({ revision: await revisionOf(d.id) })
      .expect(204);
    await itemOf(again.itemId);
    expect(await count('desire_conversions WHERE item_id=$1', [again.itemId])).toBe(0);
  });

  it('enforces database guards, owner-safe keys, immutability and row-level security', async () => {
    const d = await boughtDesire();
    const c = (await convert(d.id, body(d.event)).expect(201)).body as DesireConversion;
    // Runtime role sees nothing without the matching owner context.
    expect(
      (await run.runtime.query('SELECT * FROM desire_conversions WHERE id=$1', [c.id])).rows,
    ).toEqual([]);
    await run.runtime.query("SELECT set_config('havefolio.owner_id',$1,false)", [other]);
    expect(
      (await run.runtime.query('SELECT * FROM desire_conversions WHERE id=$1', [c.id])).rows,
    ).toEqual([]);
    await run.runtime.query("SELECT set_config('havefolio.owner_id',$1,false)", [owner]);
    await expect(
      run.runtime.query('UPDATE desire_conversions SET item_id=$1 WHERE id=$2', [
        randomUUID(),
        c.id,
      ]),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      run.runtime.query(
        "UPDATE desire_conversions SET photo_state='pending',photo_attempt=1 WHERE id=$1",
        [c.id],
      ),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      run.runtime.query('DELETE FROM desire_conversions WHERE id=$1', [c.id]),
    ).rejects.toMatchObject({ code: '23514' });
    const fresh = await boughtDesire();
    const ownItem = (
      await items.create(owner, { name: 'Raw item', ownershipStatus: 'owned', currency: 'INR' })
    ).id;
    const foreignItem = randomUUID();
    await run.migration.query(
      "INSERT INTO items(id,owner_id,name,currency,original_entry,original_source) VALUES($1,$2,'Foreign',$3,'{}','manual')",
      [foreignItem, other, 'INR'],
    );
    const raw = (
      itemId: string,
      event: string,
      state = 'not_requested',
      attempt = 0,
    ): Promise<unknown> =>
      run.runtime.query(
        'INSERT INTO desire_conversions(id,owner_id,desire_id,item_id,bought_event_id,command_id,request_hash,photo_state,photo_attempt) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
        [
          randomUUID(),
          owner,
          fresh.id,
          itemId,
          event,
          randomUUID(),
          'b'.repeat(64),
          state,
          attempt,
        ],
      );
    await expect(raw(foreignItem, fresh.event)).rejects.toMatchObject({ code: '23503' });
    // The bought-outcome guard runs before the owner-composite event key.
    await expect(raw(ownItem, d.event)).rejects.toMatchObject({ code: '23514' });
    await expect(raw(ownItem, fresh.event, 'pending', 0)).rejects.toMatchObject({
      code: '23514',
      constraint: 'conversion_photo_check',
    });
    await expect(raw(c.itemId, fresh.event)).rejects.toMatchObject({
      code: '23505',
      constraint: 'conversion_item_unique',
    });
    await review(fresh.id, 'declined', { supersedesEventId: fresh.event });
    await expect(raw(ownItem, fresh.event)).rejects.toMatchObject({ code: '23514' });
    await run.runtime.query("SELECT set_config('havefolio.owner_id','',false)");
    const indexes = (
      await run.migration.query<{ indexname: string }>(
        "SELECT indexname FROM pg_indexes WHERE schemaname=$1 AND tablename='desire_conversions'",
        [run.schema],
      )
    ).rows.map((r) => r.indexname);
    expect(indexes).toEqual(
      expect.arrayContaining([
        'conversion_owner_desire_unique',
        'conversion_owner_command_unique',
        'conversion_item_unique',
        'conversion_owner_created_idx',
      ]),
    );
  });

  it('publishes OpenAPI without provider identifiers and logs only fixed redacted events', () => {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .addCookieAuth('havefolio_session', { type: 'apiKey', in: 'cookie' }, 'ownerSession')
        .build(),
    );
    for (const [path, method] of [
      ['/api/v1/desires/{id}/conversion', 'get'],
      ['/api/v1/desires/{id}/conversion', 'post'],
      ['/api/v1/desires/{id}/conversion/photo', 'post'],
      ['/api/v1/items', 'post'],
    ] as const) {
      const operation = document.paths[path]?.[method];
      expect(operation).toBeDefined();
      expect(operation?.security).toEqual([{ ownerSession: [] }]);
    }
    const schemas = document.components!.schemas!;
    for (const name of [
      'ConvertDesireDto',
      'ConvertDesireItemDto',
      'ConfirmedPricePaidDto',
      'DesireConversionDto',
      'DesireConversionStateDto',
      'DesireConversionSuggestionsDto',
    ])
      expect(schemas[name]).toBeDefined();
    const required = (schemas.ConvertDesireItemDto as { required: string[] }).required;
    expect(required).toEqual(
      expect.arrayContaining([
        'pricePaid',
        'currency',
        'purchaseDate',
        'acquisitionType',
        'condition',
        'useFrequency',
        'ownershipStatus',
      ]),
    );
    const text = JSON.stringify(document.components);
    for (const forbidden of ['objectKey', 'providerAssetId', 'ownerId', 'secureUrl'])
      expect(text).not.toContain(forbidden);
    // Telemetry carries only fixed tokens, never names, notes, URLs, amounts or identifiers.
    const logs = JSON.stringify(emitted);
    expect(logs).toContain('desire_converted');
    for (const secret of [
      'Synthetic kettle',
      'Synthetic private reason',
      'shop.example.test',
      '99900',
      owner,
    ])
      expect(logs).not.toContain(secret);
  });
});
