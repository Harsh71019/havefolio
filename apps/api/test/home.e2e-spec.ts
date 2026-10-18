import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import pg from 'pg';
import { TelemetryModule } from '@havefolio/logging';
import { IntegrationRun, integrationConfiguration } from '@havefolio/test-utils';
import { validateApiEnvironment } from '@havefolio/config';
import type { HomeSummary, SpendingReport } from '@havefolio/contracts';
import request, { type Test as HttpTest } from 'supertest';
import { AuthModule } from '../src/auth/auth.module.js';
import { newToken, hashToken } from '../src/auth/session-cookie.service.js';
import { configureApplication } from '../src/app.setup.js';
import { HomeModule } from '../src/home/home.module.js';
import { HomeService } from '../src/home/home.service.js';
import { PrivateMediaStorage } from '../src/media/storage.js';

jest.setTimeout(120000);
describe('PER-33 owner-scoped Home summary', () => {
  const run = new IntegrationRun(integrationConfiguration());
  const owner = randomUUID(),
    other = randomUUID(),
    token = newToken();
  let app: NestExpressApplication, service: HomeService;
  const http = (): ReturnType<typeof request> => request(app.getHttpServer());
  const auth = (t: HttpTest): HttpTest => t.set('Cookie', `havefolio_session=${token}`);
  const home = async (): Promise<HomeSummary> =>
    (await auth(http().get('/api/v1/home')).expect(200)).body as HomeSummary;
  // Only one credentialed owner may exist, so the second owner is read through the service.
  const foreignHome = (): Promise<HomeSummary> => service.summary(other) as Promise<HomeSummary>;
  const item = async (
    who: string,
    fields: Record<string, unknown> = {},
    createdAt = '2030-01-01T00:00:00Z',
  ): Promise<string> => {
    const row = {
      name: 'Synthetic item',
      currency: 'INR',
      price_paid_minor: '10000',
      ownership_status: 'owned',
      condition: 'working',
      use_frequency: 'often',
      purchase_date_precision: 'unknown',
      purchase_year: null,
      demo_dataset_id: null,
      acquisition_type: 'bought',
      ...fields,
    };
    const keys = Object.keys(row);
    return (
      await run.runtime.query<{ id: string }>(
        `INSERT INTO items(owner_id,${keys.join(',')},original_entry,original_source,created_at)
         VALUES($1,${keys.map((_, n) => `$${n + 2}`).join(',')},'{}','manual',$${keys.length + 2}) RETURNING id`,
        [who, ...Object.values(row), createdAt],
      )
    ).rows[0]!.id;
  };
  const used = (who: string, id: string, at: string): Promise<unknown> =>
    run.runtime.query(
      "INSERT INTO lifecycle_events(owner_id,item_id,event_type,occurred_at) VALUES($1,$2,'used',$3)",
      [who, id, at],
    );
  beforeAll(async () => {
    await run.start();
    await run.runtime.query(
      "INSERT INTO users(id,email,password_hash) VALUES($1,'home@example.test','$argon2id$fixture'),($2,NULL,NULL)",
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
        HomeModule,
      ],
    })
      .overrideProvider(ConfigService)
      .useValue(
        new ConfigService({
          ...validateApiEnvironment({ NODE_ENV: 'test' }),
          DATABASE_URL: url.toString(),
        }),
      )
      .overrideProvider(PrivateMediaStorage)
      .useValue({})
      .compile();
    service = module.get(HomeService);
    app = module.createNestApplication<NestExpressApplication>({ logger: false });
    configureApplication(app);
    await app.listen(0, '127.0.0.1');
  });
  afterAll(async () => {
    await app?.close();
    await run.close();
  });

  it('requires a session, returns no-store and gives empty owners actionable zero sections', async () => {
    await http().get('/api/v1/home').expect(401);
    const response = await auth(http().get('/api/v1/home')).expect(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body).toEqual({
      inventory: { ownedCount: 0, sampleOwnedCount: 0 },
      spending: {
        scope: 'current-owned',
        grouping: 'overall',
        basis: 'purchase-date',
        purchasedFrom: null,
        purchasedTo: null,
        buckets: [],
      },
      recentItems: [],
      desires: { activeCount: 0, readyForReviewCount: 0, items: [] },
      goals: { activeCount: 0, items: [] },
      rediscovery: { eligibleCount: 0, item: null },
    });
  });

  it('matches authoritative spending exactly, keeps currencies/date buckets separate and counts unknown prices', async () => {
    await item(owner, { currency: 'INR', price_paid_minor: '250000' });
    await item(owner, {
      currency: 'INR',
      price_paid_minor: '9007199254740993',
      purchase_date_precision: 'year',
      purchase_year: 2024,
    });
    await item(owner, { currency: 'USD', price_paid_minor: '1999' });
    await item(owner, { currency: 'INR', price_paid_minor: null });
    await item(owner, { currency: 'INR', price_paid_minor: null, acquisition_type: 'gift' });
    for (const status of ['sold', 'donated', 'disposed', 'lost', 'returned'])
      await item(owner, { ownership_status: status, price_paid_minor: '777' });
    const dataset = (
      await run.runtime.query<{ id: string }>(
        "INSERT INTO demo_datasets(owner_id,version) VALUES($1,'indian-household-v1') RETURNING id",
        [owner],
      )
    ).rows[0]!.id;
    await item(owner, { demo_dataset_id: dataset, price_paid_minor: '555' });
    await item(other, { price_paid_minor: '123456' });

    const summary = await home();
    const direct = (
      await auth(http().get('/api/v1/spending').query({ scope: 'current-owned' })).expect(200)
    ).body as SpendingReport;
    expect(summary.spending).toEqual(direct);
    expect(new Set(summary.spending.buckets.map((b) => b.currency))).toEqual(
      new Set(['INR', 'USD']),
    );
    const inr = summary.spending.buckets.filter((b) => b.currency === 'INR');
    expect(inr.map((b) => b.dateBucket).sort()).toEqual(['dated', 'unknownDate']);
    expect(inr.find((b) => b.dateBucket === 'dated')!.netMinor).toBe('9007199254740993');
    expect(inr.find((b) => b.dateBucket === 'unknownDate')).toMatchObject({
      netMinor: '250000',
      unknownPriceCount: 1,
      notSpendingCount: 1,
    });
    // Count parity: owned genuine items equal current-owned membership; samples stay separate.
    expect(summary.inventory).toEqual({ ownedCount: 5, sampleOwnedCount: 1 });
    expect(summary.spending.buckets.reduce((n, b) => n + b.totalItemCount, 0)).toBe(5);
    expect(JSON.stringify(summary)).not.toContain('123456');
  });

  it('lists only the newest owned items, bounded to four', async () => {
    const newest = await item(owner, { name: 'Synthetic newest' }, '2031-06-01T00:00:00Z');
    await item(owner, { name: 'Synthetic sold newest', ownership_status: 'sold' }, '2031-07-01');
    const { recentItems } = await home();
    expect(recentItems).toHaveLength(4);
    expect(recentItems[0]!.id).toBe(newest);
    expect(recentItems.every((i) => i.ownershipStatus === 'owned')).toBe(true);
    expect(recentItems[0]).not.toHaveProperty('notes');
  });

  it('suggests only eligible rarely used items, least recently used first, never inventing usage', async () => {
    const dataset = (
      await run.runtime.query<{ id: string }>('SELECT id FROM demo_datasets WHERE owner_id=$1', [
        owner,
      ])
    ).rows[0]!.id;
    const excluded = [
      { condition: 'broken', use_frequency: 'never' },
      { condition: 'worn_out', use_frequency: 'never' },
      ...['sold', 'donated', 'disposed', 'lost', 'returned'].map((s) => ({
        ownership_status: s,
        use_frequency: 'never',
      })),
      { use_frequency: 'unknown' },
      { use_frequency: 'sometimes' },
      { demo_dataset_id: dataset, use_frequency: 'never' },
    ];
    for (const fields of excluded) await item(owner, fields, '2000-01-01');
    await item(other, { use_frequency: 'never' }, '1999-01-01');
    expect((await home()).rediscovery).toEqual({ eligibleCount: 0, item: null });

    const usedRecently = await item(owner, { use_frequency: 'rarely' }, '2001-01-01');
    const usedLongAgo = await item(
      owner,
      { use_frequency: 'rarely', condition: 'needs_repair' },
      '2002-01-01',
    );
    await used(owner, usedRecently, '2030-05-01T00:00:00Z');
    await used(owner, usedLongAgo, '2020-05-01T00:00:00Z');
    let r = (await home()).rediscovery;
    expect(r.eligibleCount).toBe(2);
    expect(r.item).toMatchObject({
      id: usedLongAgo,
      condition: 'needs_repair',
      useFrequency: 'rarely',
      lastUsedAt: '2020-05-01T00:00:00.000Z',
      cover: null,
    });

    const neverRecorded = await item(owner, { use_frequency: 'never' }, '2003-01-01');
    const cover = randomUUID();
    await run.runtime.query(
      "INSERT INTO media_attachments(id,owner_id,item_id,kind,variant,state,object_key,resource_type,format,original_filename,mime_type,byte_size,checksum,provider_asset_id,provider_version,width,height,position,alt_text) VALUES($1,$2,$3,'photo','original','ready',$4,'image','webp','synthetic.webp','image/webp',4,$5,'synthetic',1,40,30,0,'')",
      [cover, owner, neverRecorded, 'havefolio/test/' + cover, 'a'.repeat(64)],
    );
    r = (await home()).rediscovery;
    expect(r.eligibleCount).toBe(3);
    expect(r.item).toEqual({
      id: neverRecorded,
      name: 'Synthetic item',
      condition: 'working',
      useFrequency: 'never',
      lastUsedAt: null,
      cover: { photoId: cover, width: 40, height: 30, altText: null, decorative: true },
    });
    expect(JSON.stringify(r)).not.toMatch(/object_key|havefolio\/test|provider/);

    // Recording a use moves the suggestion on; another owner's events never count.
    await used(other, neverRecorded, '2031-01-01T00:00:00Z').catch(() => undefined);
    expect((await home()).rediscovery.item!.id).toBe(neverRecorded);
    await used(owner, neverRecorded, '2031-01-01T00:00:00Z');
    expect((await home()).rediscovery.item!.id).toBe(usedLongAgo);
    expect((await foreignHome()).rediscovery.item).toMatchObject({ useFrequency: 'never' });
  });

  it('summarises active desires with effective review state, bounded to three', async () => {
    await run.runtime.query(
      `INSERT INTO desires(owner_id,name,status,waiting_started_at,review_at,created_at,updated_at) VALUES
        ($1,'Synthetic considering','considering',NULL,NULL,'2030-01-01','2030-01-01'),
        ($1,'Synthetic waiting','waiting',now()-interval '1 day',now()+interval '5 days','2030-01-02','2030-01-02'),
        ($1,'Synthetic ready','waiting',now()-interval '9 days',now()-interval '1 day','2030-01-03','2030-01-03'),
        ($1,'Synthetic older','considering',NULL,NULL,'2029-01-01','2029-01-01'),
        ($1,'Synthetic bought','bought',NULL,NULL,'2031-01-01','2031-01-01'),
        ($1,'Synthetic declined','declined',NULL,NULL,'2031-01-01','2031-01-01'),
        ($2,'Foreign desire','considering',NULL,NULL,'2031-01-01','2031-01-01')`,
      [owner, other],
    );
    const { desires } = await home();
    expect(desires.activeCount).toBe(4);
    expect(desires.readyForReviewCount).toBe(1);
    expect(desires.items.map((d) => [d.name, d.effectiveState])).toEqual([
      ['Synthetic ready', 'ready_for_review'],
      ['Synthetic waiting', 'waiting'],
      ['Synthetic considering', 'considering'],
    ]);
  });

  it('shows only active goals with confirmed progress, separate currencies and the owner only', async () => {
    const goal = async (body: Record<string, unknown>): Promise<{ id: string; revision: number }> =>
      (await auth(http().post('/api/v1/goals')).send(body).expect(201)).body as {
        id: string;
        revision: number;
      };
    const contribute = async (
      id: string,
      extra: Record<string, unknown>,
    ): Promise<{ id: string }> => {
      const { revision } = (await auth(http().get(`/api/v1/goals/${id}`)).expect(200)).body as {
        revision: number;
      };
      return (
        await auth(http().post(`/api/v1/goals/${id}/contributions`))
          .send({ revision, commandId: randomUUID(), kind: 'contribution', ...extra })
          .expect(201)
      ).body as { id: string };
    };
    const trip = await goal({
      name: 'Synthetic trip',
      targetMinor: '4000000',
      currency: 'INR',
      targetDate: '2032-01-01',
    });
    const first = await contribute(trip.id, { amountMinor: '800000', currency: 'INR' });
    await contribute(trip.id, {
      kind: 'correction',
      supersedesId: first.id,
      amountMinor: '500000',
      currency: 'INR',
    });
    const reversed = await contribute(trip.id, { amountMinor: '300000', currency: 'INR' });
    await contribute(trip.id, {
      kind: 'reversal',
      supersedesId: reversed.id,
      amountMinor: '0',
      currency: 'INR',
    });
    const course = await goal({
      name: 'Synthetic course',
      targetMinor: '0',
      currency: 'USD',
      targetDate: '2031-01-01',
    });
    await goal({ name: 'Synthetic undated', targetMinor: '100', currency: 'EUR' });
    await goal({ name: 'Synthetic later', targetMinor: '100', currency: 'INR' });
    const archived = await goal({ name: 'Synthetic archived', targetMinor: '1', currency: 'INR' });
    await auth(http().patch(`/api/v1/goals/${archived.id}`))
      .send({ revision: archived.revision, status: 'archived' })
      .expect(200);
    await run.migration.query('BEGIN');
    await run.migration.query("SELECT set_config('havefolio.owner_id',$1,true)", [other]);
    await run.migration.query(
      "INSERT INTO goals(owner_id,name,target_minor,currency) VALUES($1,'Foreign goal',1,'INR')",
      [other],
    );
    await run.migration.query('COMMIT');

    const { goals } = await home();
    expect(goals.activeCount).toBe(4);
    expect(goals.items).toEqual([
      {
        id: course.id,
        name: 'Synthetic course',
        targetMinor: '0',
        progressMinor: '0',
        currency: 'USD',
        targetDate: '2031-01-01',
      },
      {
        id: trip.id,
        name: 'Synthetic trip',
        targetMinor: '4000000',
        progressMinor: '500000',
        currency: 'INR',
        targetDate: '2032-01-01',
      },
      expect.objectContaining({ targetDate: null }),
    ]);
    const foreign = await foreignHome();
    expect(foreign.goals.items.map((g) => g.name)).toEqual(['Foreign goal']);
    expect(foreign.desires.items.map((d) => d.name)).toEqual(['Foreign desire']);
    expect(JSON.stringify(foreign)).not.toMatch(/Synthetic (trip|ready|newest)/);
  });

  it('uses a constant number of bounded statements regardless of inventory size', async () => {
    const statements = (): Promise<number> => {
      const spy = jest.spyOn(pg.Client.prototype, 'query');
      return home().then(() => {
        const count = spy.mock.calls.length;
        spy.mockRestore();
        return count;
      });
    };
    const before = await statements();
    const ownedBefore = (await home()).inventory.ownedCount;
    await run.runtime.query(
      `INSERT INTO items(owner_id,name,currency,price_paid_minor,use_frequency,condition,original_entry,original_source)
       SELECT $1,'Synthetic bulk '||n,'INR',n,'rarely','working','{}','manual' FROM generate_series(1,1500) n`,
      [owner],
    );
    await run.runtime.query(
      `INSERT INTO lifecycle_events(owner_id,item_id,event_type,occurred_at)
       SELECT owner_id,id,'used',now()-interval '1 day' FROM items WHERE owner_id=$1 AND name LIKE 'Synthetic bulk %'`,
      [owner],
    );
    await run.migration.query('ANALYZE items');
    await run.migration.query('ANALYZE lifecycle_events');
    const started = performance.now();
    const after = await statements();
    expect(after).toBe(before);
    expect(performance.now() - started).toBeLessThan(3000);
    const summary = await home();
    expect(summary.recentItems).toHaveLength(4);
    expect(summary.inventory.ownedCount).toBe(ownedBefore + 1500);
    // Bulk items have a recent recorded use, so the never-used suggestion still leads.
    expect(summary.rediscovery.eligibleCount).toBe(1503);
    expect(summary.rediscovery.item!.lastUsedAt).toBe('2020-05-01T00:00:00.000Z');
  });

  it('publishes the Home summary in OpenAPI', () => {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle('Havefolio').build(),
    );
    const operation = document.paths['/api/v1/home']?.get;
    expect(operation?.responses['200']).toBeDefined();
    expect(document.components?.schemas).toHaveProperty('HomeSummaryDto');
    expect(document.components?.schemas).toHaveProperty('HomeRediscoveryItemDto');
  });
});
