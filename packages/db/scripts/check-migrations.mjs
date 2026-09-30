import { mkdtemp, cp, rm, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import config from '../drizzle.config.ts';

// Compare against committed snapshots in a disposable directory: never mutate history.
async function inventory(directory, prefix = '') {
  const entries = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const name = join(prefix, item.name);
    if (item.isDirectory()) entries.push(...(await inventory(join(directory, item.name), name)));
    else entries.push([name, await readFile(join(directory, item.name), 'utf8')]);
  }
  return entries.sort(([a], [b]) => a.localeCompare(b));
}
const temporary = await mkdtemp(join(tmpdir(), 'havefolio-migrations-'));
try {
  const before = await inventory('migrations');
  const base = process.env.MIGRATION_BASE_REF;
  if (base) {
    const history = spawnSync('git', ['diff', '--name-status', base, '--', 'migrations'], {
      encoding: 'utf8',
    });
    if (
      history.status !== 0 ||
      history.stdout
        .split('\n')
        .some((line) => line && !line.startsWith('A\t') && !line.endsWith('meta/_journal.json'))
    ) {
      throw new Error('Existing migration SQL/snapshots are immutable; add a forward migration.');
    }
    const previous = spawnSync(
      'git',
      ['show', `${base}:packages/db/migrations/meta/_journal.json`],
      { encoding: 'utf8' },
    );
    if (previous.status === 0) {
      const journal = JSON.parse(await readFile('migrations/meta/_journal.json', 'utf8'));
      const entries = JSON.parse(previous.stdout).entries;
      if (JSON.stringify(entries) !== JSON.stringify(journal.entries.slice(0, entries.length))) {
        throw new Error('Existing migration journal entries are immutable.');
      }
    }
  }
  await cp('migrations', temporary, { recursive: true });
  const result = spawnSync(
    'pnpm',
    [
      'exec',
      'drizzle-kit',
      'generate',
      '--dialect',
      config.dialect,
      '--schema',
      config.schema,
      '--out',
      temporary,
      '--name',
      'drift_check',
    ],
    {
      stdio: 'pipe',
      encoding: 'utf8',
    },
  );
  if (
    result.status !== 0 ||
    JSON.stringify(before) !== JSON.stringify(await inventory(temporary))
  ) {
    throw new Error('Schema drift: generate and commit a reviewed forward migration.');
  }
  const tracked = spawnSync('git', ['ls-files', '--others', '--exclude-standard', 'migrations'], {
    encoding: 'utf8',
  });
  const changed = spawnSync('git', ['diff', '--exit-code', 'HEAD', '--', 'migrations'], {
    stdio: 'pipe',
  });
  if (tracked.status !== 0 || tracked.stdout.trim() || changed.status !== 0) {
    throw new Error('Generated migrations must be committed.');
  }
  const check = spawnSync('pnpm', ['exec', 'drizzle-kit', 'check'], { stdio: 'inherit' });
  if (check.status !== 0) throw new Error('Migration history check failed.');
  console.log('PASS: schema matches committed migration snapshots.');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await rm(temporary, { recursive: true, force: true });
}
