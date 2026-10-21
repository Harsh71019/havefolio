import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { attachShiftTracker } from './fixtures/measure-shifts';
import { homeFixture } from '../test/home-fixture';

const outDir = resolve(process.cwd(), '../../docs/screenshots');

async function captureThemes(page: Page, name: string, project: string): Promise<void> {
  await mkdir(outDir, { recursive: true });
  for (const theme of ['light', 'dark']) {
    await page.evaluate((value) => {
      document.documentElement.classList.remove('light', 'dark');
      document.documentElement.classList.add(value);
      document.documentElement.style.colorScheme = value;
    }, theme);
    await page.screenshot({
      path: resolve(outDir, `per-88-${name}-${project}-${theme}.png`),
      fullPage: true,
      animations: 'disabled',
    });
  }
}

const id = (n: number): string => `00000000-0000-4000-a000-${String(n).padStart(12, '0')}`;
const kitchen = id(901);
const appliances = id(911);
const daily = id(921);

const sampleItem = {
  id: id(1),
  name: 'Electric kettle',
  ownershipStatus: 'owned',
  currency: 'INR',
  pricePaidMinor: '249900',
  purchaseDate: { precision: 'exact', year: 2024, month: 3, day: 12 },
  acquisitionType: 'bought',
  condition: 'working',
  useFrequency: 'often',
  categoryId: kitchen,
  subcategoryId: appliances,
  tagIds: [daily],
  brand: 'Prestige',
  model: 'PKOSS 1.5',
  description: 'Steel body, 1.5 litre.',
  notes: 'Descale every month with citric acid.',
  specifications: { Wattage: '1500 W', Capacity: '1.5 L' },
  revision: 4,
  createdAt: '2026-09-01T05:30:00.000Z',
  updatedAt: '2026-09-20T05:30:00.000Z',
  cover: null,
};

const taxonomy = {
  categories: [
    { id: kitchen, name: 'Kitchen', position: 0, isDemo: false, retiredAt: null, itemCount: 2 },
  ],
  subcategories: [
    {
      id: appliances,
      categoryId: kitchen,
      name: 'Appliances',
      position: 0,
      isDemo: false,
      retiredAt: null,
      itemCount: 2,
    },
  ],
  tags: [{ id: daily, name: 'Daily use', itemCount: 1 }],
  defaultsSeeded: true,
};

const storeItems = [
  sampleItem,
  {
    ...sampleItem,
    id: id(2),
    name: 'Cast iron skillet',
    brand: 'Lodge',
    model: '10.25 inch',
  },
  {
    ...sampleItem,
    id: id(3),
    name: 'Chef knife',
    brand: 'Victorinox',
    model: 'Fibrox 8 inch',
  },
];

const spendingReport = {
  scope: 'current-owned',
  grouping: 'overall',
  basis: 'purchase-date',
  purchasedFrom: null,
  purchasedTo: null,
  buckets: [
    {
      currency: 'INR',
      key: null,
      dateBucket: 'dated',
      grossMinor: '18450000',
      refundedMinor: '550000',
      netMinor: '17900000',
      pricedItemCount: 25,
      unknownPriceCount: 2,
      notSpendingCount: 1,
      explicitZeroCount: 1,
      knownDateCount: 25,
      unknownDateCount: 0,
      totalItemCount: 27,
      missingMerchantCount: 0,
    },
    {
      currency: 'INR',
      key: null,
      dateBucket: 'unknownDate',
      grossMinor: '1250000',
      refundedMinor: '0',
      netMinor: '1250000',
      pricedItemCount: 2,
      unknownPriceCount: 0,
      notSpendingCount: 0,
      explicitZeroCount: 0,
      knownDateCount: 0,
      unknownDateCount: 2,
      totalItemCount: 2,
      missingMerchantCount: 0,
    },
  ],
};

const merchantSpending = {
  rows: [
    {
      currency: 'INR',
      merchant: { id: id(51), displayName: 'Amazon', state: 'active' },
      netMinor: '12500000',
      totalItemCount: 18,
      unknownPriceCount: 1,
    },
    {
      currency: 'INR',
      merchant: { id: id(52), displayName: 'Croma', state: 'active' },
      netMinor: '5400000',
      totalItemCount: 7,
      unknownPriceCount: 1,
    },
  ],
};

test.describe('PER-88 Layout Shift & Stable Geometry', () => {
  test('Home Dashboard initial load with 300ms delayed API maintains CLS <= 0.1', async ({
    page,
  }, testInfo) => {
    const getMetrics = await attachShiftTracker(page);

    await page.route('**/api/v1/**', async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/api/v1/home') {
        await new Promise((r) => setTimeout(r, 300));
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(homeFixture),
        });
      } else if (path === '/api/v1/onboarding') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ state: 'completed', genuineItemCount: 42, demoItemCount: 0 }),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({}),
        });
      }
    });

    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    // When loaded:
    await expect(page.getByRole('region', { name: 'Rediscover something you own' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Recorded spending' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Goals' })).toBeVisible();

    // Settle layout
    await page.waitForTimeout(200);
    const metrics = await getMetrics();
    console.log(
      `[PER-88 Result] Home initial load CLS: ${metrics.cls.toFixed(4)}, total: ${metrics.totalShift.toFixed(4)}`,
    );
    expect(metrics.cls).toBeLessThanOrEqual(0.1);
    await captureThemes(page, 'home-populated', testInfo.project.name);
  });

  test('My Store initial load with 300ms delayed items maintains CLS <= 0.1', async ({
    page,
  }, testInfo) => {
    const getMetrics = await attachShiftTracker(page);

    await page.route('**/api/v1/**', async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/api/v1/items') {
        await new Promise((r) => setTimeout(r, 300));
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ items: storeItems, nextCursor: null, hasMore: false }),
        });
      } else if (path === '/api/v1/taxonomy') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(taxonomy),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({}),
        });
      }
    });

    await page.goto('/store');
    const region = page.getByRole('region', { name: 'Your items' });
    await expect(region).toBeVisible();

    // Loaded card:
    await expect(region.getByRole('link', { name: /Electric kettle/i })).toBeVisible();

    await page.waitForTimeout(200);
    const metrics = await getMetrics();
    console.log(
      `[PER-88 Result] Store initial load CLS: ${metrics.cls.toFixed(4)}, total: ${metrics.totalShift.toFixed(4)}`,
    );
    expect(metrics.cls).toBeLessThanOrEqual(0.1);
    await captureThemes(page, 'store-populated', testInfo.project.name);
  });

  test('Item Details initial load with 300ms delayed item maintains CLS <= 0.1', async ({
    page,
  }, testInfo) => {
    const getMetrics = await attachShiftTracker(page);
    page.on('console', (msg) => console.log('PAGE LOG:', msg.text()));
    page.on('pageerror', (err) => console.log('PAGE ERROR:', err.message));

    await page.route('**/api/v1/**', async (route) => {
      const u = new URL(route.request().url());
      const path = u.pathname;
      if (path === `/api/v1/items/${sampleItem.id}`) {
        await new Promise((r) => setTimeout(r, 300));
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(sampleItem),
        });
      } else if (path === '/api/v1/items') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ items: [], nextCursor: null, hasMore: false }),
        });
      } else if (path === `/api/v1/items/${sampleItem.id}/photos`) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ photos: [], revision: 1 }),
        });
      } else if (path === `/api/v1/items/${sampleItem.id}/documents`) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ documents: [], revision: 1 }),
        });
      } else if (path === `/api/v1/items/${sampleItem.id}/refunds`) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            refunds: [],
            revision: 1,
            ownershipStatus: 'owned',
            acquisitionType: 'bought',
            totals: {
              currency: 'INR',
              amountPaidMinor: '249900',
              refundedMinor: '0',
              netMinor: '249900',
            },
          }),
        });
      } else if (path === `/api/v1/items/${sampleItem.id}/history`) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ events: [], nextCursor: null, hasMore: false }),
        });
      } else if (path === '/api/v1/taxonomy') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(taxonomy),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({}),
        });
      }
    });

    await page.goto(`/items/${sampleItem.id}`);
    await expect(page.getByRole('heading', { name: 'Electric kettle' })).toBeVisible();

    await page.waitForTimeout(200);
    const metrics = await getMetrics();
    console.log(
      `[PER-88 Result] Item details initial load CLS: ${metrics.cls.toFixed(4)}, total: ${metrics.totalShift.toFixed(4)}`,
    );
    expect(metrics.cls).toBeLessThanOrEqual(0.1);
    await captureThemes(page, 'item-details-populated', testInfo.project.name);
  });

  test('Spending Insights initial load and filter change movement measurement', async ({
    page,
  }, testInfo) => {
    const getMetrics = await attachShiftTracker(page);

    await page.route('**/api/v1/**', async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/api/v1/spending') {
        await new Promise((r) => setTimeout(r, 200));
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(spendingReport),
        });
      } else if (path === '/api/v1/spending/merchants') {
        await new Promise((r) => setTimeout(r, 200));
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(merchantSpending),
        });
      } else if (path === '/api/v1/taxonomy') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(taxonomy),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({}),
        });
      }
    });

    await page.goto('/insights');
    await expect(page.getByRole('heading', { name: 'Spend by merchant' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Recorded spending summary' })).toBeVisible();

    await page.waitForTimeout(200);
    const initialMetrics = await getMetrics();
    console.log(
      `[PER-88 Result] Spending initial load CLS: ${initialMetrics.cls.toFixed(4)}, total: ${initialMetrics.totalShift.toFixed(4)}`,
    );
    await captureThemes(page, 'spending-insights-populated', testInfo.project.name);

    // Now test interaction-triggered movement:
    // Change grouping
    const groupingSelect = page.getByRole('combobox', { name: 'Group by' });
    if (await groupingSelect.isVisible()) {
      await groupingSelect.click();
      await page.getByRole('option', { name: 'Category' }).click();
      await page.waitForTimeout(400);
      const afterFilterMetrics = await getMetrics();
      console.log(
        `[PER-88 Result] Spending filter interaction total movement: ${afterFilterMetrics.totalShift.toFixed(4)}`,
      );
    }
  });

  test('Photo Gallery initial load with 300ms delayed photos maintains CLS <= 0.1', async ({
    page,
  }, testInfo) => {
    const getMetrics = await attachShiftTracker(page);

    await page.route('**/api/v1/**', async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === `/api/v1/items/${sampleItem.id}/photos`) {
        await new Promise((r) => setTimeout(r, 300));
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            photos: [
              {
                id: id(101),
                itemId: sampleItem.id,
                position: 0,
                width: 1200,
                height: 900,
                byteSize: 102400,
                mimeType: 'image/jpeg',
                altText: 'Electric kettle cover',
                decorative: false,
                createdAt: '2026-09-01T00:00:00.000Z',
              },
            ],
            revision: 1,
          }),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({}),
        });
      }
    });

    await page.goto(`/items/${sampleItem.id}/photos`);
    await expect(page.getByRole('heading', { name: 'Item photos' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Cover' })).toBeVisible();

    await page.waitForTimeout(200);
    const metrics = await getMetrics();
    console.log(
      `[PER-88 Result] Photo gallery initial load CLS: ${metrics.cls.toFixed(4)}, total: ${metrics.totalShift.toFixed(4)}`,
    );
    expect(metrics.cls).toBeLessThanOrEqual(0.1);
    await captureThemes(page, 'photo-gallery-populated', testInfo.project.name);
  });

  test('Home background refresh keeps useful content visible when refresh errors', async ({
    page,
  }) => {
    let requests = 0;
    await page.route('**/api/v1/**', async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/api/v1/home') {
        requests++;
        if (requests === 1) {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(homeFixture),
          });
        } else {
          // Background refresh failure: 503
          await route.fulfill({
            status: 503,
            contentType: 'application/json',
            body: JSON.stringify({ message: 'Service temporarily unavailable' }),
          });
        }
      } else if (path === '/api/v1/onboarding') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ state: 'completed', genuineItemCount: 42, demoItemCount: 0 }),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({}),
        });
      }
    });

    await page.goto('/');
    await expect(page.getByRole('region', { name: 'Rediscover something you own' })).toBeVisible();

    const getMetrics = await attachShiftTracker(page);
    // Trigger background inventory change
    await page.evaluate(() => window.dispatchEvent(new Event('havefolio-inventory-changed')));
    await page.waitForTimeout(300);

    const metrics = await getMetrics();
    console.log(
      `[PER-88] Home background refresh failure movement: ${metrics.totalShift.toFixed(4)}`,
    );
    // Crucial check: dashboard preserves user content instead of replacing with an alert!
    await expect(page.getByRole('region', { name: 'Rediscover something you own' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Recorded spending' })).toBeVisible();
  });

  test('Store background refresh keeps items visible when refresh errors', async ({ page }) => {
    let requests = 0;
    await page.route('**/api/v1/**', async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/api/v1/items') {
        requests++;
        if (requests === 1) {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ items: storeItems, nextCursor: null, hasMore: false }),
          });
        } else {
          await route.fulfill({
            status: 503,
            contentType: 'application/json',
            body: JSON.stringify({ message: 'Service temporarily unavailable' }),
          });
        }
      } else if (path === '/api/v1/taxonomy') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(taxonomy),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({}),
        });
      }
    });

    await page.goto('/store');
    const region = page.getByRole('region', { name: 'Your items' });
    await expect(region.getByRole('link', { name: /Electric kettle/i })).toBeVisible();

    const getMetrics = await attachShiftTracker(page);
    // Trigger background inventory change
    await page.evaluate(() => window.dispatchEvent(new Event('havefolio-inventory-changed')));
    await page.waitForTimeout(300);

    const metrics = await getMetrics();
    console.log(
      `[PER-88] Store background refresh failure movement: ${metrics.totalShift.toFixed(4)}`,
    );
    // Crucial check: store preserves user items instead of replacing with an alert!
    await expect(region.getByRole('link', { name: /Electric kettle/i })).toBeVisible();
  });

  test('Broken private image fallback maintains aspect-ratio and geometry', async ({
    page,
  }, testInfo) => {
    await page.route('**/api/v1/**', async (route) => {
      const u = new URL(route.request().url());
      const path = u.pathname;
      if (path === `/api/v1/items/${sampleItem.id}`) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            ...sampleItem,
            cover: {
              photoId: id(101),
              width: 1200,
              height: 900,
              altText: 'Broken kettle',
              decorative: false,
            },
          }),
        });
      } else if (path === `/api/v1/items/${sampleItem.id}/photos`) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            photos: [
              {
                id: id(101),
                itemId: sampleItem.id,
                position: 0,
                width: 1200,
                height: 900,
                byteSize: 102400,
                mimeType: 'image/jpeg',
                altText: 'Broken kettle',
                decorative: false,
                createdAt: '2026-09-01T00:00:00.000Z',
              },
            ],
            revision: 1,
          }),
        });
      } else if (path.includes('/photos/') && path.endsWith('/file')) {
        // Image fails to load: 404 or 500
        await route.fulfill({ status: 404 });
      } else if (path === `/api/v1/items/${sampleItem.id}/documents`) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ documents: [], revision: 1 }),
        });
      } else if (path === `/api/v1/items/${sampleItem.id}/refunds`) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            refunds: [],
            revision: 1,
            ownershipStatus: 'owned',
            acquisitionType: 'bought',
            totals: {
              currency: 'INR',
              amountPaidMinor: '249900',
              refundedMinor: '0',
              netMinor: '249900',
            },
          }),
        });
      } else if (path === `/api/v1/items/${sampleItem.id}/history`) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ events: [], nextCursor: null, hasMore: false }),
        });
      } else if (path === '/api/v1/taxonomy') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(taxonomy),
        });
      } else if (path === '/api/v1/items') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ items: [], nextCursor: null, hasMore: false }),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({}),
        });
      }
    });

    const getMetrics = await attachShiftTracker(page);
    await page.goto(`/items/${sampleItem.id}`);
    await expect(page.getByRole('heading', { name: 'Electric kettle' })).toBeVisible();

    // The image will fail and show fallback
    await expect(page.getByText('Cover photo could not load.')).toBeVisible();
    const metrics = await getMetrics();
    console.log(
      `[PER-88 Baseline] Image failure CLS: ${metrics.cls.toFixed(4)}, total: ${metrics.totalShift.toFixed(4)}`,
    );
    expect(metrics.cls).toBeLessThanOrEqual(0.1);
    await captureThemes(page, 'broken-media-fallback', testInfo.project.name);
  });

  test('Capture loading skeleton states across light and dark themes', async ({
    page,
  }, testInfo) => {
    // 1. Home loading skeleton
    await page.route('**/api/v1/**', async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/api/v1/home') {
        // Hold request
      } else if (path === '/api/v1/onboarding') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ state: 'completed', genuineItemCount: 42, demoItemCount: 0 }),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({}),
        });
      }
    });
    await page.goto('/');
    await expect(page.getByTestId('home-skeleton')).toBeVisible();
    await captureThemes(page, 'home-loading', testInfo.project.name);

    // 2. Store loading skeleton
    await page.unroute('**/api/v1/**');
    await page.route('**/api/v1/**', async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/api/v1/items') {
        // Hold request
      } else if (path === '/api/v1/taxonomy') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(taxonomy),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({}),
        });
      }
    });
    await page.goto('/store');
    await expect(page.getByTestId('store-skeleton')).toBeVisible();
    await captureThemes(page, 'store-loading', testInfo.project.name);

    // 3. Item details loading skeleton
    await page.unroute('**/api/v1/**');
    await page.route('**/api/v1/**', async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === `/api/v1/items/${sampleItem.id}`) {
        // Hold request
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({}),
        });
      }
    });
    await page.goto(`/items/${sampleItem.id}`);
    await expect(page.getByTestId('item-detail-skeleton')).toBeVisible();
    await captureThemes(page, 'item-details-loading', testInfo.project.name);

    // 4. Spending Insights loading skeleton
    await page.unroute('**/api/v1/**');
    await page.route('**/api/v1/**', async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path.startsWith('/api/v1/spending')) {
        // Hold request
      } else if (path === '/api/v1/taxonomy') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(taxonomy),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({}),
        });
      }
    });
    await page.goto('/insights');
    await expect(page.getByTestId('spending-skeleton')).toBeVisible();
    await captureThemes(page, 'spending-insights-loading', testInfo.project.name);
  });
});
