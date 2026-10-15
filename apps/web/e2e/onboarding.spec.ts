import { test, expect, type Page } from '@playwright/test';
import { resolve } from 'node:path';
import type { ItemResponse, OnboardingStatus } from '@havefolio/contracts';

const demoId = '00000000-0000-4000-a000-000000000019';
const realId = '00000000-0000-4000-a000-000000000020';
const sample = (isDemo: boolean): ItemResponse & { cover: null } => ({
  id: isDemo ? demoId : realId,
  isDemo,
  name: isDemo ? 'Steel kettle' : 'My reading lamp',
  ownershipStatus: 'owned',
  currency: 'INR',
  pricePaidMinor: isDemo ? '180000' : null,
  purchaseDate: { precision: 'unknown', year: null, month: null, day: null },
  acquisitionType: 'bought',
  condition: 'working',
  useFrequency: 'often',
  categoryId: null,
  subcategoryId: null,
  tagIds: [],
  brand: null,
  model: null,
  revision: 1,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  cover: null,
  originalEntry: {},
  originalSource: 'import',
  notes: null,
  description: null,
  specifications: null,
});
async function fixture(page: Page, genuine = 0): Promise<void> {
  let status: OnboardingStatus = {
    state: 'not_started',
    genuineItemCount: genuine,
    demoItemCount: 0,
    browsedStore: false,
    reviewedItem: false,
    triedDemo: false,
    removedDemo: false,
  };
  await page.route('**/api/v1/**', async (route) => {
    const req = route.request(),
      path = new URL(req.url()).pathname;
    let body: unknown = {};
    if (path.startsWith('/api/v1/onboarding')) {
      if (path.endsWith('/actions')) {
        const action = (req.postDataJSON() as { action: string }).action;
        if (action === 'skip') status = { ...status, state: 'skipped' };
        if (action === 'complete') status = { ...status, state: 'completed' };
        if (action === 'revisit') status = { ...status, state: 'active' };
        if (action === 'browse_store') status = { ...status, browsedStore: true };
      }
      if (path.endsWith('/demo'))
        status = {
          ...status,
          demoItemCount: req.method() === 'DELETE' ? 0 : 1,
          triedDemo: true,
          removedDemo: req.method() === 'DELETE',
          state: 'active',
        };
      body = status;
    } else if (path === '/api/v1/items')
      body = {
        items: [
          ...(genuine ? [sample(false)] : []),
          ...(status.demoItemCount ? [sample(true)] : []),
        ],
        hasMore: false,
        nextCursor: null,
      };
    else if (path === '/api/v1/items/' + demoId) body = sample(true);
    else if (path === '/api/v1/taxonomy')
      body = { categories: [], subcategories: [], tags: [], defaultsSeeded: false };
    else if (path === '/api/v1/auth/me') body = { id: realId, displayName: 'Synthetic owner' };
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  });
}
const noOverflow = async (page: Page): Promise<void> => {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
};

for (const theme of ['light', 'dark'] as const) {
  test(`demo opt-in, readonly details and removal preserve manual entry · ${theme}`, async ({
    page,
  }, info) => {
    await page.setViewportSize(
      info.project.name === 'mobile' ? { width: 360, height: 800 } : { width: 1440, height: 1000 },
    );
    await page.addInitScript((value) => localStorage.setItem('theme', value), theme);
    await fixture(page);
    await page.goto('/store');
    await expect(page.getByRole('heading', { name: 'Make yourself at home' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Add my first item' })).toHaveAttribute(
      'href',
      '/items/new',
    );
    await noOverflow(page);
    await page.screenshot({
      path: resolve('../../docs/screenshots', `per-19-welcome-${info.project.name}-${theme}.png`),
      fullPage: true,
    });
    const explore = page.getByRole('button', { name: 'Explore optional demo inventory' });
    await explore.focus();
    await page.keyboard.press('Enter');
    const demo = page.getByRole('link', { name: /Steel kettle Demo/ });
    await expect(demo).toBeVisible();
    await expect(page.getByRole('link', { name: 'Add my first item' })).toBeVisible();
    await page.reload();
    await expect(demo).toBeVisible();
    await noOverflow(page);
    await page.screenshot({
      path: resolve('../../docs/screenshots', `per-19-demo-${info.project.name}-${theme}.png`),
      fullPage: true,
    });
    await demo.click();
    await expect(page.getByRole('heading', { name: 'Steel kettle' })).toBeVisible();
    await expect(page.getByText('Demo · read-only example')).toBeVisible();
    await expect(page.getByRole('button', { name: /Edit|Delete|Refund|Upload/ })).toHaveCount(0);
    await noOverflow(page);
    await page.screenshot({
      path: resolve('../../docs/screenshots', `per-19-details-${info.project.name}-${theme}.png`),
      fullPage: true,
    });
    await page.getByRole('link', { name: 'Back to My Store' }).click();
    await page.getByRole('button', { name: 'Remove all demo data' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Remove demos', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(
      page.getByText('Demo inventory removed. Your genuine items are unchanged.'),
    ).toBeVisible();
    await expect(demo).toHaveCount(0);
    await expect(
      page.getByRole('link', { name: 'Add your first item', exact: true }),
    ).toBeVisible();
    await noOverflow(page);
    await page.screenshot({
      path: resolve('../../docs/screenshots', `per-19-removed-${info.project.name}-${theme}.png`),
      fullPage: true,
    });
  });
}

test('skip persists on refresh and removal retains genuine cards at tablet width', async ({
  page,
}) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  await fixture(page, 1);
  await page.goto('/store');
  await page.getByRole('button', { name: 'Skip for now' }).click();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Revisit welcome help' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Make yourself at home' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Revisit welcome help' }).click();
  await page.getByRole('button', { name: 'Explore optional demo inventory' }).click();
  await expect(page.getByRole('link', { name: /Steel kettle Demo/ })).toBeVisible();
  await page.getByRole('button', { name: 'Remove all demo data' }).click();
  await page.getByRole('button', { name: 'Remove demos', exact: true }).click();
  await expect(page.getByRole('link', { name: /Steel kettle Demo/ })).toHaveCount(0);
  await expect(page.getByRole('link', { name: /My reading lamp/ })).toBeVisible();
  await noOverflow(page);
});
