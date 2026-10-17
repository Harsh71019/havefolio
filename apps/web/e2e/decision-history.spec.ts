import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Desire, ReviewEvent } from '@havefolio/contracts';
const id = 'd1000000-0000-4000-a000-000000000001';
const desire: Desire = {
  id,
  name: 'Synthetic everyday headphones',
  classification: 'want',
  likelyPriceMinor: '159900',
  currency: 'INR',
  productUrl: null,
  reason: null,
  status: 'declined',
  effectiveState: 'declined',
  reviewAt: null,
  waitingStartedAt: null,
  photo: null,
  revision: 3,
  createdAt: '2026-10-16T08:00:00.000Z',
  updatedAt: '2026-10-17T08:00:00.000Z',
};
const original: ReviewEvent = {
  id: 'e1000000-0000-4000-a000-000000000001',
  sequence: 2,
  outcome: 'delayed',
  occurredAt: '2026-10-16T08:00:00.000Z',
  note: 'Review after trying the headphones already at home.',
  linkedItemId: null,
  linkedItemName: null,
  reviewAt: '2026-10-17T08:00:00.000Z',
  supersedesEventId: null,
  estimatedNotSpentMinor: null,
  currency: null,
};
const decision: ReviewEvent = {
  ...original,
  id: 'e2000000-0000-4000-a000-000000000001',
  sequence: 3,
  outcome: 'declined',
  occurredAt: '2026-10-17T08:00:00.000Z',
  note: 'Keep the current pair for now.',
  reviewAt: null,
  estimatedNotSpentMinor: '159900',
  currency: 'INR',
};
// Synthetic browser fixtures verify rendering/navigation; real owner/DB/queue contracts use integration tests.
test('decision timeline, keyboard correction and responsive neutral light/dark themes', async ({
  page,
}, testInfo) => {
  await page.route('**/api/v1/auth/me', (r) =>
    r.fulfill({
      json: { id: 'synthetic-owner', email: 'owner@example.test', displayName: 'Owner' },
    }),
  );
  await page.route(`**/api/v1/desires/${id}`, (r) => r.fulfill({ json: desire }));
  await page.route(`**/api/v1/desires/${id}/reviews`, (r) =>
    r.fulfill({
      json: {
        items: [decision, original],
        nextBefore: null,
        currentEventId: decision.id,
        estimatedNotSpentMinor: '159900',
        currency: 'INR',
      },
    }),
  );
  await page.goto(`/wants/${id}/history`);
  await expect(page.getByRole('heading', { name: 'Decision history', exact: true })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Decision timeline' })).toBeVisible();
  const correct = page.getByRole('button', { name: 'Correct latest decision' });
  await correct.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Record correction' })).toBeVisible();
  const radio = page.getByRole('radio', { name: 'Bought', exact: true });
  await radio.focus();
  await page.keyboard.press('Space');
  await expect(radio).toBeChecked();
  await expect(page.getByLabel('Private note (optional)')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cancel correction' })).toBeVisible();
  const out = resolve(process.cwd(), '../../docs/screenshots');
  await mkdir(out, { recursive: true });
  for (const theme of ['light', 'dark']) {
    await page.evaluate((value) => {
      document.documentElement.classList.remove('light', 'dark');
      document.documentElement.classList.add(value);
      document.documentElement.style.colorScheme = value;
    }, theme);
    await expect(page.locator('html')).toHaveClass(new RegExp(theme));
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    expect(overflow).toBe(false);
    await page.screenshot({
      path: resolve(out, `per-28-history-${testInfo.project.name}-${theme}.png`),
      fullPage: true,
    });
  }
});
