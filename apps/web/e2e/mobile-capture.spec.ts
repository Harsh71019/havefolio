import { expect, test } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const screenshotsDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../docs/screenshots',
);
const item = '47474747-4747-4747-a747-474747474747';

test('PER-47 manifest is installable metadata only, with no service worker or caching', async ({
  page,
  request,
}) => {
  const response = await request.get('/manifest.webmanifest');
  expect(response.ok()).toBe(true);
  const manifest = (await response.json()) as {
    display: string;
    start_url: string;
    icons: { src: string; sizes: string; purpose: string }[];
  };
  expect(manifest).toMatchObject({ display: 'standalone', start_url: '/' });
  for (const icon of manifest.icons) {
    const image = await request.get(icon.src);
    expect(image.headers()['content-type']).toBe('image/png');
  }
  expect(manifest.icons.map((icon) => icon.purpose)).toContain('maskable');
  await page.goto('/login');
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
    'href',
    '/manifest.webmanifest',
  );
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute(
    'href',
    '/icons/apple-touch-icon.png',
  );
  expect(
    await page.evaluate(async () =>
      'serviceWorker' in navigator ? (await navigator.serviceWorker.getRegistrations()).length : 0,
    ),
  ).toBe(0);
  expect(
    await page.evaluate(async () => ('caches' in window ? (await caches.keys()).length : 0)),
  ).toBe(0);
});

test('PER-47 unsupported HEIC guidance on the capture page', async ({ page }, testInfo) => {
  await page.route(`**/api/v1/items/${item}/photos`, (route) =>
    route.fulfill({ json: { revision: 1, photos: [] } }),
  );
  await page.goto(`/items/${item}/photos/new`);
  await page.getByLabel('Choose from gallery or files').setInputFiles({
    name: 'IMG_0047.HEIC',
    mimeType: '',
    // ISO-BMFF header only; detected by signature even without a MIME type.
    buffer: Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypheic mif1 synthetic')]),
  });
  await expect(page.getByRole('alert').filter({ hasText: 'can’t convert' })).toContainText(
    'Most Compatible',
  );
  await expect(page.getByRole('button', { name: 'Upload photos' })).toBeDisabled();
  const label = testInfo.project.name === 'mobile' ? '360' : 'desktop';
  if (label === '360') await page.setViewportSize({ width: 360, height: 800 });
  for (const theme of ['light', 'dark']) {
    await page.evaluate(
      (dark) => document.documentElement.classList.toggle('dark', dark),
      theme === 'dark',
    );
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({
      path: path.join(screenshotsDir, `per-47-heic-guidance-${label}-${theme}.png`),
      fullPage: true,
    });
  }
});
