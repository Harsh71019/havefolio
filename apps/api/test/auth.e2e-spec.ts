import type { NestExpressApplication } from '@nestjs/platform-express';
import { Controller, Get, Post } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { IntegrationRun, integrationConfiguration } from '@havefolio/test-utils';
import { applyMigrations } from '@havefolio/db';
import { validateApiEnvironment } from '@havefolio/config';
import request, { type Response, type Test as HttpTest } from 'supertest';
import { argon2id, hash, verify } from 'argon2';
import { jest } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { AuthModule } from '../src/auth/auth.module.js';
import { AuthRepository } from '../src/auth/auth.repository.js';
import { AuthRateService } from '../src/auth/auth-rate.service.js';
import { CurrentOwner, type OwnerContext } from '../src/auth/auth.context.js';
import { hashToken } from '../src/auth/session-cookie.service.js';
import { OperationsModule } from '../src/operations/operations.module.js';
import { configureApplication } from '../src/app.setup.js';

@Controller({ path: 'private-probe', version: '1' })
class PrivateProbeController {
  @Get() get(@CurrentOwner() owner: OwnerContext): { ownerId: string } {
    return { ownerId: owner.id };
  }
  @Post() post(): void {}
}
const credentials = { email: 'owner@example.test', password: 'synthetic password fixture' };
function cookie(response: Response): string {
  const values = response.headers['set-cookie'] as unknown as string[];
  return values[0]!.split(';')[0]!;
}
function token(value: string): string {
  return value.split('=')[1]!;
}

jest.setTimeout(60000);

describe('private authentication on isolated PostgreSQL and Valkey', () => {
  let run: IntegrationRun;
  let app: NestExpressApplication;
  let module: TestingModule;
  let settings: Record<string, unknown>;
  let rateKeys: Set<string>;
  beforeEach(async () => {
    const config = integrationConfiguration();
    run = new IntegrationRun(config);
    await run.start();
    const url = new URL(config.runtimeUrl);
    url.searchParams.set('options', `-c search_path=${run.schema},pg_catalog`);
    // CI supplies random ACL identities; production configuration still enforces PER-3 identity names.
    settings = {
      ...validateApiEnvironment({ NODE_ENV: 'test' }),
      DATABASE_URL: url.toString(),
      AUTH_REGISTRATION_ENABLED: true,
      AUTH_RATE_KEY_SECRET: 'synthetic test HMAC key for isolation',
      VALKEY_HOST: config.valkeyHost,
      VALKEY_PORT: config.valkeyPort,
      VALKEY_USERNAME: config.valkeyUsername,
      VALKEY_PASSWORD: config.valkeyPassword,
      VALKEY_PREFIX: run.prefix,
      AUTH_RATE_SOURCE_LIMIT: 100,
      AUTH_RATE_ACCOUNT_SOURCE_LIMIT: 100,
    };
    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, ignoreEnvVars: true }),
        AuthModule,
        OperationsModule,
      ],
      controllers: [PrivateProbeController],
    })
      .overrideProvider(ConfigService)
      .useValue(new ConfigService(settings))
      .compile();
    rateKeys = new Set();
    const limiter = module.get(AuthRateService);
    const original = limiter.keys.bind(limiter);
    limiter.keys = (...args: Parameters<AuthRateService['keys']>): [string, string] => {
      const result = original(...args);
      result.forEach((key) => rateKeys.add(key));
      return result;
    };
    app = module.createNestApplication<NestExpressApplication>({
      logger: false,
      bodyParser: false,
    });
    app.useBodyParser('json', { limit: '16kb' });
    configureApplication(app);
    await app.listen(0, '127.0.0.1');
  });
  afterEach(async () => {
    await app?.close();
    if (run?.valkey.status === 'ready' && rateKeys?.size) await run.valkey.del(...rateKeys);
    await run?.close();
  });
  const post = (path: string, values = credentials): HttpTest =>
    request(app.getHttpServer()).post(`/api/v1/auth/${path}`).send(values);
  const me = (session: string): HttpTest =>
    request(app.getHttpServer()).get('/api/v1/auth/me').set('Cookie', session);

  it('applies the forward migration twice, preserves shells, normalizes and registers only one owner concurrently', async () => {
    const shellId = randomUUID();
    await run.runtime.query('INSERT INTO users (id) VALUES ($1)', [shellId]);
    await applyMigrations(run.migration, run.schema);
    const results = await Promise.all([
      post('register', { ...credentials, email: ' OWNER@example.test ' }),
      post('register', { ...credentials, email: 'second@example.test' }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 403]);
    const created = results.find((r) => r.status === 201)!;
    const owners = await run.runtime.query('SELECT * FROM users WHERE email IS NOT NULL');
    expect(owners.rowCount).toBe(1);
    expect(await verify(owners.rows[0].password_hash as string, credentials.password)).toBe(true);
    const sessions = await run.runtime.query('SELECT * FROM auth_sessions');
    expect(sessions.rowCount).toBe(1);
    expect(sessions.rows[0].token_hash).toBe(hashToken(token(cookie(created))));
    expect(JSON.stringify(sessions.rows)).not.toContain(token(cookie(created)));
    expect(Object.keys(created.body).sort()).toEqual(['displayName', 'email', 'id']);
    expect(created.headers['cache-control']).toBe('no-store');
    expect(
      (await run.runtime.query('SELECT email, password_hash FROM users WHERE id = $1', [shellId]))
        .rows[0],
    ).toEqual({ email: null, password_hash: null });
    await post('register').expect(403);
    await expect(
      run.runtime.query(
        "INSERT INTO users (email, password_hash) VALUES ('third@example.test', '$argon2id$fixture')",
      ),
    ).rejects.toMatchObject({ code: '23505' });
  });
  it('enforces disabled registration, DTO bounds and generic failure responses', async () => {
    settings.AUTH_REGISTRATION_ENABLED = false;
    const disabled = await post('register').expect(403);
    expect(disabled.body.message).toBe('REGISTRATION_UNAVAILABLE');
    expect((await run.runtime.query('SELECT * FROM users')).rowCount).toBe(0);
    for (const values of [
      { ...credentials, password: 'short' },
      { ...credentials, password: 'a'.repeat(129) },
      { ...credentials, email: 'invalid' },
      { ...credentials, password: 123456789123456 },
      { ...credentials, extra: true },
    ]) {
      const result = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send(values)
        .expect(400);
      expect(JSON.stringify(result.body)).not.toContain(credentials.password);
    }
    const malformed = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('Content-Type', 'application/json')
      .send('secret-password-fragment invalid JSON')
      .expect(400);
    expect(JSON.stringify(malformed.body)).not.toContain('secret-password-fragment');
    expect(malformed.body.message).toBe('INVALID_REQUEST');
    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ ...credentials, password: 'a'.repeat(17000) })
      .expect(413);
    settings.AUTH_REGISTRATION_ENABLED = true;
    await post('register').expect(201);
    const wrong = await post('login', {
      ...credentials,
      password: 'different password fixture',
    }).expect(401);
    const missing = await post('login', { ...credentials, email: 'missing@example.test' }).expect(
      401,
    );
    expect(wrong.body).toEqual(missing.body);
    settings.AUTH_REGISTRATION_ENABLED = false;
    await post('register', { ...credentials, email: 'missing@example.test' }).expect(403);
  });
  it('rotates on login, upgrades password parameters and bounds all retained session rows', async () => {
    const registered = await post('register').expect(201);
    const first = cookie(registered);
    const old = await hash(credentials.password, {
      type: argon2id,
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
    });
    await run.runtime.query('UPDATE users SET password_hash = $1 WHERE id = $2', [
      old,
      registered.body.id,
    ]);
    const loggedIn = await post('login', { ...credentials, email: ' OWNER@example.test ' })
      .set('Cookie', first)
      .expect(200);
    expect(cookie(loggedIn)).not.toBe(first);
    await me(first).expect(401);
    await me(cookie(loggedIn)).expect(200);
    const upgraded = (await run.runtime.query('SELECT password_hash FROM users')).rows[0]
      .password_hash as string;
    expect(upgraded).toContain('m=65536');
    expect(upgraded).toContain('t=3');
    expect(await verify(upgraded, credentials.password)).toBe(true);
    settings.AUTH_SESSION_MAX_RETAINED = 3;
    for (let i = 0; i < 5; i++) await post('login').expect(200);
    expect((await run.runtime.query('SELECT * FROM auth_sessions')).rowCount).toBe(3);
    await me(cookie(loggedIn)).expect(401);
  });
  it('rejects idle-expired, absolute-expired and revoked sessions without resurrection', async () => {
    const registered = await post('register').expect(201);
    // Backdate all relevant metadata coherently so database constraints remain meaningful.
    await run.runtime.query(
      "UPDATE auth_sessions SET created_at = now() - interval '2 days', last_used_at = now() - interval '2 days', idle_expires_at = now() - interval '1 day' WHERE token_hash = $1",
      [hashToken(token(cookie(registered)))],
    );
    await me(cookie(registered)).expect(401);
    const absolute = await post('login').expect(200);
    await run.runtime.query(
      "UPDATE auth_sessions SET created_at = now() - interval '8 days', last_used_at = now() - interval '8 days', idle_expires_at = now() - interval '1 day', absolute_expires_at = now() - interval '1 day' WHERE token_hash = $1",
      [hashToken(token(cookie(absolute)))],
    );
    await me(cookie(absolute)).expect(401);
    const revoked = await post('login').expect(200);
    await run.runtime.query('UPDATE auth_sessions SET revoked_at = now() WHERE token_hash = $1', [
      hashToken(token(cookie(revoked))),
    ]);
    const before = (
      await run.runtime.query('SELECT last_used_at FROM auth_sessions WHERE token_hash = $1', [
        hashToken(token(cookie(revoked))),
      ])
    ).rows[0];
    await Promise.all([me(cookie(revoked)).expect(401), me(cookie(revoked)).expect(401)]);
    expect(
      (
        await run.runtime.query('SELECT last_used_at FROM auth_sessions WHERE token_hash = $1', [
          hashToken(token(cookie(revoked))),
        ])
      ).rows[0],
    ).toEqual(before);
  });
  it('revokes the current session independently and logout-all includes the current session under concurrent touches', async () => {
    const first = cookie(await post('register').expect(201));
    const second = cookie(await post('login').expect(200));
    const cleared = await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .set('Cookie', first)
      .expect(204);
    expect((cleared.headers['set-cookie'] as unknown as string[])[0]!).toContain(
      'havefolio_session=;',
    );
    expect((cleared.headers['set-cookie'] as unknown as string[])[0]!).toContain('Path=/');
    expect((cleared.headers['set-cookie'] as unknown as string[])[0]!).toContain('HttpOnly');
    expect((cleared.headers['set-cookie'] as unknown as string[])[0]!).toContain('SameSite=Strict');
    await me(first).expect(401);
    await me(second).expect(200);
    const third = cookie(await post('login').expect(200));
    await Promise.all([
      me(third),
      request(app.getHttpServer())
        .post('/api/v1/auth/logout-all')
        .set('Cookie', second)
        .expect(204),
    ]);
    await me(second).expect(401);
    await me(third).expect(401);
    expect(
      (await run.runtime.query('SELECT * FROM auth_sessions WHERE revoked_at IS NULL')).rowCount,
    ).toBe(0);
    // Rotation and logout-all serialize on the owner; no existing session can be revived.
    const fourth = cookie(await post('login').expect(200));
    const results = await Promise.all([
      post('login').set('Cookie', fourth),
      request(app.getHttpServer()).post('/api/v1/auth/logout-all').set('Cookie', fourth),
    ]);
    expect(results[0].status).toBe(200);
    expect([204, 401]).toContain(results[1].status);
    await me(fourth).expect(401);
    const active = await run.runtime.query('SELECT * FROM auth_sessions WHERE revoked_at IS NULL');
    expect(active.rowCount).toBeLessThanOrEqual(1);
  });
  it('protects future routes by default, exposes public health, rejects hostile origins and malformed cookies, and describes contracts', async () => {
    await request(app.getHttpServer()).get('/api/v1/private-probe').expect(401);
    await request(app.getHttpServer()).get('/api/v1/health').expect(200);
    const registered = await post('register').expect(201);
    const session = cookie(registered);
    await request(app.getHttpServer())
      .get('/api/v1/private-probe')
      .set('Cookie', session)
      .expect(200)
      .expect({ ownerId: registered.body.id });
    await post('login').set('Origin', 'https://attacker.example.test').expect(403);
    await request(app.getHttpServer())
      .post('/api/v1/private-probe')
      .set('Cookie', session)
      .set('Sec-Fetch-Site', 'cross-site')
      .expect(403);
    for (const value of [
      'havefolio_session=',
      'havefolio_session=bad',
      `havefolio_session=${'a'.repeat(5000)}`,
      `${session}; ${session}`,
    ])
      await me(value).expect(401);
    await me('havefolio_session=' + 'a'.repeat(43)).expect(401);
    await post('login').set('Cookie', 'havefolio_session=bad').expect(401);
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .addCookieAuth('havefolio_session', { type: 'apiKey', in: 'cookie' }, 'ownerSession')
        .build(),
    );
    const prefix = '/api/v1/auth/';
    expect(document.paths[prefix + 'register']?.post?.responses).toHaveProperty('201');
    expect(document.paths[prefix + 'login']?.post?.responses).toHaveProperty('429');
    expect(document.paths[prefix + 'login']?.post?.security ?? []).toEqual([]);
    for (const [path, method] of [
      ['me', 'get'],
      ['logout', 'post'],
      ['logout-all', 'post'],
    ] as const) {
      expect(document.paths[prefix + path]?.[method]?.security).toEqual([{ ownerSession: [] }]);
      expect(document.paths[prefix + path]?.[method]?.responses).toHaveProperty('401');
    }
    expect(document.components?.schemas?.OwnerResponseDto).not.toHaveProperty(
      'properties.passwordHash',
    );
    expect(document.components?.schemas?.OwnerResponseDto).not.toHaveProperty(
      'properties.sessionId',
    );
  });
  it('sets and clears production cookies with matching secure host-only HTTP scope', async () => {
    await post('register').expect(201);
    const productionModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, ignoreEnvVars: true }),
        AuthModule,
      ],
    })
      .overrideProvider(ConfigService)
      .useValue(new ConfigService({ ...settings, NODE_ENV: 'production' }))
      .compile();
    const productionApp = productionModule.createNestApplication({ logger: false });
    configureApplication(productionApp);
    try {
      await productionApp.listen(0, '127.0.0.1');
      const loggedIn = await request(productionApp.getHttpServer())
        .post('/api/v1/auth/login')
        .send(credentials)
        .expect(200);
      const header = (loggedIn.headers['set-cookie'] as unknown as string[])[0]!;
      for (const attribute of [
        '__Host-havefolio_session=',
        'Path=/',
        'Max-Age=604800',
        'HttpOnly',
        'Secure',
        'SameSite=Strict',
      ])
        expect(header).toContain(attribute);
      expect(header).not.toContain('Domain=');
      const cleared = await request(productionApp.getHttpServer())
        .post('/api/v1/auth/logout-all')
        .set('Cookie', cookie(loggedIn))
        .expect(204);
      const clearedHeader = (cleared.headers['set-cookie'] as unknown as string[])[0]!;
      for (const attribute of [
        '__Host-havefolio_session=;',
        'Path=/',
        'HttpOnly',
        'Secure',
        'SameSite=Strict',
        'Expires=Thu, 01 Jan 1970',
      ])
        expect(clearedHeader).toContain(attribute);
      expect(clearedHeader).not.toContain('Domain=');
    } finally {
      await productionApp.close();
    }
    // Exact synthetic limiter keys from the production fixture share only this test's prefix.
    const rate = productionModule.get(AuthRateService);
    const candidates = ['::ffff:127.0.0.1', '127.0.0.1', '::1'].flatMap((source) =>
      rate.keys('login', source, credentials.email),
    );
    candidates.forEach((key) => rateKeys.add(key));
  });
  it('limits login/registration in an isolated namespace with bounded TTL, avoids account-wide lockout and fails closed on outage', async () => {
    const rate = module.get(AuthRateService);
    settings.AUTH_RATE_ACCOUNT_SOURCE_LIMIT = 2;
    settings.AUTH_RATE_SOURCE_LIMIT = 4;
    await rate.check('login', 'one', credentials.email);
    await rate.check('login', 'one', credentials.email);
    await expect(rate.check('login', 'one', credentials.email)).rejects.toMatchObject({
      status: 429,
    });
    await rate.check('login', 'two', credentials.email); // Chosen identifier cannot lock out another source.
    await rate.check('login', 'one', 'other@example.test'); // Source limit reached for this source.
    await expect(rate.check('login', 'one', 'third@example.test')).rejects.toMatchObject({
      status: 429,
    });
    for (const key of rateKeys) {
      expect(key).toMatch(new RegExp(`^${run.prefix}:auth:`));
      expect(key).not.toContain(credentials.email);
      expect(await run.valkey.ttl(key)).toBeGreaterThan(0);
      expect(await run.valkey.ttl(key)).toBeLessThanOrEqual(300);
    }
    const unrelated = await run.setKey('unrelated', 'preserved');
    await post('register').expect(201);
    await post('register').expect(403);
    await post('register').expect(429);
    await post('login', { ...credentials, email: 'absent@example.test' }).expect(401);
    await post('login', { ...credentials, email: 'absent@example.test' }).expect(401);
    await post('login', { ...credentials, email: 'absent@example.test' }).expect(429);
    expect(await run.valkey.get(unrelated)).toBe('preserved');
    await post('login', { ...credentials, email: 'absent@example.test' })
      .set('X-Forwarded-For', '203.0.113.20')
      .expect(429);
    rate.onModuleDestroy();
    await post('login').expect(503);
    await post('register').expect(503);
    expect((await run.runtime.query('SELECT * FROM users WHERE email IS NOT NULL')).rowCount).toBe(
      1,
    );
    const repository = module.get(AuthRepository);
    await repository.onModuleDestroy();
    await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Cookie', 'havefolio_session=' + 'A'.repeat(43))
      .expect(503);
  });
});
