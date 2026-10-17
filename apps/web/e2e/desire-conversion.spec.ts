import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { DesireConversion, DesireConversionState } from '@havefolio/contracts';
const id = 'd1000000-0000-4000-a000-000000000001';
const state: DesireConversionState = {
  desireId: id,
  eligibility: 'eligible',
  boughtEventId: 'e1000000-0000-4000-a000-000000000001',
  suggestions: {
    name: 'Synthetic steel water bottle',
    notes: 'Replacing the cracked bottle for daily commutes.',
    productUrl: 'https://shop.example.test/bottle',
    photo: null,
    likelyPriceMinor: '89900',
    likelyCurrency: 'INR',
  },
  conversion: null,
};
const conversion: DesireConversion = {
  id: 'c1000000-0000-4000-a000-000000000001',
  desireId: id,
  itemId: 'a1000000-0000-4000-a000-000000000001',
  itemName: 'Synthetic steel water bottle',
  boughtEventId: state.boughtEventId!,
  boughtOutcomeCurrent: true,
  photo: 'not_requested',
  createdAt: '2026-10-17T08:00:00.000Z',
};
// Synthetic browser fixtures verify rendering/keyboard flow; real contracts use API integration tests.
test('optional conversion: keyboard confirmation, responsive neutral light/dark themes', async ({
  page,
}, testInfo) => {
  let submitted: unknown;
  await page.route('**/api/v1/auth/me', (r) =>
    r.fulfill({
      json: { id: 'synthetic-owner', email: 'owner@example.test', displayName: 'Owner' },
    }),
  );
  await page.route(`**/api/v1/desires/${id}/conversion`, (r) => {
    if (r.request().method() === 'POST') {
      submitted = r.request().postDataJSON();
      return r.fulfill({ status: 201, json: conversion });
    }
    return r.fulfill({ json: state });
  });
  await page.goto(`/wants/${id}/convert`);
  await expect(page.getByRole('heading', { name: 'Add to your inventory' })).toBeVisible();
  await expect(page.getByText('Suggested from your want').first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'Keep only the bought decision' })).toBeVisible();
  const out = resolve(process.cwd(), '../../docs/screenshots');
  await mkdir(out, { recursive: true });
  for (const theme of ['light', 'dark']) {
    await page.evaluate((value) => {
      document.documentElement.classList.remove('light', 'dark');
      document.documentElement.classList.add(value);
      document.documentElement.style.colorScheme = value;
    }, theme);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
    ).toBe(false);
    await page.screenshot({
      path: resolve(out, `per-29-convert-${testInfo.project.name}-${theme}.png`),
      fullPage: true,
    });
  }
  // Submitting without confirmation focuses a summary instead of guessing facts.
  await page.getByRole('button', { name: 'Add to inventory' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'before adding' })).toBeFocused();
  // Keyboard-only confirmation of radio facts.
  const unknown = page.getByRole('radio', { name: /I don’t know \(left out/ });
  await unknown.focus();
  await page.keyboard.press('Space');
  await expect(unknown).toBeChecked();
  const yearOnly = page.getByRole('radio', { name: 'Year only' });
  await yearOnly.focus();
  await page.keyboard.press('Space');
  await page.getByLabel('Year', { exact: true }).fill('2026');
  for (const [combo, option] of [
    ['Currency paid', /INR/],
    ['How you got it', 'Bought new'],
    ['Ownership now', 'Currently owned'],
    ['Condition', 'Working well'],
    ['Expected use', /Often/],
  ] as const) {
    await page.getByRole('combobox', { name: combo }).click();
    await page.getByRole('option', { name: option }).click();
  }
  await page.getByRole('button', { name: 'Add to inventory' }).click();
  await expect(page.getByText('Added to your inventory.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Synthetic steel water bottle' })).toHaveAttribute(
    'href',
    `/items/${conversion.itemId}`,
  );
  expect(submitted).toMatchObject({
    item: {
      pricePaid: { state: 'unknown' },
      purchaseDate: { precision: 'year', year: 2026 },
      currency: 'INR',
    },
  });
  expect(JSON.stringify(submitted)).not.toContain('89900');
});
