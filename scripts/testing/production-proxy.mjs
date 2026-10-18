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
      if (body.length > 2048) throw new Error('Synthetic request exceeded limit');
    }
    const isJson = req.headers['content-type'] === 'application/json';
    const isMultipart =
      typeof req.headers['content-type'] === 'string' &&
      req.headers['content-type'].startsWith('multipart/form-data');
    let action = undefined;
    if (body && isJson) {
      try {
        action = JSON.parse(body).action;
      } catch {
        action = undefined;
      }
    }
    const authenticated = req.headers.cookie === session;
    const allowed = !req.headers.origin || req.headers.origin === origin;
    // Only booleans and public route/method metadata survive this request handler.
    records.push({
      method: req.method,
      path: url.pathname,
      query: url.search === '?probe=one&probe=two',
      notificationQuery:
        url.search === '?limit=10&unreadOnly=true&after=synthetic%2Bcursor%2Fvalue',
      readBody: body === '{}',
      authenticated,
      allowed,
      originMatches: req.headers.origin === origin,
      json: isJson,
      multipart: isMultipart,
      skip: body === '{"action":"skip"}',
      hasUploadId: Boolean(req.headers['upload-id']),
      multipartBodyReceived: isMultipart && body.includes('sample-file-content'),
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
            : url.pathname === '/api/v1/desires'
              ? { items: [], hasMore: false, nextCursor: null }
              : url.pathname.startsWith('/api/v1/desires')
                ? { id: 'synthetic-desire', name: 'Synthetic desire', revision: 1 }
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
  for (const domain of ['onboarding', 'desires', 'notifications', 'goals', 'home']) {
    if (!process.argv.includes(`--without-${domain}`)) continue;
    const config = join(app, 'next.config.ts');
    const source = await readFile(config, 'utf8');
    const entry = `'${domain}',`;
    assert(source.includes(entry), 'Mutation requires the fixed allowlist');
    await writeFile(config, source.replace(entry, ''));
  }
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  const serverSecrets = Object.fromEntries(
    ['AUTH_RATE_KEY_SECRET', 'CLOUDINARY_API_SECRET', 'KAN_API_KEY', 'SENTRY_AUTH_TOKEN'].map(
      (key) => [key, randomBytes(32).toString('hex')],
    ),
  );
  const env = {
    ...serverSecrets,
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
      const source = await readFile(join(app, '.next/static', file), 'utf8');
      assert(
        !source.includes(env.NEXT_PUBLIC_API_BASE_URL),
        'Internal API address must not enter browser bundles',
      );
      assert(
        Object.values(serverSecrets).every((secret) => !source.includes(secret)),
        'Server credentials must not enter browser bundles',
      );
    }
  }
  console.log(
    'PASS: disposable production Next build, private upstream address and server credentials',
  );
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
  const anonymousGoals = await request('/api/v1/goals?limit=25');
  assert.equal(anonymousGoals.status, 401, 'Anonymous goals must reach the API, not a Next 404');
  assert.match(anonymousGoals.headers.get('content-type') ?? '', /^application\/json\b/);
  const notificationQuery = '?limit=10&unreadOnly=true&after=synthetic%2Bcursor%2Fvalue';
  const anonymousNotifications = await request('/api/v1/notifications' + notificationQuery);
  assert.equal(
    anonymousNotifications.status,
    401,
    'Anonymous notifications must reach the API, not a Next 404',
  );
  assert.match(anonymousNotifications.headers.get('content-type') ?? '', /^application\/json\b/);
  assert.deepEqual(await anonymousNotifications.json(), {
    code: 'AUTH_REQUIRED',
    message: 'Sign in required',
  });
  assert.equal(anonymousNotifications.headers.get('cache-control'), 'no-store');
  assert.equal(records.at(-1).notificationQuery, true, 'Notification collection query preserved');
  for (const [method, path, body] of [
    ['GET', '/api/v1/notifications' + notificationQuery],
    // The API consumes no body; a nonempty JSON payload proves transport preservation only.
    ['PATCH', '/api/v1/notifications/3fa85f64-5717-4562-b3fc-2c963f66afa6/read', '{}'],
  ]) {
    const response = await request(path, { method, headers, body });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const metadata = records.at(-1);
    assert.equal(metadata.method, method);
    assert.equal(metadata.path, path.split('?')[0]);
    assert(
      metadata.authenticated && metadata.originMatches && metadata.json,
      'Cookie, origin and JSON content type preserved on notification endpoints',
    );
    if (method === 'GET') assert(metadata.notificationQuery, 'Collection query preserved');
    if (body) assert(metadata.readBody, 'Mark-read JSON body preserved exactly');
  }
  console.log('PASS: notifications anonymous JSON 401, collection query and PATCH transport');
  const anonymousHome = await request('/api/v1/home');
  assert.equal(
    anonymousHome.status,
    401,
    'Anonymous Home summary must reach the API, not a Next 404',
  );
  assert.equal(anonymousHome.headers.get('cache-control'), 'no-store');
  const home = await request('/api/v1/home', { headers });
  assert.equal(home.status, 200);
  assert.equal(records.at(-1).path, '/api/v1/home');
  assert(records.at(-1).authenticated, 'Owner cookie preserved for the Home summary');
  console.log('PASS: Home summary anonymous 401 and authenticated same-origin transport');
  const anonymousMerchants = await request('/api/v1/merchants?probe=one&probe=two');
  assert.equal(anonymousMerchants.status, 401, 'Anonymous merchants reach the API');
  assert.equal(anonymousMerchants.headers.get('cache-control'), 'no-store');
  assert.equal(records.at(-1).query, true);
  for (const [method, path, body] of [
    ['GET', '/api/v1/merchants?probe=one&probe=two'],
    ['POST', '/api/v1/merchants', '{"displayName":"Synthetic seller"}'],
    ['GET', '/api/v1/merchants/3fa85f64-5717-4562-b3fc-2c963f66afa6'],
    ['PATCH', '/api/v1/merchants/3fa85f64-5717-4562-b3fc-2c963f66afa6', '{"state":"retired"}'],
  ]) {
    const response = await request(path, { method, headers, body });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(records.at(-1).method, method);
    assert.equal(records.at(-1).path, path.split('?')[0]);
    assert(records.at(-1).authenticated && records.at(-1).originMatches && records.at(-1).json);
  }
  console.log('PASS: merchant collection query, owner cookie, POST and PATCH production transport');
  const anonymousDesires = await request('/api/v1/desires?probe=one&probe=two');
  assert.equal(
    anonymousDesires.status,
    401,
    'Anonymous desires must reach the API, not a Next 404',
  );
  assert.deepEqual(await anonymousDesires.json(), {
    code: 'AUTH_REQUIRED',
    message: 'Sign in required',
  });
  assert.equal(anonymousDesires.headers.get('cache-control'), 'no-store');
  assert.equal(records.at(-1).query, true, 'Query string preserved on desires');
  for (const [method, path, body] of [
    ['GET', '/api/v1/goals'],
    ['GET', '/api/v1/goals/3fa85f64-5717-4562-b3fc-2c963f66afa6/contributions'],
    ['POST', '/api/v1/goals/3fa85f64-5717-4562-b3fc-2c963f66afa6/contributions', '{}'],
    ['GET', '/api/v1/desires/3fa85f64-5717-4562-b3fc-2c963f66afa6/allocation'],
    ['GET', '/api/v1/desires/3fa85f64-5717-4562-b3fc-2c963f66afa6/allocation/history'],
    ['POST', '/api/v1/desires/3fa85f64-5717-4562-b3fc-2c963f66afa6/allocation', '{}'],
    ['GET', '/api/v1/desires'],
    ['POST', '/api/v1/desires', '{"name":"Synthetic desire"}'],
    ['GET', '/api/v1/desires/3fa85f64-5717-4562-b3fc-2c963f66afa6'],
    [
      'PATCH',
      '/api/v1/desires/3fa85f64-5717-4562-b3fc-2c963f66afa6',
      '{"revision":1,"name":"Updated"}',
    ],
    ['DELETE', '/api/v1/desires/3fa85f64-5717-4562-b3fc-2c963f66afa6', '{"revision":1}'],
    ['GET', '/api/v1/desires/3fa85f64-5717-4562-b3fc-2c963f66afa6/reviews'],
    [
      'POST',
      '/api/v1/desires/3fa85f64-5717-4562-b3fc-2c963f66afa6/reviews',
      '{"commandId":"e3ba903a-b211-4cf4-aad0-ce3a312975ea","revision":1,"outcome":"declined"}',
    ],
    ['GET', '/api/v1/desires/3fa85f64-5717-4562-b3fc-2c963f66afa6/conversion'],
    [
      'POST',
      '/api/v1/desires/3fa85f64-5717-4562-b3fc-2c963f66afa6/conversion',
      '{"commandId":"e3ba903a-b211-4cf4-aad0-ce3a312975ea","boughtEventId":"9b2f4c2e-3c1d-4d55-9a83-5a6d2d1b8c11","copyPhoto":false}',
    ],
    ['POST', '/api/v1/desires/3fa85f64-5717-4562-b3fc-2c963f66afa6/conversion/photo'],
    ['GET', '/api/v1/desires/3fa85f64-5717-4562-b3fc-2c963f66afa6/photo'],
    ['GET', '/api/v1/desires/3fa85f64-5717-4562-b3fc-2c963f66afa6/photo/content/thumbnail'],
    ['DELETE', '/api/v1/desires/3fa85f64-5717-4562-b3fc-2c963f66afa6/photo', '{"revision":1}'],
  ]) {
    const response = await request(path, { method, headers, body });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const metadata = records.at(-1);
    assert.equal(metadata.method, method);
    assert.equal(metadata.path, path);
    assert(
      metadata.authenticated && metadata.originMatches && metadata.json,
      'Cookie, origin and JSON content type preserved on desire endpoints',
    );
  }
  const photoForm = new FormData();
  photoForm.append('photo', new Blob(['sample-file-content'], { type: 'image/jpeg' }), 'test.jpg');
  const multipartRes = await request('/api/v1/desires/3fa85f64-5717-4562-b3fc-2c963f66afa6/photo', {
    method: 'POST',
    headers: {
      Cookie: session,
      Origin: origin,
      'Upload-Id': '11111111-2222-4333-8444-555555555555',
    },
    body: photoForm,
  });
  assert.equal(multipartRes.status, 200);
  assert.equal(multipartRes.headers.get('cache-control'), 'no-store');
  const photoRecord = records.at(-1);
  assert.equal(photoRecord.method, 'POST');
  assert.equal(photoRecord.path, '/api/v1/desires/3fa85f64-5717-4562-b3fc-2c963f66afa6/photo');
  assert(photoRecord.multipart, 'Multipart content type preserved through Next.js proxy');
  assert(photoRecord.hasUploadId, 'Upload-Id header preserved');
  assert(photoRecord.multipartBodyReceived, 'Multipart body reached upstream through proxy');
  assert(
    photoRecord.authenticated && photoRecord.originMatches,
    'Cookie and origin preserved for multipart desire photo',
  );
  for (const domain of [
    'auth',
    'taxonomy',
    'merchants',
    'items',
    'spending',
    'health',
    'onboarding',
    'desires',
    'notifications',
    'goals',
    'home',
    'settings',
  ]) {
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
