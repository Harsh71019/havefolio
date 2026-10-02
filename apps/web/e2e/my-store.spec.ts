import { expect, test, type Page } from '@playwright/test';

const id = (n: number): string => `00000000-0000-4000-a000-${String(n).padStart(12, '0')}`;
const kitchen = id(901);
const living = id(902);
const appliances = id(911);
// Synthetic flat illustrations only: no user content or provider data.
const colours = ['#7c9a92', '#c9a66b', '#8d7fa8', '#b5655d', '#6b8fb5', '#9aa36b'];
const svg = (n: number): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="100%" height="100%" fill="${colours[n % colours.length]}"/><circle cx="400" cy="300" r="150" fill="#fff" fill-opacity="0.55"/></svg>`;
const shot = (name: string): string => `../../docs/screenshots/per-16-${name}.png`;

type Entry = Record<string, unknown>;
const base = (n: number, extra: Entry = {}): Entry => ({
  id: id(n),
  name: `Item ${n}`,
  ownershipStatus: 'owned',
  currency: 'INR',
  pricePaidMinor: null,
  purchaseDate: { precision: 'unknown', year: null, month: null, day: null },
  acquisitionType: 'bought',
  condition: 'working',
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
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  originalEntry: {},
  originalSource: 'manual',
  cover: null,
  ...extra,
});
const cover = (n: number, altText: string | null = null): Entry => ({
  photoId: id(500 + n),
  width: 800,
  height: 600,
  altText,
  decorative: false,
});
const inventory = [
  base(1, {
    name: 'Electric kettle',
    categoryId: kitchen,
    subcategoryId: appliances,
    pricePaidMinor: '249900',
    purchaseDate: { precision: 'exact', year: 2024, month: 3, day: 12 },
    useFrequency: 'often',
    cover: cover(1, 'Steel kettle on the counter'),
  }),
  base(2, {
    name: 'Mixer grinder',
    categoryId: kitchen,
    subcategoryId: appliances,
    pricePaidMinor: '0',
    acquisitionType: 'gift',
    purchaseDate: { precision: 'month', year: 2025, month: 11, day: null },
    useFrequency: 'sometimes',
    cover: cover(2),
  }),
  base(3, {
    name: 'Cast-iron tawa',
    categoryId: kitchen,
    purchaseDate: { precision: 'year', year: 2019, month: null, day: null },
    useFrequency: 'often',
  }),
  base(4, {
    name: 'Reading lamp',
    categoryId: living,
    pricePaidMinor: '189900',
    purchaseDate: { precision: 'month', year: 2023, month: 6, day: null },
    useFrequency: 'rarely',
    cover: cover(4, 'Brass reading lamp'),
  }),
  base(5, {
    name: 'Old bicycle',
    categoryId: living,
    ownershipStatus: 'sold',
    pricePaidMinor: '850000',
    purchaseDate: { precision: 'year', year: 2017, month: null, day: null },
    cover: cover(5),
  }),
  base(6, { name: 'Woollen shawl', ownershipStatus: 'donated', acquisitionType: 'gift' }),
  base(7, { name: 'Umbrella', ownershipStatus: 'lost', useFrequency: 'never' }),
];
const taxonomy = {
  categories: [
    { id: kitchen, name: 'Kitchen', position: 0, isDemo: false, retiredAt: null, itemCount: 3 },
    { id: living, name: 'Living room', position: 1, isDemo: false, retiredAt: null, itemCount: 2 },
    { id: id(903), name: 'Books', position: 2, isDemo: false, retiredAt: null, itemCount: 0 },
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
  tags: [],
  defaultsSeeded: true,
};

async function mock(
  page: Page,
  items: Entry[],
  options: { failImages?: boolean } = {},
): Promise<void> {
  await page.route('**/api/v1/taxonomy**', (route) => route.fulfill({ json: taxonomy }));
  await page.route(/\/api\/v1\/items(\?.*)?$/, (route) =>
    route.fulfill({ json: { items, nextCursor: null, hasMore: false } }),
  );
  await page.route('**/api/v1/items/*/photos/*/content/*', (route) => {
    if (options.failImages)
      return route.fulfill({ status: 503, json: { message: 'MEDIA_STORAGE_UNAVAILABLE' } });
    const n = Number(
      route
        .request()
        .url()
        .match(/a000-0*(\d+)\/content/)?.[1] ?? 0,
    );
    return route.fulfill({ contentType: 'image/svg+xml', body: svg(n) });
  });
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

test('empty inventory offers the add-item flow at 360px in both themes', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'Captured once at mobile width.');
  await mock(page, []);
  await page.setViewportSize({ width: 360, height: 900 });
  await page.goto('/store');
  await expect(page.getByText('Nothing recorded yet')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Add your first item' })).toHaveAttribute(
    'href',
    '/items/new',
  );
  for (const theme of ['light', 'dark'] as const) {
    await setTheme(page, theme);
    await expectNoOverflow(page);
    await page.screenshot({
      path: shot(`empty-360-${theme}`),
      fullPage: true,
      animations: 'disabled',
    });
  }
});

test('populated, mixed-lifecycle store is responsive, private and keyboard navigable', async ({
  page,
}, testInfo) => {
  await mock(page, inventory);
  await page.goto('/store');
  const kettle = page.getByRole('link', { name: /^Electric kettle Owned/ });
  await expect(kettle).toBeVisible();
  await expect(
    page.getByRole('link', { name: /^Old bicycle Sold\s*, no longer owned$/ }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { level: 2 })).toHaveText([
    'Kitchen',
    'Living room',
    'Not yet categorised',
    'Categories with nothing yet',
  ]);
  const html = await page.content();
  expect(html).not.toMatch(
    /cloudinary|api_key|signature=|havefolio\/(test|production|development)/i,
  );
  await expect(page.getByRole('button', { name: /buy|cart|checkout|sell/i })).toHaveCount(0);
  await expect(kettle.getByRole('img', { name: 'Steel kettle on the counter' })).toHaveAttribute(
    'src',
    `/api/v1/items/${id(1)}/photos/${id(501)}/content/thumbnail`,
  );
  // Keyboard: tab from the Add item action into the first card and onward.
  await page.getByRole('link', { name: 'Add item', exact: true }).focus();
  await page.keyboard.press('Tab');
  // Display order: Kitchen items without a subcategory, then Appliances.
  await expect(page.getByRole('link', { name: /^Cast-iron tawa Owned/ })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(kettle).toBeFocused();
  const ring = await kettle.evaluate((el) => getComputedStyle(el).boxShadow);
  expect(ring).not.toBe('none');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: /^Mixer grinder Owned/ })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(`/items/${id(2)}/photos\\?from=store$`));
  await expect(page.getByRole('link', { name: 'Back to My Store' })).toHaveAttribute(
    'href',
    '/store',
  );
  await page.goBack();
  const sizes =
    testInfo.project.name === 'mobile'
      ? [{ width: 360, label: '360' }]
      : [
          { width: 768, label: 'tablet' },
          { width: 1280, label: 'desktop' },
        ];
  for (const { width, label } of sizes) {
    await page.setViewportSize({ width, height: 1000 });
    for (const theme of ['light', 'dark'] as const) {
      await setTheme(page, theme);
      await expect(kettle).toBeVisible();
      await expectNoOverflow(page);
      const cardWidth = await kettle.evaluate((el) => el.getBoundingClientRect().width);
      expect(cardWidth).toBeLessThanOrEqual(width >= 768 ? 420 : 360);
      await page.screenshot({
        path: shot(`populated-${label}-${theme}`),
        fullPage: true,
        animations: 'disabled',
      });
    }
  }
});

test('failed private-image delivery keeps cards readable', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'Captured once at mobile width.');
  await mock(page, inventory.slice(0, 2), { failImages: true });
  await page.setViewportSize({ width: 360, height: 900 });
  await page.goto('/store');
  await expect(page.getByText('Photo could not load.')).toHaveCount(2);
  await expect(page.locator('main [role="alert"]')).toHaveCount(0);
  await setTheme(page, 'light');
  await expectNoOverflow(page);
  await page.screenshot({
    path: shot('failed-image-360-light'),
    fullPage: true,
    animations: 'disabled',
  });
});

test('API failure and expired session expose recovery actions', async ({ page }) => {
  await page.route('**/api/v1/taxonomy**', (route) => route.fulfill({ json: taxonomy }));
  let status = 503;
  await page.route(/\/api\/v1\/items(\?.*)?$/, (route) =>
    status === 200
      ? route.fulfill({ json: { items: inventory.slice(0, 1), nextCursor: null, hasMore: false } })
      : route.fulfill({ status, json: { message: 'ITEMS_UNAVAILABLE' } }),
  );
  await page.goto('/store');
  await expect(page.locator('main').getByRole('alert')).toContainText('My Store could not load');
  status = 200;
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('link', { name: /^Electric kettle/ })).toBeVisible();
  status = 401;
  await page.reload();
  await expect(page.locator('main').getByRole('alert')).toContainText('Please sign in again');
  await expect(page.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login');
});
