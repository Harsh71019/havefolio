import { TelemetryModule } from '@havefolio/logging';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request, { type Test as HttpTest } from 'supertest';
import sharp from 'sharp';
import { PDF } from '@libpdf/core';
import { IntegrationRun, integrationConfiguration } from '@havefolio/test-utils';
import { validateApiEnvironment } from '@havefolio/config';
import { AuthModule } from '../src/auth/auth.module.js';
import { newToken, hashToken } from '../src/auth/session-cookie.service.js';
import { configureApplication } from '../src/app.setup.js';
import { ItemsModule } from '../src/items/items.module.js';
import { DesiresModule } from '../src/desires/desires.module.js';
import { GoalsModule } from '../src/goals/goals.module.js';
import { PrivateMediaStorage, type StoreInput } from '../src/media/storage.js';
import { MediaService } from '../src/media/media.service.js';
import type { PhotoSnapshotDto, PhotoUploadDto } from '../src/media/item-photos.dto.js';
import type { DocumentSnapshotDto } from '../src/media/item-documents.dto.js';
import type { DesireConversionDto } from '../src/desires/desire-conversions.dto.js';
import type { GoalDto, ContributionDto } from '../src/goals/goals.dto.js';

jest.setTimeout(90000);

describe('PER-39 failure boundaries, upload resilience, idempotency and concurrency', () => {
  const run = new IntegrationRun(integrationConfiguration());
  const ownerA = randomUUID();
  const tokenA = newToken();

  let app: NestExpressApplication;
  let photoBytes: Buffer;
  let pdfBytes: Buffer;
  const storedObjects = new Map<string, Buffer>();

  const putMock = jest.fn(async (input: StoreInput) => {
    storedObjects.set(input.key, Buffer.from(input.bytes));
    const m: { width?: number; height?: number } =
      input.resourceType === 'image' ? await sharp(input.bytes).metadata() : {};
    return {
      assetId: `asset-${randomUUID()}`,
      version: 1,
      width: m.width ?? 100,
      height: m.height ?? 100,
    };
  });

  const deleteMock = jest.fn((key: string): Promise<void> => {
    storedObjects.delete(key);
    return Promise.resolve();
  });

  const readMock = jest.fn((key: string): Promise<Buffer> => {
    const bytes = storedObjects.get(key);
    if (!bytes) return Promise.reject(new Error('Object not found in test storage'));
    return Promise.resolve(Buffer.from(bytes));
  });

  const http = (): ReturnType<typeof request> => request(app.getHttpServer());
  const authA = (t: HttpTest): HttpTest => t.set('Cookie', `havefolio_session=${tokenA}`);

  beforeAll(async () => {
    await run.start();

    // Insert test user with email and credentials
    await run.migration.query(
      `INSERT INTO users(id, email, password_hash) VALUES ($1, 'failure-owner-a@example.test', '$argon2id$synthetic_fixture')`,
      [ownerA],
    );

    // Insert session for authenticated requests
    await run.migration.query(
      `INSERT INTO auth_sessions(owner_id, token_hash, idle_expires_at, absolute_expires_at)
       VALUES ($1, $2, now() + interval '2 hours', now() + interval '1 day')`,
      [ownerA, hashToken(tokenA)],
    );

    const runtimeUrl = new URL(integrationConfiguration().runtimeUrl);
    runtimeUrl.searchParams.set('options', `-c search_path=${run.schema},pg_catalog`);

    const moduleRef = await Test.createTestingModule({
      imports: [
        TelemetryModule.register('api'),
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, ignoreEnvVars: true }),
        AuthModule,
        ItemsModule,
        DesiresModule,
        GoalsModule,
      ],
    })
      .overrideProvider(ConfigService)
      .useValue(
        new ConfigService({
          ...validateApiEnvironment({ NODE_ENV: 'test' }),
          DATABASE_URL: runtimeUrl.toString(),
          MEDIA_STORAGE_ENABLED: true,
        }),
      )
      .overrideProvider(PrivateMediaStorage)
      .useValue({
        put: putMock,
        delete: deleteMock,
        read: readMock,
        download: () => 'https://example.test/short-lived-synthetic-signed-url',
      })
      .compile();

    app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
    configureApplication(app);
    await app.listen(0, '127.0.0.1');

    photoBytes = await sharp({
      create: { width: 80, height: 60, channels: 3, background: '#456789' },
    })
      .jpeg()
      .toBuffer();

    const pdfDoc = PDF.create();
    pdfDoc.addPage();
    pdfBytes = Buffer.from(await pdfDoc.save());
  });

  afterAll(async () => {
    await app?.close();
    await run.close();
    storedObjects.clear();
  });

  // Helpers
  const createItem = async (extra: object = {}): Promise<{ id: string; revision: number }> => {
    const res = await authA(http().post('/api/v1/items'))
      .send({
        name: 'Failure Test Item',
        currency: 'INR',
        ownershipStatus: 'owned',
        ...extra,
      })
      .expect(201);
    return res.body as { id: string; revision: number };
  };

  const createDesire = async (extra: object = {}): Promise<{ id: string; revision: number }> => {
    const res = await authA(http().post('/api/v1/desires'))
      .send({
        name: 'Failure Test Desire',
        currency: 'INR',
        likelyPriceMinor: '250000',
        ...extra,
      })
      .expect(201);
    return res.body as { id: string; revision: number };
  };

  const reviewDesire = async (
    desireId: string,
    revision: number,
    outcome: string,
    extra: object = {},
  ): Promise<{ id: string }> => {
    const res = await authA(http().post(`/api/v1/desires/${desireId}/reviews`))
      .send({
        commandId: randomUUID(),
        revision,
        outcome,
        ...extra,
      })
      .expect(201);
    return res.body as { id: string };
  };

  describe('Upload and storage provider failure resilience', () => {
    it('handles item photo provider failure gracefully without leaving ready attachments or advancing revision', async () => {
      const item = await createItem();
      const uploadId = randomUUID();

      // Simulate storage provider failure (e.g. timeout / HTTP 503)
      putMock.mockRejectedValueOnce(new Error('Synthetic storage provider timeout'));

      const res = await authA(http().post(`/api/v1/items/${item.id}/photos`))
        .set('Upload-Id', uploadId)
        .attach('photos', photoBytes, 'test.jpg')
        .expect(201);

      const body = res.body as PhotoUploadDto;
      expect(body.results).toHaveLength(1);
      expect(body.results[0]!.error).toBe('PHOTO_UPLOAD_FAILED');
      expect(body.results[0]!.photo).toBeUndefined();

      // Database verification: attachments inserted for intent must remain in 'pending', none in 'ready'
      const rows = (
        await run.migration.query<{ state: string; item_id: string }>(
          'SELECT state, item_id FROM media_attachments WHERE item_id=$1',
          [item.id],
        )
      ).rows;
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((r) => r.state === 'pending')).toBe(true);
      expect(rows.some((r) => r.state === 'ready')).toBe(false);

      // Parent item revision must not have incremented
      const itemRes = await authA(http().get(`/api/v1/items/${item.id}`)).expect(200);
      expect(itemRes.body.revision).toBe(item.revision);

      // Snapshot must show 0 ready photos
      const snapshot = (await authA(http().get(`/api/v1/items/${item.id}/photos`)).expect(200))
        .body as PhotoSnapshotDto;
      expect(snapshot.photos).toHaveLength(0);

      // Reconciler cleans up pending attachments older than 15m
      await run.migration.query(
        "UPDATE media_attachments SET updated_at = now() - interval '20 minutes' WHERE item_id=$1",
        [item.id],
      );

      const mediaService = app.get(MediaService);
      // First pass deletes variants (children), second pass deletes original
      await mediaService.reconcile();
      await mediaService.reconcile();

      const postReconcileRows = (
        await run.migration.query<{ state: string }>(
          'SELECT state FROM media_attachments WHERE item_id=$1',
          [item.id],
        )
      ).rows;
      expect(postReconcileRows.every((r) => r.state === 'deleted')).toBe(true);
    });

    it('handles desire photo provider failure gracefully without advancing revision or showing photo', async () => {
      const desire = await createDesire();
      const uploadId = randomUUID();

      putMock.mockRejectedValueOnce(new Error('Synthetic provider 503 error'));

      // POST /desires/:id/photo returns error on provider failure
      await authA(http().post(`/api/v1/desires/${desire.id}/photo`))
        .set('Upload-Id', uploadId)
        .attach('photo', photoBytes, 'desire.jpg')
        .expect(500);

      // Verify no ready attachment in database
      const rows = (
        await run.migration.query<{ state: string }>(
          'SELECT state FROM media_attachments WHERE desire_id=$1',
          [desire.id],
        )
      ).rows;
      expect(rows.every((r) => r.state === 'pending')).toBe(true);
      expect(rows.some((r) => r.state === 'ready')).toBe(false);

      // Desire revision must remain unchanged
      const desireRes = await authA(http().get(`/api/v1/desires/${desire.id}`)).expect(200);
      expect(desireRes.body.revision).toBe(desire.revision);

      // Desire photo GET must return 404
      await authA(http().get(`/api/v1/desires/${desire.id}/photo`)).expect(404);
    });

    it('handles item document provider failure and leaves zero ready documents', async () => {
      const item = await createItem();
      const uploadId = randomUUID();

      putMock.mockRejectedValueOnce(new Error('Synthetic document storage disconnection'));

      await authA(http().post(`/api/v1/items/${item.id}/documents`))
        .set('Upload-Id', uploadId)
        .field('kind', 'receipt')
        .attach('document', pdfBytes, 'receipt.pdf')
        .expect(503);

      // Verify no ready document in database
      const docRows = (
        await run.migration.query<{ state: string }>(
          "SELECT state FROM media_attachments WHERE item_id=$1 AND kind in ('receipt', 'warranty')",
          [item.id],
        )
      ).rows;
      expect(docRows.some((r) => r.state === 'ready')).toBe(false);

      // Document snapshot returns empty list
      const snapshot = (await authA(http().get(`/api/v1/items/${item.id}/documents`)).expect(200))
        .body as DocumentSnapshotDto;
      expect(snapshot.documents).toHaveLength(0);
    });

    it('rejects corrupt/spoofed files before invoking storage provider', async () => {
      const item = await createItem();
      const fakeCorruptBytes = Buffer.from('NOT_AN_IMAGE_OR_PDF_RANDOM_TEXT_BYTES');
      const callsBefore = putMock.mock.calls.length;

      await authA(http().post(`/api/v1/items/${item.id}/photos`))
        .set('Upload-Id', randomUUID())
        .attach('photos', fakeCorruptBytes, {
          filename: 'corrupt.jpg',
          contentType: 'image/jpeg',
        })
        .expect(201)
        .then((res) => {
          expect(res.body.results[0]!.error).toBe('PHOTO_FORMAT_MISMATCH');
        });

      // Storage put should not have been called for this corrupt file
      expect(putMock.mock.calls.length).toBe(callsBefore);
    });
  });

  describe('Desire conversion idempotency and boundary failures', () => {
    it('returns identical result on idempotent replay and rejects conflicting command retry', async () => {
      const desire = await createDesire();
      const reviewEvent = await reviewDesire(desire.id, desire.revision, 'bought');

      const commandId = randomUUID();
      const conversionPayload = {
        commandId,
        boughtEventId: reviewEvent.id,
        copyPhoto: false,
        item: {
          name: 'Converted Kitchen Appliance',
          currency: 'INR',
          ownershipStatus: 'owned',
          acquisitionType: 'bought',
          condition: 'working',
          useFrequency: 'often',
          pricePaid: { state: 'known', minor: '250000' },
          purchaseDate: { precision: 'exact', year: 2026, month: 3, day: 15 },
        },
      };

      // First conversion
      const firstRes = await authA(http().post(`/api/v1/desires/${desire.id}/conversion`))
        .send(conversionPayload)
        .expect(201);
      const firstBody = firstRes.body as DesireConversionDto;
      expect(firstBody.itemId).toBeDefined();

      // Idempotent replay with exact same commandId and payload
      const replayRes = await authA(http().post(`/api/v1/desires/${desire.id}/conversion`))
        .send(conversionPayload)
        .expect(201);
      expect(replayRes.body).toEqual(firstBody);

      // Verify that no second item was created in the database
      const itemRows = (
        await run.migration.query(
          "SELECT id FROM items WHERE owner_id=$1 AND name='Converted Kitchen Appliance'",
          [ownerA],
        )
      ).rows;
      expect(itemRows).toHaveLength(1);

      // Conflicting retry with the same commandId but different name
      const conflictingPayload = {
        ...conversionPayload,
        item: {
          ...conversionPayload.item,
          name: 'Conflicting Name In Reused Command',
        },
      };

      const conflictRes = await authA(http().post(`/api/v1/desires/${desire.id}/conversion`))
        .send(conflictingPayload)
        .expect(409);
      expect(conflictRes.body.message).toBe('CONVERSION_COMMAND_REUSED');
    });

    it('rejects conversion on a desire that is not in bought state', async () => {
      // Create desire in default 'considering' state
      const desire = await createDesire();
      const fakeBoughtEventId = randomUUID();

      const res = await authA(http().post(`/api/v1/desires/${desire.id}/conversion`))
        .send({
          commandId: randomUUID(),
          boughtEventId: fakeBoughtEventId,
          copyPhoto: false,
          item: {
            name: 'Premature Conversion Item',
            currency: 'INR',
            ownershipStatus: 'owned',
            acquisitionType: 'bought',
            condition: 'working',
            useFrequency: 'often',
            pricePaid: { state: 'unknown' },
            purchaseDate: { precision: 'unknown' },
          },
        })
        .expect(409);

      expect(res.body.message).toBe('DESIRE_NOT_BOUGHT');

      // Verify no item was created
      const itemRows = (
        await run.migration.query(
          "SELECT id FROM items WHERE owner_id=$1 AND name='Premature Conversion Item'",
          [ownerA],
        )
      ).rows;
      expect(itemRows).toHaveLength(0);
    });

    it('rejects cross-owner or non-existent conversion attempts with 404 and unauthenticated with 401', async () => {
      const nonExistentDesireId = randomUUID();

      // Authenticated user attempting to convert non-existent / foreign desire returns 404
      await authA(http().post(`/api/v1/desires/${nonExistentDesireId}/conversion`))
        .send({
          commandId: randomUUID(),
          boughtEventId: randomUUID(),
          copyPhoto: false,
          item: {
            name: 'Foreign Conversion Item',
            currency: 'INR',
            ownershipStatus: 'owned',
            acquisitionType: 'bought',
            condition: 'working',
            useFrequency: 'often',
            pricePaid: { state: 'unknown' },
            purchaseDate: { precision: 'unknown' },
          },
        })
        .expect(404);

      // Unauthenticated conversion attempt returns 401
      await http()
        .post(`/api/v1/desires/${nonExistentDesireId}/conversion`)
        .send({
          commandId: randomUUID(),
          boughtEventId: randomUUID(),
          copyPhoto: false,
          item: {
            name: 'Unauthenticated Item',
            currency: 'INR',
            ownershipStatus: 'owned',
            acquisitionType: 'bought',
            condition: 'working',
            useFrequency: 'often',
            pricePaid: { state: 'unknown' },
            purchaseDate: { precision: 'unknown' },
          },
        })
        .expect(401);
    });
  });

  describe('Desire review and reminder scheduling idempotency and boundary failures', () => {
    it('returns identical result on review replay and rejects conflicting retry or stale revision', async () => {
      const desire = await createDesire();
      const commandId = randomUUID();
      const reviewAt = new Date(Date.now() + 86400000 * 7).toISOString();

      const delayPayload = {
        commandId,
        revision: desire.revision,
        outcome: 'delayed',
        reviewAt,
      };

      // First review
      const firstRes = await authA(http().post(`/api/v1/desires/${desire.id}/reviews`))
        .send(delayPayload)
        .expect(201);
      const firstEventId = firstRes.body.id;
      expect(firstEventId).toBeDefined();

      // Idempotent replay with same commandId and payload
      const replayRes = await authA(http().post(`/api/v1/desires/${desire.id}/reviews`))
        .send(delayPayload)
        .expect(201);
      expect(replayRes.body.id).toBe(firstEventId);

      // Verify only 1 review event row exists
      const eventCount = (
        await run.migration.query(
          'SELECT count(*)::int as count FROM desire_review_events WHERE desire_id=$1',
          [desire.id],
        )
      ).rows[0]!.count;
      expect(eventCount).toBe(1);

      // Conflicting retry with same commandId but different outcome
      const conflictingPayload = {
        ...delayPayload,
        outcome: 'declined',
      };
      const conflictRes = await authA(http().post(`/api/v1/desires/${desire.id}/reviews`))
        .send(conflictingPayload)
        .expect(409);
      expect(conflictRes.body.message).toBe('REVIEW_COMMAND_REUSED');

      // Submitting review with stale revision (desire is now at revision 2)
      const staleRes = await authA(http().post(`/api/v1/desires/${desire.id}/reviews`))
        .send({
          commandId: randomUUID(),
          revision: 1, // Stale!
          outcome: 'declined',
        })
        .expect(409);
      expect(staleRes.body.message).toBe('STALE_DESIRE_REVISION');
    });
  });

  describe('Goal contributions and allocations boundary failures and idempotency', () => {
    it('supports idempotent contribution replay and rejects conflicting command retry', async () => {
      const goalRes = await authA(http().post('/api/v1/goals'))
        .send({
          name: 'Vacation Savings',
          currency: 'INR',
          targetMinor: '10000000',
        })
        .expect(201);
      const goal = goalRes.body as GoalDto;

      const commandId = randomUUID();
      const contributionPayload = {
        commandId,
        revision: goal.revision,
        kind: 'contribution',
        amountMinor: '2500000',
        currency: 'INR',
        note: 'Savings from bonus',
      };

      // First contribution
      const firstRes = await authA(http().post(`/api/v1/goals/${goal.id}/contributions`))
        .send(contributionPayload)
        .expect(201);
      const firstContrib = firstRes.body as ContributionDto;
      expect(firstContrib.id).toBeDefined();
      expect(firstContrib.sequence).toBe(2);

      // Idempotent replay
      const replayRes = await authA(http().post(`/api/v1/goals/${goal.id}/contributions`))
        .send(contributionPayload)
        .expect(201);
      expect(replayRes.body.id).toBe(firstContrib.id);
      expect(replayRes.body.sequence).toBe(firstContrib.sequence);

      // Verify single contribution in ledger
      const ledgerCount = (
        await run.migration.query(
          'SELECT count(*)::int as count FROM goal_contributions WHERE goal_id=$1',
          [goal.id],
        )
      ).rows[0]!.count;
      expect(ledgerCount).toBe(1);

      // Conflicting retry with different amount
      const conflictingPayload = {
        ...contributionPayload,
        amountMinor: '3000000',
      };
      const conflictRes = await authA(http().post(`/api/v1/goals/${goal.id}/contributions`))
        .send(conflictingPayload)
        .expect(409);
      expect(conflictRes.body.message).toBe('CONTRIBUTION_COMMAND_REUSED');
    });

    it('rejects cross-currency contribution and contribution to archived goal', async () => {
      const goalRes = await authA(http().post('/api/v1/goals'))
        .send({
          name: 'Home Renovation',
          currency: 'INR',
          targetMinor: '50000000',
        })
        .expect(201);
      const goal = goalRes.body as GoalDto;

      // Currency mismatch (USD vs INR)
      const currencyMismatchRes = await authA(http().post(`/api/v1/goals/${goal.id}/contributions`))
        .send({
          commandId: randomUUID(),
          revision: goal.revision,
          kind: 'contribution',
          amountMinor: '50000',
          currency: 'USD',
        })
        .expect(409);
      expect(currencyMismatchRes.body.message).toBe('GOAL_CURRENCY_MISMATCH');

      // Archive the goal
      await authA(http().patch(`/api/v1/goals/${goal.id}`))
        .send({
          revision: goal.revision,
          status: 'archived',
        })
        .expect(200);

      const archivedGoal = (await authA(http().get(`/api/v1/goals/${goal.id}`)).expect(200))
        .body as GoalDto;

      // Contribution to archived goal must be rejected
      const archivedRes = await authA(http().post(`/api/v1/goals/${goal.id}/contributions`))
        .send({
          commandId: randomUUID(),
          revision: archivedGoal.revision,
          kind: 'contribution',
          amountMinor: '100000',
          currency: 'INR',
        })
        .expect(409);
      expect(archivedRes.body.message).toBe('GOAL_ARCHIVED');
    });
  });
});
