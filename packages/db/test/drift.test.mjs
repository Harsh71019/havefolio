import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, cp, symlink, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

test('migration gate accepts history and rejects schema drift, tool errors, uncommitted SQL and history edits', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'havefolio-drift-test-'));
  const run = (command, args, environment = {}) =>
    spawnSync(command, args, {
      cwd: directory,
      encoding: 'utf8',
      env: { ...process.env, MIGRATION_BASE_REF: '', ...environment },
    });
  const check = (environment = {}) =>
    run(process.execPath, ['scripts/check-migrations.mjs'], environment);
  try {
    for (const name of ['src', 'migrations', 'scripts', 'drizzle.config.ts', 'package.json']) {
      await cp(name, join(directory, name), { recursive: true });
    }
    await symlink(resolve('node_modules'), join(directory, 'node_modules'), 'dir');
    await writeFile(join(directory, '.gitignore'), 'node_modules/\n');
    for (const args of [
      ['init', '--quiet'],
      ['add', '.'],
      [
        '-c',
        'user.name=Test fixture',
        '-c',
        'user.email=fixture@example.test',
        'commit',
        '--quiet',
        '-m',
        'test(PER-4): snapshot migration gate fixture',
      ],
    ])
      assert.equal(run('git', args).status, 0);
    let result = check({ MIGRATION_BASE_REF: 'HEAD' });
    assert.equal(result.status, 0, result.stdout + result.stderr);

    const schema = join(directory, 'src/schema.ts');
    const original = await readFile(schema, 'utf8');
    await writeFile(
      schema,
      original.replace(
        "value: text('value').notNull(),",
        "value: text('value').notNull(), driftProbe: text('drift_probe'),",
      ),
    );
    result = check();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Schema drift/);
    await writeFile(schema, original);

    // Drizzle can return status zero for some errors; the gate must require successful no-op output.
    await rm(schema);
    result = check();
    assert.notEqual(result.status, 0);
    await writeFile(schema, original);

    const migration = join(directory, 'migrations/0000_foundation.sql');
    const sql = await readFile(migration, 'utf8');
    await writeFile(migration, sql + '\n-- history edit\n');
    result = check({ MIGRATION_BASE_REF: 'HEAD' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /immutable/);
    result = check();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /must be committed/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
