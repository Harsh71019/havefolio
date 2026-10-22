/* global window, document, innerHeight, requestAnimationFrame */
// PER-97: protected-photo audit. Records variant labels, dimensions, bytes, priorities and decode
// time only. Request URLs and trace contents stay in memory and are never serialized.
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { mediaVariant, decodeMs } from './core.mjs';
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
    name: 'retina',
    viewport: { width: 1512, height: 982 },
    isMobile: false,
    deviceScaleFactor: 2,
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
const frames = (page) =>
  page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
const ready = {
  store: (page) =>
    page
      .getByRole('region', { name: 'Your items', exact: true })
      .locator('a[href^="/items/"]')
      .first()
      .waitFor(),
  item: (page) => page.getByRole('heading', { name: /^Synthetic item/, level: 1 }).waitFor(),
  gallery: (page) => page.getByRole('heading', { name: 'Cover', exact: true }).waitFor(),
};
// Visible owner photos only; aria-hidden placeholders are counted through network totals.
const visibleComplete = () =>
  [...document.images]
    .filter((img) => {
      const r = img.getBoundingClientRect();
      return (
        r.top < innerHeight &&
        r.bottom > 0 &&
        r.width > 0 &&
        img.getAttribute('aria-hidden') !== 'true'
      );
    })
    .every((img) => img.complete);
const inspectImages = () =>
  [...document.images]
    .filter((img) => /\/photos\/[^/]+\/content\//.test(img.currentSrc || img.src))
    .map((img) => {
      const r = img.getBoundingClientRect();
      return {
        source: (img.currentSrc || img.src).match(/\/content\/([a-z]+)/)?.[1] ?? 'unknown',
        placeholder: img.getAttribute('aria-hidden') === 'true',
        visible: r.top < innerHeight && r.bottom > 0 && r.width > 0,
        slotWidth: Math.round(r.width),
        slotHeight: Math.round(r.height),
        naturalWidth: img.naturalWidth,
        naturalHeight: img.naturalHeight,
        lazy: img.loading === 'lazy',
        highPriority: img.fetchPriority === 'high',
        complete: img.complete && img.naturalWidth > 0,
      };
    });

async function open(browser, profile, origin, fixture, preferences) {
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
  // Fixed non-private display preferences, applied before the head bootstrap reads them.
  await context.addInitScript((values) => {
    for (const [key, value] of Object.entries(values)) window.localStorage.setItem(key, value);
    window.__per97 = { lcpMs: null };
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) window.__per97.lcpMs = e.startTime;
    }).observe({ type: 'largest-contentful-paint', buffered: true });
  }, preferences);
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.setBlockedURLs', {
    urls: ['https://*', 'http://localhost:*', 'http://192.*', 'http://10.*'],
  });
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: profile.cpu });
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: profile.latency,
    downloadThroughput: profile.download,
    uploadThroughput: profile.upload,
  });
  const network = { requests: new Map(), errors: 0, failed: 0 };
  cdp.on('Network.requestWillBeSent', (event) => {
    const variant = mediaVariant(event.request.url);
    if (variant)
      network.requests.set(event.requestId, {
        variant,
        key: event.request.url,
        priority: event.request.initialPriority,
        bytes: 0,
        status: 0,
        done: false,
      });
  });
  cdp.on('Network.resourceChangedPriority', (event) => {
    const request = network.requests.get(event.requestId);
    if (request) request.priority = event.newPriority;
  });
  cdp.on('Network.responseReceived', (event) => {
    const request = network.requests.get(event.requestId);
    if (request) request.status = event.response.status;
  });
  cdp.on('Network.loadingFinished', (event) => {
    const request = network.requests.get(event.requestId);
    if (request) Object.assign(request, { bytes: event.encodedDataLength, done: true });
  });
  cdp.on('Network.loadingFailed', (event) => {
    if (network.requests.has(event.requestId)) network.failed++;
  });
  page.on('pageerror', () => network.errors++);
  page.on('response', (response) => {
    if (response.status() >= 400) network.errors++;
  });
  return { context, page, network };
}

// Totals by variant; a repeated URL within one observation is a duplicate protected fetch.
function summarise(network) {
  const variants = {};
  const seen = new Set();
  for (const r of network.requests.values()) {
    const v = (variants[r.variant] ??= {
      requests: 0,
      completed: 0,
      bytes: 0,
      maxBytes: 0,
      duplicates: 0,
      errorResponses: 0,
      highPriority: 0,
    });
    v.requests++;
    if (seen.has(r.key)) v.duplicates++;
    seen.add(r.key);
    if (r.done) {
      v.completed++;
      v.bytes += r.bytes;
      v.maxBytes = Math.max(v.maxBytes, r.bytes);
    }
    if (r.status >= 400) v.errorResponses++;
    if (r.priority === 'High' || r.priority === 'VeryHigh') v.highPriority++;
  }
  return variants;
}

async function observe(browser, page, network, profile, navigate, view) {
  network.requests.clear();
  await browser.startTracing(page, {
    categories: ['devtools.timeline', 'disabled-by-default-devtools.timeline'],
  });
  const start = performance.now();
  await navigate();
  await ready[view](page);
  await frames(page);
  const readyMs = performance.now() - start;
  let mediaTimedOut = false,
    visibleMediaMs = null;
  try {
    await page.waitForFunction(visibleComplete, undefined, { timeout: 15000, polling: 50 });
    visibleMediaMs = performance.now() - start;
  } catch {
    mediaTimedOut = true;
  }
  await page.waitForTimeout(1000);
  const images = await page.evaluate(inspectImages);
  const lcpMs = await page.evaluate(() => window.__per97.lcpMs);
  const trace = await browser.stopTracing();
  // Parse in memory only; trace text includes URLs and is discarded immediately.
  const decode = decodeMs(JSON.parse(trace.toString()));
  const dpr = profile.deviceScaleFactor;
  const owner = images.filter((i) => !i.placeholder);
  const visible = owner.filter((i) => i.visible);
  // Device pixels needed to fill the slot; `cover` crops to the larger axis ratio.
  const needed = (i) =>
    Math.ceil(
      Math.max(i.slotWidth, (i.slotHeight * i.naturalWidth) / Math.max(1, i.naturalHeight)) * dpr,
    );
  return {
    readyMs,
    visibleMediaMs,
    mediaTimedOut,
    lcpMs,
    decodeMs: decode,
    images: {
      total: owner.length,
      visible: visible.length,
      visibleComplete: visible.filter((i) => i.complete).length,
      visibleThumbnail: visible.filter((i) => i.source === 'thumbnail').length,
      visibleDisplay: visible.filter((i) => i.source === 'display').length,
      visibleHighPriority: visible.filter((i) => i.highPriority).length,
      offscreenEagerOrLoaded: owner.filter((i) => !i.visible && (!i.lazy || i.complete)).length,
      placeholders: images.filter((i) => i.placeholder).length,
      // Ratio > 1 means more pixels arrived than the slot can show; < 1 means upscaled.
      visibleSupplyRatio: visible
        .filter((i) => i.complete)
        .map((i) => Number((i.naturalWidth / Math.max(1, needed(i))).toFixed(3))),
      visibleSlotCssWidths: [...new Set(visible.map((i) => i.slotWidth))],
      decodedMegapixels: Number(
        (
          owner
            .filter((i) => i.complete)
            .reduce((n, i) => n + i.naturalWidth * i.naturalHeight, 0) / 1e6
        ).toFixed(3),
      ),
    },
    variants: summarise(network),
    errors: network.errors,
    failedRequests: network.failed,
  };
}

export async function mediaAudit({ origin, fixture, runs, metadata }) {
  const browser = await chromium.launch({
    args: ['--proxy-server=http://127.0.0.1:9', '--proxy-bypass-list=127.0.0.1'],
  });
  metadata.browser = browser.version();
  metadata.mediaProfiles = profiles;
  const output = [];
  let stage = 'start';
  try {
    for (let repeat = 0; repeat < runs; repeat++) {
      for (const profile of profiles) {
        const sidebars = profile.isMobile ? ['expanded'] : ['expanded', 'collapsed'];
        for (const density of ['compact', 'comfortable', 'large'])
          for (const sidebar of sidebars) {
            stage = `${profile.name}/store/${density}/${sidebar}`;
            console.log(`Measured media start ${stage}`);
            const { context, page, network } = await open(browser, profile, origin, fixture, {
              'havefolio:store-density:v1': density,
              'havefolio:sidebar:v1': sidebar,
            });
            const result = await observe(
              browser,
              page,
              network,
              profile,
              () => page.goto(`${origin}/store`, { waitUntil: 'domcontentloaded' }),
              'store',
            );
            output.push({
              profile: profile.name,
              view: 'store',
              density,
              sidebar,
              repeat,
              ...result,
            });
            if (density === 'comfortable' && sidebar === 'expanded') {
              // Client-side return to the Store: are protected covers fetched again?
              stage = `${profile.name}/revisit`;
              await page
                .getByRole('region', { name: 'Your items', exact: true })
                .locator('a[href^="/items/"]')
                .first()
                .click();
              await ready.item(page);
              await page.waitForLoadState('networkidle');
              const revisit = await observe(
                browser,
                page,
                network,
                profile,
                () => page.goBack({ waitUntil: 'commit' }),
                'store',
              );
              output.push({
                profile: profile.name,
                view: 'revisit',
                density,
                sidebar,
                repeat,
                ...revisit,
              });
            }
            await context.close();
          }
        for (const [view, path] of [
          ['item', `/items/${fixture.item}`],
          ['gallery', `/items/${fixture.item}/photos`],
        ]) {
          stage = `${profile.name}/${view}`;
          console.log(`Measured media start ${stage}`);
          const { context, page, network } = await open(browser, profile, origin, fixture, {});
          const result = await observe(
            browser,
            page,
            network,
            profile,
            () => page.goto(`${origin}${path}`, { waitUntil: 'domcontentloaded' }),
            view,
          );
          output.push({ profile: profile.name, view, repeat, ...result });
          await context.close();
        }
      }
      // Reproduce the PER-94 rank-1 mobile sequence: navigate, load more, then filter.
      const profile = profiles.find((p) => p.name === 'mobile');
      stage = 'mobile/filter-after-load-more';
      console.log(`Measured media start ${stage}`);
      const { context, page, network } = await open(browser, profile, origin, fixture, {});
      await page.goto(origin);
      await page.getByRole('heading', { name: 'Recently added', exact: true }).waitFor();
      network.requests.clear();
      let start = performance.now();
      await page.locator('a[href="/store"]:visible').first().click();
      await ready.store(page);
      await frames(page);
      const navigationMs = performance.now() - start;
      const region = page.getByRole('region', { name: 'Your items', exact: true });
      start = performance.now();
      await page.getByRole('button', { name: 'Show more items', exact: true }).click();
      await region.locator('a[href^="/items/"]').nth(25).waitFor();
      await frames(page);
      const loadMoreMs = performance.now() - start;
      const beforeFilter = summarise(network);
      const inFlightAtFilter = [...network.requests.values()].filter((r) => !r.done).length;
      await page.getByRole('searchbox', { name: 'Search what you own' }).fill('00001');
      start = performance.now();
      await Promise.all([
        page.waitForResponse(
          (r) =>
            new URL(r.url()).pathname === '/api/v1/items' &&
            new URL(r.url()).searchParams.get('q') === '00001',
        ),
        page.getByRole('searchbox', { name: 'Search what you own' }).press('Enter'),
      ]);
      await page.waitForURL(/q=00001/);
      await ready.store(page);
      await frames(page);
      const filterMs = performance.now() - start;
      output.push({
        profile: 'mobile',
        view: 'interaction',
        repeat,
        navigationMs,
        loadMoreMs,
        filterMs,
        inFlightAtFilter,
        variantsBeforeFilter: beforeFilter,
        variants: summarise(network),
        errors: network.errors,
        failedRequests: network.failed,
      });
      await context.close();
      console.log(`Measured media repeat ${repeat + 1}/${runs}`);
    }
  } catch (error) {
    console.error(
      `FAIL: media ${stage} ${error.name === 'TimeoutError' ? 'timeout' : 'assertion'}`,
    );
    throw new Error('Media audit failed');
  } finally {
    await browser.close();
  }
  return output;
}
