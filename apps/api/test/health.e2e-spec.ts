import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApplication } from '../src/app.setup.js';

describe('HealthController (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApplication(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/v1/health', async () => {
    await request(app.getHttpServer()).get('/api/v1/health').expect(200).expect({
      service: 'havefolio-api',
      status: 'ok',
      version: '1',
    });
  });

  it('GET /api/v1/health/live', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health/live').expect(200);

    expect(res.body).toEqual({
      service: 'havefolio-api',
      status: 'ok',
    });
    expect(res.headers['cache-control']).toBe('no-store, no-cache, must-revalidate');
    expect(res.headers['pragma']).toBe('no-cache');
  });

  it('GET /api/v1/health/ready', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health/ready');

    expect([200, 503]).toContain(res.status);
    expect(res.body).toHaveProperty('service', 'havefolio-api');
    expect(['ok', 'degraded', 'unavailable']).toContain(res.body.status);
    expect(res.body).toHaveProperty('dependencies');
    expect(res.body.dependencies).toHaveProperty('postgres');
    expect(res.body.dependencies).toHaveProperty('valkey');
    expect(res.body.dependencies).toHaveProperty('storage');
    expect(res.headers['cache-control']).toBe('no-store, no-cache, must-revalidate');
    expect(res.headers['pragma']).toBe('no-cache');

    const json = JSON.stringify(res.body);
    expect(json).not.toContain('password');
    expect(json).not.toContain('secret');
    expect(json).not.toContain('postgres://');
    expect(json).not.toContain('redis://');
  });
});
