import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { SettingsOverview } from '@havefolio/contracts';

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

test.describe('Owner Settings', () => {
  test.beforeEach(async ({ page }) => {
    await page.route(/\/api\/v1\/settings$/, async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(mockOverview),
        });
      } else if (route.request().method() === 'PATCH') {
        const body = route.request().postDataJSON();
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            defaultCurrency: body.defaultCurrency ?? 'INR',
            notifyInApp: body.notifyInApp ?? true,
            notifyNtfy: body.notifyNtfy ?? true,
            revision: 2,
            updatedAt: '2026-10-18T10:05:00.000Z',
          }),
        });
      }
    });

    await page.route(/\/api\/v1\/settings\/sessions\/[^/]+$/, async (route) => {
      if (route.request().method() === 'DELETE') {
        await route.fulfill({
          status: 204,
        });
      }
    });

    await page.route(/\/api\/v1\/settings\/sessions$/, async (route) => {
      if (route.request().method() === 'DELETE') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ revokedCount: 1 }),
        });
      }
    });
  });

  test('displays settings sections, handles theme switching and captures sanitized screenshots', async ({
    page,
  }, info) => {
    await page.goto('/settings');
    await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
    await expect(page.getByText('Defaults & Reminders')).toBeVisible();
    await expect(page.getByText('Active Sessions')).toBeVisible();
    await expect(page.getByText('Demo Inventory')).toBeVisible();
    await expect(page.getByText('Privacy & Security')).toBeVisible();
    await expect(page.getByText('Categories & Tags')).toBeVisible();

    const screenshots = resolve(process.cwd(), '../../docs/screenshots');
    await mkdir(screenshots, { recursive: true });

    for (const theme of ['light', 'dark'] as const) {
      await page.evaluate((value) => {
        localStorage.setItem('theme', value);
      }, theme);
      await page.reload();
      await expect(page.locator('html')).toHaveClass(new RegExp(theme));
      await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();

      // Ensure content has rendered
      await expect(page.getByText('Defaults & Reminders')).toBeVisible();
      await expect(page.getByText('Private media storage')).toBeVisible();
      await expect(page.getByText('Registration lock')).toBeVisible();

      await page.screenshot({
        path: resolve(screenshots, `per-34-${info.project.name}-${theme}.png`),
        fullPage: true,
      });
    }
  });

  test('allows changing currency and toggling notification channels', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();

    const currencySelect = page.getByRole('combobox', {
      name: 'Default entry and display currency',
    });
    await expect(currencySelect).toHaveText('INR');

    await currencySelect.click();
    await page.getByRole('option', { name: 'USD' }).click();
    await expect(currencySelect).toHaveText('USD');

    const inAppToggle = page.getByRole('switch', {
      name: 'Toggle in-app review reminders',
    });
    await expect(inAppToggle).toHaveAttribute('aria-checked', 'true');
    await inAppToggle.click();
    await expect(inAppToggle).toHaveAttribute('aria-checked', 'false');

    await page.getByRole('button', { name: 'Save preferences' }).click();
  });

  test('allows revoking other sessions with confirmation', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();

    const revokeButtons = page.getByRole('button', { name: 'Revoke' });
    await expect(revokeButtons).toHaveCount(1);
    await revokeButtons.first().click();

    // Dialog appears
    await expect(page.getByRole('alertdialog')).toBeVisible();
    await expect(page.getByText('Revoke this session?')).toBeVisible();

    await page.getByRole('button', { name: 'Revoke session' }).click();
    await expect(page.getByRole('alertdialog')).not.toBeVisible();
  });
});
