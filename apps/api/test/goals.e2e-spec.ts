import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { EventLogger, TelemetryModule } from '@havefolio/logging';
import { IntegrationRun, integrationConfiguration } from '@havefolio/test-utils';
import { validateApiEnvironment } from '@havefolio/config';
import request, { type Test as HttpTest } from 'supertest';
import { AuthModule } from '../src/auth/auth.module.js';
import { newToken, hashToken } from '../src/auth/session-cookie.service.js';
import { configureApplication } from '../src/app.setup.js';
import { GoalsModule } from '../src/goals/goals.module.js';
import type {
  GoalDto,
  ContributionDto,
  GoalsPageDto,
  ContributionsPageDto,
} from '../src/goals/goals.dto.js';

jest.setTimeout(90000);
describe('PER-30 owner-private goals and confirmed contribution ledger', () => {
  const run = new IntegrationRun(integrationConfiguration());
  const owner = randomUUID(),
    other = randomUUID(),
    token = newToken();
  let app: NestExpressApplication;
  const emitted: unknown[] = [];
  const http = (): ReturnType<typeof request> => request(app.getHttpServer());
  const auth = (t: HttpTest): HttpTest => t.set('Cookie', `havefolio_session=${token}`);
  const create = async (extra: object = {}): Promise<GoalDto> =>
    (
      await auth(http().post('/api/v1/goals'))
        .send({ name: 'Synthetic trip', targetMinor: '4000000', currency: 'INR', ...extra })
        .expect(201)
    ).body as GoalDto;
  const get = async (id: string): Promise<GoalDto> =>
    (await auth(http().get(`/api/v1/goals/${id}`)).expect(200)).body as GoalDto;
  const patch = async (id: string, extra: object): Promise<GoalDto> =>
    (
      await auth(http().patch(`/api/v1/goals/${id}`))
        .send({ revision: (await get(id)).revision, ...extra })
        .expect(200)
    ).body as GoalDto;
  const command = async (id: string, extra: object = {}): Promise<Record<string, unknown>> => ({
    revision: (await get(id)).revision,
    commandId: randomUUID(),
    kind: 'contribution',
    amountMinor: '800000',
    currency: 'INR',
    ...extra,
  });
  const post = (id: string, b: object): HttpTest =>
    auth(http().post(`/api/v1/goals/${id}/contributions`)).send(b);
  const contribute = async (id: string, extra: object = {}): Promise<ContributionDto> =>
    (await post(id, await command(id, extra)).expect(201)).body as ContributionDto;
  beforeAll(async () => {
    await run.start();
    await run.runtime.query(
      "INSERT INTO users(id,email,password_hash) VALUES($1,'goals@example.test','$argon2id$fixture'),($2,NULL,NULL)",
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
        GoalsModule,
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
    jest.spyOn(module.get(EventLogger), 'emit').mockImplementation((_level, event) => {
      emitted.push(event);
    });
    app = module.createNestApplication<NestExpressApplication>({ logger: false });
    configureApplication(app);
    await app.listen(0, '127.0.0.1');
  });
  afterAll(async () => {
    await app?.close();
    await run.close();
  });
  it('creates, reads, edits, archives, restores, completes and deletes with revision protection', async () => {
    const g = await create({ notes: 'Private synthetic notes', targetDate: '2028-02-29' });
    expect(g).toMatchObject({
      progressMinor: '0',
      revision: 1,
      status: 'active',
      targetDate: '2028-02-29',
    });
    expect(g).not.toHaveProperty('ownerId');
    await auth(http().patch(`/api/v1/goals/${g.id}`))
      .send({ revision: 2, name: 'Stale' })
      .expect(409);
    const edited = await patch(g.id, {
      name: 'Synthetic course',
      notes: null,
      targetDate: null,
      targetMinor: '0',
      status: 'completed',
    });
    expect(edited).toMatchObject({
      name: 'Synthetic course',
      notes: null,
      targetDate: null,
      targetMinor: '0',
      status: 'completed',
    });
    await patch(g.id, { status: 'archived' });
    expect((await get(g.id)).status).toBe('archived');
    await post(g.id, await command(g.id))
      .expect(409)
      .expect((r) => expect(r.body.message).toBe('GOAL_ARCHIVED'));
    await patch(g.id, { status: 'active' });
    await auth(http().delete(`/api/v1/goals/${g.id}`))
      .send({ revision: 1 })
      .expect(409);
    await auth(http().delete(`/api/v1/goals/${g.id}`))
      .send({ revision: (await get(g.id)).revision })
      .expect(204);
    await auth(http().get(`/api/v1/goals/${g.id}`)).expect(404);
  });
  it('counts only explicit effective contributions, preserves target history, corrects and reverses durably', async () => {
    const g = await create();
    const a = await contribute(g.id);
    await contribute(g.id, { amountMinor: '200000' });
    expect((await get(g.id)).progressMinor).toBe('1000000');
    await patch(g.id, { targetMinor: '2000000' });
    expect((await get(g.id)).progressMinor).toBe('1000000');
    const correction = await contribute(g.id, {
      kind: 'correction',
      supersedesId: a.id,
      amountMinor: '500000',
      note: 'Synthetic correction',
    });
    expect((await get(g.id)).progressMinor).toBe('700000');
    await post(
      g.id,
      await command(g.id, { kind: 'correction', supersedesId: a.id, amountMinor: '1' }),
    ).expect(409);
    await contribute(g.id, { kind: 'reversal', supersedesId: correction.id, amountMinor: '0' });
    expect((await get(g.id)).progressMinor).toBe('200000');
    const history = (await auth(http().get(`/api/v1/goals/${g.id}/contributions`)).expect(200))
      .body as ContributionsPageDto;
    expect(history.items).toHaveLength(4);
    expect(history.items.map((e) => e.sequence)).toEqual([6, 5, 3, 2]);
    await patch(g.id, { status: 'archived' });
    expect((await get(g.id)).progressMinor).toBe('200000');
    await auth(http().get(`/api/v1/goals/${g.id}/contributions`)).expect(200);
    await auth(http().delete(`/api/v1/goals/${g.id}`))
      .send({ revision: (await get(g.id)).revision })
      .expect(204);
    expect(
      (await run.migration.query('SELECT id FROM goal_contributions WHERE goal_id=$1', [g.id]))
        .rows,
    ).toEqual([]);
  });
  it('is retry safe, rejects conflicting command reuse and serializes concurrent writes', async () => {
    const g = await create(),
      b = await command(g.id);
    const first = (await post(g.id, b).expect(201)).body as ContributionDto;
    expect((await post(g.id, b).expect(201)).body).toEqual(first);
    expect((await get(g.id)).revision).toBe(2);
    await post(g.id, { ...b, amountMinor: '1' }).expect(409);
    const next = await command(g.id);
    const responses = await Promise.all([
      post(g.id, next),
      post(g.id, { ...next, commandId: randomUUID() }),
    ]);
    expect(responses.map((r) => r.status).sort()).toEqual([201, 409]);
    expect((await get(g.id)).progressMinor).toBe('1600000');
  });
  it('retains exact bigint amounts and sums beyond bigint without floating point or target capping', async () => {
    const g = await create({ targetMinor: '0' });
    await contribute(g.id, { amountMinor: '9223372036854775807' });
    await contribute(g.id, { amountMinor: '9223372036854775807' });
    expect((await get(g.id)).progressMinor).toBe('18446744073709551614');
    expect((await get(g.id)).status).toBe('active');
  });
  it('rejects mixed currencies and locks currency even after reversal', async () => {
    const g = await create();
    await patch(g.id, { currency: 'USD' });
    await post(g.id, await command(g.id))
      .expect(409)
      .expect((r) => expect(r.body.message).toBe('GOAL_CURRENCY_MISMATCH'));
    const e = await contribute(g.id, { currency: 'USD' });
    await contribute(g.id, {
      currency: 'USD',
      kind: 'reversal',
      amountMinor: '0',
      supersedesId: e.id,
    });
    await auth(http().patch(`/api/v1/goals/${g.id}`))
      .send({ revision: (await get(g.id)).revision, currency: 'INR' })
      .expect(409);
  });
  it.each(['-1', '1.2', '1e3', '01', '9223372036854775808', 1, null])(
    'rejects invalid target minor units %s',
    async (v) => {
      await auth(http().post('/api/v1/goals'))
        .send({ name: 'Synthetic', targetMinor: v, currency: 'INR' })
        .expect(400);
    },
  );
  it.each(['2027-02-29', '2028-04-31', '2028-01-01T00:00:00Z', '0000-01-01', 'infinity'])(
    'rejects invalid dates %s',
    async (targetDate) => {
      await auth(http().post('/api/v1/goals'))
        .send({ name: 'Synthetic', targetMinor: '1', currency: 'INR', targetDate })
        .expect(400);
    },
  );
  it('rejects invalid bodies, null required patches, amounts and correction shapes', async () => {
    const g = await create();
    for (const b of [
      { name: ' ' },
      { currency: 'ZZZ' },
      { targetMinor: null },
      { name: null },
      { currency: null },
      { status: null },
      { unexpected: true },
    ])
      await auth(http().patch(`/api/v1/goals/${g.id}`))
        .send({ revision: 1, ...b })
        .expect(400);
    for (const b of [
      { amountMinor: '0' },
      { amountMinor: '-1' },
      { amountMinor: 1 },
      { amountMinor: '9223372036854775808' },
      { kind: 'correction' },
      { kind: 'reversal', amountMinor: '0' },
      { kind: 'contribution', supersedesId: randomUUID() },
      { note: ' ' },
    ])
      await post(g.id, await command(g.id, b)).expect(400);
  });
  it('rejects foreign/missing goals and contribution IDs without disclosure', async () => {
    const foreign = randomUUID();
    await run.migration.query(
      "INSERT INTO goals(id,owner_id,name,target_minor,currency) VALUES($1,$2,'Foreign',1,'INR')",
      [foreign, other],
    );
    const missing = randomUUID();
    for (const id of [foreign, missing]) {
      await auth(http().get(`/api/v1/goals/${id}`))
        .expect(404)
        .expect((r) => expect(r.body.message).toBe('GOAL_NOT_FOUND'));
      await auth(http().patch(`/api/v1/goals/${id}`))
        .send({ revision: 1, name: 'Private' })
        .expect(404);
      await auth(http().delete(`/api/v1/goals/${id}`))
        .send({ revision: 1 })
        .expect(404);
      await auth(http().get(`/api/v1/goals/${id}/contributions`)).expect(404);
      await post(id, {
        revision: 1,
        commandId: randomUUID(),
        kind: 'contribution',
        amountMinor: '1',
        currency: 'INR',
      }).expect(404);
    }
    const g = await create(),
      another = await create(),
      e = await contribute(another.id);
    for (const supersedesId of [e.id, randomUUID()])
      await post(g.id, await command(g.id, { kind: 'correction', supersedesId }))
        .expect(404)
        .expect((r) => expect(r.body.message).toBe('CONTRIBUTION_NOT_FOUND'));
    const page = (await auth(http().get('/api/v1/goals?limit=100')).expect(200))
      .body as GoalsPageDto;
    expect(page.items.some((x) => x.id === foreign)).toBe(false);
    await http().get('/api/v1/goals').expect(401);
  });
  it('paginates goals stably without repeats and filters archived goals', async () => {
    await create();
    await create();
    const ids: string[] = [];
    let after: string | null = null;
    do {
      const page = (
        await auth(
          http()
            .get('/api/v1/goals')
            .query({ limit: 2, ...(after ? { after } : {}) }),
        ).expect(200)
      ).body as GoalsPageDto;
      ids.push(...page.items.map((g) => g.id));
      after = page.nextAfter;
    } while (after);
    expect(ids).toEqual([...ids].sort());
    expect(new Set(ids).size).toBe(ids.length);
    const g = await create();
    await patch(g.id, { status: 'archived' });
    const p = (await auth(http().get('/api/v1/goals?status=archived')).expect(200))
      .body as GoalsPageDto;
    expect(p.items.some((x) => x.id === g.id)).toBe(true);
    expect(p.items.every((x) => x.status === 'archived')).toBe(true);
    for (const q of ['limit=0', 'limit=101', 'after=bad', 'status=bad'])
      await auth(http().get(`/api/v1/goals?${q}`)).expect(400);
  });
  it('paginates ledger with stable sequence cursor and validates pagination', async () => {
    const g = await create();
    for (let i = 0; i < 3; i++) await contribute(g.id);
    const p = (await auth(http().get(`/api/v1/goals/${g.id}/contributions?limit=2`)).expect(200))
      .body as ContributionsPageDto;
    expect(p.items.map((e) => e.sequence)).toEqual([4, 3]);
    expect(p.nextBefore).toBe(3);
    await contribute(g.id);
    const next = (
      await auth(
        http().get(`/api/v1/goals/${g.id}/contributions?before=${p.nextBefore}&limit=2`),
      ).expect(200)
    ).body as ContributionsPageDto;
    expect(next.items.map((e) => e.sequence)).toEqual([2]);
    expect(next.nextBefore).toBe(null);
    for (const q of ['limit=101', 'before=1', 'before=2147483648'])
      await auth(http().get(`/api/v1/goals/${g.id}/contributions?${q}`)).expect(400);
  });
  it('enforces immutable ledger, owner RLS, database constraints and expected indexes', async () => {
    const g = await create(),
      e = await contribute(g.id);
    await run.runtime.query("SELECT set_config('havefolio.owner_id',$1,false)", [owner]);
    await expect(
      run.runtime.query('UPDATE goal_contributions SET amount_minor=1 WHERE id=$1', [e.id]),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      run.runtime.query('DELETE FROM goal_contributions WHERE id=$1', [e.id]),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      run.runtime.query('UPDATE goals SET currency=$1 WHERE id=$2', ['USD', g.id]),
    ).rejects.toMatchObject({ code: '23503' });
    for (const sql of [
      'UPDATE goals SET target_minor=-1',
      "UPDATE goals SET status='bad'",
      "UPDATE goals SET currency='ZZZ'",
      "UPDATE goals SET name=''",
      "UPDATE goals SET target_date='infinity'",
    ])
      await expect(run.runtime.query(`${sql} WHERE id=$1`, [g.id])).rejects.toMatchObject({
        code: '23514',
      });
    await expect(
      run.runtime.query(
        "INSERT INTO goal_contributions(goal_id,owner_id,currency,amount_minor,command_id,request_hash,kind,sequence) VALUES($1,$2,'INR',-1,$3,$4,'contribution',$5)",
        [g.id, owner, randomUUID(), 'a'.repeat(64), (await get(g.id)).revision + 1],
      ),
    ).rejects.toMatchObject({ code: '23514' });
    await run.runtime.query("SELECT set_config('havefolio.owner_id',$1,false)", [other]);
    expect((await run.runtime.query('SELECT * FROM goals WHERE id=$1', [g.id])).rows).toEqual([]);
    expect(
      (await run.runtime.query('SELECT * FROM goal_contributions WHERE id=$1', [e.id])).rows,
    ).toEqual([]);
    await run.runtime.query("SELECT set_config('havefolio.owner_id','',false)");
    expect((await run.runtime.query('SELECT * FROM goals')).rows).toEqual([]);
    const indexes = (
      await run.migration.query<{ indexname: string }>(
        'SELECT indexname FROM pg_indexes WHERE schemaname=$1',
        [run.schema],
      )
    ).rows.map((x) => x.indexname);
    expect(indexes).toEqual(
      expect.arrayContaining([
        'goal_owner_order_idx',
        'contribution_owner_order_idx',
        'contribution_command_unique',
        'contribution_successor_unique',
      ]),
    );
  });
  it('publishes versioned OpenAPI contracts and never emits goal contents, amounts or identifiers', async () => {
    const doc = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .addCookieAuth('havefolio_session', { type: 'apiKey' }, 'ownerSession')
        .build(),
    );
    expect(Object.keys(doc.paths)).toEqual(
      expect.arrayContaining([
        '/api/v1/goals',
        '/api/v1/goals/{id}',
        '/api/v1/goals/{id}/contributions',
      ]),
    );
    for (const [schemaName, property] of [
      ['GoalDto', 'targetMinor'],
      ['ContributionDto', 'amountMinor'],
    ]) {
      const schema = doc.components?.schemas?.[schemaName!];
      if (!schema || !('properties' in schema)) throw new Error('Missing inline goal schema');
      expect(schema.properties?.[property!]).toMatchObject({ type: 'string' });
    }
    const name = 'SYNTHETIC_PRIVATE_GOAL',
      note = 'SYNTHETIC_PRIVATE_NOTE';
    const g = await create({ name, notes: note });
    await contribute(g.id, { note, amountMinor: '12345678901234567' });
    expect(emitted).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ event: 'goal_command_completed', component: 'goals' }),
      ]),
    );
    const logs = JSON.stringify(emitted);
    for (const privateValue of [name, note, g.id, owner, token, '12345678901234567'])
      expect(logs).not.toContain(privateValue);
    await auth(http().get(`/api/v1/goals/${g.id}`)).expect('Cache-Control', 'no-store');
  });
});
