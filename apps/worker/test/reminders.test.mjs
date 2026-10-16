import assert from 'node:assert/strict';
import test from 'node:test';
import pino from 'pino';
import { EventLogger } from '@havefolio/logging';
import { RemindersProcessor } from '../dist/reminders/reminders.processor.js';
import { NtfyNotifierService } from '../dist/reminders/ntfy-notifier.service.js';

const silentLogger = () => new EventLogger(pino({ level: 'silent' }));

test('reminder processor delivers a valid bounded payload without creating domain decisions', async () => {
  const calls = [];
  const repository = {
    deliver: async (intent) => {
      calls.push(intent);
      return { status: 'delivered', notificationId: 'a0000000-0000-4000-8000-000000000001' };
    },
  };
  const delivered = [];
  const processor = new RemindersProcessor(
    repository,
    { deliver: async (id) => delivered.push(id) },
    silentLogger(),
  );
  const data = {
    desireId: 'd0000000-0000-4000-8000-000000000001',
    scheduleVersion: 2,
    scheduledFor: '2026-10-23T10:00:00.000Z',
  };

  await processor.process({
    id: 'desire-reminder-d0000000-0000-4000-8000-000000000001-2',
    name: 'desire.wait-ended',
    data,
    attemptsMade: 0,
    opts: { attempts: 5 },
  });

  assert.deepEqual(calls, [
    {
      desireId: data.desireId,
      scheduleVersion: 2,
      scheduledFor: new Date(data.scheduledFor),
    },
  ]);
  assert.deepEqual(delivered, ['a0000000-0000-4000-8000-000000000001']);
});

test('ntfy delivery uses fixed copy and never includes identifiers or private desire content', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (input, init) => {
    requests.push({ input, init });
    return { ok: true };
  };
  const marks = [];
  const repository = {
    claimNtfy: async () => true,
    markNtfySent: async (id) => marks.push(['sent', id]),
    markNtfyFailed: async (id) => marks.push(['failed', id]),
  };
  const environment = {
    NTFY_ENABLED: true,
    NTFY_ENDPOINT: 'http://ntfy.example.test/havefolio',
    NTFY_TOKEN: 'protected-fixture',
  };
  const notifier = new NtfyNotifierService(environment, repository, silentLogger());
  const notificationId = 'a0000000-0000-4000-8000-000000000001';
  try {
    await notifier.deliver(notificationId);
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(requests.length, 1);
  assert.equal(requests[0].init.body, 'A waiting period is ready for review in Havefolio.');
  assert.ok(!JSON.stringify(requests).includes(notificationId));
  assert.deepEqual(marks, [['sent', notificationId]]);
});
