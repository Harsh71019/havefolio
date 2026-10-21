/* global window, requestAnimationFrame, document, innerHeight */
import { primeWarm } from './core.mjs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
const require = createRequire(resolve(import.meta.dirname, '../../apps/web/package.json'));
const { chromium } = require('@playwright/test');
const profiles = [
  {
    name: 'desktop',
    viewport: { width: 1280, height: 720 },
    isMobile: false,
    deviceScaleFactor: 1,
    cpu: 1,
    latency: 0,
    download: -1,
    upload: -1,
  },
  {
    name: 'mobile',
    viewport: { width: 390, height: 844 },
    isMobile: true,
    deviceScaleFactor: 3,
    cpu: 4,
    latency: 150,
    download: 1600000 / 8,
    upload: 750000 / 8,
  },
];
const ready = async (page, route) => {
  if (route === 'home')
    await page.getByRole('heading', { name: 'Recently added', exact: true }).waitFor();
  if (route === 'store')
    await page
      .getByRole('region', { name: 'Your items', exact: true })
      .locator('a[href^="/items/"]')
      .first()
      .waitFor();
  if (route === 'item')
    await page.getByRole('heading', { name: /^Synthetic item/, level: 1 }).waitFor();
  if (route === 'add') await page.getByRole('button', { name: 'Save item', exact: true }).waitFor();
  if (route === 'insights')
    await page.getByRole('heading', { name: 'Recorded spending summary', exact: true }).waitFor();
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
};
export async function browserBaseline({ origin, fixture, runs, metadata }) {
  const browser = await chromium.launch({
    args: ['--proxy-server=http://127.0.0.1:9', '--proxy-bypass-list=127.0.0.1'],
  });
  metadata.browser = browser.version();
  metadata.profiles = profiles;
  const output = [];
  let stage = 'start';
  try {
    for (const profile of profiles.filter(
      (p) => !metadata.config.profile || p.name === metadata.config.profile,
    )) {
      for (let repeat = 0; repeat < runs; repeat++) {
        for (const [route, path] of metadata.config.calibration || metadata.config.route
          ? metadata.config.route
            ? [['store', '/store']]
            : [['home', '/']]
          : [
              ['home', '/'],
              ['store', '/store'],
              ['item', `/items/${fixture.item}`],
              ['add', '/items/new'],
              ['insights', '/insights'],
            ]) {
          const context = await browser.newContext({
            viewport: profile.viewport,
            isMobile: profile.isMobile,
            hasTouch: profile.isMobile,
            deviceScaleFactor: profile.deviceScaleFactor,
            serviceWorkers: 'block',
          });
          // One synthetic session only, in memory. No storage-state file, HAR, trace or screenshots.
          await context.addCookies([
            {
              name: 'havefolio_session',
              value: fixture.token,
              url: origin,
              httpOnly: true,
              sameSite: 'Strict',
            },
          ]);
          // Enforce local-only requests without routing (routing would disable HTTP cache).
          const page = await context.newPage();
          page.setDefaultTimeout(30000);
          const cdp = await context.newCDPSession(page);
          await cdp.send('Network.enable');
          await cdp.send('Network.setBlockedURLs', {
            urls: ['https://*', 'http://localhost:*', 'http://192.*', 'http://10.*'],
          });
          await cdp.send('Emulation.setCPUThrottlingRate', { rate: profile.cpu });
          await cdp.send('Network.emulateNetworkConditions', {
            offline: false,
            latency: profile.latency,
            downloadThroughput: profile.download,
            uploadThroughput: profile.upload,
          });
          await page.addInitScript((enabled) => {
            window.__per94 = { lcpMs: null, longTasks: 0, longTaskMs: 0 };
            if (!enabled) return;
            new PerformanceObserver((list) => {
              for (const e of list.getEntries()) window.__per94.lcpMs = e.startTime;
            }).observe({ type: 'largest-contentful-paint', buffered: true });
            new PerformanceObserver((list) => {
              for (const e of list.getEntries()) {
                window.__per94.longTasks++;
                window.__per94.longTaskMs += e.duration;
              }
            }).observe({ type: 'longtask', buffered: true });
          }, metadata.config.instrument);
          let errors = 0,
            requests = 0,
            transferBytes = 0,
            jsBytes = 0,
            failedRequests = 0;
          const types = new Map();
          cdp.on('Network.requestWillBeSent', (event) => {
            requests++;
            types.set(event.requestId, event.type);
          });
          cdp.on('Network.loadingFinished', (event) => {
            if (!types.has(event.requestId)) return;
            transferBytes += event.encodedDataLength;
            if (types.get(event.requestId) === 'Script') jsBytes += event.encodedDataLength;
            types.delete(event.requestId);
          });
          cdp.on('Network.loadingFailed', (event) => {
            if (types.has(event.requestId)) {
              failedRequests++;
              types.delete(event.requestId);
            }
          });
          page.on('pageerror', () => errors++);
          page.on('response', (response) => {
            if (response.status() >= 400) {
              errors++;
              console.log('Measured browser response error status=' + response.status());
            }
          });
          for (const condition of ['cold', 'warm']) {
            stage = `${profile.name}/${route}/${condition}`;
            console.log(`Measured browser start ${stage}`);
            const failed = (kind, elapsed) =>
              output.push({
                profile: profile.name,
                repeat,
                route,
                condition,
                readyMs: null,
                readyLowerBoundMs: elapsed,
                lcpMs: null,
                longTasks: null,
                longTaskMs: null,
                domContentLoadedMs: null,
                mediaTimedOut: true,
                requests: kind === 'priming-timeout' ? null : requests,
                transferBytes: kind === 'priming-timeout' ? null : transferBytes,
                jsBytes: kind === 'priming-timeout' ? null : jsBytes,
                errors: errors + 1,
                failedRequests,
                failureKind: kind,
              });
            if (condition === 'warm') {
              try {
                await primeWarm(cdp, profile, async () => {
                  await page.goto(`${origin}${path}`, { waitUntil: 'domcontentloaded' });
                  await ready(page, route);
                  await page.waitForLoadState('networkidle');
                });
              } catch (error) {
                if (error.name !== 'TimeoutError') throw error;
                failed('priming-timeout', null);
                continue;
              }
            }

            requests = 0;
            transferBytes = 0;
            jsBytes = 0;
            errors = 0;
            failedRequests = 0;
            types.clear();
            await cdp.send('Network.setCacheDisabled', { cacheDisabled: condition === 'cold' });
            const start = performance.now();
            try {
              await page.goto(`${origin}${path}`, { waitUntil: 'domcontentloaded' });
              await ready(page, route);
            } catch (error) {
              if (error.name !== 'TimeoutError') throw error;
              failed('ready-timeout', performance.now() - start);
              continue;
            }
            const readyMs = performance.now() - start;
            // Wait for visible media, then a fixed one-second observation window. Keep incomplete windows explicit.
            let mediaTimedOut = false;
            try {
              await page.waitForFunction(
                () =>
                  [...document.images]
                    .filter((img) => {
                      const r = img.getBoundingClientRect();
                      return r.top < innerHeight && r.bottom > 0 && r.width > 0;
                    })
                    .every((img) => img.complete),
                undefined,
                { timeout: 15000 },
              );
            } catch {
              mediaTimedOut = true;
            }
            await page.waitForTimeout(1000);
            const metrics = await page.evaluate(() => ({
              ...window.__per94,
              domContentLoadedMs:
                performance.getEntriesByType('navigation')[0]?.domContentLoadedEventEnd ?? null,
            }));
            output.push({
              profile: profile.name,
              repeat,
              route,
              condition,
              readyMs,
              mediaTimedOut,
              ...metrics,
              requests,
              transferBytes,
              jsBytes,
              errors,
              failedRequests,
            });
          }
          await context.close();
        }
        if (metadata.config.calibration || metadata.config.route) {
          console.log(`Measured browser ${profile.name} calibration ${repeat + 1}/${runs}`);
          continue;
        }
        const context = await browser.newContext({
          viewport: profile.viewport,
          isMobile: profile.isMobile,
          hasTouch: profile.isMobile,
          deviceScaleFactor: profile.deviceScaleFactor,
          serviceWorkers: 'block',
        });
        await context.addCookies([
          {
            name: 'havefolio_session',
            value: fixture.token,
            url: origin,
            httpOnly: true,
            sameSite: 'Strict',
          },
        ]);
        const page = await context.newPage();
        page.setDefaultTimeout(30000);
        const cdp = await context.newCDPSession(page);
        await cdp.send('Network.enable');
        await cdp.send('Network.setBlockedURLs', {
          urls: ['https://*', 'http://localhost:*', 'http://192.*', 'http://10.*'],
        });
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: profile.cpu });
        await cdp.send('Network.emulateNetworkConditions', {
          offline: false,
          latency: profile.latency,
          downloadThroughput: profile.download,
          uploadThroughput: profile.upload,
        });
        await page.goto(origin);
        await ready(page, 'home');
        const measure = async (interaction, action, done) => {
          stage = `${profile.name}/${interaction}`;
          console.log(`Measured browser action ${stage}`);
          const start = performance.now();
          await action();
          await done();
          await page.evaluate(
            () =>
              new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
          );
          output.push({
            profile: profile.name,
            repeat,
            interaction,
            latencyMs: performance.now() - start,
          });
        };
        await measure(
          'navigation',
          () => page.locator('a[href="/store"]:visible').first().click(),
          () => ready(page, 'store'),
        );
        const region = page.getByRole('region', { name: 'Your items', exact: true });
        await measure(
          'load-more',
          () => page.getByRole('button', { name: 'Show more items', exact: true }).click(),
          async () => {
            await region.locator('a[href^="/items/"]').nth(25).waitFor();
          },
        );
        await page.getByRole('searchbox', { name: 'Search what you own' }).fill('00001');
        await measure(
          'filter',
          async () => {
            await Promise.all([
              page.waitForResponse(
                (r) =>
                  new URL(r.url()).pathname === '/api/v1/items' &&
                  new URL(r.url()).searchParams.get('q') === '00001',
              ),
              page.getByRole('searchbox', { name: 'Search what you own' }).press('Enter'),
            ]);
          },
          async () => {
            await page.waitForURL(/q=00001/);
            await ready(page, 'store');
          },
        );
        await page.goto(`${origin}/items/new`);
        await ready(page, 'add');
        await page.getByLabel('Item name', { exact: false }).fill('Synthetic saved probe');
        await page.getByRole('checkbox', { name: 'Price unknown', exact: true }).check();
        await page.getByRole('checkbox', { name: 'Date unknown', exact: true }).check();
        await measure(
          'save-feedback',
          () => page.getByRole('button', { name: 'Save item', exact: true }).click(),
          () =>
            page
              .getByRole('heading', {
                name: 'Synthetic saved probe saved to your home',
                exact: true,
              })
              .waitFor(),
        );
        const savedPath = await page
          .getByRole('link', { name: 'View item', exact: true })
          .getAttribute('href');
        if (!/^\/items\/[a-f0-9-]{36}$/.test(savedPath))
          throw new Error('Invalid fixture save path');
        const deleted = await context.request.delete(`${origin}/api/v1${savedPath}`, {
          data: { revision: 1 },
          headers: { Origin: origin },
        });
        if (deleted.status() !== 204) throw new Error('Probe cleanup failed');
        await context.close();
        console.log(`Measured browser ${profile.name} repeat ${repeat + 1}/${runs}`);
      }
    }
  } catch (error) {
    console.error(
      `FAIL: browser ${stage} ${error.name === 'TimeoutError' ? 'timeout' : 'assertion'}`,
    );
    throw new Error('Browser measurement failed');
  } finally {
    await browser.close();
  }
  return output;
}
