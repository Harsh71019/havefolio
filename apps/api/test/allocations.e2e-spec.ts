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
import { DesiresModule } from '../src/desires/desires.module.js';
import type { DesireAllocationState, ConfirmDesireAllocationRequest } from '@havefolio/contracts';
import { GoalsModule } from '../src/goals/goals.module.js';
import type { GoalDto, ContributionDto, ContributionsPageDto } from '../src/goals/goals.dto.js';

jest.setTimeout(90000);
describe('PER-31 estimates and explicit allocations', () => {
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
        DesiresModule,
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
  const desire = async (extra: object = {}): Promise<{ id: string; revision: number }> =>
    (
      await auth(http().post('/api/v1/desires'))
        .send({
          name: 'Synthetic declined purchase',
          likelyPriceMinor: '800000',
          currency: 'INR',
          ...extra,
        })
        .expect(201)
    ).body as { id: string; revision: number };
  const review = async (id: string, extra: object = {}): Promise<{ id: string }> => {
    const d = (await auth(http().get(`/api/v1/desires/${id}`)).expect(200)).body as {
      revision: number;
    };
    return (
      await auth(http().post(`/api/v1/desires/${id}/reviews`))
        .send({ commandId: randomUUID(), revision: d.revision, outcome: 'declined', ...extra })
        .expect(201)
    ).body as { id: string };
  };
  const setup = async (
    goalExtra: object = {},
    desireExtra: object = {},
  ): Promise<{
    g: GoalDto;
    d: { id: string };
    event: { id: string };
    body: ConfirmDesireAllocationRequest;
  }> => {
    const g = await create(goalExtra),
      d = await desire(desireExtra),
      event = await review(d.id);
    return {
      g,
      d,
      event,
      body: {
        commandId: randomUUID(),
        reviewEventId: event.id,
        goalId: g.id,
        goalRevision: g.revision,
        confirmed: true,
      },
    };
  };
  const allocate = (id: string, b: object): HttpTest =>
    auth(http().post(`/api/v1/desires/${id}/allocation`)).send(b);
  const state = async (id: string): Promise<DesireAllocationState> =>
    (await auth(http().get(`/api/v1/desires/${id}/allocation`)).expect(200))
      .body as DesireAllocationState;
  it('keeps estimates separate until explicit true confirmation; retries never increase progress', async () => {
    const { g, d, body } = await setup();
    expect(await state(d.id)).toMatchObject({
      estimatedNotSpentMinor: '800000',
      currency: 'INR',
      allocation: null,
    });
    expect((await get(g.id)).progressMinor).toBe('0');
    for (const confirmed of [false, undefined, 'true'])
      await allocate(d.id, { ...body, confirmed }).expect(400);
    await allocate(d.id, { ...body, amountMinor: '900000' }).expect(400);
    const first = (await allocate(d.id, body).expect(201)).body as DesireAllocationState;
    expect(first.allocation).toMatchObject({
      sourceChanged: false,
      goal: { progressMinor: '800000', revision: 2 },
      currentContribution: { amountMinor: '800000', kind: 'contribution' },
    });
    await allocate(d.id, body).expect(201);
    await allocate(d.id, {
      ...body,
      commandId: body.commandId.toUpperCase(),
      reviewEventId: body.reviewEventId.toUpperCase(),
      goalId: body.goalId.toUpperCase(),
    }).expect(201);
    expect((await get(g.id)).progressMinor).toBe('800000');
    await allocate(d.id, { ...body, goalRevision: 2 })
      .expect(409)
      .expect((r) => expect(r.body.message).toBe('ALLOCATION_COMMAND_REUSED'));
    await allocate(d.id, { ...body, commandId: randomUUID(), goalRevision: 2 })
      .expect(409)
      .expect((r) => expect(r.body.message).toBe('ALLOCATION_ALREADY_EXISTS'));
    const page = (await auth(http().get(`/api/v1/goals/${g.id}/contributions`)).expect(200))
      .body as ContributionsPageDto;
    expect(page.items).toHaveLength(1);
  });
  it('serializes same-command retries and distinct concurrent commands across goals', async () => {
    const { g, d, body } = await setup();
    const replies = await Promise.all([allocate(d.id, body), allocate(d.id, body)]);
    expect(replies.map((r) => r.status)).toEqual([201, 201]);
    expect((await get(g.id)).progressMinor).toBe('800000');
    const x = await setup(),
      g2 = await create();
    const competing = await Promise.all([
      allocate(x.d.id, x.body),
      allocate(x.d.id, { ...x.body, commandId: randomUUID(), goalId: g2.id }),
    ]);
    expect(competing.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(
      BigInt((await get(x.g.id)).progressMinor) + BigInt((await get(g2.id)).progressMinor),
    ).toBe(800000n);
  });
  it('rejects stale review/goal revisions, currency mismatch, unknown and zero estimates; zero targets are safe', async () => {
    const x = await setup({ currency: 'USD' });
    await allocate(x.d.id, x.body)
      .expect(409)
      .expect((r) => expect(r.body.message).toBe('GOAL_CURRENCY_MISMATCH'));
    for (const desireExtra of [
      { likelyPriceMinor: null, currency: null },
      { likelyPriceMinor: '0' },
    ]) {
      const y = await setup({}, desireExtra);
      await allocate(y.d.id, y.body)
        .expect(409)
        .expect((r) => expect(r.body.message).toBe('ALLOCATION_ESTIMATE_REQUIRED'));
      expect((await get(y.g.id)).progressMinor).toBe('0');
    }
    const z = await setup({ targetMinor: '0' });
    await allocate(z.d.id, z.body).expect(201);
    expect((await get(z.g.id)).progressMinor).toBe('800000');
    const y = await setup();
    await patch(y.g.id, { targetMinor: '5000000' });
    await allocate(y.d.id, y.body)
      .expect(409)
      .expect((r) => expect(r.body.message).toBe('STALE_GOAL_REVISION'));
    await review(y.d.id, { outcome: 'bought', supersedesEventId: y.event.id });
    await allocate(y.d.id, { ...y.body, goalRevision: 2 })
      .expect(409)
      .expect((r) => expect(r.body.message).toBe('STALE_DECLINED_OUTCOME'));
  });
  it('does not inflate repeated declined reviews and leaves confirmed progress unchanged after source corrections', async () => {
    const x = await setup();
    await allocate(x.d.id, x.body).expect(201);
    const corrected = await review(x.d.id, { supersedesEventId: x.event.id });
    let s = await state(x.d.id);
    expect(s).toMatchObject({
      estimatedNotSpentMinor: '800000',
      allocation: {
        sourceChanged: true,
        sourceReviewEventId: x.event.id,
        goal: { progressMinor: '800000' },
      },
    });
    await allocate(x.d.id, {
      ...x.body,
      commandId: randomUUID(),
      reviewEventId: corrected.id,
      goalRevision: 2,
    }).expect(409);
    await review(x.d.id, { outcome: 'bought', supersedesEventId: corrected.id });
    s = await state(x.d.id);
    expect(s.estimatedNotSpentMinor).toBeNull();
    expect(s.allocation?.goal?.progressMinor).toBe('800000');
    await allocate(x.d.id, x.body).expect(201);
  });
  it('reuses append-only corrections and reversals with exact progress and paginated allocation-only history', async () => {
    const x = await setup();
    const s = (await allocate(x.d.id, x.body).expect(201)).body as DesireAllocationState;
    const root = s.allocation!.currentContribution!;
    await contribute(x.g.id, { kind: 'correction', amountMinor: '500001', supersedesId: root.id });
    const corrected = (await state(x.d.id)).allocation!.currentContribution!;
    expect(corrected.amountMinor).toBe('500001');
    await contribute(x.g.id, { amountMinor: '3' }); // Independent contribution must not appear in this allocation's history.
    await contribute(x.g.id, { kind: 'reversal', amountMinor: '0', supersedesId: corrected.id });
    expect((await get(x.g.id)).progressMinor).toBe('3');
    const reversed = (await state(x.d.id)).allocation!.currentContribution!;
    await contribute(x.g.id, {
      kind: 'correction',
      amountMinor: '9223372036854775807',
      supersedesId: reversed.id,
    });
    expect((await get(x.g.id)).progressMinor).toBe('9223372036854775810');
    const history = (
      await auth(http().get(`/api/v1/desires/${x.d.id}/allocation/history?limit=2`)).expect(200)
    ).body as ContributionsPageDto;
    expect(history.items.map((e) => e.kind)).toEqual(['correction', 'reversal']);
    const earlier = (
      await auth(
        http().get(
          `/api/v1/desires/${x.d.id}/allocation/history?limit=2&before=${history.nextBefore}`,
        ),
      ).expect(200)
    ).body as ContributionsPageDto;
    expect(earlier.items.map((e) => e.amountMinor)).toEqual(['500001', '800000']);
    await post(
      x.g.id,
      await command(x.g.id, { kind: 'reversal', amountMinor: '0', supersedesId: root.id }),
    ).expect(409);
  });
  it('preserves archived behavior and removes private goal details on deletion without allowing repeat allocation', async () => {
    const x = await setup();
    await patch(x.g.id, { status: 'archived' });
    await allocate(x.d.id, { ...x.body, goalRevision: 2 })
      .expect(409)
      .expect((r) => expect(r.body.message).toBe('GOAL_ARCHIVED'));
    await patch(x.g.id, { status: 'active' });
    const b = { ...x.body, goalRevision: 3 };
    await allocate(x.d.id, b).expect(201);
    const root = (await state(x.d.id)).allocation!.currentContribution!;
    await patch(x.g.id, { status: 'archived' });
    await post(
      x.g.id,
      await command(x.g.id, { kind: 'reversal', amountMinor: '0', supersedesId: root.id }),
    ).expect(409);
    await allocate(x.d.id, b).expect(201); // Identical replay succeeds after archival.
    await auth(http().delete(`/api/v1/goals/${x.g.id}`))
      .send({ revision: (await get(x.g.id)).revision })
      .expect(204);
    expect((await state(x.d.id)).allocation).toMatchObject({
      goal: null,
      currentContribution: null,
      rootContributionId: null,
    });
    expect(JSON.stringify(await state(x.d.id))).not.toContain('Synthetic trip');
    const g2 = await create();
    await allocate(x.d.id, {
      ...b,
      goalId: g2.id,
      goalRevision: 1,
      commandId: randomUUID(),
    }).expect(409);
    await allocate(x.d.id, b).expect(201);
  });
  it('purges source history/link on explicit desire deletion, retaining independently confirmed ledger amounts', async () => {
    const x = await setup();
    await allocate(x.d.id, x.body).expect(201);
    const d = (await auth(http().get(`/api/v1/desires/${x.d.id}`)).expect(200)).body as {
      revision: number;
    };
    await auth(http().delete(`/api/v1/desires/${x.d.id}`))
      .send({ revision: d.revision })
      .expect(204);
    await auth(http().get(`/api/v1/desires/${x.d.id}/allocation`)).expect(404);
    expect((await get(x.g.id)).progressMinor).toBe('800000');
    for (const table of ['desire_goal_allocations', 'desire_review_events'])
      expect(
        (await run.migration.query(`SELECT * FROM ${table} WHERE desire_id=$1`, [x.d.id])).rows,
      ).toHaveLength(0);
  });
  it('enforces ownership, RLS, source/ledger guards, immutable links and no-store contracts', async () => {
    const x = await setup();
    await http().get(`/api/v1/desires/${x.d.id}/allocation`).expect(401);
    await http().post(`/api/v1/desires/${x.d.id}/allocation`).send(x.body).expect(401);
    const foreign = randomUUID();
    await run.migration.query(
      "INSERT INTO desires(id,owner_id,name) VALUES($1,$2,'Other source')",
      [foreign, other],
    );
    for (const id of [foreign, randomUUID()]) {
      await allocate(id, x.body).expect(404);
      await auth(http().get(`/api/v1/desires/${id}/allocation/history`)).expect(404);
    }
    const foreignGoal = randomUUID();
    await run.migration.query(
      "INSERT INTO goals(id,owner_id,name,target_minor,currency) VALUES($1,$2,'Other goal',1,'INR')",
      [foreignGoal, other],
    );
    for (const goalId of [foreignGoal, randomUUID()])
      await allocate(x.d.id, { ...x.body, goalId }).expect(404);
    await allocate(x.d.id, x.body).expect(201);
    expect(
      (await auth(http().get(`/api/v1/desires/${x.d.id}/allocation`)).expect(200)).headers[
        'cache-control'
      ],
    ).toBe('no-store');
    expect((await run.runtime.query('SELECT * FROM desire_goal_allocations')).rows).toHaveLength(0);
    await run.migration.query('BEGIN');
    try {
      await run.migration.query("SELECT set_config('havefolio.owner_id',$1,true)", [owner]);
      for (const sql of [
        'UPDATE desire_goal_allocations SET goal_id=goal_id WHERE desire_id=$1',
        'DELETE FROM desire_goal_allocations WHERE desire_id=$1',
      ]) {
        await run.migration.query('SAVEPOINT guard');
        await expect(run.migration.query(sql, [x.d.id])).rejects.toMatchObject({ code: '23514' });
        await run.migration.query('ROLLBACK TO SAVEPOINT guard');
      }
    } finally {
      await run.migration.query('ROLLBACK');
    }
    const y = await setup();
    await expect(
      run.migration.query(
        `INSERT INTO desire_goal_allocations(desire_id,owner_id,review_event_id,goal_id,contribution_id,command_id,request_hash) VALUES($1,$2,$3,$4,$5,$6,$7)`,
        [y.d.id, owner, y.event.id, y.g.id, randomUUID(), randomUUID(), 'a'.repeat(64)],
      ),
    ).rejects.toMatchObject({ code: '23503' });
  });
  it('rejects command reuse from a manual contribution and serializes concurrent reversals', async () => {
    const x = await setup();
    await post(x.g.id, await command(x.g.id, { commandId: x.body.commandId })).expect(201);
    await allocate(x.d.id, { ...x.body, goalRevision: 2 })
      .expect(409)
      .expect((r) => expect(r.body.message).toBe('ALLOCATION_COMMAND_REUSED'));
    expect((await state(x.d.id)).allocation).toBeNull();
    const y = await setup();
    await allocate(y.d.id, y.body).expect(201);
    const leaf = (await state(y.d.id)).allocation!.currentContribution!;
    const b = await command(y.g.id, { kind: 'reversal', amountMinor: '0', supersedesId: leaf.id });
    const replies = await Promise.all([post(y.g.id, b), post(y.g.id, b)]);
    expect(replies.map((r) => r.status)).toEqual([201, 201]);
    expect((await get(y.g.id)).progressMinor).toBe('0');
    const history = (
      await auth(http().get(`/api/v1/desires/${y.d.id}/allocation/history`)).expect(200)
    ).body as ContributionsPageDto;
    expect(history.items.map((e) => e.kind)).toEqual(['reversal', 'contribution']);
  });
  it('publishes confirmation and bounded history OpenAPI and emits no private financial fields', () => {
    const doc = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().addCookieAuth('havefolio_session').build(),
    );
    for (const [path, method] of [
      ['/api/v1/desires/{id}/allocation', 'get'],
      ['/api/v1/desires/{id}/allocation', 'post'],
      ['/api/v1/desires/{id}/allocation/history', 'get'],
    ])
      expect(doc.paths[path!]?.[method! as 'get' | 'post']).toBeDefined();
    expect(doc.components?.schemas?.ConfirmAllocationDto).toBeDefined();
    const allocationEvents = emitted.filter(
      (e) => (e as { operation?: string }).operation === 'allocate',
    );
    expect(allocationEvents.length).toBeGreaterThan(0);
    for (const event of allocationEvents)
      expect(event).toEqual({
        event: 'goal_command_completed',
        component: 'goals',
        operation: 'allocate',
        category: 'success',
      });
    expect(JSON.stringify(allocationEvents)).not.toMatch(
      /800000|Synthetic|sourceReviewEventId|commandId|ownerId/,
    );
  });
});
