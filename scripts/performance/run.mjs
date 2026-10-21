import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile, readFile, access } from 'node:fs/promises';
import { tmpdir, cpus, totalmem, platform, arch } from 'node:os';
import { resolve, join } from 'node:path';
import { options, validateReport, assertFreePorts } from './core.mjs';
import { refuseEnvFiles, cleanEnvironment, fingerprint } from './build.mjs';
const root = resolve(import.meta.dirname, '../..');
const config = options(process.argv.slice(2));
// There is deliberately no configurable network target or credential input.
const env = { ...cleanEnvironment(), NODE_ENV: 'test' };
let directory,
  postgresStarted = false,
  worker,
  interrupted = false,
  result;
function command(bin, args) {
  try {
    return execFileSync(bin, args, { env, cwd: root, stdio: 'pipe', timeout: 30000 })
      .toString()
      .trim();
  } catch (error) {
    console.error('Isolated command failed: ' + bin + ' status=' + (error.status ?? error.code));
    throw new Error('Isolated command failure');
  }
}
for (const signal of ['SIGINT', 'SIGTERM'])
  process.once(signal, () => {
    interrupted = true;
    worker?.kill('SIGTERM');
  });
try {
  await refuseEnvFiles();
  await assertFreePorts([55494, 3194, 3195]);
  const sha = command('git', ['rev-parse', 'HEAD']);
  const buildId = await readFile(join(root, 'apps/web/.next/BUILD_ID'), 'utf8');
  const apiBuild = await readFile(join(root, 'apps/api/dist/main.js'), 'utf8');
  if (!buildId.trim() || !apiBuild) throw new Error('Production builds required');
  const provenance = JSON.parse(
    await readFile(join(root, 'apps/web/.next/per94-build.json'), 'utf8'),
  );
  if (
    provenance.runtimeFingerprint !== (await fingerprint()) ||
    provenance.buildId !== buildId.trim()
  )
    throw new Error('Production builds required');
  const pgVersion = command('postgres', ['--version']);
  directory = await mkdtemp(join(tmpdir(), 'havefolio-per94-'));
  await writeFile(join(directory, 'PER-94-owned'), 'disposable\n', { mode: 0o600 });
  command('initdb', ['-D', join(directory, 'pg'), '-A', 'trust', '--no-locale', '--encoding=UTF8']);
  command('pg_ctl', [
    '-D',
    join(directory, 'pg'),
    '-l',
    join(directory, 'postgres.log'),
    '-o',
    `-h 127.0.0.1 -p 55494 -k ${directory}`,
    '-w',
    'start',
  ]);
  postgresStarted = true;
  const metadata = {
    measuredAt: new Date().toISOString(),
    ...provenance,
    harnessSha: sha,
    sourceDirty: Boolean(command('git', ['status', '--porcelain'])),
    buildId: buildId.trim(),
    node: process.version,
    postgres: pgVersion,
    platform: platform(),
    arch: arch(),
    cpu: cpus()[0]?.model ?? 'unknown',
    logicalCpus: cpus().length,
    memoryGiB: Math.round(totalmem() / 2 ** 30),
    config,
  };
  // Only fixed environment and our own metadata cross into the harness.
  worker = spawn(process.execPath, ['scripts/performance-baseline.mjs'], {
    cwd: join(root, 'apps/api'),
    env: { ...env, PER94_DIRECTORY: directory, PER94_METADATA: JSON.stringify(metadata) },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  let pending = '';
  worker.stdout.on('data', (data) => {
    pending += data.toString();
    const lines = pending.split('\n');
    pending = lines.pop();
    for (const line of lines) if (/^(PASS:|FAIL:|Measured )/.test(line)) console.log(line);
  });
  const watchdog = setTimeout(
    () => {
      interrupted = true;
      worker.kill('SIGTERM');
    },
    30 * 60 * 1000,
  );
  const code = await new Promise((resolve) => {
    worker.once('exit', resolve);
    worker.once('error', () => resolve(1));
  });
  clearTimeout(watchdog);
  if (code !== 0 || interrupted) throw new Error('Measurement failed');
  result = validateReport(JSON.parse(await readFile(join(directory, 'result.json'), 'utf8')));
} catch (error) {
  // Only our bounded diagnostic; never print subprocess stdout/stderr or connection settings.
  console.error(
    `PER-94 stopped: ${error instanceof Error && ['Environment file present; use a clean worktree', 'Production builds required', 'Measurement failed'].includes(error.message) ? error.message : 'isolated setup or artifact failure'}`,
  );
  process.exitCode = 1;
} finally {
  if (postgresStarted) {
    try {
      command('pg_ctl', ['-D', join(directory, 'pg'), '-m', 'fast', '-w', 'stop']);
    } catch {
      console.error('FAIL: isolated PostgreSQL cleanup requires attention');
      process.exitCode = 1;
    }
  }
  if (directory) {
    try {
      await access(join(directory, 'pg/postmaster.pid'));
      console.error('FAIL: retained isolated cluster; cleanup required');
      process.exitCode = 1;
    } catch {
      await rm(directory, { recursive: true, force: true });
      console.log('PASS: disposable cluster and scratch artifacts removed');
    }
  }
}

if (result && !process.exitCode) {
  result.clusterCleanup = true;
  await writeFile(
    join(root, 'docs/testing/per-94-baseline.json'),
    JSON.stringify(result, null, 2) + '\n',
  );
  console.log('PASS: validated numerical baseline published after verified cleanup');
}
