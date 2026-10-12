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
import { PrivateMediaStorage } from '../src/media/storage.js';
import type { ItemRefundsDto } from '../src/items/item-refunds.dto.js';
import type { EventsPageDto, ItemDto, ItemsPageDto } from '../src/items/items.dto.js';
jest.setTimeout(60000);

describe('money, date precision and refund correctness (PER-22)', () => {
  const run = new IntegrationRun(integrationConfiguration());
  const owner = randomUUID(),
    other = randomUUID(),
    token = newToken();
  let app: NestExpressApplication;
  let foreignItem: string;
  const http = (): ReturnType<typeof request> => request(app.getHttpServer());
  const auth = (test: HttpTest): HttpTest => test.set('Cookie', `havefolio_session=${token}`);
  const createItem = async (input: object = {}): Promise<ItemDto> =>
    (
      await auth(http().post('/api/v1/items'))
        .send({
          name: 'Synthetic mixer',
          ownershipStatus: 'owned',
          currency: 'INR',
          pricePaidMinor: '100000',
          acquisitionType: 'bought',
          purchaseDate: { precision: 'exact', year: 2024, month: 3, day: 5 },
          ...input,
        })
        .expect(201)
    ).body as ItemDto;
  const refunds = (item: string): HttpTest => auth(http().get(`/api/v1/items/${item}/refunds`));
  const record = (item: string, body: object): HttpTest =>
    auth(http().post(`/api/v1/items/${item}/refunds`)).send(body);
  const correct = (item: string, refund: string, body: object): HttpTest =>
    auth(http().patch(`/api/v1/items/${item}/refunds/${refund}`)).send(body);
  const remove = (item: string, refund: string, revision: number): HttpTest =>
    auth(http().delete(`/api/v1/items/${item}/refunds/${refund}`)).send({ revision });
  const code = async (test: HttpTest, status: number, expected: string): Promise<void> => {
    const response = await test.expect(status);
    expect(response.body).toEqual({
      statusCode: status,
      message: expected,
      error: expect.any(String),
    });
  };
  const history = async (item: string): Promise<EventsPageDto['events']> =>
    (
      (await auth(http().get(`/api/v1/items/${item}/history?limit=100`)).expect(200))
        .body as EventsPageDto
    ).events;

  beforeAll(async () => {
    await run.start();
    await run.runtime.query(
      "INSERT INTO users(id,email,password_hash) VALUES($1,'refund-owner@example.test','$argon2id$fixture'),($2,NULL,NULL)",
      [owner, other],
    );
    await run.runtime.query(
      "INSERT INTO auth_sessions(owner_id,token_hash,idle_expires_at,absolute_expires_at) VALUES($1,$2,now()+interval '1 hour',now()+interval '1 day')",
      [owner, hashToken(token)],
    );
    foreignItem = (
      await run.runtime.query<{ id: string }>(
        "INSERT INTO items(owner_id,name,currency,price_paid_minor,original_entry,original_source) VALUES($1,'Foreign kettle','INR',50000,'{}','manual') RETURNING id",
        [other],
      )
    ).rows[0]!.id;
    const config = integrationConfiguration(),
      url = new URL(config.runtimeUrl);
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
      .overrideProvider(PrivateMediaStorage)
      .useValue({ delete: jest.fn() })
      .compile();
    app = module.createNestApplication<NestExpressApplication>({ logger: false });
    configureApplication(app);
    await app.listen(0, '127.0.0.1');
  });
  afterAll(async () => {
    await app?.close();
    await run.close();
  });

  it('requires authentication for every refund endpoint', async () => {
    const id = randomUUID();
    await http().get(`/api/v1/items/${id}/refunds`).expect(401);
    await http()
      .post(`/api/v1/items/${id}/refunds`)
      .send({ revision: 1, amountMinor: '1', currency: 'INR' })
      .expect(401);
    await http()
      .patch(`/api/v1/items/${id}/refunds/${id}`)
      .send({ revision: 1, amountMinor: '1' })
      .expect(401);
    await http().delete(`/api/v1/items/${id}/refunds/${id}`).send({ revision: 1 }).expect(401);
  });

  it('records partial, multiple and full refunds without mutating the historical purchase', async () => {
    const item = await createItem();
    const empty = (await refunds(item.id).expect(200)).body as ItemRefundsDto;
    expect(empty).toEqual({
      revision: 1,
      ownershipStatus: 'owned',
      acquisitionType: 'bought',
      totals: {
        currency: 'INR',
        amountPaidMinor: '100000',
        refundedMinor: '0',
        netMinor: '100000',
      },
      refunds: [],
    });
    const partial = (
      await record(item.id, {
        revision: 1,
        amountMinor: '25000',
        currency: 'INR',
        refundDate: { precision: 'exact', year: 2024, month: 2, day: 29 },
        note: '  Lid was missing  ',
      }).expect(201)
    ).body as ItemRefundsDto;
    expect(partial.revision).toBe(2);
    expect(partial.totals).toEqual({
      currency: 'INR',
      amountPaidMinor: '100000',
      refundedMinor: '25000',
      netMinor: '75000',
    });
    expect(partial.refunds[0]).toMatchObject({
      amountMinor: '25000',
      currency: 'INR',
      refundDate: { precision: 'exact', year: 2024, month: 2, day: 29 },
      note: 'Lid was missing',
    });
    const second = (
      await record(item.id, {
        revision: 2,
        amountMinor: '75000',
        currency: 'INR',
        refundDate: { precision: 'month', year: 2024, month: 4 },
      }).expect(201)
    ).body as ItemRefundsDto;
    expect(second.totals.netMinor).toBe('0');
    expect(second.refunds.map((r) => r.refundDate)).toEqual([
      { precision: 'exact', year: 2024, month: 2, day: 29 },
      { precision: 'month', year: 2024, month: 4, day: null },
    ]);
    await code(
      record(item.id, { revision: 3, amountMinor: '1', currency: 'INR' }),
      409,
      'REFUND_EXCEEDS_AMOUNT_PAID',
    );
    const after = (await auth(http().get(`/api/v1/items/${item.id}`)).expect(200)).body as ItemDto;
    expect(after.pricePaidMinor).toBe('100000');
    expect(after.currency).toBe('INR');
    expect(after.ownershipStatus).toBe('owned');
    expect(after.originalEntry).toMatchObject({ pricePaidMinor: '100000', currency: 'INR' });
    const events = await history(item.id);
    expect(events.map((e) => e.eventType)).toEqual([
      'created',
      'refund_recorded',
      'refund_recorded',
    ]);
    expect(events[1]!.metadata).toEqual({
      source: 'user',
      revision: 2,
      refundId: partial.refunds[0]!.id,
      amountMinor: '25000',
      currency: 'INR',
    });
    expect(JSON.stringify(events)).not.toContain('Lid was missing');
  });

  it('rejects malformed money, unsafe values, mismatched currency and invalid dates with stable codes', async () => {
    const item = await createItem();
    const body = { revision: 1, currency: 'INR' };
    for (const amountMinor of ['0', '-1', '1.5', '01', '1e3'])
      await code(record(item.id, { ...body, amountMinor }), 400, 'INVALID_MONEY_AMOUNT');
    await code(record(item.id, { ...body, amountMinor: 5 }), 400, 'INVALID_REQUEST');
    await code(record(item.id, { ...body, amountMinor: '' }), 400, 'INVALID_REQUEST');
    await code(
      record(item.id, { ...body, amountMinor: '123456789012345678901' }),
      400,
      'UNSAFE_MONEY_VALUE',
    );
    await code(
      record(item.id, { ...body, amountMinor: '9223372036854775808' }),
      400,
      'UNSAFE_MONEY_VALUE',
    );
    await code(
      record(item.id, { ...body, amountMinor: '1', currency: 'XXX' }),
      400,
      'INVALID_CURRENCY',
    );
    await code(
      record(item.id, { ...body, amountMinor: '1', currency: 'USD' }),
      409,
      'CURRENCY_MISMATCH',
    );
    for (const refundDate of [
      { precision: 'exact', year: 2024, month: 2 },
      { precision: 'month', year: 2024, month: 2, day: 1 },
      { precision: 'unknown', year: 2024 },
      { precision: 'week', year: 2024 },
    ])
      await code(
        record(item.id, { ...body, amountMinor: '1', refundDate }),
        400,
        'INVALID_DATE_PRECISION',
      );
    for (const refundDate of [
      { precision: 'exact', year: 2023, month: 2, day: 29 },
      { precision: 'exact', year: 1900, month: 2, day: 29 },
      { precision: 'exact', year: 2024, month: 4, day: 31 },
      { precision: 'month', year: 2024, month: 13 },
      { precision: 'year', year: 0 },
    ])
      await code(
        record(item.id, { ...body, amountMinor: '1', refundDate }),
        400,
        'INVALID_CALENDAR_DATE',
      );
    await code(
      record(item.id, { ...body, amountMinor: '1', note: 'x'.repeat(1001) }),
      400,
      'INVALID_REFUND',
    );
    await code(
      record(item.id, { ...body, amountMinor: '1', ownerId: other }),
      400,
      'INVALID_REQUEST',
    );
    // Nothing was written by any rejected request.
    expect(((await refunds(item.id).expect(200)).body as ItemRefundsDto).revision).toBe(1);
  });

  it('preserves amounts beyond the JavaScript safe-integer range exactly', async () => {
    const item = await createItem({ pricePaidMinor: '9223372036854775807' });
    const snapshot = (
      await record(item.id, {
        revision: 1,
        amountMinor: '9007199254740993',
        currency: 'INR',
      }).expect(201)
    ).body as ItemRefundsDto;
    expect(snapshot.totals).toEqual({
      currency: 'INR',
      amountPaidMinor: '9223372036854775807',
      refundedMinor: '9007199254740993',
      netMinor: '9214364837600034814',
    });
  });

  it('corrects and deletes refunds with history, revalidating totals and revisions', async () => {
    const item = await createItem();
    const created = (
      await record(item.id, {
        revision: 1,
        amountMinor: '40000',
        currency: 'INR',
        note: 'First',
      }).expect(201)
    ).body as ItemRefundsDto;
    const id = created.refunds[0]!.id;
    await code(correct(item.id, id, { revision: 1, amountMinor: '1' }), 409, 'STALE_ITEM_REVISION');
    await code(correct(item.id, id, { revision: 2 }), 400, 'INVALID_REFUND');
    await code(
      correct(item.id, id, { revision: 2, amountMinor: '100001' }),
      409,
      'REFUND_EXCEEDS_AMOUNT_PAID',
    );
    await code(correct(item.id, id, { revision: 2, currency: 'EUR' }), 409, 'CURRENCY_MISMATCH');
    const corrected = (
      await correct(item.id, id, {
        revision: 2,
        amountMinor: '30000',
        refundDate: { precision: 'year', year: 2025 },
        note: '',
      }).expect(200)
    ).body as ItemRefundsDto;
    expect(corrected.revision).toBe(3);
    expect(corrected.refunds[0]).toMatchObject({
      id,
      amountMinor: '30000',
      refundDate: { precision: 'year', year: 2025, month: null, day: null },
      note: null,
    });
    expect(corrected.totals.netMinor).toBe('70000');
    await code(remove(item.id, randomUUID(), 3), 404, 'REFUND_NOT_FOUND');
    await code(remove(item.id, 'not-a-uuid', 3), 404, 'REFUND_NOT_FOUND');
    await code(remove(item.id, id, 2), 409, 'STALE_ITEM_REVISION');
    const removed = (await remove(item.id, id, 3).expect(200)).body as ItemRefundsDto;
    expect(removed).toMatchObject({
      revision: 4,
      refunds: [],
      totals: { refundedMinor: '0', netMinor: '100000', amountPaidMinor: '100000' },
    });
    const events = await history(item.id);
    expect(events.map((e) => e.eventType)).toEqual([
      'created',
      'refund_recorded',
      'refund_corrected',
      'refund_deleted',
    ]);
    expect(events[2]!.metadata).toMatchObject({
      refundId: id,
      fields: ['amountMinor', 'refundDate', 'note'],
      amountMinor: '30000',
      previousAmountMinor: '40000',
      revision: 3,
    });
    expect(events[3]!.metadata).toMatchObject({ refundId: id, amountMinor: '30000', revision: 4 });
    expect(JSON.stringify(events)).not.toContain('First');
    expect((await run.runtime.query('SELECT 1 FROM item_refunds WHERE id=$1', [id])).rowCount).toBe(
      0,
    );
  });

  it('serialises concurrent refund writes: one succeeds, the other is stale, totals stay valid', async () => {
    const item = await createItem();
    const results = await Promise.all([
      record(item.id, { revision: 1, amountMinor: '60000', currency: 'INR' }),
      record(item.id, { revision: 1, amountMinor: '60000', currency: 'INR' }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(results.find((r) => r.status === 409)!.body.message).toBe('STALE_ITEM_REVISION');
    const snapshot = (await refunds(item.id).expect(200)).body as ItemRefundsDto;
    expect(snapshot.refunds).toHaveLength(1);
    expect(snapshot.totals.netMinor).toBe('40000');
  });

  it('enforces ownership, currency and totals in the database even if the API is bypassed', async () => {
    const item = await createItem();
    // Another owner's item and refunds are invisible: the same safe not-found response.
    await code(refunds(foreignItem), 404, 'ITEM_NOT_FOUND');
    await code(
      record(foreignItem, { revision: 1, amountMinor: '1', currency: 'INR' }),
      404,
      'ITEM_NOT_FOUND',
    );
    const foreignRefund = (
      await run.runtime.query<{ id: string }>(
        "INSERT INTO item_refunds(owner_id,item_id,currency,amount_minor) VALUES($1,$2,'INR',100) RETURNING id",
        [other, foreignItem],
      )
    ).rows[0]!.id;
    await code(
      correct(item.id, foreignRefund, { revision: 1, amountMinor: '1' }),
      404,
      'REFUND_NOT_FOUND',
    );
    await code(remove(item.id, foreignRefund, 1), 404, 'REFUND_NOT_FOUND');
    await code(remove(foreignItem, foreignRefund, 1), 404, 'ITEM_NOT_FOUND');
    const sqlError = async (sql: string, params: unknown[]): Promise<Record<string, unknown>> => {
      try {
        await run.runtime.query(sql, params);
      } catch (error) {
        return error as Record<string, unknown>;
      }
      throw new Error('expected a database rejection');
    };
    // Cross-owner attachment and cross-currency refunds violate the composite foreign key.
    expect(
      await sqlError(
        "INSERT INTO item_refunds(owner_id,item_id,currency,amount_minor) VALUES($1,$2,'INR',1)",
        [other, item.id],
      ),
    ).toMatchObject({ code: '23503', constraint: 'refund_item_owner_currency_fk' });
    expect(
      await sqlError(
        "INSERT INTO item_refunds(owner_id,item_id,currency,amount_minor) VALUES($1,$2,'USD',1)",
        [owner, item.id],
      ),
    ).toMatchObject({ code: '23503', constraint: 'refund_item_owner_currency_fk' });
    expect(
      await sqlError(
        "INSERT INTO item_refunds(owner_id,item_id,currency,amount_minor) VALUES($1,$2,'INR',0)",
        [owner, item.id],
      ),
    ).toMatchObject({ code: '23514', constraint: 'refund_amount_check' });
    expect(
      await sqlError(
        "INSERT INTO item_refunds(owner_id,item_id,currency,amount_minor) VALUES($1,$2,'INR',100001)",
        [owner, item.id],
      ),
    ).toMatchObject({ code: '23514', constraint: 'refund_total_check' });
    expect(
      await sqlError(
        "INSERT INTO item_refunds(owner_id,item_id,currency,amount_minor,refund_date_precision,refund_year,refund_month,refund_day) VALUES($1,$2,'INR',1,'exact',2023,2,29)",
        [owner, item.id],
      ),
    ).toMatchObject({ code: '23514', constraint: 'refund_date_precision_check' });
    const mine = (
      await run.runtime.query<{ id: string }>(
        "INSERT INTO item_refunds(owner_id,item_id,currency,amount_minor) VALUES($1,$2,'INR',100) RETURNING id",
        [owner, item.id],
      )
    ).rows[0]!.id;
    expect(
      await sqlError('UPDATE item_refunds SET item_id=$2 WHERE id=$1', [mine, foreignItem]),
    ).toMatchObject({ code: '23514' });
    expect(await sqlError("UPDATE items SET currency='USD' WHERE id=$1", [item.id])).toMatchObject({
      code: '23001',
      constraint: 'refund_item_owner_currency_fk',
    });
    expect(
      await sqlError('UPDATE items SET price_paid_minor=99 WHERE id=$1', [item.id]),
    ).toMatchObject({ code: '23514', constraint: 'refund_total_check' });
    expect(
      await sqlError('UPDATE items SET price_paid_minor=NULL WHERE id=$1', [item.id]),
    ).toMatchObject({ code: '23514', constraint: 'refund_total_check' });
  });

  it('keeps purchase corrections consistent with recorded refunds', async () => {
    const item = await createItem();
    await record(item.id, { revision: 1, amountMinor: '50000', currency: 'INR' }).expect(201);
    const patch = (body: object): HttpTest =>
      auth(http().patch(`/api/v1/items/${item.id}`)).send({ revision: 2, ...body });
    await code(patch({ currency: 'USD' }), 409, 'CURRENCY_MISMATCH');
    await code(patch({ pricePaidMinor: '49999' }), 409, 'REFUND_EXCEEDS_AMOUNT_PAID');
    await code(patch({ pricePaidMinor: null }), 409, 'REFUND_REQUIRES_AMOUNT_PAID');
    await code(
      patch({ pricePaidMinor: null, acquisitionType: 'gift' }),
      409,
      'INVALID_ACQUISITION_COMBINATION',
    );
    // An explicit owner correction of the original record remains possible when consistent.
    const corrected = (
      await patch({ pricePaidMinor: '50000', acquisitionType: 'gift' }).expect(200)
    ).body as ItemDto;
    expect(corrected.pricePaidMinor).toBe('50000');
    expect(((await refunds(item.id).expect(200)).body as ItemRefundsDto).totals).toMatchObject({
      amountPaidMinor: '50000',
      refundedMinor: '50000',
      netMinor: '0',
    });
  });

  it('applies gift, secondhand, explicit-zero and unknown-amount rules', async () => {
    const giftNothingPaid = await createItem({ acquisitionType: 'gift', pricePaidMinor: null });
    expect(((await refunds(giftNothingPaid.id).expect(200)).body as ItemRefundsDto).totals).toEqual(
      {
        currency: 'INR',
        amountPaidMinor: null,
        refundedMinor: '0',
        netMinor: null,
      },
    );
    await code(
      record(giftNothingPaid.id, { revision: 1, amountMinor: '1', currency: 'INR' }),
      409,
      'INVALID_ACQUISITION_COMBINATION',
    );
    const giftWithAmount = await createItem({ acquisitionType: 'gift', pricePaidMinor: '20000' });
    await record(giftWithAmount.id, { revision: 1, amountMinor: '5000', currency: 'INR' }).expect(
      201,
    );
    const secondhand = await createItem({ acquisitionType: 'secondhand', pricePaidMinor: '15000' });
    expect(secondhand.condition).toBe('unknown');
    await record(secondhand.id, { revision: 1, amountMinor: '15000', currency: 'INR' }).expect(201);
    const zero = await createItem({ pricePaidMinor: '0' });
    expect(((await refunds(zero.id).expect(200)).body as ItemRefundsDto).totals.netMinor).toBe('0');
    await code(
      record(zero.id, { revision: 1, amountMinor: '1', currency: 'INR' }),
      409,
      'REFUND_EXCEEDS_AMOUNT_PAID',
    );
    const unknown = await createItem({ pricePaidMinor: null });
    await code(
      record(unknown.id, { revision: 1, amountMinor: '1', currency: 'INR' }),
      409,
      'REFUND_REQUIRES_AMOUNT_PAID',
    );
    const yen = await createItem({ currency: 'JPY', pricePaidMinor: '1500' });
    expect(
      (
        (await record(yen.id, { revision: 1, amountMinor: '500', currency: 'JPY' }).expect(201))
          .body as ItemRefundsDto
      ).totals,
    ).toEqual({ currency: 'JPY', amountPaidMinor: '1500', refundedMinor: '500', netMinor: '1000' });
  });

  it('keeps returns and refunds independent', async () => {
    const returned = await createItem();
    await auth(http().post(`/api/v1/items/${returned.id}/actions`))
      .send({ revision: 1, action: 'ownership_changed', ownershipStatus: 'returned' })
      .expect(200);
    // Returning never infers a refund.
    expect((await refunds(returned.id).expect(200)).body as ItemRefundsDto).toMatchObject({
      ownershipStatus: 'returned',
      refunds: [],
      totals: { refundedMinor: '0', netMinor: '100000' },
    });
    await record(returned.id, { revision: 2, amountMinor: '100000', currency: 'INR' }).expect(201);
    const kept = await createItem();
    await record(kept.id, { revision: 1, amountMinor: '10000', currency: 'INR' }).expect(201);
    const after = (await auth(http().get(`/api/v1/items/${kept.id}`)).expect(200)).body as ItemDto;
    // Refunding never changes ownership.
    expect(after.ownershipStatus).toBe('owned');
    expect((await history(kept.id)).some((e) => e.eventType === 'ownership_changed')).toBe(false);
  });

  it('erases refunds and their notes with the item', async () => {
    const item = await createItem();
    await record(item.id, {
      revision: 1,
      amountMinor: '100',
      currency: 'INR',
      note: 'Private',
    }).expect(201);
    await auth(http().delete(`/api/v1/items/${item.id}`))
      .send({ revision: 2 })
      .expect(204);
    expect(
      (await run.runtime.query('SELECT 1 FROM item_refunds WHERE item_id=$1', [item.id])).rowCount,
    ).toBe(0);
    await code(refunds(item.id), 404, 'ITEM_NOT_FOUND');
  });

  it('filters by purchase date with overlap semantics, never by record-created time', async () => {
    const tag = (
      await run.runtime.query<{ id: string }>(
        "INSERT INTO tags(owner_id,name) VALUES($1,'Date filter probe') RETURNING id",
        [owner],
      )
    ).rows[0]!.id;
    const make = async (name: string, purchaseDate?: object): Promise<string> =>
      (
        await createItem({
          name,
          tagIds: [tag],
          purchaseDate: purchaseDate ?? { precision: 'unknown' },
        })
      ).id;
    const exact = await make('Exact 2020', { precision: 'exact', year: 2020, month: 6, day: 30 });
    const month = await make('Month Feb 2020', { precision: 'month', year: 2020, month: 2 });
    const year = await make('Year 2019', { precision: 'year', year: 2019 });
    const unknown = await make('Unknown date');
    const list = async (query: string): Promise<string[]> =>
      (
        (await auth(http().get(`/api/v1/items?tagId=${tag}&limit=100&${query}`)).expect(200))
          .body as ItemsPageDto
      ).items
        .map((i) => i.id)
        .sort();
    // Every probe was created today; a created-date filter would return all or nothing.
    expect(await list('purchasedFrom=2020-06-30&purchasedTo=2020-06-30&dateKnown=exclude')).toEqual(
      [exact],
    );
    expect(await list('purchasedFrom=2020-02-29&purchasedTo=2020-02-29&dateKnown=exclude')).toEqual(
      [month],
    );
    expect(await list('purchasedFrom=2019-12-31&purchasedTo=2020-01-01&dateKnown=exclude')).toEqual(
      [year],
    );
    expect(await list('purchasedFrom=2026-01-01&dateKnown=exclude')).toEqual([]);
    expect(await list('purchasedFrom=2026-01-01')).toEqual([unknown]);
    expect(await list('dateKnown=only')).toEqual([unknown]);
    await code(
      auth(http().get('/api/v1/items?purchasedFrom=2023-02-29')),
      400,
      'INVALID_ITEM_QUERY',
    );
    await auth(http().get('/api/v1/items?purchasedFrom=2024-02-29')).expect(200);
  });

  it('keeps item create/edit compatible and distinguishes explicit zero from unknown', async () => {
    const zero = await createItem({ pricePaidMinor: '0' });
    const unknown = await createItem({ pricePaidMinor: null, purchaseDate: undefined });
    expect(zero.pricePaidMinor).toBe('0');
    expect(unknown.pricePaidMinor).toBeNull();
    expect(unknown.purchaseDate).toEqual({
      precision: 'unknown',
      year: null,
      month: null,
      day: null,
    });
    await code(
      auth(http().post('/api/v1/items')).send({
        name: 'Bad date',
        ownershipStatus: 'owned',
        currency: 'INR',
        purchaseDate: { precision: 'exact', year: 2023, month: 2, day: 29 },
      }),
      400,
      'INVALID_ITEM_DATE',
    );
    await code(
      auth(http().post('/api/v1/items')).send({
        name: 'Bad money',
        ownershipStatus: 'owned',
        currency: 'INR',
        pricePaidMinor: '9223372036854775808',
      }),
      400,
      'INVALID_ITEM',
    );
    const leap = await createItem({
      purchaseDate: { precision: 'exact', year: 2024, month: 2, day: 29 },
    });
    expect(leap.purchaseDate).toEqual({ precision: 'exact', year: 2024, month: 2, day: 29 });
  });

  it('never writes money values or refund notes to telemetry', async () => {
    const lines: string[] = [];
    const output = jest
      .spyOn(process.stdout, 'write')
      .mockImplementation((line: string | Uint8Array) => {
        lines.push(line.toString());
        return true;
      });
    try {
      const item = await createItem({ pricePaidMinor: '7654321' });
      await record(item.id, {
        revision: 1,
        amountMinor: '1234567',
        currency: 'INR',
        note: 'TelemetryProbeNote',
      }).expect(201);
      await record(item.id, { revision: 2, amountMinor: '7654322', currency: 'INR' }).expect(409);
      await record(item.id, {
        revision: 2,
        amountMinor: '98765432109876543210',
        currency: 'INR',
      }).expect(400);
    } finally {
      output.mockRestore();
    }
    const text = lines.join('');
    expect(text).toContain('REFUND_EXCEEDS_AMOUNT_PAID');
    for (const secret of [
      '7654321',
      '1234567',
      '7654322',
      '98765432109876543210',
      'TelemetryProbeNote',
    ])
      expect(text).not.toContain(secret);
  });

  it('publishes refund contracts and every error response', () => {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .addCookieAuth('havefolio_session', { type: 'apiKey', in: 'cookie' }, 'ownerSession')
        .build(),
    );
    for (const [path, method] of [
      ['/api/v1/items/{id}/refunds', 'get'],
      ['/api/v1/items/{id}/refunds', 'post'],
      ['/api/v1/items/{id}/refunds/{refundId}', 'patch'],
      ['/api/v1/items/{id}/refunds/{refundId}', 'delete'],
    ] as const) {
      const operation = document.paths[path]![method]!;
      for (const status of ['400', '401', '404', '409', '413', '503'])
        expect(operation.responses[status]).toBeDefined();
      expect(operation.security).toEqual([{ ownerSession: [] }]);
    }
    const schemas = document.components!.schemas!;
    for (const name of [
      'RecordRefundDto',
      'CorrectRefundDto',
      'RefundDateDto',
      'RefundDto',
      'RefundTotalsDto',
      'ItemRefundsDto',
    ])
      expect(schemas[name]).toBeDefined();
    const conflicts = JSON.stringify(
      document.paths['/api/v1/items/{id}/refunds']!.post!.responses['409'],
    );
    for (const errorCode of [
      'CURRENCY_MISMATCH',
      'REFUND_EXCEEDS_AMOUNT_PAID',
      'INVALID_ACQUISITION_COMBINATION',
      'STALE_ITEM_REVISION',
    ])
      expect(conflicts).toContain(errorCode);
    for (const field of ['ownerId', 'owner_id', 'itemId'])
      expect(
        (schemas.RefundDto as { properties: Record<string, unknown> }).properties,
      ).not.toHaveProperty(field);
    expect(JSON.stringify(schemas.ItemEventDto)).toContain('refund_deleted');
  });
});
