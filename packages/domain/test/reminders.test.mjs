import assert from 'node:assert/strict';
import test from 'node:test';
import { desireReminderJobId, isDesireReminderJobData } from '../dist/reminders.js';

test('reminder jobs use stable bounded IDs and strictly validated data', () => {
  const desireId = 'd0000000-0000-4000-8000-000000000001';
  assert.equal(
    desireReminderJobId(desireId, 7),
    'desire-reminder-d0000000-0000-4000-8000-000000000001-7',
  );
  assert.equal(
    isDesireReminderJobData({
      desireId,
      scheduleVersion: 7,
      scheduledFor: '2026-10-23T10:00:00.000Z',
    }),
    true,
  );
  assert.equal(
    isDesireReminderJobData({
      desireId,
      scheduleVersion: 0,
      scheduledFor: 'private-content',
    }),
    false,
  );
  assert.throws(() => desireReminderJobId('../private', 1));
});
