import {
  initializeMonitoring,
  flushMonitoring,
  closeMonitoring,
} from '@havefolio/monitoring/server';
import { createServer } from 'node:http';
import { Client } from 'pg';
import { TelemetryModule } from '@havefolio/logging';
import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, describe, expect, it, jest } from '@jest/globals';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import request from 'supertest';
import { IntegrationRun, integrationConfiguration } from '@havefolio/test-utils';
import { validateApiEnvironment } from '@havefolio/config';
import { summarizeSpending, type SpendingItemInput } from '@havefolio/domain';
import type { ItemsPage, SpendingReport, SpendingBucket } from '@havefolio/contracts';
import { AuthModule } from '../src/auth/auth.module.js';
import { newToken, hashToken } from '../src/auth/session-cookie.service.js';
import { configureApplication } from '../src/app.setup.js';
import { ItemsModule } from '../src/items/items.module.js';
import { ItemsRepository } from '../src/items/items.repository.js';
import { SpendingService, spendingSql } from '../src/items/spending.service.js';

describe('authoritative spending HTTP, SQL and domain parity', () => {
  const run = new IntegrationRun(integrationConfiguration()),
    owner = randomUUID(),
    other = randomUUID(),
    token = newToken();
  const category = randomUUID(),
    child = randomUUID(),
    foreign = randomUUID(),
    merchantActive = randomUUID(),
    merchantRetired = randomUUID(),
    foreignMerchant = randomUUID();
  const fixtures: SpendingItemInput[] = [];
  const ids: string[] = [];
  let app: NestExpressApplication, service: SpendingService;
  const get = (q: object = {}): request.Test =>
    request(app.getHttpServer())
      .get('/api/v1/spending')
      .set('Cookie', `havefolio_session=${token}`)
      .query({ scope: 'all-history', ...q });
  const report = async (q: object = {}): Promise<SpendingReport> =>
    (await get(q).expect(200)).body as SpendingReport;
  beforeAll(async () => {
    await run.start();
    await run.runtime.query(
      "INSERT INTO users(id,email,password_hash) VALUES($1,'spending@example.test','$argon2id$fixture'),($2,NULL,NULL)",
      [owner, other],
    );
    await run.runtime.query(
      "INSERT INTO auth_sessions(owner_id,token_hash,idle_expires_at,absolute_expires_at) VALUES($1,$2,now()+interval '1 hour',now()+interval '1 day')",
      [owner, hashToken(token)],
    );
    await run.runtime.query(
      "INSERT INTO categories(id,owner_id,name) VALUES($1,$2,'Synthetic retired'),($3,$4,'Private foreign')",
      [category, owner, foreign, other],
    );
    await run.runtime.query(
      "INSERT INTO subcategories(id,owner_id,category_id,name) VALUES($1,$2,$3,'Synthetic child')",
      [child, owner, category],
    );
    await run.runtime.query('UPDATE categories SET retired_at=now() WHERE id=$1', [category]);
    await run.runtime.query(
      `INSERT INTO merchants(id,owner_id,display_name,normalized_name,website_host,state)
       VALUES($1,$2,'Amazon India','amazon india','amazon.in','active'),
             ($3,$2,'Flipkart','flipkart','flipkart.com','retired'),
             ($4,$5,'Foreign Store','foreign store',NULL,'active')`,
      [merchantActive, owner, merchantRetired, foreignMerchant, other],
    );
    const statuses = ['owned', 'sold', 'donated', 'disposed', 'lost', 'returned'] as const;
    const dates = [
      { precision: 'exact', year: 2024, month: 2, day: 29 },
      { precision: 'month', year: 2024, month: 2 },
      { precision: 'year', year: 2024 },
      { precision: 'unknown' },
    ] as const;
    for (let n = 0; n < 24; n++) {
      const merchantId = n < 8 ? merchantActive : n < 16 ? merchantRetired : null;
      const input: SpendingItemInput = {
        currency: n === 23 ? 'USD' : n === 20 || n === 21 ? 'EUR' : 'INR',
        pricePaidMinor:
          n % 6 === 0
            ? null
            : n % 6 === 1
              ? '0'
              : n === 2
                ? '9223372036854775807'
                : n === 3
                  ? '9007199254740993'
                  : '10000',
        acquisitionType:
          (n % 6 === 0 && n !== 12) || n % 6 === 2 ? 'gift' : n % 6 === 3 ? 'secondhand' : 'bought',
        ownershipStatus: statuses[Math.floor(n / 4) % 6]!,
        purchaseDate: dates[n % 4]!,
        merchantId,
        refunds:
          n % 6 === 4
            ? [
                { currency: 'INR', amountMinor: '1000' },
                { currency: 'INR', amountMinor: '2000' },
              ]
            : n % 6 === 5
              ? [
                  {
                    currency: n === 23 ? 'USD' : n === 20 || n === 21 ? 'EUR' : 'INR',
                    amountMinor: '10000',
                  },
                ]
              : [],
      };
      fixtures.push(input);
      const d = input.purchaseDate;
      const result = await run.runtime.query<{ id: string }>(
        `INSERT INTO items(owner_id,name,currency,price_paid_minor,acquisition_type,ownership_status,purchase_date_precision,purchase_year,purchase_month,purchase_day,category_id,subcategory_id,merchant_id,original_entry,original_source,created_at) VALUES($1,'Synthetic item',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'{}','manual','2030-01-01') RETURNING id`,
        [
          owner,
          input.currency,
          input.pricePaidMinor,
          input.acquisitionType,
          input.ownershipStatus,
          d.precision,
          d.year ?? null,
          d.month ?? null,
          d.day ?? null,
          n < 12 ? category : null,
          n < 6 ? child : null,
          merchantId,
        ],
      );
      const id = result.rows[0]!.id;
      ids.push(id);
      for (const refund of input.refunds)
        await run.runtime.query(
          'INSERT INTO item_refunds(owner_id,item_id,currency,amount_minor) VALUES($1,$2,$3,$4)',
          [owner, id, refund.currency, refund.amountMinor],
        );
    }
    // PER-19: mirror every genuine fixture (currencies, dates, gifts, statuses and refunds)
    // as explicitly marked samples. All existing SQL/oracle/reconciliation expectations must
    // remain unchanged; neither the implementation nor test relies on a sample name heuristic.
    const dataset = (
      await run.runtime.query<{ id: string }>(
        "INSERT INTO demo_datasets(owner_id,version) VALUES($1,'indian-household-v1') RETURNING id",
        [owner],
      )
    ).rows[0]!.id;
    const genuineFixtures = [...fixtures];
    for (let n = 0; n < ids.length; n++) {
      const sample = (
        await run.runtime.query<{ id: string }>(
          `INSERT INTO items(owner_id,demo_dataset_id,name,currency,price_paid_minor,acquisition_type,ownership_status,purchase_date_precision,purchase_year,purchase_month,purchase_day,category_id,subcategory_id,merchant_id,original_entry,original_source)
        SELECT owner_id,$2,name,currency,price_paid_minor,acquisition_type,ownership_status,purchase_date_precision,purchase_year,purchase_month,purchase_day,category_id,subcategory_id,merchant_id,original_entry,original_source FROM items WHERE id=$1 RETURNING id`,
          [ids[n], dataset],
        )
      ).rows[0]!.id;
      await run.runtime.query(
        `INSERT INTO item_refunds(owner_id,item_id,currency,amount_minor) SELECT owner_id,$2,currency,amount_minor FROM item_refunds WHERE item_id=$1`,
        [ids[n], sample],
      );
      fixtures.push({ ...genuineFixtures[n]!, isDemo: true });
    }
    await run.runtime.query(
      "INSERT INTO items(owner_id,name,currency,price_paid_minor,original_entry,original_source) VALUES($1,'Foreign amount','INR',777,'{}','manual')",
      [other],
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
    service = module.get(SpendingService);
    app = module.createNestApplication<NestExpressApplication>({ logger: false });
    configureApplication(app);
    await app.listen(0, '127.0.0.1');
  }, 60000);
  afterAll(async () => {
    await app?.close();
    await run.close();
  });
  it.each(['current-owned', 'all-history'] as const)(
    'drills down every category/subcategory/year/merchant date bucket with exact %s membership and opaque pages',
    async (scope) => {
      for (const grouping of ['category', 'subcategory', 'year', 'merchant'] as const) {
        for (const range of [{}, { purchasedFrom: '2024-02-29', purchasedTo: '2024-02-29' }]) {
          const r = await report({ scope, grouping, ...range });
          for (const bucket of r.buckets) {
            const query: Record<string, string | number> = {
              spendingScope: scope,
              spendingDateBucket: bucket.dateBucket,
              currency: bucket.currency,
              limit: 2,
              ...range,
            };
            if (grouping === 'category') {
              if (bucket.key) query.categoryId = bucket.key;
              else query.spendingUnassigned = 'category';
            }
            if (grouping === 'subcategory') {
              if (bucket.key) {
                query.categoryId = category;
                query.subcategoryId = bucket.key;
              } else query.spendingUnassigned = 'subcategory';
            }
            if (grouping === 'year' && bucket.key) query.spendingYear = bucket.key;
            if (grouping === 'merchant') {
              if (bucket.key) {
                query.merchantId = bucket.key;
                expect(bucket.merchant).toBeDefined();
                expect(bucket.merchant?.id).toBe(bucket.key);
                expect(['Amazon India', 'Flipkart']).toContain(bucket.merchant?.displayName);
              } else {
                query.spendingUnassigned = 'merchant';
                expect(bucket.merchant).toBeNull();
                expect(bucket.missingMerchantCount).toBe(bucket.totalItemCount);
              }
            }
            const collected: ItemsPage['items'] = [];
            let cursor: string | null = null;
            do {
              const response = await request(app.getHttpServer())
                .get('/api/v1/items')
                .set('Cookie', `havefolio_session=${token}`)
                .query({ ...query, ...(cursor ? { after: cursor } : {}) })
                .expect(200);
              expect(response.headers['cache-control']).toBe('no-store');
              const page = response.body as ItemsPage;
              expect(page.items.length).toBeLessThanOrEqual(2);
              expect(page.items.every((i) => !i.isDemo && ids.includes(i.id))).toBe(true);
              if (scope === 'current-owned')
                expect(page.items.every((i) => i.ownershipStatus === 'owned')).toBe(true);
              collected.push(...page.items);
              cursor = page.hasMore ? page.nextCursor : null;
            } while (cursor);
            expect(new Set(collected.map((i) => i.id)).size).toBe(bucket.totalItemCount);
            expect(collected.length).toBe(bucket.totalItemCount);
            expect(
              collected.filter((i) => i.pricePaidMinor === null && i.acquisitionType !== 'gift')
                .length,
            ).toBe(bucket.unknownPriceCount);
            expect(
              collected.filter((i) => i.pricePaidMinor === null && i.acquisitionType === 'gift')
                .length,
            ).toBe(bucket.notSpendingCount);
          }
        }
      }
    },
    60000,
  );
  it('rejects incomplete, incompatible and foreign drill-down filters without private prose', async () => {
    for (const q of [
      { spendingDateBucket: 'dated' },
      { spendingScope: 'invalid' },
      { spendingScope: 'current-owned', ownershipStatus: 'sold' },
      { spendingScope: 'all-history', categoryId: foreign },
      { spendingScope: 'all-history', merchantId: foreignMerchant },
      { spendingScope: 'all-history', spendingUnassigned: 'category', categoryId: category },
      { spendingScope: 'all-history', spendingUnassigned: 'merchant', merchantId: merchantActive },
      { spendingScope: 'all-history', spendingYear: '0000' },
    ]) {
      const r = await request(app.getHttpServer())
        .get('/api/v1/items')
        .set('Cookie', `havefolio_session=${token}`)
        .query(q)
        .expect(400);
      expect(r.body.message).toMatch(/^INVALID_/);
    }
    await request(app.getHttpServer())
      .get('/api/v1/items')
      .query({ spendingScope: 'all-history' })
      .expect(401);
    const first = (
      await request(app.getHttpServer())
        .get('/api/v1/items')
        .set('Cookie', `havefolio_session=${token}`)
        .query({ spendingScope: 'all-history', limit: 1 })
        .expect(200)
    ).body as ItemsPage;
    await request(app.getHttpServer())
      .get('/api/v1/items')
      .set('Cookie', `havefolio_session=${token}`)
      .query({ spendingScope: 'current-owned', limit: 1, after: first.nextCursor })
      .expect(400);
  });
  it.each(['all-history', 'current-owned'] as const)(
    'matches the PER-22 oracle exactly for %s, large sums, gifts, refunds and currencies',
    async (scope) => {
      const actual = await report({ scope });
      const expected = summarizeSpending(fixtures, {
        scope: scope === 'all-history' ? 'all_history' : 'current_owned',
      });
      for (const relation of ['dated', 'spanningRange', 'unknownDate'] as const) {
        expect(
          actual.buckets
            .filter((b) => b.dateBucket === relation)
            .map(
              ({
                currency,
                grossMinor,
                refundedMinor,
                netMinor,
                pricedItemCount,
                unknownPriceCount,
                notSpendingCount,
              }) => ({
                currency,
                grossMinor,
                refundedMinor,
                netMinor,
                pricedItemCount,
                unknownPriceCount,
                notSpendingCount,
              }),
            ),
        ).toEqual(expected[relation]);
      }
      expect(actual.scope).toBe(scope);
      expect(
        actual.buckets.every(
          (b) =>
            b.totalItemCount === b.pricedItemCount + b.unknownPriceCount + b.notSpendingCount &&
            b.totalItemCount === b.knownDateCount + b.unknownDateCount,
        ),
      ).toBe(true);
      expect(actual.buckets.some((b) => b.explicitZeroCount > 0)).toBe(true);
      expect(actual.buckets.every((b) => BigInt(b.netMinor) >= 0n)).toBe(true);
    },
  );
  it('uses purchase-date containment, overlap and explicit unknowns at a leap boundary', async () => {
    const actual = await report({ purchasedFrom: '2024-02-29', purchasedTo: '2024-02-29' });
    const expected = summarizeSpending(fixtures, {
      scope: 'all_history',
      range: { from: '2024-02-29', to: '2024-02-29' },
    });
    for (const relation of ['dated', 'spanningRange', 'unknownDate'] as const)
      expect(
        actual.buckets
          .filter((b) => b.dateBucket === relation)
          .map((b) => ({
            currency: b.currency,
            grossMinor: b.grossMinor,
            refundedMinor: b.refundedMinor,
            netMinor: b.netMinor,
            pricedItemCount: b.pricedItemCount,
            unknownPriceCount: b.unknownPriceCount,
            notSpendingCount: b.notSpendingCount,
          })),
      ).toEqual(expected[relation]);
    expect(actual.buckets.map((b) => b.dateBucket)).toContain('spanningRange');
    const outside = await report({ purchasedFrom: '2030-01-01' });
    expect(outside.buckets.every((b) => b.dateBucket === 'unknownDate')).toBe(true);
  });
  const merge = (
    buckets: SpendingBucket[],
  ): [string, { gross: bigint; refunded: bigint; net: bigint; count: number }][] => {
    const result = new Map<
      string,
      { gross: bigint; refunded: bigint; net: bigint; count: number }
    >();
    for (const b of buckets) {
      const k = b.currency + ':' + b.dateBucket,
        t = result.get(k) ?? { gross: 0n, refunded: 0n, net: 0n, count: 0 };
      t.gross += BigInt(b.grossMinor);
      t.refunded += BigInt(b.refundedMinor);
      t.net += BigInt(b.netMinor);
      t.count += b.totalItemCount;
      result.set(k, t);
    }
    return [...result].sort(([a], [b]) => a.localeCompare(b));
  };
  it.each(['category', 'subcategory', 'year', 'merchant'])(
    'reconciles %s drilldown with overall including unassigned and retired taxonomy',
    async (grouping) => {
      expect(merge((await report({ grouping })).buckets)).toEqual(merge((await report()).buckets));
    },
  );
  it('rejects month grouping for year-only dates; exact/month dates reconcile when filtered honestly', async () => {
    await get({ grouping: 'month' })
      .expect(400)
      .expect((r) => expect(r.body.message).toBe('SPENDING_PRECISION_UNREPRESENTABLE'));
    const q = { currency: 'EUR' };
    expect(merge((await report({ ...q, grouping: 'month' })).buckets)).toEqual(
      merge((await report(q)).buckets),
    );
  });
  it('keeps original facts and history stable when ownership changes without refund', async () => {
    const before = await report();
    await run.runtime.query("UPDATE items SET ownership_status='returned' WHERE id=$1", [ids[0]]);
    expect(await report()).toEqual(before);
    const current = await report({ scope: 'current-owned' });
    expect(current.buckets.reduce((n, b) => n + b.totalItemCount, 0)).toBe(3);
    await run.runtime.query("UPDATE items SET ownership_status='owned' WHERE id=$1", [ids[0]]);
    expect(await report()).toEqual(before);
  });
  it('keeps worn-out items in historical and current-owned spending because ownership is unchanged', async () => {
    const history = await report();
    const current = await report({ scope: 'current-owned' });
    expect(current.buckets.reduce((n, b) => n + b.totalItemCount, 0)).toBeGreaterThan(0);
    await run.runtime.query("UPDATE items SET condition='worn_out' WHERE owner_id=$1", [owner]);
    expect(await report()).toEqual(history);
    expect(await report({ scope: 'current-owned' })).toEqual(current);
    await run.runtime.query("UPDATE items SET condition='unknown' WHERE owner_id=$1", [owner]);
  });
  it('reads confirmed refund writes atomically with unchanged gross', async () => {
    const before = await report();
    const write = await run.runtime.query(
      "INSERT INTO item_refunds(owner_id,item_id,currency,amount_minor) VALUES($1,$2,'INR',1234) RETURNING id",
      [owner, ids[3]],
    );
    const after = await report();
    expect(after.buckets.map((b) => b.grossMinor)).toEqual(before.buckets.map((b) => b.grossMinor));
    const net = (r: SpendingReport): bigint =>
      r.buckets.filter((b) => b.currency === 'INR').reduce((n, b) => n + BigInt(b.netMinor), 0n);
    expect(net(before) - net(after)).toBe(1234n);
    expect(await report()).toEqual(after);
    await run.runtime.query('DELETE FROM item_refunds WHERE id=$1', [write.rows[0]!.id]);
  });
  it.each([
    { scope: 'invalid' },
    { scope: undefined },
    { currency: 'ZZZ' },
    { purchasedFrom: '2023-02-29' },
    { purchasedFrom: '2024-01-02', purchasedTo: '2024-01-01' },
    { grouping: 'day' },
    { subcategoryId: child },
    { ownerId: other },
    { categoryId: foreign },
    { categoryId: randomUUID() },
    { categoryId: category, subcategoryId: randomUUID() },
    { merchantId: foreignMerchant },
    { merchantId: randomUUID() },
  ])('rejects invalid or cross-owner query %j', async (q) => {
    await get(q).expect(400);
  });
  it('rejects unauthenticated requests, prevents public caching and accepts own retired filters', async () => {
    await request(app.getHttpServer()).get('/api/v1/spending?scope=all-history').expect(401);
    const response = await get({ categoryId: category, subcategoryId: child }).expect(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(
      (response.body as SpendingReport).buckets.reduce((n, b) => n + b.totalItemCount, 0),
    ).toBe(6);
  });
  it('publishes request, response and error OpenAPI schemas', () => {
    const doc = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle('test').setVersion('1').build(),
    );
    const operation = doc.paths['/api/v1/spending']!.get!;
    expect(operation.responses).toHaveProperty('200');
    expect(operation.responses).toHaveProperty('400');
    expect(operation.responses).toHaveProperty('401');
    expect(operation.responses).toHaveProperty('503');
    expect(doc.components!.schemas!.SpendingBucketDto).toMatchObject({
      properties: {
        grossMinor: { type: 'string' },
        netMinor: { type: 'string' },
        missingMerchantCount: { type: 'number' },
      },
    });
    expect(JSON.stringify(operation.parameters)).toContain('scope');
    const itemParameters = doc.paths['/api/v1/items']!.get!.parameters as { name: string }[];
    expect(itemParameters.map((p) => p.name)).toEqual(
      expect.arrayContaining([
        'spendingScope',
        'spendingDateBucket',
        'spendingUnassigned',
        'spendingYear',
        'merchantId',
      ]),
    );
  });
  it('uses one aggregate plus at most one taxonomy query, independent of inventory size', async () => {
    const queries = jest.spyOn(Client.prototype, 'query');
    try {
      await service.report(owner, { scope: 'all-history' });
      // BEGIN, owner lock, one aggregate, COMMIT; never one query per item.
      expect(queries).toHaveBeenCalledTimes(4);
      queries.mockClear();
      await service.report(owner, { scope: 'all-history', categoryId: category });
      expect(queries).toHaveBeenCalledTimes(5);
      queries.mockClear();
      await service.report(owner, { scope: 'all-history', merchantId: merchantActive });
      expect(queries).toHaveBeenCalledTimes(5);
    } finally {
      queries.mockRestore();
    }
    const sql = spendingSql(owner, { scope: 'all-history' });
    expect(sql.text).not.toContain('SELECT *');
    expect(sql.text).toContain('LIMIT 1001');
  });
  it('keeps financial responses and filters out of logs and monitoring; expected errors create no incident', async () => {
    const envelopes: string[] = [],
      lines: string[] = [];
    const receiver = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => {
        body += String(chunk);
      });
      req.on('end', () => {
        envelopes.push(body);
        res.end('{}');
      });
    });
    await new Promise<void>((resolve) => receiver.listen(0, '127.0.0.1', resolve));
    const address = receiver.address();
    if (!address || typeof address === 'string') throw new Error('Missing test receiver');
    initializeMonitoring('api', {
      NODE_ENV: 'test',
      LOG_RELEASE: 'per20-privacy-test',
      GLITCHTIP_ENABLED: 'true',
      GLITCHTIP_TRACE_SAMPLE_RATE: '0',
      GLITCHTIP_DSN: `http://${randomUUID().replaceAll('-', '')}@127.0.0.1:${address.port}/1`,
    });
    const output = jest
      .spyOn(process.stdout, 'write')
      .mockImplementation((line: string | Uint8Array) => {
        lines.push(line.toString());
        return true;
      });
    try {
      await get({ categoryId: category }).expect(200);
      await get({ categoryId: foreign }).expect(400);
      await get({ grouping: 'month' }).expect(400);
      await flushMonitoring();
      expect(envelopes).toHaveLength(0);
      const failure = jest
        .spyOn(ItemsRepository.prototype, 'transaction')
        .mockRejectedValueOnce(
          new Error('private-financial-canary 9223372036854775807 Synthetic retired'),
        );
      try {
        await get({ categoryId: category }).expect(500);
      } finally {
        failure.mockRestore();
      }
      await flushMonitoring();
      expect(envelopes).toHaveLength(1);
      const telemetry = lines.join('') + envelopes.join('');
      for (const privateValue of [
        '9223372036854775807',
        '9007199254740993',
        'private-financial-canary',
        'Synthetic retired',
        owner,
        category,
        foreign,
      ])
        expect(telemetry).not.toContain(privateValue);
      expect(telemetry).toContain('/api/v1/spending');
      expect(lines.join('')).toContain('requestId');
    } finally {
      output.mockRestore();
      await closeMonitoring();
      await new Promise<void>((resolve) => receiver.close(() => resolve()));
    }
  });
  it('measures realistic owner/period/category/merchant plans using existing indexes', async () => {
    const synthetic = randomUUID();
    await run.runtime.query('INSERT INTO users(id) VALUES($1)', [synthetic]);
    await run.runtime.query(
      `INSERT INTO items(owner_id,name,currency,price_paid_minor,purchase_date_precision,purchase_year,purchase_month,purchase_day,original_entry,original_source)
      SELECT $1,'Synthetic plan item','INR',n,'exact',2024,2,1,'{}','manual' FROM generate_series(1,12000) n`,
      [synthetic],
    );
    await run.runtime.query(
      `INSERT INTO items(owner_id,name,currency,price_paid_minor,purchase_date_precision,purchase_year,purchase_month,purchase_day,category_id,merchant_id,original_entry,original_source)
      SELECT $1,'Synthetic plan item','INR',n,'exact',2020+(n%5),2,1,$2,$3,'{}','manual' FROM generate_series(1,2000) n`,
      [owner, category, merchantActive],
    );
    await run.runtime.query(
      `INSERT INTO item_refunds(owner_id,item_id,currency,amount_minor)
      SELECT owner_id,id,currency,1 FROM items WHERE owner_id=$1 AND name='Synthetic plan item' AND price_paid_minor%5=0`,
      [owner],
    );
    await run.migration.query('ANALYZE items');
    const plans = [];
    for (const q of [
      { scope: 'all-history' as const },
      { scope: 'all-history' as const, purchasedFrom: '2024-02-01', purchasedTo: '2024-02-29' },
      { scope: 'current-owned' as const, categoryId: category },
      { scope: 'all-history' as const, merchantId: merchantActive },
      { scope: 'all-history' as const, grouping: 'merchant' as const },
    ]) {
      const sql = spendingSql(owner, q);
      const result = await run.runtime.query(
        'EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) ' + sql.text,
        sql.values,
      );
      const plan = result.rows[0]!['QUERY PLAN'][0];
      expect(plan['Execution Time']).toBeLessThan(2000);
      const text = JSON.stringify(plan);
      expect(text).toMatch(/Index|Bitmap/);
      plans.push({
        shape: q.merchantId
          ? 'merchant'
          : q.grouping === 'merchant'
            ? 'merchant-grouping'
            : q.categoryId
              ? 'category'
              : q.purchasedFrom
                ? 'period'
                : 'owner',
        executionMs: plan['Execution Time'],
      });
    }
    console.info(
      'PER-57 synthetic plan evidence (14024 items, 2024 target-owner items, 400 synthetic refunds)',
      plans,
    );
  }, 30000);
});
