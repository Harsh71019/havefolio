import assert from 'node:assert/strict';
import test from 'node:test';
import {
  validateApiEnvironment,
  validateWorkerEnvironment,
} from '../../packages/config/dist/index.js';

const configured = {
  NODE_ENV: 'test',
  WORKER_QUEUE_ENABLED: true,
  DATABASE_URL:
    'postgresql://havefolio_test_runtime:test-placeholder@shared-postgres:5432/havefolio_test',
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

test('API reminder dispatch requires its dedicated producer identity and namespace', () => {
  const api = {
    NODE_ENV: 'test',
    REMINDER_QUEUE_ENABLED: true,
    VALKEY_USERNAME: 'havefolio_test_api',
    VALKEY_PASSWORD: 'test-placeholder',
    VALKEY_PREFIX: 'havefolio:test:run_123',
  };
  assert.equal(validateApiEnvironment(api).REMINDER_QUEUE_ENABLED, true);
  for (const change of [
    { VALKEY_USERNAME: 'havefolio_test_worker' },
    { VALKEY_PASSWORD: '' },
    { VALKEY_PREFIX: undefined },
    { VALKEY_PREFIX: 'havefolio:production' },
  ]) {
    assert.throws(() => validateApiEnvironment({ ...api, ...change }));
  }
});

test('optional ntfy delivery requires a safe fixed endpoint', () => {
  assert.equal(validateWorkerEnvironment(configured).NTFY_ENABLED, false);
  assert.equal(
    validateWorkerEnvironment({
      ...configured,
      NTFY_ENABLED: true,
      NTFY_ENDPOINT: 'https://ntfy.example.test/havefolio',
    }).NTFY_ENABLED,
    true,
  );
  for (const endpoint of [
    undefined,
    'https://user:secret@ntfy.example.test/havefolio',
    'https://ntfy.example.test/havefolio?token=secret',
    'file:///tmp/ntfy',
  ]) {
    assert.throws(() =>
      validateWorkerEnvironment({
        ...configured,
        NTFY_ENABLED: true,
        NTFY_ENDPOINT: endpoint,
      }),
    );
  }
});

test('LAN HTTP opt-in is exact and limited to private IPv4 origins', () => {
  assert.equal(validateApiEnvironment({}).AUTH_LAN_HTTP_ORIGIN, undefined);
  for (const origin of [
    'http://192.168.0.226:3020',
    'http://10.0.0.1',
    'http://172.16.0.1:3020',
    'http://172.31.255.254:3020',
  ]) {
    assert.equal(
      validateApiEnvironment({ AUTH_LAN_HTTP_ORIGIN: origin }).AUTH_LAN_HTTP_ORIGIN,
      origin,
    );
  }
  for (const origin of [
    'http://8.8.8.8',
    'http://localhost:3020',
    'http://127.0.0.1:3020',
    'http://172.32.0.1',
    'http://192.168.0.226:3020/',
    'http://192.168.0.226:3020/path',
    'http://192.168.0.226:3020?x=1',
    'http://192.168.0.226:3020#x',
    'http://user:password@192.168.0.226:3020',
    'https://192.168.0.226:3020',
    'http://192.168.0.226.example.test:3020',
  ]) {
    assert.throws(() => validateApiEnvironment({ AUTH_LAN_HTTP_ORIGIN: origin }));
  }
});
