import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, describe, expect, it, jest } from '@jest/globals';
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
import {
  InventoryQueryService,
  inventorySql,
  normalizeQuery,
} from '../src/items/inventory-query.service.js';
import type { ItemsQueryDto } from '../src/items/inventory-query.dto.js';
import type { ItemListEntryDto, ItemsPageDto } from '../src/items/items.dto.js';

describe('complete owner inventory querying', () => {
  const run = new IntegrationRun(integrationConfiguration()),
    owner = randomUUID(),
    other = randomUUID(),
    token = newToken();
  const category = randomUUID(),
    child = randomUUID(),
    tag = randomUUID(),
    foreignTag = randomUUID();
  let app: NestExpressApplication;
  let service: InventoryQueryService;
  const get = (q: object = {}): request.Test =>
    request(app.getHttpServer())
      .get('/api/v1/items')
      .set('Cookie', `havefolio_session=${token}`)
      .query(q);
  const list = async (q: object = {}): Promise<ItemsPageDto> =>
    (await get(q).expect(200)).body as ItemsPageDto;
  const names = async (q: object = {}): Promise<string[]> =>
    (await list(q)).items.map((i) => i.name);
  beforeAll(async () => {
    await run.start();
    await run.runtime.query(
      "INSERT INTO users(id,email,password_hash) VALUES($1,'query-owner@example.test','$argon2id$fixture'),($2,NULL,NULL)",
      [owner, other],
    );
    await run.runtime.query(
      "INSERT INTO auth_sessions(owner_id,token_hash,idle_expires_at,absolute_expires_at) VALUES($1,$2,now()+interval '1 hour',now()+interval '1 day')",
      [owner, hashToken(token)],
    );
    await run.runtime.query("INSERT INTO categories(id,owner_id,name) VALUES($1,$2,'Kitchen')", [
      category,
      owner,
    ]);
    await run.runtime.query(
      "INSERT INTO subcategories(id,owner_id,category_id,name) VALUES($1,$2,$3,'Appliances')",
      [child, owner, category],
    );
    await run.runtime.query(
      "INSERT INTO tags(id,owner_id,name) VALUES($1,$2,'Daily Steel'),($3,$4,'Daily Steel')",
      [tag, owner, foreignTag, other],
    );
    const dates = [
      ['exact', 2024, 2, 29],
      ['month', 2024, 2, null],
      ['year', 2024, null, null],
      ['unknown', null, null, null],
    ];
    for (let n = 0; n < 12; n++) {
      const d = dates[n % 4]!;
      const r = await run.runtime.query<{ id: string }>(
        "INSERT INTO items(owner_id,name,brand,model,currency,price_paid_minor,purchase_date_precision,purchase_year,purchase_month,purchase_day,ownership_status,use_frequency,category_id,subcategory_id,original_entry,original_source,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'{}','manual', $15,$16) RETURNING id",
        [
          owner,
          'Item ' + String(n).padStart(2, '0'),
          n === 0 ? 'Acme' : null,
          n === 1 ? 'Turbo' : null,
          n === 11 ? 'USD' : 'INR',
          n % 4 === 3 ? null : String((n % 4) * 100),
          ...d,
          n % 2 ? 'sold' : 'owned',
          n % 2 ? 'rarely' : 'often',
          n < 6 ? category : null,
          n < 3 ? child : null,
          '2024-01-01T00:00:00.123Z',
          '2024-01-02T00:00:00.123Z',
        ],
      );
      if (n === 2)
        await run.runtime.query('INSERT INTO item_tags(owner_id,item_id,tag_id) VALUES($1,$2,$3)', [
          owner,
          r.rows[0]!.id,
          tag,
        ]);
    }
    await run.runtime.query(
      "INSERT INTO items(owner_id,name,brand,model,currency,original_entry,original_source) VALUES($1,'Item foreign','Acme','Turbo','INR','{}','manual')",
      [other],
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
        }),
      )
      .compile();
    service = module.get(InventoryQueryService);
    app = module.createNestApplication<NestExpressApplication>({ logger: false });
    configureApplication(app);
    await app.listen(0, '127.0.0.1');
  }, 60000);
  afterAll(async () => {
    await app?.close();
    await run.close();
  });
  it.each([
    ['item 00', ['Item 00']],
    ['ACME', ['Item 00']],
    [' turbo ', ['Item 01']],
    ['daily steel', ['Item 02']],
    ['ＡＣＭＥ', ['Item 00']],
    ["%_' OR 1=1 --", []],
  ])(
    'searches name/brand/model/tags with normalized AND words, owner isolation and safe SQL: %s',
    async (q, expected) => {
      expect(await names({ q })).toEqual(expected);
    },
  );
  it('filters category/subcategory, status, frequency and selected tags over complete results', async () => {
    expect((await names({ categoryId: category })).length).toBe(6);
    expect((await names({ categoryId: category, subcategoryId: child })).length).toBe(3);
    expect((await names({ ownershipStatus: 'owned', useFrequency: 'often' })).length).toBe(6);
    expect(await names({ tagId: tag })).toEqual(['Item 02']);
    await get({ tagId: foreignTag }).expect(400);
    await get({ categoryId: randomUUID() }).expect(400);
    await get({ subcategoryId: child }).expect(400);
  });
  it('preserves zero versus unknown and scopes price comparisons to currency', async () => {
    const zero = await list({
      currency: 'INR',
      priceMin: '0',
      priceMax: '0',
      priceKnown: 'exclude',
    });
    expect(zero.items).toHaveLength(3);
    expect(zero.items.every((i) => i.pricePaidMinor === '0')).toBe(true);
    expect((await names({ priceKnown: 'only' })).length).toBe(3);
    expect((await names({ currency: 'INR', priceMin: '0', priceMax: '0' })).length).toBe(5);
    expect((await names({ priceKnown: 'exclude' })).length).toBe(9);
    await get({ sort: 'price' }).expect(400);
    await get({ priceMin: '0' }).expect(400);
  });
  it('matches possible approximate-date intervals without inventing exact dates', async () => {
    expect(
      (
        await names({
          purchasedFrom: '2024-02-15',
          purchasedTo: '2024-02-15',
          dateKnown: 'exclude',
        })
      ).length,
    ).toBe(6);
    expect((await names({ purchasedFrom: '2024-02-15', purchasedTo: '2024-02-15' })).length).toBe(
      9,
    );
    const years = await list({ datePrecision: 'year' });
    expect(years.items).toHaveLength(3);
    expect(
      years.items.every((i) => i.purchaseDate.month === null && i.purchaseDate.day === null),
    ).toBe(true);
    expect((await names({ dateKnown: 'only' })).length).toBe(3);
    expect(
      await names({
        purchasedFrom: '2024-03-01',
        purchasedTo: '2024-03-31',
        datePrecision: 'month',
        dateKnown: 'exclude',
      }),
    ).toEqual([]);
  });
  it.each([
    { sort: 'id' },
    { sort: 'name', direction: 'asc' },
    { sort: 'name', direction: 'desc' },
    { sort: 'newest' },
    { sort: 'oldest' },
    { sort: 'updated' },
    { sort: 'price', currency: 'INR', direction: 'asc' },
    { sort: 'price', currency: 'INR', direction: 'desc' },
  ] as ItemsQueryDto[])('traverses each sort without duplicates or omissions: %j', async (q) => {
    const all: ItemListEntryDto[] = [];
    let after: string | undefined;
    do {
      const page = await list({ ...q, limit: 2, ...(after ? { after } : {}) });
      all.push(...page.items);
      after = page.nextCursor ?? undefined;
    } while (after);
    expect(new Set(all.map((i) => i.id)).size).toBe(all.length);
    const normalized = normalizeQuery({ ...q, limit: 100 }),
      sql = inventorySql(owner, normalized);
    const expected = await run.runtime.query<{ id: string }>(sql.text, sql.values);
    expect(all.map((i) => i.id)).toEqual(expected.rows.map((r) => r.id));
    if (q.sort === 'price') {
      const firstUnknown = all.findIndex((i) => i.pricePaidMinor === null);
      expect(all.slice(firstUnknown).every((i) => i.pricePaidMinor === null)).toBe(true);
    }
  });
  it('rejects tampered, mismatched, foreign and malformed cursors, permits a deleted anchor', async () => {
    const first = await list({ sort: 'name', limit: 2 }),
      after = first.nextCursor!;
    expect(after).toMatch(/^v1\./);
    expect(after).not.toContain('Item');
    await get({ after, sort: 'price', currency: 'INR', limit: 2 }).expect(400);
    await get({ after, sort: 'name', limit: 3 }).expect(400);
    await get({ after, sort: 'name', limit: 2, q: 'item' }).expect(400);
    await get({ after: after.slice(0, -4) + 'AAAA', sort: 'name', limit: 2 }).expect(400);
    await get({ after: 'invalid' }).expect(400);
    await expect(service.list(other, { after, sort: 'name', limit: 2 })).rejects.toThrow(
      'INVALID_ITEM_CURSOR',
    );
    const time = jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 8 * 24 * 60 * 60 * 1000);
    try {
      await get({ after, sort: 'name', limit: 2 }).expect(400);
    } finally {
      time.mockRestore();
    }
    await run.runtime.query('DELETE FROM items WHERE owner_id=$1 AND id=$2', [
      owner,
      first.items[1]!.id,
    ]);
    const next = await list({ after, sort: 'name', limit: 2 });
    expect(next.items.map((i) => i.name)).toEqual(['Item 02', 'Item 03']);
  });
  it.each([
    { limit: 101 },
    { limit: 0 },
    { priceMin: '2', priceMax: '1', currency: 'INR' },
    { purchasedFrom: '2023-02-29' },
    { purchasedFrom: '2024-12-01', purchasedTo: '2024-01-01' },
    { dateKnown: 'exclude', datePrecision: 'unknown' },
    { priceKnown: 'only', priceMin: '0', currency: 'INR' },
    { direction: 'asc', sort: 'newest' },
  ])('returns controlled validation errors %j', async (q) => {
    const response = await get(q).expect(400);
    expect(JSON.stringify(response.body)).not.toContain('SELECT');
  });
  it('batches ready cover metadata matching gallery position and excludes documents and storage fields', async () => {
    const item = (await list({ q: 'item 00' })).items[0]!;
    const cover = randomUUID();
    await run.runtime.query(
      "INSERT INTO media_attachments(id,owner_id,item_id,kind,variant,state,object_key,resource_type,format,original_filename,mime_type,byte_size,checksum,provider_asset_id,provider_version,width,height,position,alt_text) VALUES($1,$2,$3,'photo','original','ready',$4,'image','webp','synthetic.webp','image/webp',4,$5,'synthetic',1,40,30,0,'')",
      [cover, owner, item.id, 'havefolio/test/' + cover, 'a'.repeat(64)],
    );
    const result = await list({ q: 'item 00' });
    expect(result.items[0]!.cover).toEqual({
      photoId: cover,
      width: 40,
      height: 30,
      altText: null,
      decorative: true,
    });
    expect(JSON.stringify(result)).not.toMatch(
      /object_key|provider_asset|synthetic.webp|havefolio\/test/,
    );
    await run.runtime.query("UPDATE media_attachments SET state='deleting' WHERE id=$1", [cover]);
    expect((await list({ q: 'item 00' })).items[0]!.cover).toBeNull();
  });
  it('returns only card fields and OpenAPI describes every query and cursor', async () => {
    const page = await list();
    expect(page.items[0]).not.toHaveProperty('originalEntry');
    expect(page.items[0]).not.toHaveProperty('notes');
    expect(page.items[0]).toHaveProperty('cover', null);
    const doc = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .addCookieAuth('havefolio_session', { type: 'apiKey' }, 'ownerSession')
        .build(),
    );
    const operation = doc.paths['/api/v1/items']!.get!;
    const parameters = operation.parameters as { name: string }[];
    expect(parameters.map((p) => p.name)).toEqual(
      expect.arrayContaining([
        'q',
        'categoryId',
        'subcategoryId',
        'tagId',
        'sort',
        'direction',
        'currency',
        'priceMin',
        'priceMax',
        'priceKnown',
        'dateKnown',
        'datePrecision',
        'purchasedFrom',
        'purchasedTo',
        'useFrequency',
        'ownershipStatus',
        'limit',
        'after',
      ]),
    );
    expect(doc.components!.schemas!.ItemListEntryDto).toBeDefined();
    expect(operation.responses['400']).toBeDefined();
  });
  it('has index-backed common plans on 30,000 synthetic items across 30 owners', async () => {
    await run.runtime.query(
      'INSERT INTO users(id) SELECT gen_random_uuid() FROM generate_series(1,30)',
    );
    await run.runtime.query(
      "INSERT INTO items(owner_id,name,brand,currency,price_paid_minor,ownership_status,original_entry,original_source) SELECT u.id,'Synthetic '||s,CASE WHEN s=500 THEN 'rareword' ELSE 'brand' END,'INR',s*100,CASE WHEN s%2=0 THEN 'owned' ELSE 'sold' END,'{}','manual' FROM users u CROSS JOIN generate_series(1,1000) s WHERE u.id<>$1 AND u.id<>$2",
      [owner, other],
    );
    await run.runtime.query(
      "INSERT INTO tags(owner_id,name) SELECT id,'Synthetic tag '||s FROM users CROSS JOIN generate_series(1,100) s WHERE id<>$1 AND id<>$2",
      [owner, other],
    );
    await run.migration.query('ANALYZE items');
    await run.migration.query('ANALYZE tags');
    await run.migration.query('ANALYZE item_tags');
    const planOwner = (
      await run.runtime.query<{ owner_id: string }>(
        'SELECT owner_id FROM items WHERE owner_id<>$1 AND owner_id<>$2 LIMIT 1',
        [owner, other],
      )
    ).rows[0]!.owner_id;
    const indexes = (
      await run.runtime.query<{ indexname: string }>(
        'SELECT indexname FROM pg_indexes WHERE schemaname=$1',
        [run.schema],
      )
    ).rows.map((r) => r.indexname);
    expect(indexes).toEqual(
      expect.arrayContaining([
        'item_owner_name_idx',
        'item_owner_updated_idx',
        'item_owner_currency_price_idx',
        'item_search_document_idx',
        'tag_search_document_idx',
      ]),
    );
    for (const q of [
      { sort: 'name' },
      { sort: 'newest' },
      { sort: 'updated' },
      { sort: 'price', currency: 'INR' },
      { sort: 'newest', ownershipStatus: 'owned' },
      { q: 'rareword' },
    ] as ItemsQueryDto[]) {
      const sql = inventorySql(planOwner, normalizeQuery(q));
      const result = await run.runtime.query(
        'EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) ' + sql.text,
        sql.values,
      );
      const plan = JSON.stringify(result.rows);
      expect(plan).toMatch(/Index (Only )?Scan|Bitmap Index Scan/);
      console.log(
        'Synthetic inventory plan',
        JSON.stringify({
          query: q,
          indexes: [...new Set([...plan.matchAll(/"Index Name":"([^"]+)"/g)].map((m) => m[1]))],
        }),
      );
      const visit = (node: Record<string, unknown>): void => {
        if (node['Relation Name'] === 'items') expect(node['Node Type']).not.toBe('Seq Scan');
        for (const child of (node.Plans ?? []) as Record<string, unknown>[]) visit(child);
      };
      visit(result.rows[0]['QUERY PLAN'][0].Plan);
    }
  }, 60000);
});
