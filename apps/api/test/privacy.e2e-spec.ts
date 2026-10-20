import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { ConfigModule, ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { IntegrationRun, integrationConfiguration } from '@havefolio/test-utils';
import { validateApiEnvironment } from '@havefolio/config';
import { TelemetryModule } from '@havefolio/logging';
import request, { type Test as HttpTest } from 'supertest';
import { AuthModule } from '../src/auth/auth.module.js';
import { PrivacyModule } from '../src/privacy/privacy.module.js';
import { PrivacyService } from '../src/privacy/privacy.service.js';
import { PrivacyRepository } from '../src/privacy/privacy.repository.js';
import { PasswordService } from '../src/auth/password.service.js';
import { AuthRateService } from '../src/auth/auth-rate.service.js';
import { PrivateMediaStorage } from '../src/media/storage.js';
import { newToken, hashToken } from '../src/auth/session-cookie.service.js';
import { configureApplication } from '../src/app.setup.js';

jest.setTimeout(90000);
describe('PER-35 private export and account erasure', () => {
  const run = new IntegrationRun(integrationConfiguration());
  let app: NestExpressApplication;
  let service: PrivacyService;
  let repo: PrivacyRepository;
  let owner = randomUUID();
  const other = randomUUID(),
    token = newToken(),
    password = randomBytes(24).toString('hex');
  const item = randomUUID(),
    desire = randomUUID(),
    goal = randomUUID(),
    contribution = randomUUID();
  const photo = randomUUID(),
    display = randomUUID(),
    thumbnail = randomUUID();
  const ready = randomUUID(),
    uncertain = randomUUID();
  const deletedKeys: string[] = [];
  let providerFails = false;
  const http = (): ReturnType<typeof request> => request(app.getHttpServer());
  const auth = (t: HttpTest): HttpTest => t.set('Cookie', `havefolio_session=${token}`);
  const receipt = (): string => randomBytes(32).toString('hex');
  let passwordHash: string;
  async function identity(): Promise<void> {
    await run.runtime.query(
      "INSERT INTO users(id,email,password_hash) VALUES($1,'privacy@example.test',$2)",
      [owner, passwordHash],
    );
    await run.runtime.query(
      "INSERT INTO auth_sessions(owner_id,token_hash,idle_expires_at,absolute_expires_at) VALUES($1,$2,now()+interval '1 hour',now()+interval '1 day')",
      [owner, hashToken(token)],
    );
  }
  async function media(id: string, state = 'ready'): Promise<void> {
    await run.runtime.query(
      `INSERT INTO media_attachments(id,owner_id,kind,variant,state,object_key,resource_type,format,provider_asset_id,provider_version,original_filename,mime_type,byte_size,checksum) VALUES($1,$2,'receipt','original',$3,$4,'raw','pdf',$5,1,'synthetic.pdf','application/pdf',100,repeat('a',64))`,
      [id, owner, state, `havefolio/test/${id}.pdf`, state === 'ready' ? randomUUID() : null],
    );
  }
  beforeAll(async () => {
    await run.start();
    const url = new URL(integrationConfiguration().runtimeUrl);
    url.searchParams.set('options', `-c search_path=${run.schema},pg_catalog`);
    const module = await Test.createTestingModule({
      imports: [
        TelemetryModule.register('api'),
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, ignoreEnvVars: true }),
        AuthModule,
        PrivacyModule,
      ],
    })
      .overrideProvider(ConfigService)
      .useValue(
        new ConfigService({
          ...validateApiEnvironment({ NODE_ENV: 'test' }),
          DATABASE_URL: url.toString(),
          AUTH_ARGON_MEMORY_KIB: 8192,
          AUTH_ARGON_TIME_COST: 1,
        }),
      )
      .overrideProvider(AuthRateService)
      .useValue({ check: jest.fn<() => Promise<void>>().mockResolvedValue(undefined) })
      .overrideProvider(PrivateMediaStorage)
      .useValue({
        delete: (key: string): Promise<void> => {
          if (providerFails) throw new Error('synthetic provider unavailable');
          deletedKeys.push(key);
          return Promise.resolve();
        },
      })
      .compile();
    app = module.createNestApplication<NestExpressApplication>({ logger: false });
    configureApplication(app);
    await app.listen(0, '127.0.0.1');
    service = module.get(PrivacyService);
    repo = module.get(PrivacyRepository);
    passwordHash = await module.get(PasswordService).hash(password);
    await identity();
    await run.runtime.query('INSERT INTO users(id) VALUES($1)', [other]);
    await run.runtime.query(
      "INSERT INTO items(id,owner_id,name,currency,price_paid_minor,original_entry,original_source,purchase_date_precision,purchase_year) VALUES($1,$2,'Synthetic item','INR',9007199254740993,'{\"manual\":true,\"numericOriginal\":9007199254740993}','manual','year',2020)",
      [item, owner],
    );
    await run.runtime.query(
      "INSERT INTO items(owner_id,name,currency,original_entry,original_source) VALUES($1,'Other private item','USD','{}','manual')",
      [other],
    );
    await repo.transaction(async (c) => {
      await c.query("SELECT set_config('havefolio.owner_id',$1,true)", [owner]);
      await c.query(
        "INSERT INTO goals(id,owner_id,name,target_minor,currency,target_date) VALUES($1,$2,'Synthetic goal',9007199254740993,'INR','2028-02-29')",
        [goal, owner],
      );
      await c.query(
        "INSERT INTO goal_contributions(id,goal_id,owner_id,currency,amount_minor,command_id,request_hash,kind,sequence) VALUES($1,$2,$3,'INR',50,$4,repeat('b',64),'contribution',2)",
        [contribution, goal, owner, randomUUID()],
      );
      await c.query(
        "INSERT INTO goal_contributions(goal_id,owner_id,currency,amount_minor,command_id,request_hash,kind,sequence,supersedes_id) VALUES($1,$2,'INR',40,$3,repeat('c',64),'correction',3,$4)",
        [goal, owner, randomUUID(), contribution],
      );
      await c.query(
        "INSERT INTO desires(id,owner_id,name,currency,likely_price_minor) VALUES($1,$2,'Synthetic desire','INR',100)",
        [desire, owner],
      );
      const event = randomUUID();
      await c.query(
        "INSERT INTO desire_review_events(id,desire_id,owner_id,command_id,request_hash,sequence,outcome,estimated_not_spent_minor,currency,note) VALUES($1,$2,$3,$4,repeat('d',64),2,'declined',100,'INR','Synthetic private history')",
        [event, desire, owner, randomUUID()],
      );
      // A separate unsuperseded contribution satisfies allocation invariants.
      const allocated = randomUUID();
      const allocationCommand = randomUUID();
      await c.query(
        "INSERT INTO goal_contributions(id,goal_id,owner_id,currency,amount_minor,command_id,request_hash,kind,sequence) VALUES($1,$2,$3,'INR',100,$4,repeat('f',64),'contribution',4)",
        [allocated, goal, owner, allocationCommand],
      );
      await c.query(
        "INSERT INTO desire_goal_allocations(desire_id,owner_id,review_event_id,goal_id,contribution_id,command_id,request_hash) VALUES($1,$2,$3,$4,$5,$6,repeat('f',64))",
        [desire, owner, event, goal, allocated, allocationCommand],
      );
    });
    const enrichment = randomUUID();
    await run.runtime.query(
      `INSERT INTO enrichment_work(id,owner_id,item_id,command_id,request_hash,base_revision,input,confirmed_snapshot) VALUES($1,$2,$3,$4,repeat('a',64),1,'{"kind":"name","name":"Private manual"}','{"name":"Private manual"}')`,
      [enrichment, owner, item, randomUUID()],
    );
    await run.runtime.query(
      `INSERT INTO enrichment_reviews(owner_id,item_id,work_id,command_id,request_hash,candidate_id,field,decision,value,previous_value,confirmed_value,revision,resulting_revision) VALUES($1,$2,$3,$4,repeat('b',64),'fixture','name','correct','Private correction','Private manual','Private correction',1,2)`,
      [owner, item, enrichment, randomUUID()],
    );
    for (const [field, confirmed] of [
      ['specification:Capacity', '1.5 L'],
      ['image', photo],
    ])
      await run.runtime.query(
        `INSERT INTO enrichment_reviews(owner_id,item_id,work_id,command_id,request_hash,candidate_id,field,decision,previous_value,confirmed_value,revision,resulting_revision) VALUES($1,$2,$3,$4,repeat('c',64),'fixture',$5,'accept',null,$6,2,3)`,
        [owner, item, enrichment, randomUUID(), field, confirmed],
      );
    await media(ready);
    for (const [id, variant, parent] of [
      [photo, 'original', null],
      [display, 'display', photo],
      [thumbnail, 'thumbnail', photo],
    ]) {
      await run.runtime.query(
        `INSERT INTO media_attachments(id,owner_id,item_id,parent_id,kind,variant,state,object_key,resource_type,format,provider_asset_id,provider_version,original_filename,mime_type,byte_size,checksum) VALUES($1,$2,$3,$4,'photo',$5,'ready',$6,'image','webp',$7,1,'sanitized.webp','image/webp',100,repeat('a',64))`,
        [id, owner, item, parent, variant, `havefolio/test/${id}`, randomUUID()],
      );
    }

    const otherFile = randomUUID();
    await run.runtime.query(
      `INSERT INTO media_attachments(id,owner_id,kind,variant,state,object_key,resource_type,format,provider_asset_id,provider_version,original_filename,mime_type,byte_size,checksum) VALUES($1,$2,'receipt','original','ready',$3,'raw','pdf',$4,1,'other.pdf','application/pdf',100,repeat('a',64))`,
      [otherFile, other, `havefolio/test/${otherFile}.pdf`, randomUUID()],
    );
    const waiting = randomUUID();
    await run.runtime.query(
      "INSERT INTO desires(id,owner_id,name,status,waiting_started_at,review_at) VALUES($1,$2,'Synthetic waiting','waiting',now(),now()+interval '1 day')",
      [waiting, owner],
    );
    await run.runtime.query(
      "INSERT INTO desire_reminders(desire_id,owner_id,schedule_version,scheduled_for) VALUES($1,$2,1,now()+interval '1 day') ON CONFLICT DO NOTHING",
      [waiting, owner],
    );
  });
  afterAll(async () => {
    await app?.close();
    await run.close();
  });
  it('requires owner authentication and exports exact money/date/provenance and private history without secrets', async () => {
    await http().get('/api/v1/privacy/export').expect(401);
    const response = await auth(http().get('/api/v1/privacy/export')).expect(200);
    expect(response.headers['cache-control']).toContain('no-store');
    expect(response.headers['content-disposition']).toContain('attachment');
    expect(response.text).toMatch(/"numericOriginal":\s*9007199254740993/);
    const data = response.body.data as Record<string, Record<string, unknown>[]>;
    expect(data.items).toHaveLength(1);
    expect(data.items![0]).toMatchObject({
      price_paid_minor: '9007199254740993',
      purchase_date_precision: 'year',
      purchase_year: 2020,
      purchase_month: null,
      purchase_day: null,
      original_entry: { manual: true },
    });
    expect(data.goals![0]).toMatchObject({
      target_minor: '9007199254740993',
      target_date: '2028-02-29',
    });
    expect(data.enrichment_work).toHaveLength(1);
    expect(data.enrichment_work![0]).toMatchObject({
      input: { kind: 'name', name: 'Private manual' },
      confirmed_snapshot: { name: 'Private manual' },
    });
    expect(data.enrichment_reviews!.find((r) => r.field === 'name')).toMatchObject({
      decision: 'correct',
      previous_value: 'Private manual',
      confirmed_value: 'Private correction',
    });
    expect(
      data.enrichment_reviews!.find((r) => r.field === 'specification:Capacity'),
    ).toMatchObject({ confirmed_value: '1.5 L' });
    expect(data.enrichment_reviews!.find((r) => r.field === 'image')).toMatchObject({
      confirmed_value: photo,
    });
    expect(data.goal_contributions).toHaveLength(3);
    expect(data.goal_contributions!.some((r) => r.supersedes_id === contribution)).toBe(true);
    expect(data.desire_goal_allocations).toHaveLength(1);
    expect(data.desire_review_events![0]!.note).toBe('Synthetic private history');
    const text = JSON.stringify(response.body);
    for (const secret of [
      'password_hash',
      'token_hash',
      'auth_sessions',
      passwordHash,
      token,
      'object_key',
      'provider_asset_id',
      'request_hash',
      'Other private item',
    ])
      expect(text).not.toContain(secret);
    expect(data.media_attachments!.find((r) => r.id === ready)!.original_filename).toBe(
      'synthetic.pdf',
    );
    expect(data.media_attachments).toHaveLength(4);
  });
  it('requires explicit confirmation and fresh password verification without revoking on rejection', async () => {
    await auth(http().post('/api/v1/privacy/deletion'))
      .send({ password, receipt: receipt(), confirmation: 'yes' })
      .expect(400);
    await auth(http().post('/api/v1/privacy/deletion'))
      .send({ password: 'incorrect', receipt: receipt(), confirmation: 'DELETE MY ACCOUNT' })
      .expect(401);
    await auth(http().get('/api/v1/privacy/export')).expect(200);
    const verify = jest.fn<() => Promise<boolean>>().mockResolvedValue(true);
    await expect(
      repo.admit(
        { id: owner, email: 'privacy@example.test', displayName: null, sessionId: randomUUID() },
        hashToken(receipt()),
        verify,
      ),
    ).rejects.toThrow('AUTH_REQUIRED');
    expect(verify).not.toHaveBeenCalled();
    await auth(http().post('/api/v1/privacy/deletion'))
      .set('Origin', 'https://hostile.example')
      .send({ password, receipt: receipt(), confirmation: 'DELETE MY ACCOUNT' })
      .expect(403);
    await auth(http().post('/api/v1/privacy/deletion'))
      .send({ password, receipt: receipt(), confirmation: 'DELETE MY ACCOUNT', ownerId: other })
      .expect(400);
  });
  it('revokes sessions, blocks stale writes and retries only exact authorised files before cascading private histories', async () => {
    const r = receipt();
    const admissions = await Promise.all(
      [0, 1].map(() =>
        auth(http().post('/api/v1/privacy/deletion')).send({
          password,
          receipt: r,
          confirmation: 'DELETE MY ACCOUNT',
        }),
      ),
    );
    expect(admissions.filter((r) => r.status === 202)).toHaveLength(1);
    expect(
      admissions.filter((r) => r.status !== 202).every((r) => [401, 503].includes(r.status)),
    ).toBe(true);
    expect(
      (await run.runtime.query('SELECT id FROM account_deletions WHERE owner_id=$1', [owner]))
        .rowCount,
    ).toBe(1);
    await auth(http().get('/api/v1/privacy/export')).expect(401);
    await http()
      .post('/api/v1/auth/login')
      .send({ email: 'privacy@example.test', password })
      .expect(401);
    await expect(
      run.runtime.query("UPDATE items SET name='stale write' WHERE id=$1", [item]),
    ).rejects.toThrow();
    await expect(run.runtime.query('DELETE FROM items WHERE id=$1', [item])).rejects.toThrow();
    expect(
      (await run.runtime.query('SELECT desire_id FROM desire_reminders WHERE owner_id=$1', [owner]))
        .rowCount,
    ).toBe(0);
    await expect(
      run.runtime.query(
        "INSERT INTO auth_sessions(owner_id,token_hash,idle_expires_at,absolute_expires_at) VALUES($1,$2,now()+interval '1 hour',now()+interval '1 day')",
        [owner, hashToken(newToken())],
      ),
    ).rejects.toThrow();
    providerFails = true;
    await service.tick();
    let response = await http()
      .post('/api/v1/privacy/deletion-status')
      .send({ receipt: r })
      .expect(200);
    expect(response.body.state).toBe('retrying');
    expect((await run.runtime.query('SELECT id FROM users WHERE id=$1', [owner])).rowCount).toBe(1);
    providerFails = false;
    await Promise.all([service.tick(), service.tick()]);
    for (let i = 0; i < 3; i++) await service.tick();
    response = await http()
      .post('/api/v1/privacy/deletion-status')
      .send({ receipt: r })
      .expect(200);
    expect(response.body).toMatchObject({
      state: 'completed',
      remainingFiles: 0,
      awaitingFinality: 0,
    });
    expect(new Set(deletedKeys)).toEqual(
      new Set([
        `havefolio/test/${ready}.pdf`,
        `havefolio/test/${photo}`,
        `havefolio/test/${display}`,
        `havefolio/test/${thumbnail}`,
      ]),
    );
    expect(deletedKeys.indexOf(`havefolio/test/${display}`)).toBeLessThan(
      deletedKeys.indexOf(`havefolio/test/${photo}`),
    );
    expect(deletedKeys.indexOf(`havefolio/test/${thumbnail}`)).toBeLessThan(
      deletedKeys.indexOf(`havefolio/test/${photo}`),
    );
    expect((await run.runtime.query('SELECT id FROM users WHERE id=$1', [owner])).rowCount).toBe(0);
    expect(
      (await run.runtime.query('SELECT id FROM items WHERE owner_id=$1', [other])).rowCount,
    ).toBe(1);
    expect(
      (await run.runtime.query('SELECT * FROM media_attachments WHERE owner_id=$1', [owner]))
        .rowCount,
    ).toBe(0);
    expect(
      (await run.runtime.query('SELECT id FROM enrichment_work WHERE owner_id=$1', [owner]))
        .rowCount,
    ).toBe(0);
    expect(
      (await run.runtime.query('SELECT id FROM enrichment_reviews WHERE owner_id=$1', [owner]))
        .rowCount,
    ).toBe(0);
    await service.tick();
    expect(deletedKeys).toHaveLength(4);
    await http().post('/api/v1/privacy/deletion-status').send({ receipt: receipt() }).expect(404);
    await http().get('/api/v1/privacy/export').set('Authorization', `Bearer ${r}`).expect(401);
    await run.runtime.query(
      "UPDATE account_deletions SET completed_at=now()-interval '31 days' WHERE receipt_hash=$1",
      [hashToken(r)],
    );
    await service.tick();
    await http().post('/api/v1/privacy/deletion-status').send({ receipt: r }).expect(404);
  });
  it('keeps uncertain writes pending across retries and restarts; not-found does not imply finality', async () => {
    owner = randomUUID();
    await identity();
    await media(uncertain, 'pending');
    const r = receipt();
    await auth(http().post('/api/v1/privacy/deletion'))
      .send({ password, receipt: r, confirmation: 'DELETE MY ACCOUNT' })
      .expect(202);
    await service.tick();
    await service.tick();
    const response = await http()
      .post('/api/v1/privacy/deletion-status')
      .send({ receipt: r })
      .expect(200);
    expect(response.body).toMatchObject({
      state: 'awaiting_finality',
      remainingFiles: 0,
      awaitingFinality: 1,
      completedAt: null,
    });
    expect((await run.runtime.query('SELECT id FROM users WHERE id=$1', [owner])).rowCount).toBe(1);
    expect(
      (
        await run.runtime.query(
          'SELECT attachment_id FROM deletion_resources WHERE attachment_id=$1',
          [uncertain],
        )
      ).rowCount,
    ).toBe(1);
    expect(deletedKeys.filter((k) => k === `havefolio/test/${uncertain}.pdf`)).toHaveLength(2);
    await expect(
      run.runtime.query(
        "UPDATE media_attachments SET state='ready',provider_asset_id=$2,provider_version=1 WHERE id=$1",
        [uncertain, randomUUID()],
      ),
    ).rejects.toThrow();
    await http()
      .post('/api/v1/privacy/deletion-status')
      .send({ receipt: r, ownerId: other })
      .expect(400);
    // Only a synthetic operator attestation: verify that a fresh destroy is required afterward.
    await run.runtime.query(
      'UPDATE deletion_resources SET finality_established=true WHERE attachment_id=$1',
      [uncertain],
    );
    expect(
      (
        await run.runtime.query(
          'SELECT cleaned_at FROM deletion_resources WHERE attachment_id=$1',
          [uncertain],
        )
      ).rows[0].cleaned_at,
    ).toBeNull();
    await repo.reconcile(app.get(PrivateMediaStorage));
    expect(
      (await http().post('/api/v1/privacy/deletion-status').send({ receipt: r }).expect(200)).body
        .state,
    ).toBe('completed');
    expect(deletedKeys.filter((k) => k === `havefolio/test/${uncertain}.pdf`)).toHaveLength(3);
    expect(
      (await run.runtime.query('SELECT id FROM media_attachments WHERE owner_id=$1', [other]))
        .rowCount,
    ).toBe(1);
  });
});
