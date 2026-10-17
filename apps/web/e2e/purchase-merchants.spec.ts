import { expect, test, type Page } from '@playwright/test';
import type { ItemResponse, Merchant } from '@havefolio/contracts';
const id = '11111111-1111-4111-8111-111111111111';
const source: Merchant = {
  id: '22222222-2222-4222-8222-222222222222',
  displayName: 'Local seller',
  websiteHost: null,
  state: 'active',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};
const base: ItemResponse = {
  id,
  isDemo: false,
  name: 'Synthetic kettle',
  currency: 'INR',
  pricePaidMinor: null,
  purchaseDate: { precision: 'unknown' },
  acquisitionType: 'unknown',
  condition: 'working',
  useFrequency: 'unknown',
  ownershipStatus: 'owned',
  categoryId: null,
  subcategoryId: null,
  tagIds: [],
  brand: null,
  model: null,
  description: null,
  notes: null,
  specifications: null,
  revision: 1,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  originalEntry: { name: 'Synthetic kettle' },
  originalSource: 'manual',
  merchantId: source.id,
  merchant: source,
  purchaseUrl: 'https://shop.example.test/synthetic?ref=synthetic',
};
async function fixtures(page: Page): Promise<{
  item: ItemResponse;
  patches: Record<string, unknown>[];
  failMerchant: boolean;
  failItem: boolean;
}> {
  const state = {
    item: { ...base },
    patches: [] as Record<string, unknown>[],
    failMerchant: false,
    failItem: false,
  };
  await page.route('**/api/v1/auth/me', (r) =>
    r.fulfill({
      json: { id: '33333333-3333-4333-8333-333333333333', displayName: 'Synthetic owner' },
    }),
  );
  await page.route('**/api/v1/taxonomy**', (r) =>
    r.fulfill({ json: { categories: [], subcategories: [], tags: [], defaultsSeeded: true } }),
  );
  await page.route('**/api/v1/merchants**', (r) => {
    if (state.failMerchant) return r.abort('internetdisconnected');
    const body = r.request().postDataJSON() as {
      displayName?: string;
      state?: Merchant['state'];
    } | null;
    return r.fulfill({
      status: r.request().method() === 'POST' ? 201 : 200,
      json:
        r.request().method() === 'GET'
          ? { merchants: [source], hasMore: false, nextCursor: null }
          : { ...source, ...body },
    });
  });
  await page.route('**/api/v1/items**', (r) => {
    const url = new URL(r.request().url()),
      method = r.request().method();
    if (url.pathname.endsWith('/history'))
      return r.fulfill({
        json: {
          events: [
            {
              id,
              eventType: 'details_updated',
              occurredAt: base.createdAt,
              createdAt: base.createdAt,
              metadata: { fields: ['merchantId', 'purchaseUrl'] },
            },
          ],
          hasMore: false,
          nextCursor: null,
        },
      });
    if (url.pathname.endsWith('/photos'))
      return r.fulfill({ json: { photos: [], revision: state.item.revision } });
    if (url.pathname.endsWith('/documents'))
      return r.fulfill({ json: { documents: [], revision: state.item.revision } });
    if (url.pathname.endsWith('/refunds'))
      return r.fulfill({
        json: {
          revision: state.item.revision,
          ownershipStatus: 'owned',
          acquisitionType: 'unknown',
          totals: { currency: 'INR', amountPaidMinor: null, refundedMinor: '0', netMinor: null },
          refunds: [],
        },
      });
    if (method === 'PATCH') {
      const body = r.request().postDataJSON() as Record<string, unknown>;
      state.patches.push(body);
      if (state.failItem) return r.fulfill({ status: 503, json: { message: 'ITEMS_UNAVAILABLE' } });
      state.item = {
        ...state.item,
        ...body,
        merchant: body.merchantId === null ? null : (state.item.merchant ?? null),
        revision: state.item.revision + 1,
      };
    }
    if (method === 'POST') {
      const body = r.request().postDataJSON() as ItemResponse;
      return r.fulfill({ status: 201, json: { ...base, ...body, id } });
    }
    return r.fulfill({ json: state.item });
  });
  return state;
}
test('purchase detail and edit remain private, responsive and keyboard accessible in both themes', async ({
  page,
}, info) => {
  const state = await fixtures(page);
  await page.goto(`/items/${id}`);
  await expect(page.getByRole('heading', { name: base.name, level: 1 })).toBeVisible();
  const link = page.getByRole('link', { name: 'Open purchase page' });
  await expect(link).toHaveAttribute('href', base.purchaseUrl!);
  await expect(link).toHaveAttribute('rel', 'noreferrer noopener');
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(page.getByText('Local seller', { exact: true })).toBeVisible();
  await expect(page.getByText(base.purchaseUrl!, { exact: true })).toHaveCount(0);
  for (const theme of ['light', 'dark']) {
    await page.evaluate((value) => {
      localStorage.setItem('theme', value);
      document.documentElement.classList.remove('light', 'dark');
      document.documentElement.classList.add(value);
    }, theme);
    await page.screenshot({
      path: `../../docs/screenshots/per-56-detail-${info.project.name}-${theme}.png`,
      fullPage: true,
    });
    await page.getByRole('button', { name: 'Edit purchase details', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Edit purchase details' });
    await expect(dialog.getByRole('combobox', { name: 'Purchase merchant' })).toBeVisible();
    await expect(dialog.getByLabel('Purchase URL (optional)')).toHaveValue(base.purchaseUrl!);
    await expect(page.locator('html')).toHaveClass(new RegExp(theme));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await dialog.getByLabel('Search saved merchants').fill('Local');
    await expect(dialog.getByText('1 saved merchants shown.')).toBeVisible();
    await dialog.evaluate((el) => {
      const source = [...el.querySelectorAll('fieldset')].find((field) =>
        field.querySelector('legend')?.textContent?.includes('Where you purchased'),
      );
      if (source)
        el.scrollTop += source.getBoundingClientRect().top - el.getBoundingClientRect().top - 24;
    });
    await dialog.screenshot({
      path: `../../docs/screenshots/per-56-edit-${info.project.name}-${theme}.png`,
    });
    await page.keyboard.press('Escape');
  }
  await page.getByRole('button', { name: 'Edit purchase details', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit purchase details' });
  state.failItem = true;
  await dialog.getByLabel('Purchase URL (optional)').fill('http://shop.example.test/corrected');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog.getByLabel('Purchase URL (optional)')).toHaveValue(
    'http://shop.example.test/corrected',
  );
  state.failItem = false;
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect(state.patches.at(-1)).toEqual({
    revision: 1,
    purchaseUrl: 'http://shop.example.test/corrected',
  });
  await page.getByRole('button', { name: 'Edit purchase details', exact: true }).click();
  const select = page.getByRole('combobox', { name: 'Purchase merchant' });
  await select.focus();
  await page.keyboard.press('ArrowDown');
  await page.getByRole('option', { name: 'Not recorded', exact: true }).click();
  await page.getByLabel('Purchase URL (optional)').fill('');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  expect(state.patches.at(-1)).toEqual({ revision: 2, merchantId: null, purchaseUrl: null });
  await expect(page.getByRole('link', { name: 'Open purchase page' })).toHaveCount(0);
});
test('manual item entry survives merchant outage and custom merchant creation works after retry', async ({
  page,
}, info) => {
  const state = await fixtures(page);
  state.failMerchant = true;
  await page.goto('/items/new');
  await page.getByLabel(/Item name/).fill('Synthetic offline item');
  await page.getByLabel('Price unknown', { exact: true }).check();
  await page.getByLabel('Date unknown', { exact: true }).check();
  await page.getByLabel('Purchase URL (optional)').fill('https://shop.example.test/synthetic');
  await expect(
    page.getByText('Could not connect. Your entries are kept; check your connection and retry.'),
  ).toBeVisible();
  await expect(page.getByLabel(/Item name/)).toHaveValue('Synthetic offline item');
  state.failMerchant = false;
  await page.getByRole('button', { name: 'Retry merchants' }).click();
  await expect(page.getByText('1 saved merchants shown.')).toBeVisible();
  await page.getByText('Create a custom merchant', { exact: true }).click();
  await page.getByLabel('Merchant name', { exact: true }).fill('Offline seller');
  await page.getByRole('button', { name: 'Create and select merchant' }).click();
  await expect(page.getByRole('combobox', { name: 'Purchase merchant' })).toContainText(
    'Offline seller',
  );
  await expect(page.getByLabel('Purchase URL (optional)')).toHaveValue(
    'https://shop.example.test/synthetic',
  );
  for (const theme of ['light', 'dark']) {
    await page.evaluate((value) => {
      document.documentElement.classList.remove('light', 'dark');
      document.documentElement.classList.add(value);
    }, theme);
    await page
      .getByRole('group', { name: 'Where you purchased it (optional)', exact: true })
      .screenshot({ path: `../../docs/screenshots/per-56-add-${info.project.name}-${theme}.png` });
  }
  await page.getByRole('button', { name: 'Save item', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Synthetic offline item saved to your home' }),
  ).toBeVisible();
});
