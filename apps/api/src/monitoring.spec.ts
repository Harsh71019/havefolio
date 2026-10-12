import { Controller, Get, Param, HttpException, type INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { TelemetryModule } from '@havefolio/logging';
import {
  initializeMonitoring,
  flushMonitoring,
  closeMonitoring,
} from '@havefolio/monitoring/server';
import { createServer, type Server } from 'node:http';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { configureApplication } from './app.setup.js';
import { SafeExceptionFilter } from './auth/safe-exception.filter.js';
const secret = randomBytes(20).toString('hex');
@Controller({ path: 'items', version: '1' })
class MonitoringController {
  @Get(':itemId')
  handle(@Param('itemId') id: string): void {
    if (id === 'unexpected') throw new TypeError(secret);
    const status = Number(id);
    if (Number.isInteger(status) && status >= 400) throw new HttpException(secret, status);
  }
}
describe('API monitoring and safe exception handling', () => {
  let app: INestApplication;
  let receiver: Server;
  const envelopes: string[] = [];
  beforeAll(async () => {
    receiver = createServer((req, res) => {
      let body = '';
      req.on('data', (data) => (body += String(data)));
      req.on('end', () => {
        envelopes.push(body);
        res.end('{}');
      });
    });
    await new Promise<void>((resolve) => receiver.listen(0, '127.0.0.1', resolve));
    const address = receiver.address();
    if (!address || typeof address === 'string') throw new Error('Missing receiver');
    initializeMonitoring('api', {
      NODE_ENV: 'test',
      LOG_RELEASE: 'per49-api-test',
      GLITCHTIP_ENABLED: 'true',
      GLITCHTIP_TRACE_SAMPLE_RATE: '0',
      GLITCHTIP_DSN: `http://${randomBytes(16).toString('hex')}@127.0.0.1:${address.port}/1`,
    });
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          ignoreEnvFile: true,
          isGlobal: true,
          load: [() => ({ NODE_ENV: 'test', SEQ_ENABLED: false })],
        }),
        TelemetryModule.register('api'),
      ],
      controllers: [MonitoringController],
    }).compile();
    app = module.createNestApplication();
    configureApplication(app);
    app.useGlobalFilters(new SafeExceptionFilter());
    await app.init();
  });
  afterAll(async () => {
    await closeMonitoring();
    await app.close();
    await new Promise<void>((resolve) => receiver.close(() => resolve()));
  });
  it('reports unexpected and operational 5xx once while omitting expected 4xx and private input', async () => {
    for (const status of [400, 401, 403, 404, 409, 413, 429])
      await request(app.getHttpServer()).get(`/api/v1/items/${status}`).expect(status);
    await flushMonitoring();
    expect(envelopes).toHaveLength(0);
    const response = await request(app.getHttpServer())
      .get(`/api/v1/items/unexpected?note=${secret}`)
      .set('X-Request-ID', 'request_123456789')
      .set('X-Correlation-ID', 'correlation_12345')
      .set('Cookie', `session=${secret}`)
      .expect(500);
    expect(JSON.stringify(response.body)).not.toContain(secret);
    await flushMonitoring();
    expect(envelopes).toHaveLength(1);
    expect(envelopes.join('')).not.toContain(secret);
    const event = JSON.parse(envelopes[0]!.split('\n')[2]!) as {
      tags: Record<string, string>;
      release: string;
    };
    expect(event.tags).toMatchObject({
      requestId: 'request_123456789',
      correlationId: 'correlation_12345',
      route: '/api/v1/items/:itemId',
      code: 'REQUEST_FAILED',
      service: 'api',
    });
    expect(event.release).toBe('per49-api-test');
    await request(app.getHttpServer()).get('/api/v1/items/503').expect(503);
    await flushMonitoring();
    expect(envelopes).toHaveLength(2);
  });
});
