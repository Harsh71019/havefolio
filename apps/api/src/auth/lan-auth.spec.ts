import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import request, { type Test as HttpTest } from 'supertest';
import { jest } from '@jest/globals';
import { AuthController } from './auth.controller.js';
import { AuthGuard } from './auth.guard.js';
import { AuthService } from './auth.service.js';
import { SessionCookieService } from './session-cookie.service.js';

const lan = 'http://192.168.0.226:3020';
const https = 'https://apps.example.test';
const token = Buffer.alloc(32, 7).toString('base64url');
const owner = {
  id: 'synthetic-owner',
  email: 'owner@example.test',
  displayName: null,
  sessionId: 'synthetic-session',
};

describe('explicit LAN HTTP authentication alongside production HTTPS', () => {
  let app: INestApplication;
  let settings: Record<string, unknown>;
  const auth = {
    login: jest.fn(() => Promise.resolve({ token, owner })),
    authenticate: jest.fn(() => Promise.resolve(owner)),
    publicOwner: jest.fn(() => owner),
    logout: jest.fn(() => Promise.resolve(undefined)),
  };
  beforeEach(async () => {
    jest.clearAllMocks();
    settings = {
      NODE_ENV: 'production',
      API_CORS_ORIGIN: https,
      AUTH_LAN_HTTP_ORIGIN: lan,
      AUTH_SESSION_ABSOLUTE_SECONDS: 3600,
    };
    const module = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: ConfigService, useValue: new ConfigService(settings) },
        { provide: AuthService, useValue: auth },
        SessionCookieService,
        { provide: APP_GUARD, useClass: AuthGuard },
      ],
    }).compile();
    app = module.createNestApplication({ logger: false });
    await app.init();
  });
  afterEach(async () => {
    await app.close();
  });
  const login = (origin: string): HttpTest =>
    request(app.getHttpServer())
      .post('/auth/login')
      .set('Origin', origin)
      .send({ email: owner.email, password: 'synthetic fixture only' });
  const cookie = (res: request.Response): string =>
    (res.headers['set-cookie'] as unknown as string[])[0]!;

  it('issues separate host-only LAN cookies and accepts them for session use, rotation and logout', async () => {
    const created = await login(lan).expect(200);
    const header = cookie(created);
    expect(header).toContain('havefolio_lan_session=');
    expect(header).toContain('HttpOnly');
    expect(header).toContain('SameSite=Strict');
    expect(header).toContain('Path=/');
    expect(header).not.toMatch(/Secure|Domain=/i);
    expect(created.headers['cache-control']).toBe('no-store');
    const session = header.split(';')[0]!;
    await request(app.getHttpServer()).get('/auth/me').set('Cookie', session).expect(200);
    expect(auth.authenticate).toHaveBeenCalledWith(token);
    await login(lan).set('Cookie', session).expect(200);
    expect(auth.login).toHaveBeenLastCalledWith(expect.anything(), expect.any(String), token);
    const cleared = await request(app.getHttpServer())
      .post('/auth/logout')
      .set('Origin', lan)
      .set('Cookie', session)
      .expect(204);
    expect(cookie(cleared)).toContain('havefolio_lan_session=;');
    expect(cookie(cleared)).not.toContain('Secure');
    expect(auth.logout).toHaveBeenCalledWith(owner, false);
  });
  it('preserves Secure __Host cookies and logout attributes on HTTPS', async () => {
    const created = await login(https).expect(200);
    expect(cookie(created)).toContain('__Host-havefolio_session=');
    expect(cookie(created)).toContain('Secure');
    expect(cookie(created)).toContain('HttpOnly');
    expect(cookie(created)).toContain('SameSite=Strict');
    expect(cookie(created)).not.toContain('Domain=');
    const cleared = await request(app.getHttpServer())
      .post('/auth/logout-all')
      .set('Origin', https)
      .set('Cookie', cookie(created).split(';')[0]!)
      .expect(204);
    expect(cookie(cleared)).toContain('__Host-havefolio_session=;');
    expect(cookie(cleared)).toContain('Secure');
  });
  it('does not downgrade cookies based on forwarded headers or missing Origin', async () => {
    const created = await request(app.getHttpServer())
      .post('/auth/login')
      .set('X-Forwarded-Proto', 'http')
      .set('X-Forwarded-Host', '192.168.0.226:3020')
      .send({ email: owner.email, password: 'synthetic fixture only' })
      .expect(200);
    expect(cookie(created)).toContain('__Host-havefolio_session=');
    expect(cookie(created)).toContain('Secure');
  });
  it('rejects foreign origins and cross-site writes before authentication', async () => {
    for (const origin of [
      'http://192.168.0.227:3020',
      'http://192.168.0.226:3021',
      'https://hostile.example',
      'null',
    ])
      await login(origin).expect(403);
    await login(lan).set('Sec-Fetch-Site', 'cross-site').expect(403);
    expect(auth.login).not.toHaveBeenCalled();
  });
  it('keeps LAN disabled by default and rejects ambiguous or malformed cookies', async () => {
    delete settings.AUTH_LAN_HTTP_ORIGIN;
    await login(lan).expect(403);
    const disabled = new SessionCookieService(new ConfigService(settings));
    expect(
      disabled.read({ headers: { cookie: `havefolio_lan_session=${token}` } } as never),
    ).toBeUndefined();
    settings.AUTH_LAN_HTTP_ORIGIN = lan;
    const cookies = new SessionCookieService(new ConfigService(settings));
    for (const value of [
      `havefolio_lan_session=bad`,
      `havefolio_lan_session=${token}; havefolio_lan_session=${token}`,
      `havefolio_lan_session=${token}; __Host-havefolio_session=${token}`,
    ])
      expect(() => cookies.read({ headers: { cookie: value } } as never)).toThrow();
  });
});
