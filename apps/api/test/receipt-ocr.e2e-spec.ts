import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { ConfigModule, ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { IntegrationRun, integrationConfiguration } from '@havefolio/test-utils';
import { EnrichmentStore } from '@havefolio/db';
import { ocrCandidates } from '@havefolio/domain';
import { Pool } from 'pg';
import { validateApiEnvironment } from '@havefolio/config';
import { TelemetryModule } from '@havefolio/logging';
import request, { type Test as HttpTest } from 'supertest';
import { AuthModule } from '../src/auth/auth.module.js';
import { AuthRateService } from '../src/auth/auth-rate.service.js';
import { newToken, hashToken } from '../src/auth/session-cookie.service.js';
import { configureApplication } from '../src/app.setup.js';
import { EnrichmentModule } from '../src/enrichment/enrichment.module.js';
import { EnrichmentService } from '../src/enrichment/enrichment.service.js';
jest.setTimeout(90000);

const line = (
  text: string,
  confidence = 94,
): { text: string; confidence: number; height: number } => ({
  text,
  confidence,
  height: 30,
});

describe('PER-45 receipt and photo OCR review', () => {
  const run = new IntegrationRun(integrationConfiguration());
  const owner = randomUUID(),
    other = randomUUID(),
    token = newToken();
  let app: NestExpressApplication, pool: Pool, store: EnrichmentStore, service: EnrichmentService;
  const http = (): ReturnType<typeof request> => request(app.getHttpServer());
  const auth = (t: HttpTest): HttpTest => t.set('Cookie', `havefolio_session=${token}`);
  const path = (item: string): string => `/api/v1/items/${item}/enrichment`;
  const createItem = async (body: Record<string, unknown> = {}): Promise<string> =>
    (
      await auth(http().post('/api/v1/items'))
        .send({ name: 'Manual kettle', currency: 'INR', ownershipStatus: 'owned', ...body })
        .expect(201)
    ).body.id as string;
  const attachment = async (
    item: string,
    kind: 'photo' | 'receipt',
    pdf = false,
    ownerId = owner,
  ): Promise<string> => {
    const id = randomUUID();
    await run.runtime.query(
      `INSERT INTO media_attachments(id,owner_id,item_id,kind,variant,state,object_key,resource_type,format,provider_asset_id,provider_version,original_filename,mime_type,byte_size,checksum) VALUES($1,$2,$3,$4,'original','ready',$5,$6,$7,$8,1,$9,$10,100,repeat('a',64))`,
      [
        id,
        ownerId,
        item,
        kind,
        'synthetic/private/' + id,
        pdf ? 'raw' : 'image',
        pdf ? 'pdf' : 'webp',
        randomUUID(),
        pdf ? 'receipt.pdf' : 'sanitized.webp',
        pdf ? 'application/pdf' : 'image/webp',
      ],
    );
    return id;
  };
  /** Simulates the worker: claim the exact owner work and publish interpreter output. */
  const complete = async (
    workId: string,
    kind: 'photo' | 'receipt',
    lines: ReturnType<typeof line>[],
  ): Promise<void> => {
    const claim = await store.claim(workId);
    expect(claim?.input.kind).toBe(kind);
    await store.finish(claim!, 'succeeded', ocrCandidates(kind, lines, 'local-ocr', '2026-10-20'));
  };
  const read = async (item: string): Promise<Record<string, unknown> & { revision: number }> =>
    (await auth(http().get(`/api/v1/items/${item}`)).expect(200)).body as Record<
      string,
      unknown
    > & {
      revision: number;
    };
  const review = (
    item: string,
    workId: string,
    body: Record<string, unknown>,
    status: number,
  ): Promise<request.Response> =>
    auth(http().post(`${path(item)}/${workId}/reviews`))
      .send({ commandId: randomUUID(), ...body })
      .expect(status);

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
          ...validateApiEnvironment({ NODE_ENV: 'test', ENRICHMENT_OCR_ENABLED: 'true' }),
          DATABASE_URL: url.toString(),
        }),
      )
      .overrideProvider(AuthRateService)
      .useValue({ check: jest.fn<() => Promise<void>>().mockResolvedValue(undefined) })
      .compile();
    service = module.get(EnrichmentService);
    app = module.createNestApplication<NestExpressApplication>({ logger: false });
    configureApplication(app);
    await app.listen(0, '127.0.0.1');
    await run.runtime.query(
      "INSERT INTO users(id,email,password_hash) VALUES($1,'owner@example.test','$argon2id$fixture')",
      [owner],
    );
    await run.runtime.query('INSERT INTO users(id) VALUES($1)', [other]);
    await run.runtime.query(
      "INSERT INTO auth_sessions(owner_id,token_hash,idle_expires_at,absolute_expires_at) VALUES($1,$2,now()+interval '1 hour',now()+interval '1 day')",
      [owner, hashToken(token)],
    );
  });
  afterAll(async () => {
    await app?.close();
    await pool?.end();
    await run.close();
  });

  it('advertises product sources and configured local kinds and accepts only owner-authorised image originals', async () => {
    const item = await createItem();
    const list = await auth(http().get(path(item))).expect(200);
    expect(list.body).toMatchObject({
      providerStatus: 'available',
      availableKinds: ['url', 'barcode', 'photo', 'receipt'],
    });
    // Manual capture never queues OCR on its own.
    expect(
      (await run.runtime.query('SELECT id FROM enrichment_work WHERE item_id=$1', [item])).rowCount,
    ).toBe(0);
    const pdf = await attachment(item, 'receipt', true);
    await auth(http().post(path(item)))
      .send({ commandId: randomUUID(), revision: 1, kind: 'receipt', attachmentId: pdf })
      .expect(400)
      .expect((r) => expect(r.body.message).toBe('ENRICHMENT_ATTACHMENT_UNSUPPORTED'));
    const photo = await attachment(item, 'photo');
    // A photo attachment is never accepted as receipt evidence, and vice versa.
    await auth(http().post(path(item)))
      .send({ commandId: randomUUID(), revision: 1, kind: 'receipt', attachmentId: photo })
      .expect(404);
    const foreignItem = randomUUID();
    await run.runtime.query(
      "INSERT INTO items(id,owner_id,name,currency,ownership_status,original_entry,original_source) VALUES($1,$2,'Other owner','INR','owned','{}','manual')",
      [foreignItem, other],
    );
    const foreign = await attachment(foreignItem, 'receipt', false, other);
    await auth(http().post(path(item)))
      .send({ commandId: randomUUID(), revision: 1, kind: 'receipt', attachmentId: foreign })
      .expect(404);
    await auth(http().post(path(foreignItem)))
      .send({ commandId: randomUUID(), revision: 1, kind: 'receipt', attachmentId: foreign })
      .expect(404);
    // The other owner cannot reference this owner's evidence either.
    await expect(
      service.request(other, item, {
        commandId: randomUUID(),
        revision: 1,
        kind: 'photo',
        attachmentId: photo,
      }),
    ).rejects.toThrow('ITEM_NOT_FOUND');
    const work = await auth(http().post(path(item)))
      .send({ commandId: randomUUID(), revision: 1, kind: 'photo', attachmentId: photo })
      .expect(201);
    // Only the opaque owner-authorised reference is persisted for the worker.
    expect(
      (await run.runtime.query('SELECT input FROM enrichment_work WHERE id=$1', [work.body.id]))
        .rows[0].input,
    ).toEqual({ kind: 'photo', attachmentId: photo });
  });

  it('applies receipt money and dates only by explicit review, keeping exact units, precision and history', async () => {
    const item = await createItem({ purchaseDate: { precision: 'unknown' } });
    const receipt = await attachment(item, 'receipt');
    const work = (
      await auth(http().post(path(item)))
        .send({ commandId: randomUUID(), revision: 1, kind: 'receipt', attachmentId: receipt })
        .expect(201)
    ).body.id;
    await complete(work, 'receipt', [
      line('Item Qty Amount'),
      line('Steel Kettle 1 Rs 1,299.00'),
      line('Cotton Towel 2 Rs 1,198.00'),
      line('Bill Date 03/04/2026'),
      line('TOTAL Rs 2,624.85'),
    ]);
    const listed = (await auth(http().get(path(item))).expect(200)).body.items[0];
    expect(listed).toMatchObject({
      state: 'succeeded',
      inputKind: 'receipt',
      attachmentId: receipt,
    });
    expect(listed.candidates.map((c: { id: string }) => c.id)).toEqual([
      'receipt-line-2',
      'receipt-line-3',
    ]);
    // Nothing was applied by the worker.
    expect(await read(item)).toMatchObject({
      name: 'Manual kettle',
      pricePaidMinor: null,
      purchaseDate: { precision: 'unknown' },
      revision: 1,
    });
    const price = await review(
      item,
      work,
      { revision: 1, candidateId: 'receipt-line-2', field: 'pricePaid', decision: 'accept' },
      201,
    );
    expect(price.body).toMatchObject({ previousValue: null, confirmedValue: 'INR 129900' });
    expect(await read(item)).toMatchObject({
      pricePaidMinor: '129900',
      currency: 'INR',
      revision: 2,
    });
    // The ambiguous 03/04 date is only offered as a year; the owner corrects it to a month.
    expect(
      listed.candidates[0].fields.find((f: { field: string }) => f.field === 'purchaseDate').value,
    ).toBe('2026');
    await review(
      item,
      work,
      {
        revision: 2,
        candidateId: 'receipt-line-2',
        field: 'purchaseDate',
        decision: 'correct',
        value: '2026-04-31',
      },
      400,
    );
    const date = await review(
      item,
      work,
      {
        revision: 2,
        candidateId: 'receipt-line-2',
        field: 'purchaseDate',
        decision: 'correct',
        value: '2026-04',
      },
      201,
    );
    expect(date.body).toMatchObject({ previousValue: null, confirmedValue: '2026-04' });
    expect((await read(item)).purchaseDate).toEqual({
      precision: 'month',
      year: 2026,
      month: 4,
      day: null,
    });
    // Correction of an accepted amount is recoverable: both values remain in history.
    for (const value of ['INR 1299.00', 'INR 01', 'XYZ 100', 'INR -5'])
      await review(
        item,
        work,
        {
          revision: 3,
          candidateId: 'receipt-line-2',
          field: 'pricePaid',
          decision: 'correct',
          value,
        },
        400,
      );
    await review(
      item,
      work,
      {
        revision: 3,
        candidateId: 'receipt-line-2',
        field: 'pricePaid',
        decision: 'correct',
        value: 'INR 9007199254740993',
      },
      201,
    );
    expect((await read(item)).pricePaidMinor).toBe('9007199254740993');
    const rejected = await review(
      item,
      work,
      { revision: 4, candidateId: 'receipt-line-3', field: 'name', decision: 'reject' },
      201,
    );
    expect(rejected.body).toMatchObject({
      previousValue: 'Manual kettle',
      confirmedValue: 'Manual kettle',
    });
    const after = await read(item);
    expect(after).toMatchObject({
      name: 'Manual kettle',
      originalEntry: { name: 'Manual kettle' },
      revision: 5,
    });
    const history = (await auth(http().get(`${path(item)}/reviews?limit=10`)).expect(200)).body
      .items as Array<{
      field: string;
      previousValue: string | null;
      confirmedValue: string | null;
      resultingRevision: number;
    }>;
    // History pages are UUID-ordered (stable, not chronological); order by resulting revision.
    expect(
      history
        .filter((h) => h.field === 'pricePaid')
        .sort((a, b) => a.resultingRevision - b.resultingRevision)
        .map((h) => [h.previousValue, h.confirmedValue]),
    ).toEqual([
      [null, 'INR 129900'],
      ['INR 129900', 'INR 9007199254740993'],
    ]);
    const snapshot = (
      await run.runtime.query('SELECT confirmed_snapshot FROM enrichment_work WHERE id=$1', [work])
    ).rows[0].confirmed_snapshot;
    expect(snapshot).toMatchObject({ name: 'Manual kettle', pricePaid: null, purchaseDate: null });
  });

  it('never applies money or dates from non-receipt work, even if such a candidate were stored', async () => {
    const item = await createItem({ pricePaidMinor: '50000' });
    const photo = await attachment(item, 'photo');
    const work = (
      await auth(http().post(path(item)))
        .send({ commandId: randomUUID(), revision: 1, kind: 'photo', attachmentId: photo })
        .expect(201)
    ).body.id;
    const claim = await store.claim(work);
    // Bypasses adapter validation on purpose to prove the review boundary also refuses it.
    await store.finish(claim!, 'succeeded', [
      {
        id: 'shelf',
        fields: [
          {
            field: 'pricePaid',
            value: 'INR 99',
            confidence: 1,
            source: { provider: 'local-ocr', inputKind: 'photo', reference: 'x' },
          },
        ] as never,
      },
    ]);
    await review(
      item,
      work,
      { revision: 1, candidateId: 'shelf', field: 'pricePaid', decision: 'accept' },
      400,
    );
    expect((await read(item)).pricePaidMinor).toBe('50000');
  });

  it('keeps refund invariants: no currency switch or amount below refunds through a receipt', async () => {
    const item = await createItem({ pricePaidMinor: '200000', acquisitionType: 'bought' });
    await auth(http().post(`/api/v1/items/${item}/refunds`))
      .send({ revision: 1, amountMinor: '150000', currency: 'INR' })
      .expect(201);
    let revision = (await read(item)).revision;
    const receipt = await attachment(item, 'receipt');
    const work = (
      await auth(http().post(path(item)))
        .send({ commandId: randomUUID(), revision, kind: 'receipt', attachmentId: receipt })
        .expect(201)
    ).body.id;
    await complete(work, 'receipt', [
      line('Steel Kettle EUR 1,000.00'),
      line('Total EUR 1,000.00'),
    ]);
    await review(
      item,
      work,
      { revision, candidateId: 'receipt-line-1', field: 'pricePaid', decision: 'accept' },
      409,
    ).then((r) => expect(r.body.message).toBe('CURRENCY_MISMATCH'));
    await review(
      item,
      work,
      {
        revision,
        candidateId: 'receipt-line-1',
        field: 'pricePaid',
        decision: 'correct',
        value: 'INR 100000',
      },
      409,
    ).then((r) => expect(r.body.message).toBe('REFUND_EXCEEDS_AMOUNT_PAID'));
    expect(await read(item)).toMatchObject({ pricePaidMinor: '200000', currency: 'INR', revision });
    await review(
      item,
      work,
      {
        revision,
        candidateId: 'receipt-line-1',
        field: 'pricePaid',
        decision: 'correct',
        value: 'INR 180000',
      },
      201,
    );
    revision++;
    expect(await read(item)).toMatchObject({ pricePaidMinor: '180000', revision });
  });

  it('stale revisions and other owners cannot review; item erasure removes evidence', async () => {
    const item = await createItem();
    const receipt = await attachment(item, 'receipt');
    const work = (
      await auth(http().post(path(item)))
        .send({ commandId: randomUUID(), revision: 1, kind: 'receipt', attachmentId: receipt })
        .expect(201)
    ).body.id;
    await complete(work, 'receipt', [line('Lamp Rs 499.00'), line('Total Rs 499.00')]);
    const decision = {
      revision: 1,
      candidateId: 'receipt-line-1',
      field: 'pricePaid',
      decision: 'accept',
    };
    await expect(
      service.decide(other, item, work, { commandId: randomUUID(), ...decision } as never),
    ).rejects.toThrow('ITEM_NOT_FOUND');
    await expect(service.list(other, item, { limit: 10 })).rejects.toThrow('ITEM_NOT_FOUND');
    await auth(http().patch(`/api/v1/items/${item}`))
      .send({ revision: 1, notes: 'edit' })
      .expect(200);
    await review(item, work, decision, 409).then((r) =>
      expect(r.body.message).toBe('STALE_ITEM_REVISION'),
    );
    // Even at the current revision, an ordinary edit invalidated this work's evidence chain.
    await review(item, work, { ...decision, revision: 2 }, 409).then((r) =>
      expect(r.body.message).toBe('STALE_ENRICHMENT_REVISION'),
    );
    await run.runtime.query("UPDATE media_attachments SET state='deleting' WHERE item_id=$1", [
      item,
    ]);
    await run.runtime.query("UPDATE media_attachments SET state='deleted' WHERE item_id=$1", [
      item,
    ]);
    await run.runtime.query('DELETE FROM media_attachments WHERE item_id=$1', [item]);
    await auth(http().delete(`/api/v1/items/${item}`))
      .send({ revision: 2 })
      .expect(204);
    expect(
      (await run.runtime.query('SELECT id FROM enrichment_work WHERE item_id=$1', [item])).rowCount,
    ).toBe(0);
  });
});
