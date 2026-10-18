import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
test('private-data confirmation and finality recovery', async ({ page }, testInfo) => {
  await page.route('**/api/v1/settings', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        preferences: {
          defaultCurrency: 'INR',
          notifyInApp: true,
          notifyNtfy: false,
          revision: 1,
          updatedAt: '2026-10-18T10:00:00.000Z',
        },
        sessions: [],
        privacy: {
          storageType: 'authenticated_cloudinary',
          storageDescription: 'Photos and documents use private authenticated storage.',
          accessType: 'authenticated_proxy',
          accessDescription: 'Private media requires owner authentication.',
          publicSharing: false,
          sharingDescription: 'No public sharing.',
          registrationLock: { locked: true, reason: 'Single-owner deployment.' },
        },
        demoStatus: { demoItemCount: 0, genuineItemCount: 0, triedDemo: false, removedDemo: false },
      }),
    }),
  );
  await page.route('**/api/v1/privacy/deletion', (route) =>
    route.fulfill({
      status: 202,
      contentType: 'application/json',
      body: JSON.stringify({
        state: 'pending',
        remainingFiles: 1,
        awaitingFinality: 1,
        completedAt: null,
      }),
    }),
  );
  await page.route('**/api/v1/privacy/deletion-status', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        state: 'awaiting_finality',
        remainingFiles: 0,
        awaitingFinality: 1,
        completedAt: null,
      }),
    }),
  );
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Delete my account', exact: true }).click();
  await expect(page.getByRole('alertdialog')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Confirm permanent deletion' })).toBeDisabled();
  await page.getByLabel('Current password').fill('synthetic-not-an-account-password');
  await page.getByLabel('Type DELETE MY ACCOUNT to confirm').fill('DELETE MY ACCOUNT');
  await expect(page.getByRole('button', { name: 'Confirm permanent deletion' })).toBeEnabled();
  const folder = resolve(process.cwd(), '../../docs/screenshots');
  await mkdir(folder, { recursive: true });
  await page.screenshot({
    path: resolve(folder, `per-35-confirmation-${testInfo.project.name}.png`),
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Confirm permanent deletion' }).click();
  await expect(
    page.getByText('Deletion is pending. Your normal sessions have been revoked.'),
  ).toBeVisible();
  await page.getByText('Check deletion status or recover with a saved receipt').click();
  await page.getByRole('button', { name: 'Check deletion status', exact: true }).click();
  await expect(page.getByText(/Deletion is pending provider finality/)).toBeVisible();
  // The receipt is a synthetic capability; hide its input before capturing public evidence.
  await page.locator('#deletion-receipt').fill('');
  await page.screenshot({
    path: resolve(folder, `per-35-finality-${testInfo.project.name}.png`),
    fullPage: true,
  });
});
