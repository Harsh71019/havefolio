import assert from 'node:assert/strict';
import test from 'node:test';
import { validateWorkerEnvironment } from '../../packages/config/dist/index.js';

const configured = {
  NODE_ENV: 'test',
  WORKER_QUEUE_ENABLED: true,
  VALKEY_USERNAME: 'havefolio_test_worker',
  VALKEY_PASSWORD: 'test-placeholder',
  VALKEY_PREFIX: 'havefolio:test:run_123',
};

test('queue prefix preserves the Havefolio namespace and selected environment', () => {
  assert.equal(validateWorkerEnvironment(configured).VALKEY_PREFIX, configured.VALKEY_PREFIX);
  for (const prefix of [
    'bull',
    'treasury_ops',
    'havefolio',
    'havefolio:*',
    'havefolio:production',
  ]) {
    assert.throws(() => validateWorkerEnvironment({ ...configured, VALKEY_PREFIX: prefix }));
  }
});

test('enabled queues require dedicated worker credentials and database zero', () => {
  for (const change of [
    { VALKEY_USERNAME: 'default' },
    { VALKEY_USERNAME: 'havefolio_test_api' },
    { VALKEY_PASSWORD: '' },
    { VALKEY_DATABASE: 1 },
    { VALKEY_HOST: '127.0.0.1' },
  ]) {
    assert.throws(() => validateWorkerEnvironment({ ...configured, ...change }));
  }
  assert.equal(validateWorkerEnvironment({}).WORKER_QUEUE_ENABLED, false);
});
