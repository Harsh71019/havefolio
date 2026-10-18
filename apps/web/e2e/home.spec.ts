import { test, expect, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { HomeSummary, OnboardingStatus } from '@havefolio/contracts';
import { emptyHomeFixture, homeFixture } from '../test/home-fixture';

const onboarding: OnboardingStatus = {
  state: 'completed',
  genuineItemCount: 42,
  demoItemCount: 0,
  browsedStore: true,
  reviewedItem: true,
  triedDemo: false,
  removedDemo: false,
};
async function fixture(
  page: Page,
  home: () => { status: number; body: unknown },
): Promise<string[]> {
  const requests: string[] = [];
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    requests.push(path);
    const response =
      path === '/api/v1/home'
        ? home()
        : path === '/api/v1/onboarding'
          ? { status: 200, body: onboarding }
          : path === '/api/v1/auth/me'
            ? { status: 200, body: { id: 'synthetic-owner', displayName: 'Synthetic owner' } }
            : { status: 404, body: {} };
    await route.fulfill({
      status: response.status,
      contentType: 'application/json',
      body: JSON.stringify(response.body),
    });
  });
  return requests;
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
      path: resolve(out, `per-33-${name}-${project}-${theme}.png`),
      fullPage: true,
      animations: 'disabled',
    });
  }
}

// Synthetic fixtures only; real contracts and owner isolation are covered by API integration tests.
test('Home summarises the owner’s data in one request with accessible responsive sections', async ({
  page,
}, testInfo) => {
  const requests = await fixture(page, () => ({ status: 200, body: homeFixture }));
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'Remember what your home already holds.',
  );
  for (const name of [
    'Rediscover something you own',
    'Recorded spending',
    'Recently added',
    'Active wants',
    'Goals',
  ])
    await expect(page.getByRole('region', { name })).toBeVisible();
  expect(requests.filter((p) => p === '/api/v1/home')).toHaveLength(1);
  expect(requests.filter((p) => /^\/api\/v1\/(items|spending|desires|goals)/.test(p))).toEqual([]);
  await expect(
    page.getByRole('progressbar', {
      name: 'Goa trip: INR 8,000.00 of INR 40,000.00 confirmed (20%)',
    }),
  ).toBeVisible();
  const open = page.getByRole('link', { name: 'Open this item' });
  await open.focus();
  await expect(open).toBeFocused();
  await expect(open).toHaveAttribute('href', `/items/${homeFixture.rediscovery.item!.id}`);
  await themes(page, 'populated', testInfo.project.name);
});

test('Home empty and failure states keep first actions reachable', async ({ page }, testInfo) => {
  let response: { status: number; body: HomeSummary | object } = { status: 503, body: {} };
  await fixture(page, () => response);
  await page.goto('/');
  await expect(page.getByRole('alert').filter({ hasText: 'could not load' })).toContainText(
    'temporarily unavailable',
  );
  response = { status: 200, body: emptyHomeFixture };
  await page.getByRole('button', { name: 'Retry Home summary' }).click();
  await expect(
    page.getByRole('region', { name: 'Recently added' }).getByRole('link', { name: 'Add an item' }),
  ).toHaveAttribute('href', '/items/new');
  await expect(
    page.getByRole('region', { name: 'Active wants' }).getByRole('link', { name: 'Add a want' }),
  ).toHaveAttribute('href', '/wants/new');
  await themes(page, 'empty', testInfo.project.name);
});
