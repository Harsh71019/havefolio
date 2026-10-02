import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Query,
  type INestApplication,
} from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { EventLogger, logContext, TelemetryModule } from '@havefolio/logging';
import { SafeExceptionFilter } from './auth/safe-exception.filter.js';
import { configureApplication } from './app.setup.js';
import request from 'supertest';
import { jest } from '@jest/globals';
import { randomBytes } from 'node:crypto';

@Controller({ path: 'log-test', version: '1' })
class LoggingTestController {
  constructor(private readonly logger: EventLogger) {}
  @Get(':id')
  async handle(
    @Param('id') id: string,
    @Query('mode') mode?: string,
  ): Promise<{ id: string; requestId?: string | undefined }> {
    if (mode === 'bad') throw new BadRequestException('private input');
    if (mode === 'error') throw new Error('private provider secret');
    await new Promise((resolve) => setTimeout(resolve, Number(id) % 3));
    this.logger.emit('info', { event: 'service_operation', component: 'logging_test' });
    return {
      id,
      ...(logContext.getStore()?.requestId ? { requestId: logContext.getStore()?.requestId } : {}),
    };
  }
}

describe('HTTP logging boundary', () => {
  let app: INestApplication;
  let lines: string[];
  let output: ReturnType<typeof jest.spyOn>;
  beforeAll(async () => {
    lines = [];
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          ignoreEnvFile: true,
          isGlobal: true,
          load: [() => ({ NODE_ENV: 'test', LOG_RELEASE: 'per48-http-test', SEQ_ENABLED: false })],
        }),
        TelemetryModule.register('api'),
      ],
      controllers: [LoggingTestController],
    }).compile();
    app = module.createNestApplication({ bodyParser: false });
    app.useGlobalFilters(new SafeExceptionFilter());
    configureApplication(app);
    await app.init();
    output = jest.spyOn(process.stdout, 'write').mockImplementation((line: string | Uint8Array) => {
      lines.push(line.toString());
      return true;
    });
  });
  afterAll(async () => {
    output.mockRestore();
    await app.close();
  });
  beforeEach(() => {
    lines.length = 0;
  });
  it('returns valid/generates replacement IDs and logs route/status/duration without queries, cookies or bodies', async () => {
    const secret = randomBytes(20).toString('hex');
    const caller = 'caller_request_123456';
    for (const incoming of [caller, 'short', 'x'.repeat(65)]) {
      const response = await request(app.getHttpServer())
        .get(`/api/v1/log-test/1?private=${secret}`)
        .set('X-Request-ID', incoming)
        .set('Cookie', `session=${secret}`)
        .set('Authorization', `Bearer ${secret}`)
        .expect(200);
      const id = response.headers['x-request-id'];
      expect(id).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
      expect(response.body.requestId).toBe(id);
      if (incoming === caller) expect(id).toBe(caller);
      else expect(id).not.toBe(incoming);
    }
    expect(lines.join('')).not.toContain(secret);
    const events = lines
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((e) => e.event === 'http_completed');
    expect(events).toHaveLength(3);
    for (const e of events) {
      expect(e.route).toBe('/api/v1/log-test/:id');
      expect(e.status).toBe(200);
      expect(e.durationMs).toBeGreaterThanOrEqual(0);
      expect(e.release).toBe('per48-http-test');
      expect(e.method).toBe('GET');
    }
  });
  it('separates controlled 4xx and unexpected 5xx without duplicating completion events', async () => {
    await request(app.getHttpServer()).get('/api/v1/log-test/1?mode=bad').expect(400);
    await request(app.getHttpServer()).get('/api/v1/log-test/1?mode=error').expect(500);
    const events = lines
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((e) => e.event === 'http_completed');
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      category: 'controlled_failure',
      level: 40,
      status: 400,
      code: 'INVALID_REQUEST',
    });
    expect(events[1]).toMatchObject({ category: 'unexpected_failure', level: 50, status: 500 });
    expect(events[1]?.error).toMatchObject({ type: 'Error' });
    expect(lines.join('')).not.toContain('private');
  });
  it('preserves context through concurrently awaited services and excludes unmatched URLs', async () => {
    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        request(app.getHttpServer())
          .get(`/api/v1/log-test/${i}`)
          .set('X-Request-ID', `request_${i}`.padEnd(16, '0'))
          .expect(200),
      ),
    );
    const events = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(events.filter((e) => e.event === 'service_operation')).toHaveLength(10);
    for (let i = 0; i < 10; i++)
      expect(events.filter((e) => e.requestId === `request_${i}`.padEnd(16, '0'))).toHaveLength(2);
    await request(app.getHttpServer()).get('/unmatched-private-content?secret=yes').expect(404);
    expect(JSON.parse(lines.at(-1) ?? '{}').route).toBe('/unmatched');
    expect(lines.join('')).not.toContain('unmatched-private');
  });
});
