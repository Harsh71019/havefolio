import { expect, test, type Page, type Route } from '@playwright/test';

const id = (n: number): string => `00000000-0000-4000-a000-${String(n).padStart(12, '0')}`;
const kitchen = id(901);
const appliances = id(911);
const daily = id(921);
const shot = (name: string): string => `../../docs/screenshots/per-18-${name}.png`;
// Synthetic flat illustration only: no user content or provider data.
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900"><rect width="100%" height="100%" fill="#7c9a92"/><circle cx="600" cy="450" r="220" fill="#fff" fill-opacity="0.55"/></svg>`;

type Entry = Record<string, unknown>;
const complete: Entry = {
  id: id(1),
  name: 'Electric kettle',
  ownershipStatus: 'owned',
  currency: 'INR',
  pricePaidMinor: '249900',
  purchaseDate: { precision: 'exact', year: 2024, month: 3, day: 12 },
  acquisitionType: 'bought',
  condition: 'working',
  useFrequency: 'often',
  categoryId: kitchen,
  subcategoryId: appliances,
  tagIds: [daily],
  brand: 'Prestige',
  model: 'PKOSS 1.5',
  description: 'Steel body, 1.5 litre.',
  notes: 'Descale every month with citric acid.',
  specifications: { Wattage: '1500 W', Capacity: '1.5 L' },
  revision: 4,
  createdAt: '2026-09-01T05:30:00.000Z',
  updatedAt: '2026-09-20T05:30:00.000Z',
  originalEntry: { name: 'Electric kettle' },
  originalSource: 'manual',
};
const sparse: Entry = {
  ...complete,
  id: id(2),
  name: 'Umbrella',
  pricePaidMinor: null,
  purchaseDate: { precision: 'unknown', year: null, month: null, day: null },
  acquisitionType: 'unknown',
  condition: 'unknown',
  useFrequency: 'unknown',
  categoryId: null,
  subcategoryId: null,
  tagIds: [],
  brand: null,
  model: null,
  description: null,
  notes: null,
  specifications: null,
  revision: 1,
};
const taxonomy = {
  categories: [
    { id: kitchen, name: 'Kitchen', position: 0, isDemo: false, retiredAt: null, itemCount: 2 },
  ],
  subcategories: [
    {
      id: appliances,
      categoryId: kitchen,
      name: 'Appliances',
      position: 0,
      isDemo: false,
      retiredAt: null,
      itemCount: 2,
    },
  ],
  tags: [{ id: daily, name: 'Daily use', itemCount: 1 }],
  defaultsSeeded: true,
};
const history = [
  ['created', '2026-09-01T05:30:00.000Z', '2026-09-01T05:30:00.000Z', { ownershipStatus: 'owned' }],
  [
    'details_updated',
    '2026-09-05T05:30:00.000Z',
    '2026-09-05T05:30:00.000Z',
    { fields: ['pricePaidMinor', 'purchaseDate'] },
  ],
  [
    'repaired',
    '2026-09-12T12:00:00.000Z',
    '2026-09-20T05:30:00.000Z',
    { note: 'Replaced the switch' },
  ],
  ['used', '2026-09-28T05:30:00.000Z', '2026-09-28T05:30:00.000Z', {}],
].map(([eventType, occurredAt, createdAt, metadata], n) => ({
  id: id(700 + n),
  eventType,
  occurredAt,
  createdAt,
  metadata: { source: 'user', revision: n + 1, ...(metadata as object) },
}));

type Mock = {
  item: Entry;
  patches: Entry[];
  actions: Entry[];
  deletes: number;
  conflictNextPatch?: Entry;
};
async function mock(page: Page, start: Entry, options: { photos?: boolean } = {}): Promise<Mock> {
  const state: Mock = { item: { ...start }, patches: [], actions: [], deletes: 0 };
  const itemId = String(start.id);
  await page.route('**/api/v1/taxonomy**', (route) => route.fulfill({ json: taxonomy }));
  await page.route(/\/api\/v1\/items\?/, (route) =>
    route.fulfill({
      json: {
        items: [
          { ...state.item, cover: null },
          { ...complete, id: id(3), name: 'Mixer grinder', cover: null },
        ],
        nextCursor: null,
        hasMore: false,
      },
    }),
  );
  await page.route(`**/api/v1/items/${itemId}`, async (route: Route) => {
    const method = route.request().method();
    if (method === 'GET') return route.fulfill({ json: state.item });
    const body = route.request().postDataJSON() as Entry;
    if (method === 'PATCH') {
      state.patches.push(body);
      if (state.conflictNextPatch) {
        state.item = { ...state.item, ...state.conflictNextPatch };
        delete state.conflictNextPatch;
        return route.fulfill({ status: 409, json: { message: 'STALE_ITEM_REVISION' } });
      }
      if (body.revision !== state.item.revision)
        return route.fulfill({ status: 409, json: { message: 'STALE_ITEM_REVISION' } });
      const { revision, ...changes } = body;
      state.item = { ...state.item, ...changes, revision: Number(revision) + 1 };
      return route.fulfill({ json: state.item });
    }
    if (method === 'DELETE') {
      state.deletes += 1;
      return route.fulfill({ status: 204, body: '' });
    }
    return route.fallback();
  });
  await page.route(`**/api/v1/items/${itemId}/actions`, (route) => {
    const body = route.request().postDataJSON() as Entry;
    state.actions.push(body);
    state.item = {
      ...state.item,
      ownershipStatus: body.ownershipStatus ?? state.item.ownershipStatus,
      revision: Number(state.item.revision) + 1,
    };
    return route.fulfill({ json: state.item });
  });
  await page.route(`**/api/v1/items/${itemId}/history**`, (route) =>
    route.fulfill({
      json: {
        events: start === sparse ? history.slice(0, 1) : history,
        nextCursor: null,
        hasMore: false,
      },
    }),
  );
  await page.route(`**/api/v1/items/${itemId}/photos`, (route) =>
    route.fulfill({
      json: {
        revision: state.item.revision,
        photos:
          options.photos === false
            ? []
            : [
                {
                  id: id(501),
                  position: 0,
                  cover: true,
                  width: 1200,
                  height: 900,
                  byteSize: 2000,
                  mimeType: 'image/webp',
                  altText: 'Steel kettle on the counter',
                  decorative: false,
                },
              ],
      },
    }),
  );
  await page.route('**/api/v1/items/*/photos/*/content/*', (route) =>
    route.fulfill({ contentType: 'image/svg+xml', body: svg }),
  );
  await page.route(`**/api/v1/items/${itemId}/documents`, (route) =>
    route.fulfill({
      json: {
        revision: state.item.revision,
        documents:
          options.photos === false
            ? []
            : [
                {
                  id: id(401),
                  kind: 'receipt',
                  mimeType: 'application/pdf',
                  byteSize: 245000,
                  width: null,
                  height: null,
                },
                {
                  id: id(402),
                  kind: 'warranty',
                  mimeType: 'image/webp',
                  byteSize: 91000,
                  width: 800,
                  height: 1000,
                },
              ],
      },
    }),
  );
  return state;
}
async function setTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  const current = await page.locator('html').getAttribute('class');
  if (!current?.split(' ').includes(theme))
    await page.getByRole('button', { name: 'Toggle color theme' }).click();
  await expect(page.locator('html')).toHaveClass(new RegExp(theme));
}
async function expectNoOverflow(page: Page): Promise<void> {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
}
async function expectTouchTargets(page: Page): Promise<void> {
  const small = await page.evaluate(() =>
    [...document.querySelectorAll('main button, main a[href], main [role="radio"]')]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && el.getAttribute('role') !== 'radio' && r.height < 44;
      })
      .map((el) => el.textContent?.trim()),
  );
  expect(small).toEqual([]);
}

test('complete record is private, responsive and readable in both themes', async ({
  page,
}, testInfo) => {
  await mock(page, complete);
  const returnTo = '/store?q=kettle&sort=price&currency=INR';
  await page.goto(`/items/${id(1)}?returnTo=${encodeURIComponent(returnTo)}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Electric kettle' })).toBeVisible();
  await expect(page.getByText('Prestige · PKOSS 1.5')).toBeVisible();
  await expect(page.getByText('Not a current value', { exact: false })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Item history, oldest first' })).toContainText(
    'Repaired',
  );
  await expect(page.getByRole('img', { name: 'Steel kettle on the counter' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Download Receipt 1' })).toHaveAttribute(
    'href',
    `/api/v1/items/${id(1)}/documents/${id(401)}/download`,
  );
  await expect(page.getByRole('link', { name: 'Back to My Store' })).toHaveAttribute(
    'href',
    returnTo,
  );
  await expect(page.getByRole('link', { name: /Mixer grinder/ })).toHaveAttribute(
    'href',
    `/items/${id(3)}?returnTo=${encodeURIComponent(returnTo)}`,
  );
  const html = await page.content();
  expect(html).not.toMatch(/cloudinary|api_key|signature=|havefolio\/(test|production)/i);
  // Logical outline: one h1, sections at h2.
  await expect(page.locator('h1')).toHaveCount(1);
  const sizes =
    testInfo.project.name === 'mobile'
      ? [{ width: 360, label: '360' }]
      : [
          { width: 768, label: 'tablet' },
          { width: 1280, label: 'desktop' },
          // 200% browser zoom of a 1280px window lays out like a 640px viewport.
          { width: 640, label: 'zoom200' },
        ];
  for (const { width, label } of sizes) {
    await page.setViewportSize({ width, height: 1100 });
    for (const theme of ['light', 'dark'] as const) {
      await setTheme(page, theme);
      await expectNoOverflow(page);
      await expectTouchTargets(page);
      if (label !== 'zoom200')
        await page.screenshot({
          path: shot(`complete-${label}-${theme}`),
          fullPage: true,
          animations: 'disabled',
        });
    }
  }
});

test('sparse record shows explicit unknowns and optional details', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'Captured once at mobile width.');
  await mock(page, sparse, { photos: false });
  await page.setViewportSize({ width: 360, height: 900 });
  await page.goto(`/items/${id(2)}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Umbrella' })).toBeVisible();
  await expect(page.getByText('No photos yet')).toBeVisible();
  await expect(page.getByText(/No receipts or warranties yet/)).toBeVisible();
  await page.getByRole('button', { name: /Add details/ }).click();
  await expect(page.getByRole('dialog', { name: 'Add details' })).toContainText('All optional');
  await page.keyboard.press('Escape');
  for (const theme of ['light', 'dark'] as const) {
    await setTheme(page, theme);
    await expectNoOverflow(page);
    await page.screenshot({
      path: shot(`sparse-360-${theme}`),
      fullPage: true,
      animations: 'disabled',
    });
  }
});

test('keyboard-only editing, conflict review and confirmation', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'Covered once at mobile width.');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const state = await mock(page, complete);
  await page.setViewportSize({ width: 360, height: 900 });
  await page.goto(`/items/${id(1)}`);
  await setTheme(page, 'light');
  const edit = page.getByRole('button', { name: 'Edit condition and use' });
  await edit.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Edit condition and use' });
  await expect(dialog).toBeVisible();
  // Reduced motion: dialog content does not animate.
  expect(await dialog.evaluate((el) => getComputedStyle(el).animationName)).toBe('none');
  // Focus moves into the dialog, onto its first field.
  await expect(dialog.getByRole('combobox', { name: 'Condition' })).toBeFocused();
  await page.keyboard.press('Enter');
  await page.getByRole('option', { name: 'Needs repair' }).press('Enter');
  await page.screenshot({ path: shot('edit-360-light'), animations: 'disabled' });
  await dialog.getByRole('button', { name: 'Save' }).press('Enter');
  await expect(dialog).toBeHidden();
  await expect(edit).toBeFocused();
  await expect(page.getByRole('status').filter({ hasText: 'Changes saved.' })).toBeAttached();
  expect(state.patches.at(-1)).toEqual({ condition: 'needs_repair', revision: 4 });

  // Someone else changes the brand; the owner's unsaved model edit survives review.
  state.conflictNextPatch = { brand: 'Philips', revision: 6 };
  await page.getByRole('button', { name: 'Edit name, brand, model and description' }).click();
  const basics = page.getByRole('dialog');
  await basics.getByLabel('Model (optional)').fill('PKOSS 1.8');
  await basics.getByRole('button', { name: 'Save' }).click();
  await expect(basics.getByText('This item changed since you opened it')).toBeVisible();
  await expect(basics.getByText('Brand is now “Philips”.')).toBeVisible();
  await expect(basics.getByLabel('Model (optional)')).toHaveValue('PKOSS 1.8');
  await page.screenshot({ path: shot('conflict-360-light'), animations: 'disabled' });
  await basics.getByRole('button', { name: 'Save my version' }).click();
  await expect(basics).toBeHidden();
  expect(state.patches.at(-1)).toEqual({ model: 'PKOSS 1.8', revision: 6 });

  // Ownership changes require confirmation and explain their effect.
  await page.getByRole('button', { name: 'No longer have it' }).click();
  await page.getByRole('menuitem', { name: 'Sold it' }).click();
  const confirm = page.getByRole('alertdialog', { name: 'Mark as sold' });
  await expect(confirm).toContainText('does not record or estimate a sale price');
  // The theme toggle sits behind the modal, so switch the class next-themes manages directly.
  for (const theme of ['light', 'dark'] as const) {
    await page.evaluate((next) => {
      document.documentElement.classList.remove('light', 'dark');
      document.documentElement.classList.add(next);
      document.documentElement.style.colorScheme = next;
    }, theme);
    await page.screenshot({ path: shot(`lifecycle-confirm-360-${theme}`), animations: 'disabled' });
  }
  await confirm.getByRole('button', { name: 'Mark as sold' }).click();
  await expect(confirm).toBeHidden();
  expect(state.actions.at(-1)).toMatchObject({
    action: 'ownership_changed',
    ownershipStatus: 'sold',
  });
  await expect(page.getByRole('button', { name: 'Own it again' })).toBeVisible();
  await expect(page.getByText('Status:', { exact: false }).locator('..')).toContainText('Sold');
});

test('history reads as text and deletion needs the item name', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Covered once at desktop width.');
  const state = await mock(page, complete);
  await page.goto(`/items/${id(1)}?returnTo=${encodeURIComponent('/store?q=kettle')}`);
  const historyList = page.getByRole('list', { name: 'Item history, oldest first' });
  await expect(historyList.getByRole('listitem')).toHaveCount(4);
  await expect(historyList).toContainText('recorded');
  await expect(historyList).not.toContainText('revision');
  await historyList.scrollIntoViewIfNeeded();
  for (const theme of ['light', 'dark'] as const) {
    await setTheme(page, theme);
    await historyList.locator('..').screenshot({
      path: shot(`history-desktop-${theme}`),
      animations: 'disabled',
    });
  }
  await page.getByRole('button', { name: /Delete item/ }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText('2 receipt or warranty documents');
  const remove = dialog.getByRole('button', { name: 'Delete permanently' });
  await expect(remove).toBeDisabled();
  await dialog.getByLabel('Type the item name to confirm').fill('Electric kettle');
  await page.screenshot({ path: shot('delete-confirm-desktop-dark'), animations: 'disabled' });
  await page.route(/\/api\/v1\/items(\?.*)?$/, (route) =>
    route.fulfill({ json: { items: [], nextCursor: null, hasMore: false } }),
  );
  await remove.click();
  await expect(page).toHaveURL(/\/store\?q=kettle$/);
  expect(state.deletes).toBe(1);
  await expect(
    page.getByText('“Electric kettle” and its private photos and documents were deleted.'),
  ).toBeVisible();
});

test('rejects unsafe return paths and shows recovery states', async ({ page }) => {
  await mock(page, complete);
  await page.goto(`/items/${id(1)}?returnTo=${encodeURIComponent('https://evil.example/store')}`);
  await expect(page.getByRole('link', { name: 'Back to My Store' })).toHaveAttribute(
    'href',
    '/store',
  );
  await page.route(`**/api/v1/items/${id(9)}`, (route) =>
    route.fulfill({ status: 404, json: { message: 'ITEM_NOT_FOUND' } }),
  );
  await page.goto(`/items/${id(9)}`);
  await expect(
    page.getByRole('heading', { name: 'This item is not in your inventory' }),
  ).toBeVisible();
  await page.route(`**/api/v1/items/${id(8)}`, (route) =>
    route.fulfill({ status: 401, json: { message: 'AUTH_REQUIRED' } }),
  );
  await page.goto(`/items/${id(8)}`);
  await expect(page.getByRole('heading', { name: 'Please sign in again' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login');
});
