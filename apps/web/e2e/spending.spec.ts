import { test, expect, type Page } from '@playwright/test';
import { resolve } from 'node:path';
import type { SpendingBucket, SpendingReport, TaxonomySnapshot } from '@havefolio/contracts';

const category = '00000000-0000-4000-a000-000000000021';
const child = '00000000-0000-4000-a000-000000000022';
const taxonomy: TaxonomySnapshot = {
  categories: [
    { id: category, name: 'Kitchen', position: 0, isDemo: false, retiredAt: null, itemCount: 6 },
  ],
  subcategories: [
    {
      id: child,
      categoryId: category,
      name: 'Cookware',
      position: 0,
      isDemo: false,
      retiredAt: '2025-01-01',
      itemCount: 3,
    },
  ],
  tags: [],
  defaultsSeeded: true,
};
const merchantAmazon = '00000000-0000-4000-a000-000000000051';
const merchantFlipkart = '00000000-0000-4000-a000-000000000052';
const bucket = (patch: Partial<SpendingBucket> = {}): SpendingBucket => ({
  currency: 'INR',
  key: null,
  dateBucket: 'dated',
  grossMinor: '125000',
  refundedMinor: '25000',
  netMinor: '100000',
  totalItemCount: 6,
  pricedItemCount: 3,
  unknownPriceCount: 2,
  notSpendingCount: 1,
  explicitZeroCount: 1,
  knownDateCount: 6,
  unknownDateCount: 0,
  missingMerchantCount: 0,
  ...patch,
});
async function fixture(
  page: Page,
  state: {
    empty?: boolean;
    error?: string;
    status?: number;
    taxonomyFails?: boolean;
    offline?: boolean;
  } = {},
): Promise<URL[]> {
  const calls: URL[] = [];
  await page.route('**/api/v1/**', async (route) => {
    const u = new URL(route.request().url());
    calls.push(u);
    let body: unknown = taxonomy,
      status = 200;
    if (u.pathname === '/api/v1/spending') {
      if (state.offline) {
        await route.abort('internetdisconnected');
        return;
      }
      if (state.error) {
        body = { message: state.error };
        status = state.status ?? 400;
      } else {
        const grouping = u.searchParams.get('grouping') as SpendingReport['grouping'];
        const key =
          grouping === 'category'
            ? category
            : grouping === 'subcategory'
              ? child
              : grouping === 'year'
                ? '2024'
                : null;
        let buckets: SpendingBucket[] = [];
        if (!state.empty) {
          if (grouping === 'merchant') {
            buckets = [
              bucket({
                key: merchantAmazon,
                grossMinor: '125000',
                refundedMinor: '25000',
                netMinor: '100000',
                merchant: {
                  id: merchantAmazon,
                  displayName: 'Amazon India',
                  websiteHost: 'amazon.in',
                  state: 'active',
                },
              }),
              bucket({
                key: merchantFlipkart,
                grossMinor: '45000',
                refundedMinor: '0',
                netMinor: '45000',
                merchant: {
                  id: merchantFlipkart,
                  displayName: 'Flipkart',
                  websiteHost: 'flipkart.com',
                  state: 'retired',
                },
              }),
              bucket({
                key: null,
                grossMinor: '20000',
                refundedMinor: '0',
                netMinor: '20000',
                missingMerchantCount: 1,
                merchant: null,
              }),
              bucket({
                key: merchantAmazon,
                currency: 'USD',
                grossMinor: '5000',
                refundedMinor: '0',
                netMinor: '5000',
                merchant: {
                  id: merchantAmazon,
                  displayName: 'Amazon India',
                  websiteHost: 'amazon.in',
                  state: 'active',
                },
              }),
            ];
          } else {
            buckets = [
              bucket({ key }),
              bucket({
                key,
                currency: 'USD',
                grossMinor: '5000',
                refundedMinor: '0',
                netMinor: '5000',
              }),
              bucket({ dateBucket: 'unknownDate', unknownDateCount: 6, knownDateCount: 0 }),
              bucket({ key, dateBucket: 'spanningRange' }),
            ];
          }
        }
        body = {
          scope: u.searchParams.get('scope'),
          grouping,
          basis: 'purchase-date',
          purchasedFrom: u.searchParams.get('purchasedFrom'),
          purchasedTo: u.searchParams.get('purchasedTo'),
          buckets,
        };
      }
    } else if (u.pathname === '/api/v1/items') {
      expect(u.searchParams.get('limit') ?? '25').toBe('25');
      expect(u.searchParams.get('spendingScope')).toMatch(/^(current-owned|all-history)$/);
      expect(u.searchParams.get('spendingDateBucket')).toMatch(
        /^(dated|unknownDate|spanningRange)$/,
      );
      const next = u.searchParams.has('after');
      const isAmazon = u.searchParams.get('merchantId') === merchantAmazon;
      const isUnrecorded = u.searchParams.get('spendingUnassigned') === 'merchant';
      body = {
        items: [
          {
            id: category,
            name: next
              ? 'Synthetic second page kettle'
              : isAmazon
                ? 'Amazon bought kettle'
                : isUnrecorded
                  ? 'Unrecorded merchant kettle'
                  : 'Synthetic first page kettle',
            currency: u.searchParams.get('currency'),
            ownershipStatus: 'owned',
            pricePaidMinor: '125000',
            acquisitionType: 'bought',
            purchaseDate: { precision: 'year', year: 2024, month: null, day: null },
          },
        ],
        hasMore: !next,
        nextCursor: next ? null : 'v1.synthetic-next-page-cursor-which-is-opaque',
      };
    } else if (u.pathname === '/api/v1/taxonomy') {
      if (state.taxonomyFails) {
        status = 503;
        body = { message: 'private SQL failure' };
      }
    } else body = {};
    await route.fulfill({
      status,
      contentType: 'application/json',
      headers: { 'Cache-Control': 'no-store' },
      body: JSON.stringify(body),
    });
  });
  return calls;
}
async function noOverflow(page: Page): Promise<void> {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}
for (const theme of ['light', 'dark'] as const) {
  test(`private spending scopes, exact tables, filters and paginated drill-down · ${theme}`, async ({
    page,
  }, info) => {
    await page.setViewportSize(
      info.project.name === 'mobile' ? { width: 360, height: 800 } : { width: 1440, height: 1000 },
    );
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.addInitScript((t) => localStorage.setItem('theme', t), theme);
    const calls = await fixture(page);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/insights?scope=current-owned&grouping=category');
    await expect(
      page.getByRole('heading', { name: 'Recorded spending', exact: true }),
    ).toBeVisible();
    const summary = page.getByRole('region', { name: 'Recorded spending summary', exact: true });
    await expect(summary).toBeVisible();
    await expect(
      summary.getByRole('region', { name: 'INR Dated purchases summary', exact: true }),
    ).toContainText('INR 1,000.00');
    await expect(
      summary.getByRole('region', { name: 'USD · Currently owned', exact: true }),
    ).toBeVisible();
    await expect(summary).toContainText('Unknown prices');
    await expect(summary).toContainText('Explicit zero amounts');
    await expect(page.getByRole('table').first()).toBeVisible();
    if (info.project.name === 'mobile') {
      const tableScroll = page
        .getByRole('region', { name: /INR.*Dated purchases table, scroll horizontally/ })
        .first();
      await tableScroll.focus();
      await page.keyboard.press('ArrowRight');
      await expect.poll(() => tableScroll.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
      await tableScroll.press('Home');
    }
    await noOverflow(page);
    await page.screenshot({
      path: resolve('../../docs/screenshots', `per-21-owned-${info.project.name}-${theme}.png`),
      fullPage: true,
      animations: 'disabled',
    });
    const navigation = page.getByRole('navigation', { name: 'Primary' }).filter({ visible: true });
    await expect(navigation.getByRole('link', { name: 'Insights', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await page.getByRole('combobox', { name: 'Ownership scope' }).focus();
    await page.keyboard.press('ArrowDown');
    await page.getByRole('option', { name: 'All recorded history', exact: true }).click();
    await expect(page).toHaveURL(/scope=all-history/);
    await expect(summary).toContainText('All recorded history');
    await expect(page.getByRole('table').first()).toContainText('All recorded history');
    await page.screenshot({
      path: resolve('../../docs/screenshots', `per-21-history-${info.project.name}-${theme}.png`),
      fullPage: true,
      animations: 'disabled',
    });
    const rowAction = page
      .getByRole('button', { name: /View items: Kitchen, INR.*Dated purchases/ })
      .first();
    await rowAction.click();
    const dialog = page.getByRole('dialog', { name: 'Matching inventory items' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('link', { name: 'Synthetic first page kettle' })).toBeVisible();
    const itemCall = calls.findLast((u) => u.pathname === '/api/v1/items')!;
    expect(itemCall.searchParams.get('categoryId')).toBe(category);
    expect(itemCall.searchParams.get('spendingScope')).toBe('all-history');
    await dialog.getByRole('button', { name: 'Next 25 items' }).click();
    await expect(dialog.getByRole('link', { name: 'Synthetic second page kettle' })).toBeVisible();
    expect(
      calls.findLast((u) => u.pathname === '/api/v1/items')!.searchParams.get('after'),
    ).toContain('v1.');
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    await expect(rowAction).toBeFocused();
    await page.getByRole('combobox', { name: 'Breakdown' }).click();
    await page.getByRole('option', { name: 'Merchant totals', exact: true }).click();
    await expect(page).toHaveURL(/grouping=merchant/);
    await expect(page.getByRole('heading', { name: 'Merchant totals', exact: true })).toBeVisible();
    await expect(page.getByRole('cell', { name: /Amazon India/ }).first()).toBeVisible();
    await expect(page.getByRole('cell', { name: /amazon\.in/ }).first()).toBeVisible();
    await expect(page.getByRole('cell', { name: /Flipkart \(retired\)/ }).first()).toBeVisible();
    await expect(page.getByRole('cell', { name: /Not recorded/ }).first()).toBeVisible();
    await noOverflow(page);
    await page.screenshot({
      path: resolve('../../docs/screenshots', `per-57-merchant-${info.project.name}-${theme}.png`),
      fullPage: true,
      animations: 'disabled',
    });
    const merchantRowAction = page
      .getByRole('button', { name: /View items: Amazon India/ })
      .first();
    await merchantRowAction.click();
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('link', { name: 'Amazon bought kettle' })).toBeVisible();
    const merchantItemCall = calls.findLast((u) => u.pathname === '/api/v1/items')!;
    expect(merchantItemCall.searchParams.get('merchantId')).toBe(merchantAmazon);
    await page.screenshot({
      path: resolve('../../docs/screenshots', `per-57-drilldown-${info.project.name}-${theme}.png`),
      fullPage: true,
      animations: 'disabled',
    });
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    const unrecordedRowAction = page
      .getByRole('button', { name: /View items: Not recorded/ })
      .first();
    await unrecordedRowAction.click();
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('link', { name: 'Unrecorded merchant kettle' })).toBeVisible();
    const unrecordedItemCall = calls.findLast((u) => u.pathname === '/api/v1/items')!;
    expect(unrecordedItemCall.searchParams.get('spendingUnassigned')).toBe('merchant');
    expect(unrecordedItemCall.searchParams.get('merchantId')).toBeNull();
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    await page.getByRole('combobox', { name: 'Breakdown' }).click();
    await page.getByRole('option', { name: 'Yearly trend', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Yearly trend', exact: true })).toBeVisible();
    await page.getByLabel('From', { exact: true }).fill('2024-02-29');
    await page.getByLabel('To', { exact: true }).fill('2024-02-29');
    await page.getByRole('button', { name: 'Apply date range' }).click();
    await expect(page).toHaveURL(/purchasedFrom=2024-02-29/);
    await expect(
      summary.getByRole('region', { name: 'INR Overlapping the selected range summary' }),
    ).toContainText('not part of the dated amount');
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Yearly trend', exact: true })).toBeVisible();
    await expect(page.getByLabel('From', { exact: true })).toHaveValue('2024-02-29');
    await page.getByRole('button', { name: 'Reset filters', exact: true }).click();
    await expect(page).toHaveURL(/scope=current-owned&grouping=category$/);
    expect(await page.evaluate(() => Object.keys(localStorage))).toEqual(['theme']);
    expect(await page.evaluate(() => Object.keys(sessionStorage))).toEqual([]);
    expect(calls.every((u) => !u.search.includes('gross') && !u.search.includes('125000'))).toBe(
      true,
    );
    expect(errors).toEqual([]);
  });
  test(`unknown-data and empty filtered state · ${theme}`, async ({ page }, info) => {
    await page.setViewportSize(
      info.project.name === 'mobile' ? { width: 360, height: 800 } : { width: 1440, height: 1000 },
    );
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.addInitScript((t) => localStorage.setItem('theme', t), theme);
    const state = { empty: false };
    await fixture(page, state);
    await page.goto('/insights?scope=all-history&grouping=subcategory');
    await expect(page.getByRole('cell', { name: /Cookware \(retired\)/ }).first()).toBeVisible();
    await expect(
      page.getByRole('region', { name: 'INR Purchase date unknown summary' }),
    ).toContainText('Unknown purchase dates');
    await page.screenshot({
      path: resolve('../../docs/screenshots', `per-21-unknown-${info.project.name}-${theme}.png`),
      fullPage: true,
      animations: 'disabled',
    });
    state.empty = true;
    await page.goto('/insights?currency=JPY');
    await expect(page.getByText('No records match these filters')).toBeVisible();
    await noOverflow(page);
    await page.screenshot({
      path: resolve('../../docs/screenshots', `per-21-empty-${info.project.name}-${theme}.png`),
      fullPage: true,
      animations: 'disabled',
    });
  });
}
test('safe network retry, expected validation failures and expired authentication', async ({
  page,
}) => {
  const state: { offline?: boolean; error?: string; status?: number; taxonomyFails?: boolean } = {
    offline: true,
  };
  await fixture(page, state);
  await page.goto('/insights');
  await expect(
    page.getByRole('alert').filter({ hasText: 'Recorded spending could not load' }),
  ).toContainText('offline');
  state.offline = false;
  await page.getByRole('button', { name: 'Retry spending' }).click();
  await expect(page.getByRole('region', { name: 'Recorded spending summary' })).toBeVisible();
  for (const [code, text] of [
    ['SPENDING_BUCKET_LIMIT', 'Narrow'],
    ['SPENDING_PRECISION_UNREPRESENTABLE', 'yearly view'],
    ['INVALID_SPENDING_QUERY', 'Reset filters'],
  ] as const) {
    state.error = code;
    await page.reload();
    await expect(
      page.getByRole('alert').filter({ hasText: 'Recorded spending could not load' }),
    ).toContainText(text);
  }
  state.error = 'private SQL details';
  state.status = 503;
  await page.reload();
  await expect(
    page.getByRole('alert').filter({ hasText: 'Recorded spending could not load' }),
  ).toContainText('temporarily unavailable');
  await expect(
    page.getByRole('alert').filter({ hasText: 'Recorded spending could not load' }),
  ).not.toContainText('SQL');
  state.status = 401;
  await page.reload();
  await expect(page.getByRole('link', { name: 'Sign in', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Recorded spending summary' })).not.toBeVisible();
});
test('mobile More menu preserves Goals and Settings keyboard access', async ({ page }, info) => {
  if (info.project.name !== 'mobile') {
    await fixture(page);
    await page.goto('/insights');
    const nav = page.getByRole('navigation', { name: 'Primary' }).filter({ visible: true });
    await expect(nav.getByRole('link', { name: 'Goals', exact: true })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Settings', exact: true })).toBeVisible();
    return;
  }
  await fixture(page);
  await page.goto('/insights');
  const more = page.getByRole('button', { name: 'More destinations', exact: true });
  await more.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menuitem', { name: 'Goals', exact: true })).toBeVisible();
  await page.getByRole('menuitem', { name: 'Goals', exact: true }).click();
  await expect(page).toHaveURL(/\/goals$/);
  await page.getByRole('button', { name: 'More destinations, current page' }).click();
  await expect(page.getByRole('menuitem', { name: 'Goals', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await page.getByRole('menuitem', { name: 'Settings', exact: true }).click();
  await expect(page).toHaveURL(/\/settings$/);
});
