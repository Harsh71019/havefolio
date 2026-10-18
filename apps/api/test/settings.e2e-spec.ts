import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import request, { type Test as HttpTest } from 'supertest';
import { TelemetryModule } from '@havefolio/logging';
import { validateApiEnvironment } from '@havefolio/config';
import { IntegrationRun, integrationConfiguration } from '@havefolio/test-utils';
import type { SettingsOverview, OwnerPreferences } from '@havefolio/contracts';
import { AuthModule } from '../src/auth/auth.module.js';
import { newToken, hashToken } from '../src/auth/session-cookie.service.js';
import { configureApplication } from '../src/app.setup.js';
import { SettingsModule } from '../src/settings/settings.module.js';
import { SettingsService } from '../src/settings/settings.service.js';
import { ItemsModule } from '../src/items/items.module.js';

jest.setTimeout(60000);

describe('PER-34 owner settings and privacy integration', () => {
  const run = new IntegrationRun(integrationConfiguration());
  const ownerId = randomUUID();
  const otherOwnerId = randomUUID();
  const ownerToken = newToken();
  const otherToken = newToken();
  const extraSessionToken = newToken();
  let app: NestExpressApplication;
  let extraSessionId: string;
  let itemId: string;

  const http = (): ReturnType<typeof request> => request(app.getHttpServer());
  const ownerGet = (path = ''): HttpTest =>
    http()
      .get(`/api/v1/settings${path ? '/' + path : ''}`)
      .set('Cookie', `havefolio_session=${ownerToken}`);
  const ownerPatch = (body: object): HttpTest =>
    http().patch('/api/v1/settings').set('Cookie', `havefolio_session=${ownerToken}`).send(body);
  const ownerDelete = (path = ''): HttpTest =>
    http()
      .delete(`/api/v1/settings${path ? '/' + path : ''}`)
      .set('Cookie', `havefolio_session=${ownerToken}`);

  beforeAll(async () => {
    await run.start();

    // Seed owners (only one owner can have credentials due to single-owner instance constraint)
    await run.runtime.query(
      `INSERT INTO users(id, email, password_hash) VALUES
       ($1, 'settings-owner@example.test', '$argon2id$fixture'),
       ($2, NULL, NULL)`,
      [ownerId, otherOwnerId],
    );

    // Seed sessions
    await run.runtime.query(
      `INSERT INTO auth_sessions(owner_id, token_hash, idle_expires_at, absolute_expires_at) VALUES
       ($1, $2, now() + interval '1 hour', now() + interval '1 day'),
       ($3, $4, now() + interval '1 hour', now() + interval '1 day')`,
      [ownerId, hashToken(ownerToken), otherOwnerId, hashToken(otherToken)],
    );

    // Extra session for owner
    const extraSession = await run.runtime.query<{ id: string }>(
      `INSERT INTO auth_sessions(owner_id, token_hash, idle_expires_at, absolute_expires_at)
       VALUES ($1, $2, now() + interval '1 hour', now() + interval '1 day')
       RETURNING id`,
      [ownerId, hashToken(extraSessionToken)],
    );
    extraSessionId = extraSession.rows[0]!.id;

    // Seed an existing item with historical currency EUR
    itemId = randomUUID();
    await run.runtime.query(
      `INSERT INTO items(id, owner_id, name, currency, price_paid_minor, original_entry, original_source)
       VALUES ($1, $2, 'Historical Item', 'EUR', 4500, '{"name":"Historical Item"}', 'manual')`,
      [itemId, ownerId],
    );

    const config = integrationConfiguration();
    const runtimeUrl = new URL(config.runtimeUrl);
    runtimeUrl.searchParams.set('options', `-c search_path=${run.schema},pg_catalog`);

    const module = await Test.createTestingModule({
      imports: [
        TelemetryModule.register('api'),
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, ignoreEnvVars: true }),
        AuthModule,
        ItemsModule,
        SettingsModule,
      ],
    })
      .overrideProvider(ConfigService)
      .useValue(
        new ConfigService({
          ...validateApiEnvironment({ NODE_ENV: 'test' }),
          DATABASE_URL: runtimeUrl.toString(),
          AUTH_RATE_KEY_SECRET: 'settings-integration-key-32-chars',
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

  it('requires authentication for settings endpoints', async () => {
    await http().get('/api/v1/settings').expect(401);
    await http().patch('/api/v1/settings').send({ revision: 1 }).expect(401);
    await http().delete('/api/v1/settings/sessions').expect(401);
  });

  it('returns default preferences and overview on first read', async () => {
    const res = await ownerGet().expect(200);
    const body = res.body as SettingsOverview;

    expect(body.preferences.defaultCurrency).toBe('INR');
    expect(body.preferences.notifyInApp).toBe(true);
    expect(body.preferences.notifyNtfy).toBe(true);
    expect(body.preferences.revision).toBe(1);

    expect(body.sessions.length).toBeGreaterThanOrEqual(2);
    const current = body.sessions.find((s) => s.isCurrent);
    expect(current).toBeDefined();

    expect(body.privacy.storageType).toBe('authenticated_cloudinary');
    expect(body.privacy.accessType).toBe('authenticated_proxy');
    expect(body.privacy.publicSharing).toBe(false);
    expect(body.privacy.registrationLock.locked).toBe(true);
  });

  it('rejects invalid currency codes with 400', async () => {
    const res = await ownerPatch({
      revision: 1,
      defaultCurrency: 'ZZZ',
    }).expect(400);

    expect(res.body.message).toBe('INVALID_SETTINGS_CURRENCY');

    const malformed = await ownerPatch({
      revision: 1,
      defaultCurrency: 'NOT_A_CURRENCY',
    }).expect(400);

    expect(malformed.body.message).toBe('INVALID_REQUEST');
  });

  it('updates preferences and increments revision', async () => {
    const res = await ownerPatch({
      revision: 1,
      defaultCurrency: 'USD',
      notifyNtfy: false,
    }).expect(200);

    const updated = res.body as OwnerPreferences;
    expect(updated.defaultCurrency).toBe('USD');
    expect(updated.notifyNtfy).toBe(false);
    expect(updated.notifyInApp).toBe(true);
    expect(updated.revision).toBe(2);
  });

  it('protects against stale/concurrent updates with 409 conflict', async () => {
    // Current revision is 2; attempting to update with revision 1 must fail
    const res = await ownerPatch({
      revision: 1,
      defaultCurrency: 'GBP',
    }).expect(409);

    expect(res.body.message).toBe('STALE_SETTINGS_REVISION');
  });

  it('preserves historical item money and currency without conversion', async () => {
    // Check database row for historical item
    const itemRow = await run.runtime.query<{ currency: string; price_paid_minor: string }>(
      `SELECT currency, price_paid_minor FROM items WHERE id=$1`,
      [itemId],
    );

    expect(itemRow.rows[0]?.currency).toBe('EUR');
    expect(itemRow.rows[0]?.price_paid_minor).toBe('4500');
  });

  it('rejects revoking the current session', async () => {
    // Find current session ID
    const overview = (await ownerGet().expect(200)).body as SettingsOverview;
    const currentSession = overview.sessions.find((s) => s.isCurrent)!;

    const res = await ownerDelete(`sessions/${currentSession.id}`).expect(400);
    expect(res.body.message).toBe('CANNOT_REVOKE_CURRENT_SESSION');
  });

  it('allows revoking another specific active session', async () => {
    await ownerDelete(`sessions/${extraSessionId}`).expect(204);

    // Verify session is no longer in active list
    const overview = (await ownerGet().expect(200)).body as SettingsOverview;
    const revoked = overview.sessions.find((s) => s.id === extraSessionId);
    expect(revoked).toBeUndefined();
  });

  it('enforces owner isolation: cannot see or mutate other owner settings', async () => {
    const settingsService = app.get(SettingsService);

    // Other owner preferences are isolated and return fresh defaults
    const otherPrefs = await settingsService.getPreferences(otherOwnerId);
    expect(otherPrefs.defaultCurrency).toBe('INR');
    expect(otherPrefs.revision).toBe(1);

    // Mutating other owner preferences does not affect initial owner
    const updatedOther = await settingsService.updatePreferences(
      { id: otherOwnerId, email: 'other@example.com', displayName: null, sessionId: randomUUID() },
      { revision: 1, defaultCurrency: 'GBP', notifyNtfy: false },
    );
    expect(updatedOther.defaultCurrency).toBe('GBP');
    expect(updatedOther.notifyNtfy).toBe(false);
    expect(updatedOther.revision).toBe(2);

    // Initial owner preferences remain USD / revision 2 from earlier tests
    const ownerPrefs = await settingsService.getPreferences(ownerId);
    expect(ownerPrefs.defaultCurrency).toBe('USD');
    expect(ownerPrefs.revision).toBe(2);

    // Database RLS isolates rows when current_setting('havefolio.owner_id') is set
    await run.runtime.query("SELECT set_config('havefolio.owner_id', $1, false)", [otherOwnerId]);
    const ownerRowsSeenByOther = await run.runtime.query(
      'SELECT * FROM owner_settings WHERE owner_id = $1',
      [ownerId],
    );
    expect(ownerRowsSeenByOther.rows).toEqual([]);

    // Reset owner_id context
    await run.runtime.query("SELECT set_config('havefolio.owner_id', '', false)");
  });

  it('publishes the settings endpoints in OpenAPI', () => {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle('Havefolio').setVersion('1').build(),
    );
    expect(document.paths['/api/v1/settings']?.get).toBeDefined();
    expect(document.paths['/api/v1/settings']?.patch).toBeDefined();
    expect(document.paths['/api/v1/settings/preferences']?.get).toBeDefined();
    expect(document.paths['/api/v1/settings/sessions']?.get).toBeDefined();
    expect(document.paths['/api/v1/settings/sessions/{id}']?.delete).toBeDefined();
  });
});
