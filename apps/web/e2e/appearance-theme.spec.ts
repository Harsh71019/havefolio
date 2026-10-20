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

test.describe('PER-76: Accessible Theme Presets & Appearance Settings', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/v1/settings**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockOverview),
      });
    });
  });

  test('switches display modes and palette presets independently with zero-flash persistence and captures screenshots', async ({
    page,
  }, info) => {
    const screenshots = resolve(process.cwd(), '../../docs/screenshots');
    await mkdir(screenshots, { recursive: true });

    await page.goto('/settings');
    await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Appearance' })).toBeVisible();

    // 1. Initial State: Neutral palette, Light mode (or system default)
    // Explicitly set to Light mode and Neutral palette
    await page.getByRole('radio', { name: /^Light\b/ }).click();
    await page.getByRole('radio', { name: /^Neutral\b/ }).click();

    await expect(page.locator('html')).toHaveAttribute('data-palette', 'neutral');
    await expect(page.locator('html')).not.toHaveClass(/dark/);

    if (info.project.name === 'desktop') {
      await page.screenshot({
        path: resolve(screenshots, 'per-76-settings-desktop-neutral-light.png'),
        fullPage: true,
      });
    } else {
      await page.screenshot({
        path: resolve(screenshots, 'per-76-settings-mobile-neutral-light.png'),
        fullPage: true,
      });
    }

    // 2. Ocean Palette in Light Mode
    await page.getByRole('radio', { name: /^Ocean\b/ }).click();
    await expect(page.locator('html')).toHaveAttribute('data-palette', 'ocean');
    await expect(page.locator('html')).not.toHaveClass(/dark/);

    if (info.project.name === 'desktop') {
      await page.screenshot({
        path: resolve(screenshots, 'per-76-settings-desktop-ocean-light.png'),
        fullPage: true,
      });
    }

    // 3. Ocean Palette in Dark Mode
    await page.getByRole('radio', { name: /^Dark\b/ }).click();
    await expect(page.locator('html')).toHaveAttribute('data-palette', 'ocean');
    await expect(page.locator('html')).toHaveClass(/dark/);

    if (info.project.name === 'desktop') {
      await page.screenshot({
        path: resolve(screenshots, 'per-76-settings-desktop-ocean-dark.png'),
        fullPage: true,
      });
    } else {
      await page.screenshot({
        path: resolve(screenshots, 'per-76-settings-mobile-ocean-dark.png'),
        fullPage: true,
      });
    }

    // 4. Forest Palette in Dark Mode
    await page.getByRole('radio', { name: /^Forest\b/ }).click();
    await expect(page.locator('html')).toHaveAttribute('data-palette', 'forest');
    await expect(page.locator('html')).toHaveClass(/dark/);

    if (info.project.name === 'desktop') {
      await page.screenshot({
        path: resolve(screenshots, 'per-76-settings-desktop-forest-dark.png'),
        fullPage: true,
      });
    } else {
      await page.screenshot({
        path: resolve(screenshots, 'per-76-settings-mobile-forest-dark.png'),
        fullPage: true,
      });
    }

    // 5. Forest Palette in Light Mode
    await page.getByRole('radio', { name: /^Light\b/ }).click();
    await expect(page.locator('html')).toHaveAttribute('data-palette', 'forest');
    await expect(page.locator('html')).not.toHaveClass(/dark/);

    if (info.project.name === 'desktop') {
      await page.screenshot({
        path: resolve(screenshots, 'per-76-settings-desktop-forest-light.png'),
        fullPage: true,
      });
    }

    // 6. Persistence across reload
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-palette', 'forest');
    await expect(page.locator('html')).not.toHaveClass(/dark/);
    await expect(page.getByRole('radio', { name: /^Forest\b/ })).toBeChecked();
    await expect(page.getByRole('radio', { name: /^Light\b/ })).toBeChecked();

    // 7. Reset to System mode and Neutral
    await page.getByRole('radio', { name: /^System\b/ }).click();
    await page.getByRole('radio', { name: /^Neutral\b/ }).click();
    await expect(page.locator('html')).toHaveAttribute('data-palette', 'neutral');
  });
});
