import { test, expect, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import type {
  CreateGoalContributionRequest,
  Desire,
  Goal,
  GoalContribution,
  OnboardingStatus,
} from '@havefolio/contracts';
import { homeFixture } from '../test/home-fixture';

// Synthetic fixtures only; ownership, ledger and revision rules are covered by API integration tests.
const goalId = 'a1000000-0000-4000-a000-000000000032';
const desireId = 'd1000000-0000-4000-a000-000000000032';
const base: Goal = {
  id: goalId,
  name: 'Synthetic trip',
  targetMinor: '4000000',
  currency: 'INR',
  targetDate: '2027-03-01',
  notes: 'Synthetic note',
  status: 'active',
  revision: 3,
  progressMinor: '1000000',
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
};
const others: Goal[] = [
  {
    ...base,
    id: 'b1000000-0000-4000-a000-000000000032',
    name: 'Synthetic course',
    targetMinor: '0',
    progressMinor: '250000',
    targetDate: null,
    status: 'completed',
  },
  {
    ...base,
    id: 'c1000000-0000-4000-a000-000000000032',
    name: 'Synthetic dollar fund',
    currency: 'USD',
    targetMinor: '100000',
    progressMinor: '150000',
    targetDate: null,
  },
];
const first: GoalContribution = {
  id: 'e1000000-0000-4000-a000-000000000032',
  sequence: 2,
  kind: 'contribution',
  amountMinor: '1000000',
  currency: 'INR',
  supersedesId: null,
  note: null,
  createdAt: '2026-10-02T00:00:00Z',
};
const desire: Desire = {
  id: desireId,
  name: 'Synthetic headphones',
  classification: null,
  likelyPriceMinor: '800000',
  currency: 'INR',
  productUrl: null,
  reason: null,
  status: 'active' as Desire['status'],
  effectiveState: 'considering',
  waitingStartedAt: null,
  reviewAt: null,
  photo: null,
  revision: 1,
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
};
const onboarding: OnboardingStatus = {
  state: 'completed',
  genuineItemCount: 1,
  demoItemCount: 0,
  browsedStore: true,
  reviewedItem: true,
  triedDemo: false,
  removedDemo: false,
};

async function fixture(page: Page): Promise<CreateGoalContributionRequest[]> {
  let goal = base;
  let ledger = [first];
  const commands: CreateGoalContributionRequest[] = [];
  await page.route('**/api/v1/**', async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    const json = (body: unknown, status = 200): Promise<void> =>
      route.fulfill({ status, json: body });
    if (path === '/api/v1/auth/me') return json({ id: 'synthetic-owner', displayName: 'Owner' });
    if (path === '/api/v1/onboarding') return json(onboarding);
    if (path === '/api/v1/home')
      return json({ ...homeFixture, goals: { activeCount: 1, items: [goal] } });
    if (path === '/api/v1/goals') return json({ items: [goal, ...others], nextAfter: null });
    if (path === `/api/v1/goals/${goalId}`) return json(goal);
    if (path === `/api/v1/goals/${goalId}/contributions` && req.method() === 'POST') {
      const body = req.postDataJSON() as CreateGoalContributionRequest;
      commands.push(body);
      if (commands.length === 1) {
        // The write commits but the response is lost: the retry must reuse the identical body.
        goal = { ...goal, revision: 4, progressMinor: '1250050' };
        ledger = [
          {
            ...first,
            id: 'f1000000-0000-4000-a000-000000000032',
            sequence: 3,
            amountMinor: body.amountMinor,
          },
          ...ledger,
        ];
        return route.abort('failed');
      }
      return json(ledger[0], 201);
    }
    if (path === `/api/v1/goals/${goalId}/contributions`)
      return json({ items: ledger, nextBefore: null });
    if (path === `/api/v1/desires/${desireId}`) return json(desire);
    return json({}, 404);
  });
  return commands;
}
async function themes(page: Page, name: string, project: string): Promise<void> {
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
      path: resolve(out, `per-32-${name}-${project}-${theme}.png`),
      fullPage: true,
      animations: 'disabled',
    });
  }
}

test('Home reaches goals; list and detail expose text progress and retry-safe contributions', async ({
  page,
}, info) => {
  const commands = await fixture(page);
  await page.goto('/');
  await page.getByRole('link', { name: 'Open Goals' }).click();
  await expect(page).toHaveURL(/\/goals$/);
  await expect(
    page.getByRole('progressbar', { name: 'Synthetic trip: ₹10,000 of ₹40,000 confirmed (25%)' }),
  ).toBeVisible();
  await expect(
    page.getByText('Synthetic course: ₹2,500 confirmed · no target amount set'),
  ).toBeVisible();
  await expect(page.getByText(/\$1,500 of \$1,000 confirmed \(150%\)/)).toBeVisible();
  await themes(page, 'list', info.project.name);

  await page.getByRole('link', { name: 'Synthetic trip' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Synthetic trip' })).toBeVisible();
  const record = page.getByRole('button', { name: 'Record a contribution' });
  await record.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText('No transfer, deposit or investment happens');
  await dialog.getByLabel(/Amount/).fill('2500.50');
  await dialog.getByRole('button', { name: 'Confirm' }).click();
  await expect(dialog.getByRole('button', { name: 'Retry' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Retry' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'no money was moved' })).toBeVisible();
  expect(commands).toHaveLength(2);
  expect(commands[1]).toEqual(commands[0]);
  expect(commands[0]).toMatchObject({ amountMinor: '250050', revision: 3, kind: 'contribution' });
  await expect(page.locator('#goal-progress-text')).toHaveText(
    '₹12,500.50 of ₹40,000 confirmed (31.25%)',
  );
  await themes(page, 'detail', info.project.name);
  await page.getByRole('button', { name: 'Archive' }).click();
  await expect(page.getByRole('alertdialog')).toContainText('full history stay readable');
  await themes(page, 'archive-confirm', info.project.name);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('alertdialog')).toBeHidden();
});

test('want-side comparison is hypothetical, currency-safe and keyboard operable', async ({
  page,
}, info) => {
  const commands = await fixture(page);
  await page.goto(`/wants/${desireId}/goals`);
  await expect(page.getByRole('heading', { level: 1, name: 'Compare with a goal' })).toBeVisible();
  await expect(page.getByRole('radio', { name: /Synthetic dollar fund/ })).toBeDisabled();
  const trip = page.getByRole('radio', { name: /Synthetic trip/ });
  await trip.focus();
  await page.keyboard.press('Space');
  await expect(page.getByText(/could cover 20% of the ₹40,000 target/)).toContainText(
    '26.66% of the ₹30,000 still to go',
  );
  await expect(page.getByText(/This is a possibility, not a saving/)).toContainText('₹10,000');
  await themes(page, 'compare', info.project.name);
  await page.getByRole('radio', { name: /Synthetic course/ }).click();
  await expect(page.getByText(/no target amount, so no percentage/)).toBeVisible();
  expect(commands).toHaveLength(0);
});
