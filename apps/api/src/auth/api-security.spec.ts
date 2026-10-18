import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  type INestApplication,
} from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { configureApplication } from '../app.setup.js';
import { AuthGuard } from './auth.guard.js';
import { AuthService } from './auth.service.js';
import { SessionCookieService } from './session-cookie.service.js';
import { SafeExceptionFilter } from './safe-exception.filter.js';
import { Public } from './auth.context.js';
import { TelemetryModule } from '@havefolio/logging';

const canonicalOrigin = 'https://app.example.test';
const lanOrigin = 'http://192.168.0.226:3020';

@Controller({ path: 'test-secure', version: '1' })
class SecureProbeController {
  @Public()
  @Get('public-probe')
  publicProbe(): { ok: boolean } {
    return { ok: true };
  }

  @Public()
  @Post('public-action')
  publicAction(): { ok: boolean } {
    return { ok: true };
  }

  @Delete('sessions/:id')
  @HttpCode(204)
  deleteSession(@Param('id', ParseUUIDPipe) id: string): { id: string } {
    return { id };
  }
}

describe('API Security Hardening and Global Controls', () => {
  let app: INestApplication;
  const mockAuthService = {
    authenticate: () => Promise.resolve({ id: 'owner-1', sessionId: 'sess-1' }),
    login: () => Promise.resolve({ token: 'mock-token', owner: { id: 'owner-1' } }),
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          ignoreEnvFile: true,
          isGlobal: true,
          load: [
            () => ({
              NODE_ENV: 'test',
              API_CORS_ORIGIN: canonicalOrigin,
              AUTH_LAN_HTTP_ORIGIN: lanOrigin,
              LOG_RELEASE: 'per37-test',
              SEQ_ENABLED: false,
            }),
          ],
        }),
        TelemetryModule.register('api'),
      ],
      controllers: [SecureProbeController],
      providers: [
        { provide: AuthService, useValue: mockAuthService },
        SessionCookieService,
        { provide: APP_GUARD, useClass: AuthGuard },
      ],
    }).compile();

    app = module.createNestApplication({ bodyParser: false });
    app.useGlobalFilters(new SafeExceptionFilter());
    configureApplication(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Global Security Headers', () => {
    it('sets strict security headers on all API responses', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/test-secure/public-probe')
        .expect(200);

      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['x-frame-options']).toBe('DENY');
      expect(response.headers['x-dns-prefetch-control']).toBe('off');
      expect(response.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
      expect(response.headers['content-security-policy']).toBe(
        "default-src 'none'; frame-ancestors 'none'",
      );
      expect(response.headers['cross-origin-resource-policy']).toBe('same-origin');
    });

    it('sets Cache-Control no-store on error responses', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/test-secure/public-action')
        .set('Origin', 'https://hostile.example')
        .expect(403);

      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.headers['x-content-type-options']).toBe('nosniff');
    });
  });

  describe('CSRF and Origin Enforcement on State-Changing Methods', () => {
    it('rejects foreign origins on POST requests', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/test-secure/public-action')
        .set('Origin', 'https://attacker.evil')
        .expect(403)
        .expect((res) => {
          expect(res.body).toMatchObject({
            statusCode: 403,
            message: 'REQUEST_ORIGIN_REJECTED',
          });
        });
    });

    it('rejects null origin on state-changing requests', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/test-secure/public-action')
        .set('Origin', 'null')
        .expect(403)
        .expect((res) => {
          expect(res.body).toMatchObject({
            statusCode: 403,
            message: 'REQUEST_ORIGIN_REJECTED',
          });
        });
    });

    it('rejects Sec-Fetch-Site cross-site', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/test-secure/public-action')
        .set('Origin', canonicalOrigin)
        .set('Sec-Fetch-Site', 'cross-site')
        .expect(403);
    });

    it('rejects Sec-Fetch-Mode navigate and nested-navigate on state-changing API routes', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/test-secure/public-action')
        .set('Origin', canonicalOrigin)
        .set('Sec-Fetch-Mode', 'navigate')
        .expect(403);

      await request(app.getHttpServer())
        .post('/api/v1/test-secure/public-action')
        .set('Origin', canonicalOrigin)
        .set('Sec-Fetch-Mode', 'nested-navigate')
        .expect(403);
    });

    it('rejects foreign or malformed Referer when Origin is omitted', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/test-secure/public-action')
        .set('Referer', 'https://malicious.example/checkout')
        .expect(403);

      await request(app.getHttpServer())
        .post('/api/v1/test-secure/public-action')
        .set('Referer', 'not-a-valid-url-at-all')
        .expect(403);
    });

    it('permits state-changing requests from canonical origin or LAN origin', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/test-secure/public-action')
        .set('Origin', canonicalOrigin)
        .expect(201);

      await request(app.getHttpServer())
        .post('/api/v1/test-secure/public-action')
        .set('Origin', lanOrigin)
        .expect(201);
    });

    it('permits state-changing requests when Referer origin matches canonical or LAN', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/test-secure/public-action')
        .set('Referer', `${canonicalOrigin}/items/new`)
        .expect(201);

      await request(app.getHttpServer())
        .post('/api/v1/test-secure/public-action')
        .set('Referer', `${lanOrigin}/items/new`)
        .expect(201);
    });
  });

  describe('Session ID Validation Boundary', () => {
    it('rejects non-UUID session parameters with 400 INVALID_REQUEST before hitting database', async () => {
      // Mock cookie
      const validCookie = 'havefolio_session=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
      await request(app.getHttpServer())
        .delete('/api/v1/test-secure/sessions/malformed-id-attempt')
        .set('Cookie', validCookie)
        .expect(400)
        .expect((res) => {
          expect(res.body).toMatchObject({
            statusCode: 400,
            message: 'INVALID_REQUEST',
          });
        });
    });
  });
});
