import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import request from 'supertest';
import { TelemetryModule } from '@havefolio/logging';
import { validateApiEnvironment } from '@havefolio/config';
import { IntegrationRun, integrationConfiguration } from '@havefolio/test-utils';
import type { NotificationsPage } from '@havefolio/contracts';
import { AuthModule } from '../src/auth/auth.module.js';
import { newToken, hashToken } from '../src/auth/session-cookie.service.js';
import { configureApplication } from '../src/app.setup.js';
import { NotificationsModule } from '../src/notifications/notifications.module.js';

jest.setTimeout(60000);

describe('owner-scoped in-app reminder notifications', () => {
  const run = new IntegrationRun(integrationConfiguration());
  const ownerId = randomUUID();
  const otherId = randomUUID();
  const ownerDesireId = randomUUID();
  const otherDesireId = randomUUID();
  const token = newToken();
  let app: NestExpressApplication;
  let firstNotificationId: string;
  let foreignNotificationId: string;

  const authenticated = (): ReturnType<ReturnType<typeof request>['get']> =>
    request(app.getHttpServer())
      .get('/api/v1/notifications')
      .set('Cookie', `havefolio_session=${token}`);

  beforeAll(async () => {
    await run.start();
    const config = integrationConfiguration();
    const runtimeUrl = new URL(config.runtimeUrl);
    runtimeUrl.searchParams.set('options', `-c search_path=${run.schema},pg_catalog`);
    await run.runtime.query(
      "INSERT INTO users(id,email,password_hash) VALUES($1,'notification-owner@example.test','$argon2id$fixture'),($2,NULL,NULL)",
      [ownerId, otherId],
    );
    await run.runtime.query(
      "INSERT INTO auth_sessions(owner_id,token_hash,idle_expires_at,absolute_expires_at) VALUES($1,$2,now()+interval '1 hour',now()+interval '1 day')",
      [ownerId, hashToken(token)],
    );
    await run.runtime.query(
      `INSERT INTO desires(id,owner_id,name) VALUES
       ($1,$2,'Owner synthetic desire'),($3,$4,'Foreign synthetic desire')`,
      [ownerDesireId, ownerId, otherDesireId, otherId],
    );
    const first = await run.runtime.query<{ id: string }>(
      `INSERT INTO notifications(owner_id,desire_id,type,reminder_version,occurred_at,created_at)
       VALUES($1,$2,'desire_wait_ended',1,now()-interval '2 minutes',now()-interval '2 minutes')
       RETURNING id`,
      [ownerId, ownerDesireId],
    );
    firstNotificationId = first.rows[0]!.id;
    await run.runtime.query(
      `INSERT INTO notifications(owner_id,desire_id,type,reminder_version,occurred_at,created_at)
       VALUES($1,$2,'desire_wait_ended',2,now()-interval '1 minute',now()-interval '1 minute')`,
      [ownerId, ownerDesireId],
    );
    const foreign = await run.runtime.query<{ id: string }>(
      `INSERT INTO notifications(owner_id,desire_id,type,reminder_version,occurred_at)
       VALUES($1,$2,'desire_wait_ended',1,now()) RETURNING id`,
      [otherId, otherDesireId],
    );
    foreignNotificationId = foreign.rows[0]!.id;

    const module = await Test.createTestingModule({
      imports: [
        TelemetryModule.register('api'),
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, ignoreEnvVars: true }),
        AuthModule,
        NotificationsModule,
      ],
    })
      .overrideProvider(ConfigService)
      .useValue(
        new ConfigService({
          ...validateApiEnvironment({ NODE_ENV: 'test' }),
          DATABASE_URL: runtimeUrl.toString(),
          AUTH_RATE_KEY_SECRET: 'notification-integration-key-32-chars',
        }),
      )
      .compile();
    app = module.createNestApplication<NestExpressApplication>({ logger: false });
    configureApplication(app);
    await app.listen(0, '127.0.0.1');
  });

  afterAll(async () => {
    await app?.close();
    await run.close();
  });

  it('requires authentication and returns bounded keyset pages only for the owner', async () => {
    await request(app.getHttpServer()).get('/api/v1/notifications').expect(401);
    const first = await authenticated().query({ limit: 1 }).expect(200);
    const page = first.body as NotificationsPage;
    expect(first.headers['cache-control']).toBe('no-store');
    expect(page.items).toHaveLength(1);
    expect(page.hasMore).toBe(true);
    expect(page.nextCursor).toEqual(expect.any(String));
    expect(page.unreadCount).toBe(2);
    expect(page.items[0]?.desireId).toBe(ownerDesireId);
    expect(JSON.stringify(page)).not.toContain(otherDesireId);
    expect(JSON.stringify(page)).not.toContain('synthetic desire');

    const next = await authenticated().query({ limit: 1, after: page.nextCursor }).expect(200);
    expect((next.body as NotificationsPage).items).toHaveLength(1);
    await authenticated().query({ after: 'invalid' }).expect(400);
  });

  it('marks owner notifications read idempotently and hides foreign existence', async () => {
    await request(app.getHttpServer())
      .patch(`/api/v1/notifications/${foreignNotificationId}/read`)
      .set('Cookie', `havefolio_session=${token}`)
      .expect(404);

    const first = await request(app.getHttpServer())
      .patch(`/api/v1/notifications/${firstNotificationId}/read`)
      .set('Cookie', `havefolio_session=${token}`)
      .expect(200);
    const second = await request(app.getHttpServer())
      .patch(`/api/v1/notifications/${firstNotificationId}/read`)
      .set('Cookie', `havefolio_session=${token}`)
      .expect(200);
    expect(second.body.readAt).toBe(first.body.readAt);

    const unread = await authenticated().query({ unreadOnly: 'true' }).expect(200);
    expect((unread.body as NotificationsPage).unreadCount).toBe(1);
    expect((unread.body as NotificationsPage).items).toHaveLength(1);
  });

  it('publishes the notification endpoints in OpenAPI', () => {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle('Havefolio').setVersion('1').build(),
    );
    expect(document.paths['/api/v1/notifications']?.get).toBeDefined();
    expect(document.paths['/api/v1/notifications/{id}/read']?.patch).toBeDefined();
  });
});
