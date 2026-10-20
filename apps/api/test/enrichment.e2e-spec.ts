import sharp from 'sharp';
import { PrivateMediaStorage, type StoreInput } from '../src/media/storage.js';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { ConfigModule, ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { IntegrationRun, integrationConfiguration } from '@havefolio/test-utils';
import { EnrichmentStore } from '@havefolio/db';
import { Pool } from 'pg';
import { validateApiEnvironment } from '@havefolio/config';
import { TelemetryModule } from '@havefolio/logging';
import request, { type Test as HttpTest } from 'supertest';
import { AuthModule } from '../src/auth/auth.module.js';
import { AuthRateService } from '../src/auth/auth-rate.service.js';
import { newToken, hashToken } from '../src/auth/session-cookie.service.js';
import { configureApplication } from '../src/app.setup.js';
import { EnrichmentService } from '../src/enrichment/enrichment.service.js';
import { EnrichmentModule } from '../src/enrichment/enrichment.module.js';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
jest.setTimeout(90000);
describe('PER-43 private correctable enrichment', () => {
  const run = new IntegrationRun(integrationConfiguration());
  const owner = randomUUID(),
    other = randomUUID(),
    token = newToken(),
    otherToken = newToken();
  let service: EnrichmentService;
  let imageBytes: Buffer;
  let fetchCount = 0;
  let duringFetch: (() => Promise<void>) | undefined;
  const put = jest.fn((input: StoreInput) =>
    Promise.resolve({
      assetId: input.key,
      version: 1,
      width: 80,
      height: 60,
    }),
  );
  let app: NestExpressApplication,
    pool: Pool,
    store: EnrichmentStore,
    item: string,
    workId: string,
    revision = 1;
  const http = (): ReturnType<typeof request> => request(app.getHttpServer());
  const auth = (t: HttpTest, foreign = false): HttpTest =>
    t.set('Cookie', `havefolio_session=${foreign ? otherToken : token}`);
  const path = (): string => `/api/v1/items/${item}/enrichment`;
  beforeAll(async () => {
    await run.start();
    const url = new URL(integrationConfiguration().runtimeUrl);
    url.searchParams.set('options', `-c search_path=${run.schema},pg_catalog`);
    pool = new Pool({ connectionString: url.toString() });
    store = new EnrichmentStore(pool);
    const module = await Test.createTestingModule({
      imports: [
        TelemetryModule.register('api'),
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, ignoreEnvVars: true }),
        AuthModule,
        EnrichmentModule,
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
      .useValue({ put, delete: () => Promise.resolve(undefined) })
      .overrideProvider('ENRICHMENT_FETCHER')
      .useValue({
        fetch: async () => {
          fetchCount++;
          await duringFetch?.();
          return {
            url: 'https://images.example.org/a.png',
            mime: 'image/png',
            bytes: Buffer.from(imageBytes),
          };
        },
      })
      .overrideProvider(AuthRateService)
      .useValue({ check: jest.fn<() => Promise<void>>().mockResolvedValue(undefined) })
      .compile();
    imageBytes = await sharp({
      create: { width: 80, height: 60, channels: 3, background: '#abcdef' },
    })
      .png()
      .toBuffer();
    service = module.get(EnrichmentService);
    app = module.createNestApplication<NestExpressApplication>({ logger: false });
    configureApplication(app);
    await app.listen(0, '127.0.0.1');
    for (const [id, t] of [
      [owner, token],
      [other, otherToken],
    ]) {
      if (id === owner)
        await run.runtime.query(
          "INSERT INTO users(id,email,password_hash) VALUES($1,'owner@example.test','$argon2id$fixture')",
          [id],
        );
      else await run.runtime.query('INSERT INTO users(id) VALUES($1)', [id]);
      await run.runtime.query(
        "INSERT INTO auth_sessions(owner_id,token_hash,idle_expires_at,absolute_expires_at) VALUES($1,$2,now()+interval '1 hour',now()+interval '1 day')",
        [id, hashToken(t!)],
      );
    }
  });
  afterAll(async () => {
    await app?.close();
    await pool?.end();
    await run.close();
  });
  it('manual capture succeeds independently of provider and unavailable queue; OpenAPI exposes explicit contracts', async () => {
    const response = await auth(http().post('/api/v1/items'))
      .send({
        name: 'Manual original',
        currency: 'INR',
        pricePaidMinor: '9007199254740993',
        ownershipStatus: 'owned',
        purchaseDate: { precision: 'year', year: 2020 },
        purchaseUrl: 'http://127.0.0.1/private-never-fetched',
      })
      .expect(201);
    item = response.body.id;
    expect(response.body.originalEntry.name).toBe('Manual original');
    expect(
      (await run.runtime.query('SELECT id FROM enrichment_work WHERE item_id=$1', [item])).rowCount,
    ).toBe(0);
    const spec = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle('test').setVersion('1').build(),
    );
    expect(
      spec.paths['/api/v1/items/{id}/enrichment/{workId}/reviews']?.post?.responses['201'],
    ).toBeDefined();
    await http().get(path()).expect(401);
    await expect(service.list(other, item, { limit: 10 })).rejects.toThrow('ITEM_NOT_FOUND');
    await auth(http().get(path()))
      .expect(200)
      .expect((r) =>
        expect(r.body).toMatchObject({
          providerStatus: 'available',
          availableKinds: ['url', 'barcode'],
        }),
      );
  });
  it('persists idempotent bounded requests, private URL provenance and unavailable status without fetching', async () => {
    await auth(http().post(path()))
      .send({ commandId: randomUUID(), revision, kind: 'url' })
      .expect(400);
    await auth(http().post(path()))
      .send({
        commandId: randomUUID(),
        revision,
        kind: 'url',
        providerConsent: 'public-product-metadata-v1',
      })
      .expect(400);
    const command = {
      commandId: randomUUID(),
      revision,
      kind: 'url',
      providerConsent: 'public-product-metadata-v1',
      url: 'https://shop.example.org/product',
    };
    const first = await auth(http().post(path())).send(command).expect(201);
    workId = first.body.id;
    expect((await auth(http().post(path())).send(command).expect(201)).body.id).toBe(workId);
    await auth(http().post(path()))
      .send({ ...command, kind: 'name' })
      .expect(409);
    expect(await store.due()).toContain(workId);
    const claim = await store.claim(workId);
    expect(claim?.input).toEqual({
      kind: 'url',
      url: 'https://shop.example.org/product',
      consent: 'public-product-metadata-v1',
    });
    await store.finish(claim!, 'unconfigured');
    expect((await auth(http().get(path())).expect(200)).body.items[0]).toMatchObject({
      state: 'unconfigured',
      failureCode: 'PROVIDER_UNCONFIGURED',
      candidates: [],
    });
    expect((await auth(http().get(`/api/v1/items/${item}`)).expect(200)).body.name).toBe(
      'Manual original',
    );
    await auth(http().post(path()))
      .send({ commandId: randomUUID(), revision, kind: 'photo', attachmentId: randomUUID() })
      .expect(404);
    await auth(http().post(path()))
      .send({ commandId: randomUUID(), revision, kind: 'name', barcode: '123' })
      .expect(400);
    await auth(http().post(path()))
      .send({ commandId: randomUUID(), revision, kind: 'barcode' })
      .expect(400);
  });
  it('accepts typed barcode and ready private attachment references without reading or forwarding content', async () => {
    const barcode = await auth(http().post(path()))
      .send({
        commandId: randomUUID(),
        revision,
        kind: 'barcode',
        barcode: '3017620422003',
        providerConsent: 'open-food-facts-v1',
      })
      .expect(201);
    let claim = await store.claim(barcode.body.id);
    expect(claim?.input).toEqual({
      kind: 'barcode',
      barcode: '3017620422003',
      consent: 'open-food-facts-v1',
    });
    await store.finish(claim!, 'unconfigured');
    for (const kind of ['photo', 'receipt']) {
      const attachment = randomUUID();
      await run.runtime.query(
        `INSERT INTO media_attachments(id,owner_id,item_id,kind,variant,state,object_key,resource_type,format,provider_asset_id,provider_version,original_filename,mime_type,byte_size,checksum) VALUES($1,$2,$3,$4,'original','ready',$5,$6,$7,$8,1,$9,$10,100,repeat('a',64))`,
        [
          attachment,
          owner,
          item,
          kind,
          'synthetic/private/' + attachment,
          'image',
          'webp',
          randomUUID(),
          'sanitized.webp',
          'image/webp',
        ],
      );
      const result = await auth(http().post(path()))
        .send({ commandId: randomUUID(), revision, kind, attachmentId: attachment })
        .expect(201);
      claim = await store.claim(result.body.id);
      expect(claim?.input).toEqual({ kind, attachmentId: attachment });
      await store.finish(claim!, 'unconfigured');
      // Remove synthetic attachment before the ordinary item-erasure test (no real provider files).
      await run.runtime.query("UPDATE media_attachments SET state='deleting' WHERE id=$1", [
        attachment,
      ]);
      await run.runtime.query("UPDATE media_attachments SET state='deleted' WHERE id=$1", [
        attachment,
      ]);
      await run.runtime.query('DELETE FROM media_attachments WHERE id=$1', [attachment]);
    }
  });
  it('stores ambiguous candidates without overwriting data and requires explicit field decisions', async () => {
    const response = await auth(http().post(path()))
      .send({ commandId: randomUUID(), revision, kind: 'name' })
      .expect(201);
    workId = response.body.id;
    const claim = await store.claim(workId);
    await store.finish(claim!, 'succeeded', [
      {
        id: 'a',
        fields: [
          {
            field: 'name',
            value: 'Suggested A',
            confidence: 0.4,
            source: { provider: 'fake', inputKind: 'name', reference: 'fixture-a' },
          },
          {
            field: 'brand',
            value: 'Synthetic brand',
            confidence: 0.9,
            source: { provider: 'fake', inputKind: 'name', reference: 'fixture-a' },
          },
        ],
      },
      {
        id: 'b',
        fields: [
          {
            field: 'name',
            value: 'Suggested B',
            confidence: 0.3,
            source: { provider: 'fake', inputKind: 'name', reference: 'fixture-b' },
          },
        ],
      },
    ]);
    const list = await auth(http().get(path())).expect(200);
    expect(list.body.items.find((w: { id: string }) => w.id === workId).candidates).toHaveLength(2);
    const original = await auth(http().get(`/api/v1/items/${item}`)).expect(200);
    expect(original.body).toMatchObject({
      name: 'Manual original',
      revision: 1,
      pricePaidMinor: '9007199254740993',
      purchaseDate: { precision: 'year', year: 2020, month: null },
    });
    await auth(http().post(`${path()}/${workId}/reviews`))
      .send({
        commandId: randomUUID(),
        revision,
        candidateId: 'a',
        field: 'pricePaidMinor',
        decision: 'accept',
      })
      .expect(400);
    await auth(http().post(`${path()}/${workId}/reviews`), true)
      .send({
        commandId: randomUUID(),
        revision,
        candidateId: 'a',
        field: 'name',
        decision: 'accept',
      })
      .expect(401);
    await expect(
      service.decide(other, item, workId, {
        commandId: randomUUID(),
        revision,
        candidateId: 'a',
        field: 'name',
        decision: 'accept',
      }),
    ).rejects.toThrow('ITEM_NOT_FOUND');
    const command = {
      commandId: randomUUID(),
      revision,
      candidateId: 'b',
      field: 'name',
      decision: 'accept',
    };
    const accepted = await auth(http().post(`${path()}/${workId}/reviews`))
      .send(command)
      .expect(201);
    expect(accepted.body).toMatchObject({
      previousValue: 'Manual original',
      confirmedValue: 'Suggested B',
      resultingRevision: 2,
    });
    revision++;
    expect(
      (
        await auth(http().post(`${path()}/${workId}/reviews`))
          .send(command)
          .expect(201)
      ).body.id,
    ).toBe(accepted.body.id);
    await auth(http().post(`${path()}/${workId}/reviews`))
      .send({ ...command, decision: 'reject' })
      .expect(409);
    const corrected = await auth(http().post(`${path()}/${workId}/reviews`))
      .send({
        commandId: randomUUID(),
        revision,
        candidateId: 'b',
        field: 'name',
        decision: 'correct',
        value: 'Owner corrected',
      })
      .expect(201);
    revision++;
    expect(corrected.body).toMatchObject({
      previousValue: 'Suggested B',
      confirmedValue: 'Owner corrected',
    });
    const rejected = await auth(http().post(`${path()}/${workId}/reviews`))
      .send({
        commandId: randomUUID(),
        revision,
        candidateId: 'a',
        field: 'brand',
        decision: 'reject',
      })
      .expect(201);
    revision++;
    expect(rejected.body).toMatchObject({ previousValue: null, confirmedValue: null });
    const result = await auth(http().get(`/api/v1/items/${item}`)).expect(200);
    expect(result.body).toMatchObject({
      name: 'Owner corrected',
      brand: null,
      originalEntry: { name: 'Manual original' },
      pricePaidMinor: '9007199254740993',
      revision,
    });
    const history = await auth(http().get(`${path()}/reviews?limit=2`)).expect(200);
    expect(history.body.items).toHaveLength(2);
    expect(history.body.nextBefore).toBeTruthy();
    await expect(service.history(other, item, { limit: 10 })).rejects.toThrow('ITEM_NOT_FOUND');
    await expect(
      run.runtime.query("UPDATE enrichment_reviews SET decision='reject' WHERE item_id=$1", [item]),
    ).rejects.toThrow();
    await expect(
      run.runtime.query('DELETE FROM enrichment_reviews WHERE item_id=$1', [item]),
    ).rejects.toThrow();
    await expect(
      run.runtime.query("UPDATE enrichment_work SET input='{}' WHERE id=$1", [workId]),
    ).rejects.toThrow();
  });
  it('serializes concurrent decisions, rejects stale item snapshots and command reuse', async () => {
    const commands = [0, 1].map(() => ({
      commandId: randomUUID(),
      revision,
      candidateId: 'a',
      field: 'name',
      decision: 'correct',
      value: 'Concurrent',
    }));
    const responses = await Promise.all(
      commands.map((c) => auth(http().post(`${path()}/${workId}/reviews`)).send(c)),
    );
    expect(responses.map((r) => r.status).sort()).toEqual([201, 409]);
    revision++;
    const pending = await auth(http().post(path()))
      .send({ commandId: randomUUID(), revision, kind: 'name' })
      .expect(201);
    await auth(http().patch(`/api/v1/items/${item}`))
      .send({ revision, name: 'Ordinary edit' })
      .expect(200);
    revision++;
    await auth(http().post(`${path()}/${workId}/reviews`))
      .send({
        commandId: randomUUID(),
        revision,
        candidateId: 'a',
        field: 'name',
        decision: 'accept',
      })
      .expect(409);
    expect(await store.claim(pending.body.id)).toBeNull();
    expect(
      (await run.runtime.query('SELECT state FROM enrichment_work WHERE id=$1', [pending.body.id]))
        .rows[0].state,
    ).toBe('stale');
    const final = await auth(http().get(`/api/v1/items/${item}`)).expect(200);
    expect(final.body.name).toBe('Ordinary edit');
  });
  it('PER-44 reviews individual specifications and imports images only through validated private media with revision and retry safety', async () => {
    const created = await auth(http().post('/api/v1/items'))
      .send({
        name: 'Original kettle',
        currency: 'INR',
        ownershipStatus: 'owned',
        specifications: { Existing: 'kept' },
      })
      .expect(201);
    const imageItem = created.body.id;
    const base = `/api/v1/items/${imageItem}/enrichment`;
    const response = await auth(http().post(base))
      .send({
        commandId: randomUUID(),
        revision: 1,
        kind: 'url',
        providerConsent: 'public-product-metadata-v1',
        url: 'https://shop.example.org/kettle',
      })
      .expect(201);
    const imageWork = response.body.id;
    const claim = await store.claim(imageWork);
    await store.finish(claim!, 'succeeded', [
      {
        id: 'product',
        fields: [
          {
            field: 'specification:Capacity',
            value: '1.5 L',
            confidence: 0.5,
            source: { provider: 'fixture', inputKind: 'url', reference: 'controlled' },
          },
          {
            field: 'image',
            value: 'https://images.example.org/a.png',
            confidence: 0.5,
            source: { provider: 'fixture', inputKind: 'url', reference: 'controlled' },
          },
        ],
      },
    ]);
    expect(fetchCount).toBe(0);
    const spec = await auth(http().post(`${base}/${imageWork}/reviews`))
      .send({
        commandId: randomUUID(),
        revision: 1,
        candidateId: 'product',
        field: 'specification:Capacity',
        decision: 'accept',
      })
      .expect(201);
    expect(spec.body).toMatchObject({
      previousValue: null,
      confirmedValue: '1.5 L',
      resultingRevision: 2,
    });
    expect(
      (await auth(http().get(`/api/v1/items/${imageItem}`)).expect(200)).body.specifications,
    ).toEqual({ Existing: 'kept', Capacity: '1.5 L' });
    const command = {
      commandId: randomUUID(),
      revision: 2,
      candidateId: 'product',
      field: 'image',
      decision: 'accept',
    };
    await expect(service.decide(other, imageItem, imageWork, command as never)).rejects.toThrow(
      'ITEM_NOT_FOUND',
    );
    expect(fetchCount).toBe(0);
    const imported = await auth(http().post(`${base}/${imageWork}/reviews`))
      .send(command)
      .expect(201);
    expect(imported.body.confirmedValue).toMatch(/^[a-f0-9-]{36}$/);
    expect(imported.body.resultingRevision).toBe(3);
    expect(fetchCount).toBe(1);
    expect(put).toHaveBeenCalledTimes(3);
    const rows = await pool.query('SELECT * FROM media_attachments WHERE item_id=$1', [imageItem]);
    expect(rows.rows).toHaveLength(3);
    expect(rows.rows.every((r) => r.state === 'ready' && r.mime_type === 'image/webp')).toBe(true);
    const retried = await auth(http().post(`${base}/${imageWork}/reviews`))
      .send(command)
      .expect(201);
    expect(retried.body.id).toBe(imported.body.id);
    expect(fetchCount).toBe(1);
    await auth(http().post(`${base}/${imageWork}/reviews`))
      .send({
        ...command,
        commandId: randomUUID(),
        revision: 3,
        decision: 'correct',
        value: 'http://127.0.0.1',
      })
      .expect(400);
    const originalImage = imageBytes;
    imageBytes = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>hostile</script></svg>',
    );
    await auth(http().post(`${base}/${imageWork}/reviews`))
      .send({ ...command, commandId: randomUUID(), revision: 3 })
      .expect(409);
    imageBytes = originalImage;
    const before = put.mock.calls.length;
    duringFetch = async () => {
      await pool.query('UPDATE items SET revision=revision+1 WHERE id=$1', [imageItem]);
    };
    await auth(http().post(`${base}/${imageWork}/reviews`))
      .send({ ...command, commandId: randomUUID(), revision: 3 })
      .expect(409);
    duringFetch = undefined;
    expect(put).toHaveBeenCalledTimes(before);
    expect(
      (await pool.query('SELECT id FROM enrichment_reviews WHERE item_id=$1', [imageItem]))
        .rowCount,
    ).toBe(2);
    // Controlled provider resources are removed through the existing media/item cascade.
    await auth(http().delete(`/api/v1/items/${imageItem}`))
      .send({ revision: 4 })
      .expect(204);
    expect(
      (await pool.query('SELECT id FROM enrichment_reviews WHERE item_id=$1', [imageItem]))
        .rowCount,
    ).toBe(0);
  });
  it('caps pending work, validates pagination and cascades histories only on parent erasure', async () => {
    for (let i = 0; i < 3; i++)
      await auth(http().post(path()))
        .send({ commandId: randomUUID(), revision, kind: 'name' })
        .expect(201);
    await auth(http().post(path()))
      .send({ commandId: randomUUID(), revision, kind: 'name' })
      .expect(429);
    await auth(http().get(`${path()}?limit=21`)).expect(400);
    const first = await auth(http().get(`${path()}?limit=1`)).expect(200);
    const second = await auth(
      http().get(`${path()}?limit=1&before=${first.body.nextBefore}`),
    ).expect(200);
    expect(first.body.items[0].id).not.toBe(second.body.items[0].id);
    await auth(http().delete(`/api/v1/items/${item}`))
      .send({ revision })
      .expect(204);
    expect(
      (await run.runtime.query('SELECT id FROM enrichment_reviews WHERE item_id=$1', [item]))
        .rowCount,
    ).toBe(0);
    expect(
      (await run.runtime.query('SELECT id FROM enrichment_work WHERE item_id=$1', [item])).rowCount,
    ).toBe(0);
  });
});
