import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { constants } from 'node:fs';
import { cp, link, lstat, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

// No operator environment, real sessions, request logging, screenshots, traces or snapshots.
const root = resolve(import.meta.dirname, '../..');
const web = join(root, 'apps/web');
const requireWeb = createRequire(join(web, 'package.json'));
const { chromium } = requireWeb('@playwright/test');

const scratch = await mkdtemp(join(tmpdir(), 'havefolio-proxy-'));
const app = join(scratch, 'apps/web');
const session = `havefolio_proxy_test=${randomBytes(24).toString('hex')}`;
const records = [];
let origin;
let child;
let browser;
let status;
function reset() {
  status = {
    state: 'not_started',
    genuineItemCount: 0,
    demoItemCount: 0,
    browsedStore: false,
    reviewedItem: false,
    triedDemo: false,
    removedDemo: false,
  };
}
reset();
const upstream = createServer((req, res) => {
  void (async () => {
    const url = new URL(req.url, 'http://localhost');
    let body = '';
    for await (const chunk of req) {
      body += chunk;
      if (body.length > 1024) throw new Error('Synthetic request exceeded limit');
    }
    const action = body ? JSON.parse(body).action : undefined;
    const authenticated = req.headers.cookie === session;
    const allowed = !req.headers.origin || req.headers.origin === origin;
    // Only booleans and public route/method metadata survive this request handler.
    records.push({
      method: req.method,
      path: url.pathname,
      query: url.search === '?probe=one&probe=two',
      authenticated,
      allowed,
      originMatches: req.headers.origin === origin,
      json: req.headers['content-type'] === 'application/json',
      skip: body === '{"action":"skip"}',
    });
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    if (!allowed) {
      res.writeHead(403).end(JSON.stringify({ code: 'AUTH_ORIGIN_INVALID' }));
      return;
    }
    if (!authenticated) {
      res
        .writeHead(401)
        .end(JSON.stringify({ code: 'AUTH_REQUIRED', message: 'Sign in required' }));
      return;
    }
    if (url.pathname === '/api/v1/onboarding/actions') {
      if (action === 'skip') status.state = 'skipped';
      if (action === 'revisit') status.state = 'active';
      if (action === 'browse_store') status.browsedStore = true;
    }
    if (url.pathname === '/api/v1/onboarding/demo') {
      status.demoItemCount = req.method === 'DELETE' ? 0 : 6;
      status.triedDemo = true;
      status.removedDemo = req.method === 'DELETE';
    }
    const response = url.pathname.startsWith('/api/v1/onboarding')
      ? status
      : url.pathname === '/api/v1/auth/me'
        ? { id: 'synthetic-owner', displayName: 'Synthetic owner' }
        : url.pathname === '/api/v1/items'
          ? { items: [], hasMore: false, nextCursor: null }
          : url.pathname === '/api/v1/taxonomy'
            ? { categories: [], subcategories: [], tags: [], defaultsSeeded: false }
            : { ok: true };
    res.end(JSON.stringify(response));
  })().catch(() => res.writeHead(400).end(JSON.stringify({ code: 'INVALID_REQUEST' })));
});
function signalChild(signal) {
  if (!child?.pid) return;
  try {
    process.kill(-child.pid, signal);
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
  }
}
async function stopChild() {
  if (!child) return;
  const exited =
    child.exitCode === null && child.signalCode === null ? once(child, 'exit') : Promise.resolve();
  signalChild('SIGTERM');
  const timer = setTimeout(() => signalChild('SIGKILL'), 5000);
  try {
    await exited;
  } finally {
    clearTimeout(timer);
    signalChild('SIGKILL');
  }
}
async function cleanup() {
  try {
    await Promise.allSettled([
      browser?.close(),
      stopChild(),
      (async () => {
        upstream.closeAllConnections();
        if (upstream.listening) await new Promise((done) => upstream.close(done));
      })(),
    ]);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => void cleanup().finally(() => process.exit(1)));
}
try {
  // Preserve the installed workspace layout, including relative pnpm links. A self-contained
  // copy avoids network/store assumptions and standalone tracing outside the disposable tree.
  await cp(root, scratch, {
    recursive: true,
    verbatimSymlinks: true,
    mode: constants.COPYFILE_FICLONE,
    filter: async (path, destination) => {
      if (
        [
          '.git',
          '.next',
          '.pnpm-store',
          'tmp',
          '.cache',
          'test-results',
          'playwright-report',
        ].includes(basename(path)) ||
        basename(path).startsWith('.env')
      )
        return false;
      // Dependency contents are immutable during build/start. Link files, not directories,
      // so relative pnpm links and standalone traces stay inside this workspace.
      if (path.split(sep).includes('node_modules') && (await lstat(path)).isFile()) {
        try {
          await link(path, destination);
          return false;
        } catch (error) {
          if (error.code !== 'EXDEV') throw error;
        }
      }
      return true;
    },
  });
  const nextBin = join(app, 'node_modules/.bin/next');
  // Mutation mode proves the original omission fails; it only changes the disposable source copy.
  if (process.argv.includes('--without-onboarding')) {
    const config = join(app, 'next.config.ts');
    const source = await readFile(config, 'utf8');
    assert(source.includes(", 'onboarding'"), 'Mutation requires the fixed allowlist');
    await writeFile(config, source.replace(", 'onboarding'", ''));
  }
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  const env = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    ...(process.env.PLAYWRIGHT_BROWSERS_PATH
      ? { PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH }
      : {}),
    NODE_ENV: 'production',
    NEXT_TELEMETRY_DISABLED: '1',
    NEXT_PUBLIC_API_BASE_URL: `http://127.0.0.1:${upstream.address().port}/api/v1`,
  };
  // Invoke the same production compiler/config as the web build, in a private disposable tree.
  child = spawn(nextBin, ['build', '--webpack'], {
    cwd: app,
    env,
    detached: true,
    stdio: 'ignore',
    timeout: 180000,
  });
  const [code] = await once(child, 'exit');
  assert.equal(code, 0, 'Disposable production build must succeed (output withheld)');
  for (const file of await readdir(join(app, '.next/static'), { recursive: true })) {
    if (file.endsWith('.js')) {
      assert(
        !(await readFile(join(app, '.next/static', file), 'utf8')).includes(
          env.NEXT_PUBLIC_API_BASE_URL,
        ),
        'Internal API address must not enter browser bundles',
      );
    }
  }
  console.log('PASS: disposable production Next build and private upstream address');
  child = spawn(nextBin, ['start', '--hostname', '127.0.0.1', '--port', '0'], {
    cwd: app,
    env,
    detached: true,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  // Read only the allocated loopback address; never emit child output.
  child.stdout.on('data', (data) => {
    const match = data.toString().match(/http:\/\/127\.0\.0\.1:(\d+)/);
    if (match) origin = match[0];
  });
  for (let attempt = 0; attempt < 600; attempt++) {
    if (child.exitCode !== null) throw new Error('Production Next server exited');
    if (
      origin &&
      (await fetch(origin)
        .then((r) => r.ok)
        .catch(() => false))
    )
      break;
    if (attempt === 599) throw new Error('Production Next server readiness timed out');
    await delay(100);
  }
  async function request(path, options = {}) {
    return fetch(origin + path, { ...options, signal: AbortSignal.timeout(10000) });
  }
  const anonymous = await request('/api/v1/onboarding?probe=one&probe=two');
  assert.equal(anonymous.status, 401, 'Anonymous onboarding must reach the API, not a Next 404');
  assert.deepEqual(await anonymous.json(), { code: 'AUTH_REQUIRED', message: 'Sign in required' });
  assert.equal(anonymous.headers.get('cache-control'), 'no-store');
  assert.equal(records.at(-1).query, true, 'Query string preserved');
  const headers = { Cookie: session, Origin: origin, 'Content-Type': 'application/json' };
  for (const [method, path, body] of [
    ['GET', '/api/v1/onboarding'],
    ['POST', '/api/v1/onboarding/actions', '{"action":"skip"}'],
    ['POST', '/api/v1/onboarding/demo'],
    ['DELETE', '/api/v1/onboarding/demo'],
  ]) {
    const response = await request(path, { method, headers, body });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const metadata = records.at(-1);
    assert.equal(metadata.method, method);
    assert.equal(metadata.path, path);
    assert(
      metadata.authenticated && metadata.originMatches && metadata.json,
      'Cookie, origin and content type preserved',
    );
    if (body) assert(metadata.skip, 'JSON body preserved exactly');
  }
  const denied = await request('/api/v1/onboarding/demo', {
    method: 'POST',
    headers: { ...headers, Origin: 'https://invalid.example' },
  });
  assert.equal(denied.status, 403);
  assert.deepEqual(await denied.json(), { code: 'AUTH_ORIGIN_INVALID' });
  for (const domain of ['auth', 'taxonomy', 'items', 'spending']) {
    assert.equal((await request(`/api/v1/${domain}`, { headers })).status, 200);
    assert.equal(records.at(-1).path, `/api/v1/${domain}`);
  }
  const count = records.length;
  assert.equal((await request('/api/v1/not-allowlisted', { headers })).status, 404);
  assert.equal(records.length, count, 'Unknown domain must never reach upstream');
  console.log(
    'PASS: real HTTP forwarding, safe JSON/status, methods/body/cookie/query/origin/no-store and allowlist',
  );
  reset();
  records.length = 0;
  browser = await chromium.launch();
  const context = await browser.newContext();
  await context.addCookies([
    { name: session.split('=')[0], value: session.split('=')[1], url: origin },
  ]);
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  await page.goto(origin);
  await page.getByRole('heading', { name: 'Make yourself at home' }).waitFor();
  assert(
    records.some((r) => r.method === 'GET' && r.path === '/api/v1/onboarding' && r.authenticated),
    'Existing client status read uses real proxy',
  );
  await page.getByRole('button', { name: 'Skip for now' }).click();
  await page.getByRole('button', { name: 'Revisit welcome help' }).waitFor();
  await page.reload();
  await page.getByRole('button', { name: 'Revisit welcome help' }).click();
  await page.getByRole('heading', { name: 'Make yourself at home' }).waitFor();
  await page.getByRole('button', { name: 'Explore optional demo inventory' }).click();
  await page.getByRole('button', { name: 'Remove all demo data' }).click();
  await page.getByRole('button', { name: 'Remove demos', exact: true }).click();
  await page.getByText('Demo inventory removed. Your genuine items are unchanged.').waitFor();
  assert.equal(status.state, 'active');
  assert.equal(status.demoItemCount, 0);
  assert(status.triedDemo && status.removedDemo);
  assert(
    records
      .filter((r) => r.path.startsWith('/api/v1/onboarding'))
      .every((r) => r.authenticated && r.allowed && (r.method === 'GET' || r.originMatches)),
  );
  console.log(
    'PASS: existing browser client status, skip, revisit, demo opt-in and removal through Next (no interception)',
  );
} finally {
  await cleanup();
}
