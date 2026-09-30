import assert from 'node:assert/strict';
import { test } from 'node:test';
import { IntegrationRun, integrationConfiguration } from '../dist/index.js';

const settings = {
  TEST_MIGRATION_DATABASE_URL: 'postgresql://migration:placeholder@localhost/isolation_test',
  TEST_DATABASE_URL: 'postgresql://runtime:placeholder@localhost/isolation_test',
  TEST_VALKEY_HOST: 'localhost',
  TEST_VALKEY_PORT: '6379',
  TEST_VALKEY_USERNAME: 'test',
  TEST_VALKEY_PASSWORD: 'placeholder',
};

test('rejects unsafe service boundaries without leaking connection settings', () => {
  for (const overrides of [
    { TEST_DATABASE_URL: settings.TEST_MIGRATION_DATABASE_URL },
    { TEST_MIGRATION_DATABASE_URL: 'postgresql://migration:private@localhost/production' },
    { TEST_DATABASE_URL: 'postgresql://runtime:private@other-host/isolation_test' },
    { TEST_DATABASE_URL: settings.TEST_DATABASE_URL + '?options=unsafe' },
    { TEST_VALKEY_PASSWORD: '' },
  ]) {
    assert.throws(
      () => integrationConfiguration({ ...settings, ...overrides }),
      (error) => {
        assert.ok(!error.message.includes('private'));
        return true;
      },
    );
  }
});

test('independent runs allocate safe unique namespaces and reject escaped keys', async () => {
  const a = new IntegrationRun(integrationConfiguration(settings));
  const b = new IntegrationRun(integrationConfiguration(settings));
  assert.match(a.schema, /^hf_test_[a-f0-9]{32}$/);
  assert.notEqual(a.schema, b.schema);
  assert.notEqual(a.prefix, b.prefix);
  await assert.rejects(a.setKey('../outside', 'value'), /Invalid test key/);
  await Promise.all([a.close(), b.close()]);
});
