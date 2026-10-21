import { execFileSync, spawn } from 'node:child_process';
import { readFile, writeFile, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
export const root = resolve(import.meta.dirname, '../..');
export async function refuseEnvFiles() {
  for (const folder of ['', 'apps/api', 'apps/web']) {
    for (const name of [
      '.env',
      '.env.local',
      '.env.production',
      '.env.production.local',
      '.env.test',
      '.env.test.local',
    ]) {
      try {
        await access(join(root, folder, name));
      } catch {
        continue;
      }
      throw new Error('Environment file present; use a clean worktree');
    }
  }
}
export function cleanEnvironment() {
  const env = Object.fromEntries(
    ['PATH', 'HOME', 'TMPDIR', 'SYSTEMROOT']
      .filter((k) => process.env[k])
      .map((k) => [k, process.env[k]]),
  );
  return {
    ...env,
    LC_ALL: 'C',
    NEXT_TELEMETRY_DISABLED: '1',
    NODE_ENV: 'production',
    LOG_LEVEL: 'fatal',
    SEQ_ENABLED: 'false',
    GLITCHTIP_ENABLED: 'false',
    NEXT_PUBLIC_API_BASE_URL: 'http://127.0.0.1:3194/api/v1',
  };
}
export async function fingerprint() {
  const paths = execFileSync(
    'git',
    [
      'ls-files',
      '-z',
      '--cached',
      '--others',
      '--exclude-standard',
      'apps',
      'packages',
      'package.json',
      'pnpm-lock.yaml',
      'pnpm-workspace.yaml',
      'tsconfig.base.json',
      'scripts/monitoring',
    ],
    { cwd: root },
  )
    .toString()
    .split('\0')
    .filter(Boolean)
    .sort();
  const hash = createHash('sha256');
  for (const path of paths) {
    hash.update(path);
    hash.update('\0');
    hash.update(await readFile(join(root, path)));
    hash.update('\0');
  }
  return hash.digest('hex');
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await refuseEnvFiles();
  const before = await fingerprint();
  const child = spawn('pnpm', ['build'], { cwd: root, env: cleanEnvironment(), stdio: 'inherit' });
  const code = await new Promise((r) => {
    child.once('exit', r);
    child.once('error', () => r(1));
  });
  if (code !== 0 || before !== (await fingerprint()))
    throw new Error('Build failed or sources changed during build');
  await writeFile(
    join(root, 'apps/web/.next/per94-build.json'),
    JSON.stringify({
      sourceSha: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root }).toString().trim(),
      runtimeFingerprint: before,
      buildId: (await readFile(join(root, 'apps/web/.next/BUILD_ID'), 'utf8')).trim(),
      mode: 'production-build',
      apiConfiguration: 'test-with-local-storage-adapter',
    }),
  );
  console.log('PASS: production build provenance recorded');
}
