import { expect, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Merchant, SettingsOverview } from '@havefolio/contracts';
const mockOverview: SettingsOverview = {
  preferences: {
    defaultCurrency: 'INR',
    notifyInApp: true,
    notifyNtfy: true,
    revision: 1,
    updatedAt: '2026-10-18T10:00:00.000Z',
  },
  sessions: [
    {
      id: 's1000000-0000-4000-a000-000000000001',
      createdAt: '2026-10-18T08:00:00.000Z',
      lastUsedAt: '2026-10-18T10:00:00.000Z',
      idleExpiresAt: '2026-10-25T10:00:00.000Z',
      isCurrent: true,
    },
    {
      id: 's2000000-0000-4000-a000-000000000002',
      createdAt: '2026-10-16T12:00:00.000Z',
      lastUsedAt: '2026-10-17T18:30:00.000Z',
      idleExpiresAt: '2026-10-24T18:30:00.000Z',
      isCurrent: false,
    },
  ],
  privacy: {
    storageType: 'authenticated_cloudinary',
    storageDescription:
      'Photos and receipts are stored privately in Cloudinary with signed transformations and strict access controls.',
    accessType: 'authenticated_proxy',
    accessDescription:
      'All media is served through authenticated Havefolio API proxy endpoints. No direct public links or open CDN buckets exist.',
    publicSharing: false,
    sharingDescription:
      'Havefolio has no public profiles, shared wishlists, social feeds, or marketplace integrations.',
    registrationLock: {
      locked: true,
      reason: 'Single-owner instance: public registration is permanently disabled.',
    },
  },
  demoStatus: {
    demoItemCount: 12,
    genuineItemCount: 5,
    triedDemo: true,
    removedDemo: false,
  },
};

test('settings saves custom merchants, preserves failed input, and exposes Categories', async ({
  page,
}, info) => {
  let merchants: Merchant[] = [];
  let failSave = true;
  const consoleErrors: string[] = [];
  page.on('pageerror', (error) => consoleErrors.push(error.message));
  await page.route('**/api/v1/settings', (route) => route.fulfill({ json: mockOverview }));
  await page.route('**/api/v1/auth/me', (route) =>
    route.fulfill({
      json: { id: '11111111-1111-4111-8111-111111111111', displayName: 'Synthetic owner' },
    }),
  );
  await page.route('**/api/v1/taxonomy**', (route) =>
    route.fulfill({ json: { categories: [], subcategories: [], tags: [], defaultsSeeded: true } }),
  );
  await page.route('**/api/v1/merchants**', (route) => {
    const request = route.request();
    if (request.method() === 'POST') {
      if (failSave) {
        failSave = false;
        return route.fulfill({ status: 400, json: { message: 'INVALID_MERCHANT' } });
      }
      const input = request.postDataJSON() as { displayName: string; websiteHost: string | null };
      const merchant: Merchant = {
        id: '22222222-2222-4222-8222-222222222222',
        ...input,
        state: 'active',
        createdAt: '2026-10-18T00:00:00Z',
        updatedAt: '2026-10-18T00:00:00Z',
      };
      merchants.push(merchant);
      return route.fulfill({ status: 201, json: merchant });
    }
    if (request.method() === 'PATCH') {
      const patch = request.postDataJSON() as Partial<Merchant>;
      merchants = merchants.map((merchant) => ({ ...merchant, ...patch }));
      return route.fulfill({ json: merchants[0] });
    }
    const url = new URL(request.url());
    return route.fulfill({
      json: {
        merchants: merchants.filter((merchant) =>
          merchant.displayName
            .toLowerCase()
            .startsWith((url.searchParams.get('q') ?? '').toLowerCase()),
        ),
        hasMore: false,
        nextCursor: null,
      },
    });
  });
  await page.setViewportSize({ width: info.project.name === 'mobile' ? 360 : 1512, height: 950 });
  await page.goto('/settings');
  await page.getByRole('link', { name: 'Manage merchants', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Purchase merchants' })).toBeVisible();
  await page.getByLabel('Merchant name', { exact: true }).fill('Myntra');
  await page.getByLabel('Website host (optional)').fill('https://myntra.com/path');
  await page.getByRole('button', { name: 'Add merchant', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Check the merchant name');
  await expect(page.getByLabel('Merchant name', { exact: true })).toHaveValue('Myntra');
  await page.getByLabel('Website host (optional)').fill('myntra.com');
  await page.getByRole('button', { name: 'Add merchant', exact: true }).click();
  await expect(page.getByRole('heading', { level: 3, name: 'Myntra', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { level: 3, name: 'Myntra', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Retire Myntra', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Restore Myntra', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Restore Myntra', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Retire Myntra', exact: true })).toBeVisible();
  const screenshots = resolve(process.cwd(), '../../docs/screenshots');
  await mkdir(screenshots, { recursive: true });
  for (const theme of ['light', 'dark']) {
    await page.evaluate((value) => localStorage.setItem('theme', value), theme);
    await page.reload();
    await expect(page.locator('html')).toHaveClass(new RegExp(theme));
    await expect(
      page.getByRole('heading', { level: 3, name: 'Myntra', exact: true }),
    ).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({
      path: resolve(screenshots, `per-62-merchants-${info.project.name}-${theme}.png`),
      fullPage: true,
    });
  }
  await page.goto('/items/new');
  const select = page.getByRole('combobox', { name: 'Purchase merchant', exact: true });
  await expect(page.getByText('1 saved merchants shown.')).toBeVisible();
  await select.click();
  await page.getByRole('option', { name: 'Myntra', exact: true }).click();
  await expect(select).toContainText('Myntra');
  if (info.project.name === 'mobile')
    await page.getByRole('button', { name: 'More destinations', exact: true }).click();
  await page
    .getByRole(info.project.name === 'mobile' ? 'menuitem' : 'link', {
      name: 'Categories',
      exact: true,
    })
    .click();
  await expect(page.getByRole('heading', { level: 1, name: 'Categories & tags' })).toBeVisible();
  if (info.project.name === 'mobile')
    await page.getByRole('button', { name: 'More destinations, current page' }).click();
  await expect(
    page.getByRole(info.project.name === 'mobile' ? 'menuitem' : 'link', {
      name: 'Categories',
      exact: true,
    }),
  ).toHaveAttribute('aria-current', 'page');
  await expect(
    page.getByRole(info.project.name === 'mobile' ? 'menuitem' : 'link', {
      name: 'Settings',
      exact: true,
    }),
  ).not.toHaveAttribute('aria-current');
  expect(consoleErrors).toEqual([]);
});
