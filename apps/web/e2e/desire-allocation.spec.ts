import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { DesireAllocationState, ConfirmDesireAllocationRequest } from '@havefolio/contracts';
const id = 'd1000000-0000-4000-a000-000000000031';
const goal = {
  id: 'a1000000-0000-4000-a000-000000000031',
  name: 'Synthetic trip',
  currency: 'INR',
  targetMinor: '4000000',
  progressMinor: '0',
  status: 'active',
  revision: 1,
};
const initial: DesireAllocationState = {
  currentReviewEventId: 'e1000000-0000-4000-a000-000000000031',
  estimatedNotSpentMinor: '800000',
  currency: 'INR',
  allocation: null,
};
test('explicit allocation: keyboard, retry, mobile/desktop light/dark, reversal history', async ({
  page,
}, info) => {
  let state = initial;
  const commands: ConfirmDesireAllocationRequest[] = [];
  await page.route('**/api/v1/auth/me', (r) =>
    r.fulfill({
      json: { id: 'synthetic-owner', email: 'owner@example.test', displayName: 'Owner' },
    }),
  );
  await page.route('**/api/v1/goals?*', (r) =>
    r.fulfill({ json: { items: [goal], nextAfter: null } }),
  );
  await page.route(`**/api/v1/desires/${id}/allocation`, async (r) => {
    if (r.request().method() === 'POST') {
      commands.push(r.request().postDataJSON() as ConfirmDesireAllocationRequest);
      state = {
        ...initial,
        allocation: {
          sourceReviewEventId: initial.currentReviewEventId!,
          sourceChanged: false,
          goal: { ...goal, progressMinor: '800000', revision: 2 },
          rootContributionId: 'c1000000-0000-4000-a000-000000000031',
          currentContribution: {
            id: 'c1000000-0000-4000-a000-000000000031',
            sequence: 2,
            kind: 'contribution',
            amountMinor: '800000',
            currency: 'INR',
            supersedesId: null,
            note: null,
            createdAt: '2026-10-18T00:00:00Z',
          },
        },
      };
      if (commands.length === 1) return r.abort('failed'); // Committed response lost: retry must reuse body.
      return r.fulfill({ status: 201, json: state });
    }
    return r.fulfill({ json: state });
  });
  await page.route(`**/api/v1/goals/${goal.id}/contributions`, (r) => {
    const old = state.allocation!;
    state = {
      ...state,
      allocation: {
        ...old,
        goal: { ...old.goal!, progressMinor: '0', revision: 3 },
        currentContribution: {
          ...old.currentContribution!,
          id: 'f1000000-0000-4000-a000-000000000031',
          kind: 'reversal',
          amountMinor: '0',
          supersedesId: old.currentContribution!.id,
          sequence: 3,
        },
      },
    };
    return r.fulfill({ status: 201, json: state.allocation!.currentContribution });
  });
  await page.route(`**/api/v1/desires/${id}/allocation/history`, (r) =>
    r.fulfill({ json: { items: [state.allocation!.currentContribution], nextBefore: null } }),
  );
  await page.goto(`/wants/${id}/allocate`);
  await expect(page.getByRole('heading', { name: 'Goal allocation', exact: true })).toBeVisible();
  const radio = page.getByRole('radio', { name: /Synthetic trip/ });
  await radio.focus();
  await page.keyboard.press('Space');
  await expect(page.getByText(/could cover 20%/)).toContainText('Confirmed progress remains ₹0');
  expect(commands).toHaveLength(0);
  await page.getByRole('button', { name: 'Allocate', exact: true }).focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText('No bank transfer, deposit or investment occurs');
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(
    dialog.getByRole('button', { name: 'Confirm allocation', exact: true }),
  ).toBeFocused();
  const out = resolve(process.cwd(), '../../docs/screenshots');
  await mkdir(out, { recursive: true });
  for (const theme of ['light', 'dark']) {
    await page.evaluate((t) => {
      document.documentElement.classList.remove('light', 'dark');
      document.documentElement.classList.add(t);
      document.documentElement.style.colorScheme = t;
    }, theme);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
      false,
    );
    await page.screenshot({
      path: resolve(out, `per-31-confirm-${info.project.name}-${theme}.png`),
      fullPage: true,
    });
  }
  await dialog.getByRole('button', { name: 'Confirm allocation', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Retry confirmation' })).toBeVisible();
  await page.getByRole('button', { name: 'Retry confirmation' }).click();
  await expect(page.getByText(/allocated to Synthetic trip/)).toBeVisible();
  expect(commands).toHaveLength(2);
  expect(commands[0]).toEqual(commands[1]);
  expect(commands[1]!.confirmed).toBe(true);
  await page.getByRole('button', { name: 'Reverse allocation' }).click();
  await page.getByRole('button', { name: 'Confirm reversal' }).click();
  await expect(page.getByText(/allocated to Synthetic trip/)).toContainText('reversed');
  await page.getByRole('button', { name: 'View allocation history' }).click();
  await expect(page.getByRole('list', { name: 'Allocation history' })).toContainText('reversal');
});
