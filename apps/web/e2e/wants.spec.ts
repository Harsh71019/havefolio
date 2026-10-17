import { test, expect, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Desire, DesiresPage } from '@havefolio/contracts';

const screenshotsDir = resolve(process.cwd(), '../../docs/screenshots');

const ownerFixture = {
  id: 'usr_owner_per24',
  email: 'owner@example.test',
  displayName: 'Harsh',
  preferredCurrency: 'INR',
};

const mockDesires: Desire[] = [
  {
    id: 'd1000000-0000-4000-a000-000000000001',
    name: 'Espresso Machine',
    classification: 'want',
    likelyPriceMinor: '2500000',
    currency: 'INR',
    productUrl: 'https://example.com/espresso-pro',
    reason: 'Make better morning coffee at home and explore espresso crafts.',
    status: 'waiting',
    effectiveState: 'waiting',
    waitingStartedAt: new Date().toISOString(),
    reviewAt: new Date(Date.now() + 7 * 86400 * 1000).toISOString(),
    photo: {
      id: 'p1000000-0000-4000-a000-000000000001',
      byteSize: 124500,
      mimeType: 'image/webp',
      width: 800,
      height: 600,
      altText: 'Espresso Machine',
      decorative: false,
      createdAt: new Date().toISOString(),
    },
    revision: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'd2000000-0000-4000-a000-000000000002',
    name: 'Winter Running Jacket',
    classification: 'need',
    likelyPriceMinor: null,
    currency: null,
    productUrl: null,
    reason: 'Current jacket is worn out for cold morning running.',
    status: 'considering',
    effectiveState: 'considering',
    waitingStartedAt: null,
    reviewAt: null,
    photo: null,
    revision: 1,
    createdAt: new Date(Date.now() - 86400 * 1000).toISOString(),
    updatedAt: new Date(Date.now() - 86400 * 1000).toISOString(),
  },
  {
    id: 'd3000000-0000-4000-a000-000000000003',
    name: 'Custom Mechanical Keyboard',
    classification: 'greed',
    likelyPriceMinor: '1850000',
    currency: 'INR',
    productUrl: 'https://example.com/custom-keyboard',
    reason: 'Love the clicky sound, but already own two keyboards.',
    status: 'waiting',
    effectiveState: 'ready_for_review',
    waitingStartedAt: new Date(Date.now() - 31 * 86400 * 1000).toISOString(),
    reviewAt: new Date(Date.now() - 3600 * 1000).toISOString(),
    photo: null,
    revision: 2,
    createdAt: new Date(Date.now() - 31 * 86400 * 1000).toISOString(),
    updatedAt: new Date(Date.now() - 31 * 86400 * 1000).toISOString(),
  },
];

async function setTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await page.evaluate((val) => {
    localStorage.setItem('theme', val);
    document.documentElement.classList.remove('light', 'dark');
    document.documentElement.classList.add(val);
  }, theme);
  await page.waitForTimeout(50);
}

test.describe('PER-24: Neutral Desire Flow (Wants)', () => {
  test.beforeEach(async ({ page }) => {
    await mkdir(screenshotsDir, { recursive: true });

    // Mock authenticated owner
    await page.route('**/api/v1/auth/me', async (route) => {
      await route.fulfill({ json: ownerFixture });
    });
  });

  test('empty wants state shows calm invitation without shame', async ({ page }, testInfo) => {
    await page.route('**/api/v1/desires**', async (route) => {
      const pageData: DesiresPage = {
        items: [],
        nextCursor: null,
        hasMore: false,
      };
      await route.fulfill({ json: pageData });
    });

    await page.goto('/wants');
    await expect(page.getByText('Nothing is waiting for a decision')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Record your first desire' })).toBeVisible();

    if (testInfo.project.name === 'mobile') {
      await setTheme(page, 'light');
      await page.screenshot({
        path: resolve(screenshotsDir, 'per-24-empty-mobile-light.png'),
        fullPage: true,
      });
    }
  });

  test('populated wants list displays classifications, prices, and effective states', async ({
    page,
  }, testInfo) => {
    await page.route('**/api/v1/desires**', async (route) => {
      const url = route.request().url();
      if (url.includes('effectiveState=waiting')) {
        const pageData: DesiresPage = {
          items: [mockDesires[0]!],
          nextCursor: null,
          hasMore: false,
        };
        return route.fulfill({ json: pageData });
      }
      const pageData: DesiresPage = {
        items: mockDesires,
        nextCursor: null,
        hasMore: false,
      };
      return route.fulfill({ json: pageData });
    });

    await page.goto('/wants');
    await expect(page.getByText('Espresso Machine')).toBeVisible();
    await expect(page.getByText('Winter Running Jacket')).toBeVisible();
    await expect(page.getByText('Custom Mechanical Keyboard')).toBeVisible();

    // Check classification and state badges
    await expect(page.getByText('Want', { exact: true })).toBeVisible();
    await expect(page.getByText('Need', { exact: true })).toBeVisible();
    await expect(page.getByText('Greed', { exact: true })).toBeVisible();

    // Check price representation
    await expect(page.getByText(/₹25,000/)).toBeVisible();
    await expect(page.getByText('Price not added')).toBeVisible();

    // Responsive horizontal overflow verification
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    expect(overflow).toBe(false);

    if (testInfo.project.name === 'mobile') {
      await setTheme(page, 'dark');
      await page.screenshot({
        path: resolve(screenshotsDir, 'per-24-list-mobile-dark.png'),
        fullPage: true,
      });
    } else if (testInfo.project.name === 'desktop') {
      await setTheme(page, 'dark');
      await page.screenshot({
        path: resolve(screenshotsDir, 'per-24-desktop-list-dark.png'),
        fullPage: true,
      });
    }
  });

  test('add desire flow captures unclassified, classified, waiting period and photo', async ({
    page,
  }, testInfo) => {
    let createdDesire: Desire | null = null;
    await page.route('**/api/v1/desires', async (route) => {
      if (route.request().method() === 'POST') {
        const body = route.request().postDataJSON() as Record<string, unknown>;
        createdDesire = {
          id: 'd-created-1234',
          name: String(body.name),
          classification: (body.classification as Desire['classification']) ?? null,
          likelyPriceMinor: (body.likelyPriceMinor as string) ?? null,
          currency: (body.currency as string) ?? null,
          productUrl: (body.productUrl as string) ?? null,
          reason: (body.reason as string) ?? null,
          status: body.waitingPeriod ? 'waiting' : 'considering',
          effectiveState: body.waitingPeriod ? 'waiting' : 'considering',
          waitingStartedAt: body.waitingPeriod ? new Date().toISOString() : null,
          reviewAt: body.waitingPeriod
            ? (body.waitingPeriod as { reviewAt: string }).reviewAt
            : null,
          photo: null,
          revision: 1,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        await route.fulfill({ status: 201, json: createdDesire });
      } else {
        await route.fallback();
      }
    });

    await page.goto('/wants/new');
    await expect(page.getByRole('heading', { name: 'Add a desire to consider' })).toBeVisible();

    // 1. Unclassified capture with only name
    await page.getByLabel(/What are you considering\?/).fill('Espresso Machine');

    if (testInfo.project.name === 'mobile') {
      await setTheme(page, 'light');
      await page.screenshot({
        path: resolve(screenshotsDir, 'per-24-add-unclassified-light.png'),
        fullPage: true,
      });

      // 2. Expand classification section and select Want
      await page.getByRole('button', { name: /Need \/ Want \/ Greed classification/i }).click();
      await expect(page.getByText('Could add enjoyment, convenience or comfort.')).toBeVisible();
      await page.getByRole('radio', { name: /Want/i }).click();

      await setTheme(page, 'dark');
      await page.screenshot({
        path: resolve(screenshotsDir, 'per-24-classification-selection-dark.png'),
        fullPage: true,
      });

      // 3. Expand waiting period section and select 7 days preset
      await page.getByRole('button', { name: /Waiting period/i }).click();
      await page.getByRole('button', { name: '7 days', exact: true }).click();
      await expect(page.getByText(/Review on:/)).toBeVisible();

      await setTheme(page, 'light');
      await page.screenshot({
        path: resolve(screenshotsDir, 'per-24-waiting-period-light.png'),
        fullPage: true,
      });

      // 4. Expand photo section and attach private photo
      await page.getByRole('button', { name: /Private photo/i }).click();
      await page.getByLabel('Choose photo').setInputFiles({
        name: 'espresso-machine.jpg',
        mimeType: 'image/jpeg',
        buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]),
      });

      await expect(page.getByAltText(/Preview for Espresso Machine/)).toBeVisible();
      await setTheme(page, 'dark');
      await page.screenshot({
        path: resolve(screenshotsDir, 'per-24-desire-photo-dark.png'),
        fullPage: true,
      });
    }
  });

  test('edit desire flow loads current state, updates fields, and supports photo removal', async ({
    page,
  }, testInfo) => {
    let currentDesire: Desire = { ...mockDesires[0]! };

    await page.route(`**/api/v1/desires/${currentDesire.id}`, async (route) => {
      const method = route.request().method();
      if (method === 'GET') {
        return route.fulfill({ json: currentDesire });
      }
      if (method === 'PATCH') {
        const body = route.request().postDataJSON() as Record<string, unknown>;
        currentDesire = {
          ...currentDesire,
          name: (body.name as string) ?? currentDesire.name,
          classification:
            body.classification !== undefined
              ? (body.classification as Desire['classification'])
              : currentDesire.classification,
          likelyPriceMinor:
            body.likelyPriceMinor !== undefined
              ? (body.likelyPriceMinor as string | null)
              : currentDesire.likelyPriceMinor,
          currency:
            body.currency !== undefined ? (body.currency as string | null) : currentDesire.currency,
          revision: currentDesire.revision + 1,
        };
        return route.fulfill({ json: currentDesire });
      }
      return route.fallback();
    });

    await page.goto(`/wants/${currentDesire.id}/edit`);
    await expect(page.locator('input[value="Espresso Machine"]')).toBeVisible();
    await expect(page.locator('input[value="25000.00"]')).toBeVisible();
    await expect(page.locator('input[value="https://example.com/espresso-pro"]')).toBeVisible();

    if (testInfo.project.name === 'mobile') {
      await setTheme(page, 'light');
      await page.screenshot({
        path: resolve(screenshotsDir, 'per-24-edit-flow-light.png'),
        fullPage: true,
      });
    }

    // Clear likely price to demonstrate price/currency removal
    await page.getByLabel('Estimated amount').clear();
    await page.getByRole('button', { name: 'Save changes' }).click();

    await expect(page).toHaveURL('/wants');
    expect(currentDesire.likelyPriceMinor).toBeNull();
    expect(currentDesire.currency).toBeNull();
  });
});
