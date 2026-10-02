import { jest } from '@jest/globals';
import { HttpException, Logger, type ArgumentsHost } from '@nestjs/common';
import { SafeExceptionFilter } from './safe-exception.filter.js';
import { ConfigService } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { validateApiEnvironment } from '@havefolio/config';
import type { Request, Response } from 'express';
import { argon2id, hash } from 'argon2';
import { PasswordService } from './password.service.js';
import { SessionCookieService, newToken } from './session-cookie.service.js';
import { AuthRateService } from './auth-rate.service.js';

async function fixture(settings: Record<string, unknown> = {}): Promise<TestingModule> {
  const module = await Test.createTestingModule({
    providers: [
      PasswordService,
      SessionCookieService,
      AuthRateService,
      {
        provide: ConfigService,
        useValue: new ConfigService({ ...validateApiEnvironment({}), ...settings }),
      },
    ],
  }).compile();
  await module.init();
  return module;
}
describe('password, cookie and configuration security', () => {
  it('uses Argon2id, verifies passwords and upgrades older parameters without a downgrade', async () => {
    const module = await fixture();
    try {
      const passwords = module.get(PasswordService);
      const password = 'synthetic long password';
      const digest = await passwords.hash(password);
      expect(digest).toMatch(/^\$argon2id\$v=19\$/);
      expect(digest).toContain('m=65536');
      expect(digest).toContain('t=3');
      expect(digest).toContain('p=1');
      expect(await passwords.verify(password, digest)).toBe(true);
      expect(await passwords.verify('wrong password fixture', digest)).toBe(false);
      expect(await passwords.verify(password, null)).toBe(false);
      expect(await passwords.verify(password, 'malformed')).toBe(false);
      expect(passwords.needsUpgrade(digest)).toBe(false);
      const old = await hash(password, {
        type: argon2id,
        memoryCost: 19456,
        timeCost: 4,
        parallelism: 1,
      });
      expect(passwords.needsUpgrade(old)).toBe(true);
      const upgraded = await passwords.upgrade(password, old);
      expect(upgraded).toContain('m=65536');
      expect(upgraded).toContain('t=4');
      expect(await passwords.verify(password, upgraded)).toBe(true);
    } finally {
      await module.close();
    }
  });
  it('matches creation/clearing cookie scope and rejects malformed, duplicated or oversized tokens', async () => {
    for (const production of [false, true]) {
      const module = await fixture({ NODE_ENV: production ? 'production' : 'development' });
      try {
        const cookies = module.get(SessionCookieService);
        const token = newToken();
        let written: unknown[] = [];
        let cleared: unknown[] = [];
        const response = {
          cookie: (...args: unknown[]) => {
            written = args;
          },
          clearCookie: (...args: unknown[]) => {
            cleared = args;
          },
        } as unknown as Response;
        cookies.write(response, token);
        cookies.clear(response);
        expect(written).toEqual([
          production ? '__Host-havefolio_session' : 'havefolio_session',
          token,
          { httpOnly: true, secure: production, sameSite: 'strict', path: '/', maxAge: 604800000 },
        ]);
        expect(cleared).toEqual([
          cookies.name,
          { httpOnly: true, secure: production, sameSite: 'strict', path: '/' },
        ]);
        const req = (cookie?: string): Request => ({ headers: { cookie } }) as Request;
        expect(cookies.read(req())).toBeUndefined();
        expect(cookies.read(req(`${cookies.name}=${token}`))).toBe(token);
        for (const value of [
          '',
          'bad',
          'a'.repeat(44),
          '%00',
          'a'.repeat(9000),
          `${token}; ${cookies.name}=${token}`,
        ])
          expect(() => cookies.read(req(`${cookies.name}=${value}`))).toThrow('AUTH_REQUIRED');
      } finally {
        await module.close();
      }
    }
  });
  it('isolates HMAC keys and fails closed without Valkey configuration', async () => {
    const module = await fixture({ AUTH_RATE_KEY_SECRET: 'synthetic-key'.repeat(4) });
    try {
      const rate = module.get(AuthRateService);
      const keys = rate.keys('login', 'source', 'owner@example.test');
      expect(keys.every((key) => key.startsWith('havefolio:dev:auth:login:'))).toBe(true);
      expect(keys.join()).not.toContain('owner@example.test');
      expect(rate.keys('login', 'other', 'owner@example.test')).not.toEqual(keys);
      await expect(rate.check('login', 'source', 'owner@example.test')).rejects.toMatchObject({
        message: 'AUTH_UNAVAILABLE',
      });
    } finally {
      await module.close();
    }
  });
  it('defaults registration off and rejects unsafe configuration', () => {
    expect(validateApiEnvironment({}).AUTH_REGISTRATION_ENABLED).toBe(false);
    const databaseUrl = new URL('postgresql://havefolio_runtime@example.test/havefolio');
    databaseUrl.password = newToken();
    const invalidDatabaseUrl = new URL(databaseUrl);
    invalidDatabaseUrl.username = 'admin';
    const production = validateApiEnvironment({
      NODE_ENV: 'production',
      API_CORS_ORIGIN: 'https://app.example.test',
      DATABASE_URL: databaseUrl.toString(),
      VALKEY_USERNAME: 'havefolio_production_api',
      VALKEY_PASSWORD: 'synthetic fixture',
      AUTH_RATE_KEY_SECRET: 'synthetic-key'.repeat(4),
      API_TRUST_PROXY: '203.0.113.10',
    });
    expect(production.AUTH_REGISTRATION_ENABLED).toBe(false);
    expect(production.API_TRUST_PROXY).toEqual(['203.0.113.10']);
    for (const change of [
      { AUTH_REGISTRATION_ENABLED: 'yes' },
      { AUTH_ARGON_MEMORY_KIB: 1024 },
      { AUTH_ARGON_TIME_COST: 1 },
      { AUTH_SESSION_IDLE_SECONDS: 1000, AUTH_SESSION_ABSOLUTE_SECONDS: 60 },
      { VALKEY_USERNAME: 'default' },
      { VALKEY_PREFIX: 'havefolio:production' },
      { VALKEY_DATABASE: 1 },
      { API_TRUST_PROXY: 'true' },
      { API_TRUST_PROXY: '0.0.0.0/0' },
      { NODE_ENV: 'production' },
      { DATABASE_URL: invalidDatabaseUrl.toString() },
    ])
      expect(() => validateApiEnvironment(change)).toThrow();
  });
});

describe('safe exception boundary', () => {
  it('redacts unknown failures and does not echo credential JSON parser messages', async () => {
    const logs = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const module = await Test.createTestingModule({ providers: [SafeExceptionFilter] }).compile();
    try {
      const filter = module.get(SafeExceptionFilter);
      let status = 0;
      let body: unknown;
      const response = {
        status: (code: number) => {
          status = code;
          return response;
        },
        locals: {},
        setHeader: () => response,
        json: (value: unknown) => {
          body = value;
        },
      };
      const host = {
        switchToHttp: () => ({ getResponse: () => response }),
      } as unknown as ArgumentsHost;
      filter.catch(new HttpException('secret-password-fragment in malformed JSON', 400), host);
      expect(status).toBe(400);
      expect(body).toMatchObject({ message: 'INVALID_REQUEST' });
      filter.catch(new Error('private database credentials and stack fixture'), host);
      expect(status).toBe(500);
      expect(JSON.stringify(body)).not.toContain('private');
      expect(logs).not.toHaveBeenCalled();
    } finally {
      logs.mockRestore();
      await module.close();
    }
  });
});
