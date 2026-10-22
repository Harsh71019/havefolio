import { expect, test, type Page } from '@playwright/test';
import type { InventoryFacets, ItemListEntry } from '@havefolio/contracts';
import { emptyHomeFixture } from '../test/home-fixture';
import { addHiddenStoreSegment } from './fixtures/streamed-store';

test.beforeEach(async ({ page }) => {
  // These tests isolate browse behaviour; PER-19's dedicated journeys cover welcome help.
  await page.route('**/api/v1/onboarding**', (route) =>
    route.fulfill({
      json: {
        state: 'skipped',
        genuineItemCount: 7,
        demoItemCount: 0,
        browsedStore: true,
        reviewedItem: false,
        triedDemo: false,
        removedDemo: false,
      },
    }),
  );
});

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
  revision: 1,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
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

/** Counts as the API would report them for an unfiltered store. */
function facetsFor(entries: Entry[]): InventoryFacets {
  const items = entries as unknown as ItemListEntry[];
  const tally = <T>(values: T[]): { value: T; count: number }[] => {
    const counts = new Map<T, number>();
    for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
    return [...counts].map(([value, count]) => ({ value, count }));
  };
  const priced = items.filter((i) => i.pricePaidMinor !== null && i.currency === 'INR');
  const minor = priced.map((i) => BigInt(i.pricePaidMinor!)).sort((a, b) => (a < b ? -1 : 1));
  return {
    total: items.length,
    ownershipStatus: tally(items.map((i) => i.ownershipStatus)),
    useFrequency: tally(items.map((i) => i.useFrequency)),
    categories: tally(items.map((i) => i.categoryId)),
    subcategories: tally(items.filter((i) => i.subcategoryId).map((i) => i.subcategoryId!)).map(
      (entry) => ({
        ...entry,
        categoryId: items.find((i) => i.subcategoryId === entry.value)!.categoryId!,
      }),
    ),
    brands: tally(items.filter((i) => i.brand).map((i) => i.brand!)),
    brandsTruncated: false,
    prices: minor.length
      ? [
          {
            currency: 'INR',
            minMinor: String(minor[0]),
            maxMinor: String(minor.at(-1)),
            count: minor.length,
          },
        ]
      : [],
  };
}
async function mock(
  page: Page,
  items: Entry[],
  options: { failImages?: boolean } = {},
): Promise<void> {
  await page.route('**/api/v1/taxonomy**', (route) => route.fulfill({ json: taxonomy }));
  // PER-33: navigating through Home requests its summary; keep that hop free of proxy errors.
  await page.route('**/api/v1/home', (route) => route.fulfill({ json: emptyHomeFixture }));
  await page.route(/\/api\/v1\/items(\?.*)?$/, (route) =>
    route.fulfill({ json: { items, nextCursor: null, hasMore: false } }),
  );
  await page.route(/\/api\/v1\/items\/facets(\?.*)?$/, (route) =>
    route.fulfill({ json: facetsFor(items) }),
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
    const body = route.request().url().endsWith('/thumbnail')
      ? svg(n).replace('width="800" height="600"', 'width="320" height="240" viewBox="0 0 800 600"')
      : svg(n);
    return route.fulfill({ contentType: 'image/svg+xml', body });
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
  // PER-66: all categories share one catalog grid; each card names its category instead.
  await expect(page.getByRole('heading', { level: 2 })).toHaveText([
    'All items',
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
  // PER-97: default cards select the thumbnail on the phone (2.625×) and desktop (1×) profiles.
  await expect
    .poll(() => kettle.locator('img').evaluate((el) => (el as HTMLImageElement).currentSrc))
    .toContain('/thumbnail');
  // Keyboard: tab from the Add item action into the first card and onward.
  await page.getByRole('link', { name: 'Add item', exact: true }).focus();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Revisit welcome help' })).toBeFocused();
  await page.keyboard.press('Tab');
  // PER-65: filters come before sorting and the results. One stop per filter group on desktop.
  if (testInfo.project.name === 'desktop') {
    await expect(page.getByRole('radio', { name: 'All categories' })).toBeFocused();
    await page.getByRole('combobox', { name: 'Sort by' }).focus();
  } else {
    await expect(page.getByRole('button', { name: /^Filters/ })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('combobox', { name: 'Sort by' })).toBeFocused();
  }
  await page.keyboard.press('Tab');
  if (testInfo.project.name === 'desktop') {
    await expect(page.getByRole('radio', { name: 'Comfortable' })).toBeFocused();
    await page.keyboard.press('Tab');
  }
  // Display order: Kitchen items without a subcategory, then Appliances.
  await expect(page.getByRole('link', { name: /^Cast-iron tawa Owned/ })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(kettle).toBeFocused();
  const ring = await kettle.evaluate((el) => getComputedStyle(el).boxShadow);
  expect(ring).not.toBe('none');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: /^Mixer grinder Owned/ })).toBeFocused();
  if (testInfo.project.name === 'desktop') {
    await page.getByRole('radio', { name: 'Large' }).click();
    await page.getByRole('link', { name: /^Mixer grinder Owned/ }).focus();
  }
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(`/items/${id(2)}$`));
  await expect(page.getByRole('link', { name: 'Back to My Store' }).first()).toHaveAttribute(
    'href',
    '/store',
  );
  await page.goBack();
  if (testInfo.project.name === 'desktop') {
    await expect(page.getByRole('radio', { name: 'Large' })).toBeChecked();
    await page.getByRole('radio', { name: 'Comfortable' }).click();
  }
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

const densityKey = 'havefolio:store-density:v1';
const densityShot = (name: string): string => `../../docs/screenshots/per-58-${name}.png`;
const densities = ['Compact', 'Comfortable', 'Large'] as const;
const densityItems = Array.from({ length: 12 }, (_, n) =>
  base(n + 1, {
    name: n === 0 ? 'Electric kettle' : `Household item ${String(n + 1).padStart(2, '0')}`,
    ownershipStatus: n === 1 ? 'sold' : 'owned',
    pricePaidMinor: n === 0 ? '0' : n === 2 ? '900719925474099312' : null,
    purchaseDate:
      n === 0
        ? { precision: 'month', year: 2025, month: 11, day: null }
        : n === 1
          ? { precision: 'year', year: 2019, month: null, day: null }
          : { precision: 'unknown', year: null, month: null, day: null },
    cover: cover(n + 1),
  }),
);
async function columns(page: Page): Promise<number> {
  return page
    .locator('.store-grid')
    .first()
    .evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length);
}

test('PER-58 desktop density geometry, facts, images, keyboard, persistence and themes', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Desktop density matrix.');
  const failures: string[] = [];
  page.on('pageerror', (error) => failures.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') failures.push(message.text());
  });
  let inventoryRequests = 0;
  page.on('request', (request) => {
    if (/\/api\/v1\/items\?/.test(request.url())) inventoryRequests++;
  });
  await mock(page, densityItems);
  await page.goto('/store?q=kettle&sort=name');
  await expect(page.getByRole('radio', { name: 'Comfortable' })).toBeChecked();
  await expect(page.getByRole('link', { name: /^Electric kettle Owned/ })).toBeVisible();
  const initialRequests = inventoryRequests;
  // PER-67: columns auto-fill 12rem, 15rem and 20rem minimums with 1.5rem gaps in the space left
  // by the 17rem navigation, 2rem gutters and, from 1280px, the 15rem filter column and its gap.
  const expected = [
    [3, 2, 2],
    [3, 2, 2],
    [3, 3, 2],
    [6, 5, 3],
  ];
  for (const [index, width] of [1024, 1280, 1440, 1920].entries()) {
    await page.setViewportSize({ width, height: 1000 });
    for (const [modeIndex, mode] of densities.entries()) {
      await page.getByRole('radio', { name: mode, exact: true }).click();
      await expect(page.getByRole('radio', { name: mode, exact: true })).toBeChecked();
      expect(await columns(page)).toBe(expected[index]![modeIndex]);
      const first = page.getByRole('link', { name: /^Electric kettle Owned/ });
      // PER-67: cards show the name only; facts stay on the item page.
      await expect(first).not.toContainText(/Paid|Acquired/);
      await expect(
        page.getByRole('link', { name: /^Household item 02 Sold\s*, no longer owned/ }),
      ).toContainText('Sold');
      const image = first.locator('img');
      expect(await page.locator('.my-store img[loading="eager"]').count()).toBe(4);
      expect(await page.locator('.my-store img[loading="lazy"]').count()).toBe(8);
      // Compare the browser's resolved slot to the real one, including sidebar/gaps. PER-97
      // reports each slot scaled as `calc(<slot> * <grid policy>)`; the slot itself is checked.
      const sizing = await image.evaluate((el) => {
        const img = el as HTMLImageElement;
        const hint = img.sizes
          .split(', ')
          .map((part) => {
            const at = part.lastIndexOf(' calc(');
            const value = at >= 0 ? part.slice(at + 1) : part.slice(part.lastIndexOf(' ') + 1);
            return { condition: part.slice(0, part.length - value.length).trim(), value };
          })
          .find(({ condition }) => !condition || matchMedia(condition).matches)!
          .value.replace(/^calc\((.*) \* [\d.]+\)$/, '$1');
        const probe = document.createElement('div');
        probe.style.cssText = `position:fixed;visibility:hidden;width:${hint}`;
        document.body.append(probe);
        const hintedWidth = probe.getBoundingClientRect().width;
        probe.remove();
        return {
          width: img.getBoundingClientRect().width,
          height: img.getBoundingClientRect().height,
          hintedWidth,
        };
      });
      expect(sizing.width).toBeGreaterThan(140);
      // The fixed hint is the widest a column gets, so it covers the real slot without
      // over-asking; photos are square in every density.
      expect(sizing.hintedWidth).toBeGreaterThanOrEqual(sizing.width);
      expect(sizing.hintedWidth / sizing.width).toBeLessThan(1.6);
      expect(sizing.width / sizing.height).toBeCloseTo(1, 1);
      // PER-97: ordinary cards stay on the 320px thumbnail; Large slots still get display. Once
      // display has loaded, the browser keeps reusing it for smaller slots instead of refetching.
      if (mode === 'Large' || index === 0)
        await expect
          .poll(() => image.evaluate((el) => (el as HTMLImageElement).currentSrc))
          .toContain(mode === 'Large' ? '/display' : '/thumbnail');
      await expectNoOverflow(page);
      if (width === 1440) {
        for (const theme of ['light', 'dark'] as const) {
          await setTheme(page, theme);
          await page
            .locator('.my-store')
            .evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + scrollY - 24));
          await page.screenshot({
            path: densityShot(`${mode.toLowerCase()}-1440-${theme}`),
            animations: 'disabled',
          });
        }
      }
    }
  }
  expect(inventoryRequests).toBe(initialRequests);
  await page.getByRole('radio', { name: 'Comfortable' }).focus();
  await page.keyboard.down('ArrowLeft');
  await expect(page.getByRole('radio', { name: 'Compact' })).toBeChecked();
  await page.keyboard.up('ArrowLeft');
  const ring = await page
    .getByRole('radio', { name: 'Compact' })
    .evaluate((el) => getComputedStyle(el).boxShadow);
  expect(ring).not.toBe('none');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: /^Electric kettle Owned/ })).toBeFocused();
  expect(await page.evaluate((key) => localStorage.getItem(key), densityKey)).toBe('compact');
  await page.reload();
  await expect(page.getByRole('radio', { name: 'Compact' })).toBeChecked();
  const nav = page.getByRole('navigation', { name: 'Primary' }).filter({ visible: true });
  await nav.getByRole('link', { name: 'Home', exact: true }).click();
  await nav.getByRole('link', { name: 'My Store', exact: true }).click();
  await expect(page.getByRole('radio', { name: 'Compact' })).toBeChecked();
  await page.goBack();
  await page.goForward();
  await expect(page.getByRole('radio', { name: 'Compact' })).toBeChecked();
  expect(failures).toEqual([]);
});

test('PER-58 restores before paint and mobile ignores every saved desktop density', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'One browser covers all responsive widths.');
  await mock(page, densityItems);
  await page.addInitScript(() => {
    const record = (): void => {
      const grid = Array.from(
        document.querySelectorAll('section[aria-label="Your items"] .store-grid'),
      ).find((candidate) => candidate.getBoundingClientRect().width > 0);
      if (grid && grid.getBoundingClientRect().width > 0) {
        document.documentElement.dataset.firstStoreColumns = String(
          getComputedStyle(grid).gridTemplateColumns.split(' ').length,
        );
        document.documentElement.dataset.firstStoreDensity =
          document.documentElement.dataset.storeDensity;
        document.documentElement.dataset.firstStoreWidth = String(innerWidth);
      } else requestAnimationFrame(record);
    };
    requestAnimationFrame(record);
  });
  await page.goto('/store');
  for (const density of ['compact', 'comfortable', 'large']) {
    await page.evaluate(({ key, value }) => localStorage.setItem(key, value), {
      key: densityKey,
      value: density,
    });
    await page.setViewportSize({ width: 1440, height: 1000 });
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(/\/api\/v1\/items(\?.*)?$/, async (route) => {
      await held;
      await route.fulfill({ json: { items: densityItems, nextCursor: null, hasMore: false } });
    });
    await page.reload();
    // Roles exclude React's hidden streamed segments; test IDs alone do not.
    const region = page.getByRole('region', { name: 'Your items', exact: true });
    const skeleton = region.getByTestId('store-skeleton');
    await expect(region).toHaveCount(1);
    await expect(skeleton).toHaveCount(1);
    await expect(skeleton).toBeVisible();
    const segment = await addHiddenStoreSegment(region);
    try {
      // Prove the fixture recreates the original ambiguity, regardless of DOM order.
      await expect(page.getByTestId('store-skeleton').isVisible()).rejects.toThrow(
        /strict mode violation/,
      );
      await expect(segment).toBeHidden();
      await expect(region).toHaveCount(1);
      await expect(skeleton).toHaveCount(1);
      await expect(skeleton).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('data-store-density', density);
      const expectedColumns = density === 'large' ? 2 : 3;
      expect(
        await skeleton
          .locator('.store-grid')
          .evaluate((grid) => getComputedStyle(grid).gridTemplateColumns.split(' ').length),
      ).toBe(expectedColumns);
      await expect(page.locator('html')).toHaveAttribute('data-first-store-density', density);
      await expect(page.locator('html')).toHaveAttribute(
        'data-first-store-columns',
        String(expectedColumns),
      );
      await page.screenshot({ path: densityShot(`loading-${density}`), animations: 'disabled' });
    } finally {
      await segment.evaluate((element) => element.remove());
      release();
    }
    await expect(skeleton).toHaveCount(0);
    await expect(region.getByRole('link', { name: /^Electric kettle/ })).toBeVisible();
    for (const width of [360, 768]) {
      await page.setViewportSize({ width, height: 1000 });
      await expect(page.getByRole('radiogroup', { name: 'View density' })).toBeHidden();
      expect(await columns(page)).toBe(2);
      await expectNoOverflow(page);
      for (const theme of ['light', 'dark'] as const) {
        await setTheme(page, theme);
        if (density === 'compact')
          await page.screenshot({
            path: densityShot(`mobile-${width}-${theme}`),
            fullPage: true,
            animations: 'disabled',
          });
      }
    }
    await page.unroute(/\/api\/v1\/items(\?.*)?$/);
    await mock(page, densityItems);
  }
});

test('PER-58 invalid and obsolete preferences fall back, resilient states align in all modes', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Desktop resilient matrix.');
  await page.setViewportSize({ width: 1280, height: 900 });
  await mock(page, []);
  await page.goto('/store');
  for (const value of ['broken', '{"version":0,"density":"compact"}', 'COMPACT']) {
    await page.evaluate(({ key, value }) => localStorage.setItem(key, value), {
      key: densityKey,
      value,
    });
    await page.reload();
    await expect(page.getByRole('radio', { name: 'Comfortable' })).toBeChecked();
  }
  for (const mode of densities) {
    await page.getByRole('radio', { name: mode, exact: true }).click();
    await expect(page.getByText('Nothing recorded yet')).toBeVisible();
    await expectNoOverflow(page);
    await page.screenshot({
      path: densityShot(`empty-${mode.toLowerCase()}`),
      animations: 'disabled',
    });
  }
  await page.route('**/api/v1/taxonomy**', (route) =>
    route.fulfill({ status: 503, json: { message: 'UNAVAILABLE' } }),
  );
  let calls = 0;
  await page.route(/\/api\/v1\/items(\?.*)?$/, (route) => {
    calls++;
    return route.fulfill({
      json: {
        items: calls === 1 ? densityItems.slice(0, 6) : densityItems.slice(6),
        nextCursor: calls === 1 ? 'next-page' : null,
        hasMore: calls === 1,
      },
    });
  });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'All items', exact: true })).toBeVisible();
  for (const mode of densities) {
    await page.getByRole('radio', { name: mode, exact: true }).click();
    await page.context().setOffline(true);
    await expect(page.getByText(/You are offline/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Show more items' })).toBeDisabled();
    await expectNoOverflow(page);
    await page.context().setOffline(false);
    await expect(page.getByRole('button', { name: 'Show more items' })).toBeEnabled();
  }
  await page.getByRole('button', { name: 'Show more items' }).click();
  await expect(
    page.getByText('Showing 12 items. Categories could not load, so items are not grouped.'),
  ).toBeVisible();
  await page.screenshot({ path: densityShot('taxonomy-fallback-large'), animations: 'disabled' });
});

for (const density of ['compact', 'comfortable', 'large'] as const) {
  test(`PER-58 fresh ${density} image candidate and image layout stability`, async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'Desktop image sizing.');
    await page.setViewportSize({ width: 1024, height: 1000 });
    await page.addInitScript(({ key, value }) => localStorage.setItem(key, value), {
      key: densityKey,
      value: density,
    });
    await mock(page, densityItems);
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route('**/api/v1/items/*/photos/*/content/*', async (route) => {
      await held;
      const small = route.request().url().endsWith('/thumbnail');
      await route.fulfill({
        contentType: 'image/svg+xml',
        body: small
          ? svg(1).replace(
              'width="800" height="600"',
              'width="320" height="240" viewBox="0 0 800 600"',
            )
          : svg(1),
      });
    });
    await page.goto('/store', { waitUntil: 'domcontentloaded' });
    const card = page.getByRole('link', { name: /^Electric kettle Owned/ });
    await expect(card).toBeVisible();
    const before = await card.boundingBox();
    release();
    const image = card.locator('img');
    await expect(image).toHaveCSS('opacity', '1');
    expect(await image.evaluate((el) => (el as HTMLImageElement).currentSrc)).toContain(
      // PER-97 grid policy: only Large slots exceed the thumbnail tolerance at 1×.
      density === 'large' ? '/display' : '/thumbnail',
    );
    expect(await card.boundingBox()).toEqual(before);
  });
}

// PER-59: synthetic category whose every item sits in its own one-item subcategory.
const sparseCategory = id(940);
const sparseSubs = ['Audio', 'Cameras', 'Chargers', 'Phones', 'Tablets', 'Wearables'].map(
  (name, n) => ({
    id: id(950 + n),
    categoryId: sparseCategory,
    name,
    position: n,
    isDemo: false,
    retiredAt: null,
    itemCount: 1,
  }),
);
const sparseItems = sparseSubs.map((sub, n) =>
  base(60 + n, {
    name: `Sample device ${n + 1}`,
    categoryId: sparseCategory,
    subcategoryId: sub.id,
    cover: cover(60 + n),
  }),
);
const sparseTaxonomy = {
  ...taxonomy,
  categories: [
    {
      id: sparseCategory,
      name: 'Electronics',
      position: 0,
      isDemo: false,
      retiredAt: null,
      itemCount: sparseItems.length,
    },
  ],
  subcategories: sparseSubs,
};
const sparseShot = (name: string): string => `../../docs/screenshots/per-59-${name}.png`;

test('PER-59 sparse subcategories share one category grid at every width and density', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'One browser covers all responsive widths.');
  const failures: string[] = [];
  page.on('pageerror', (error) => failures.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') failures.push(message.text());
  });
  let inventoryRequests = 0;
  page.on('request', (request) => {
    if (/\/api\/v1\/items\?/.test(request.url())) inventoryRequests++;
  });
  await mock(page, sparseItems);
  await page.route('**/api/v1/taxonomy**', (route) => route.fulfill({ json: sparseTaxonomy }));
  // PER-66: a selected category keeps its section; all categories share one flat grid.
  await page.goto(`/store?categoryId=${sparseCategory}`);
  const section = page.locator('section[aria-labelledby]', {
    has: page.getByRole('heading', { level: 2, name: 'Electronics' }),
  });
  await expect(section.getByRole('link')).toHaveCount(sparseItems.length);
  await expect(section.locator('.store-grid')).toHaveCount(1);
  await expect(section.getByRole('heading', { level: 3 })).toHaveCount(0);
  for (const [n, sub] of sparseSubs.entries()) {
    const link = section.getByRole('link', { name: new RegExp(`^Sample device ${n + 1} Owned`) });
    await expect(link).toHaveAccessibleDescription(`Electronics › ${sub.name}`);
  }
  const initialRequests = inventoryRequests;
  // Cards on the first row share its top edge; the row holds as many cards as the grid has columns.
  const firstRow = (): Promise<number> =>
    section.getByRole('link').evaluateAll((links) => {
      const top = links[0]!.getBoundingClientRect().top;
      return links.filter((l) => Math.abs(l.getBoundingClientRect().top - top) < 1).length;
    });
  const expected: Record<number, [number, number, number]> = {
    1280: [3, 2, 2],
    1512: [4, 3, 2],
    1920: [6, 5, 3],
  };
  for (const width of [1280, 1512, 1920]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const [modeIndex, mode] of densities.entries()) {
      await page.getByRole('radio', { name: mode, exact: true }).click();
      await expect(page.getByRole('radio', { name: mode, exact: true })).toBeChecked();
      expect(Math.min(await columns(page), sparseItems.length)).toBe(expected[width]![modeIndex]);
      expect(await firstRow()).toBe(expected[width]![modeIndex]);
      await expectNoOverflow(page);
      if (width === 1512 && mode === 'Compact') {
        for (const theme of ['light', 'dark'] as const) {
          await setTheme(page, theme);
          await page
            .locator('.my-store')
            .evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + scrollY - 24));
          await page.screenshot({
            path: sparseShot(`compact-1512-${theme}`),
            animations: 'disabled',
          });
        }
      }
    }
  }
  expect(inventoryRequests).toBe(initialRequests);
  // Keyboard order follows taxonomy order across the shared grid.
  await page.getByRole('radio', { name: 'Large' }).focus();
  for (let n = 1; n <= sparseItems.length; n++) {
    await page.keyboard.press('Tab');
    await expect(
      section.getByRole('link', { name: new RegExp(`^Sample device ${n} Owned`) }),
    ).toBeFocused();
  }
  await page.getByRole('radio', { name: 'Compact' }).click();
  await page.reload();
  await expect(page.getByRole('radio', { name: 'Compact' })).toBeChecked();
  await expect(section.getByRole('link')).toHaveCount(sparseItems.length);
  expect(await firstRow()).toBe(6);
  // PER-67: phones show two columns, like tablets.
  for (const [width, perRow] of [
    [360, 2],
    [768, 2],
  ] as const) {
    await page.setViewportSize({ width, height: 1000 });
    await expect(page.getByRole('radiogroup', { name: 'View density' })).toBeHidden();
    expect(await columns(page)).toBe(perRow);
    expect(await firstRow()).toBe(perRow);
    await expectNoOverflow(page);
  }
  expect(failures).toEqual([]);
});
