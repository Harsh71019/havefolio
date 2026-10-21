import { expect, test } from '@playwright/test';
import { id, itemId, mockCoreJourneys, taxonomy } from './support/core-journeys';

// PER-90: Route transitions, history navigation, list restoration, and focus recovery suite.

type MockItem = {
  id: string;
  name: string;
  ownershipStatus: 'owned';
  currency: string;
  pricePaidMinor: string;
  purchaseDate: { precision: 'year'; year: number; month: null; day: null };
  acquisitionType: 'bought';
  condition: 'working';
  useFrequency: 'often';
  categoryId: string | null;
  subcategoryId: string | null;
  tagIds: string[];
  brand: string;
  model: string;
  revision: number;
  createdAt: string;
  isDemo: boolean;
  cover: null;
};

const makeItems = (count: number): MockItem[] =>
  Array.from({ length: count }, (_, i) => ({
    id: id(i + 10),
    name: `Inventory Item ${i + 1}`,
    ownershipStatus: 'owned' as const,
    currency: 'INR',
    pricePaidMinor: '199900',
    purchaseDate: { precision: 'year' as const, year: 2024, month: null, day: null },
    acquisitionType: 'bought' as const,
    condition: 'working' as const,
    useFrequency: 'often' as const,
    categoryId: taxonomy.categories[0]?.id ?? null,
    subcategoryId: taxonomy.subcategories[0]?.id ?? null,
    tagIds: [],
    brand: 'Generic',
    model: `Model ${i + 1}`,
    revision: 1,
    createdAt: '2026-10-01T00:00:00.000Z',
    isDemo: false,
    cover: null,
  }));

const itemsList = makeItems(20);
// Position the fully-mocked itemId at index 11 so it is rendered midway down the catalog
const targetItem = itemsList[11]!;
itemsList[11] = {
  ...targetItem,
  id: itemId,
  name: 'Synthetic electric kettle',
};

test.beforeEach(async ({ page }) => {
  await mockCoreJourneys(page);

  // Provide 20 items so the catalog grid scrolls significantly
  await page.route(/\/api\/v1\/items(\?.*)?$/, (route) => {
    if (route.request().url().includes(`/api/v1/items/${itemId}`)) {
      return route.fallback();
    }
    const url = new URL(route.request().url());
    const q = url.searchParams.get('q');
    const filtered = q
      ? itemsList.filter((item) => item.name.toLowerCase().includes(q.toLowerCase()))
      : itemsList;

    return route.fulfill({
      json: {
        items: filtered,
        nextCursor: null,
        hasMore: false,
      },
    });
  });
});

test.describe('PER-90: Route transitions, history navigation and focus recovery', () => {
  test('desktop sidebar navigation scrolls to (0,0) and focuses #main-content', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/store');

    // Scroll down the store page
    await page.evaluate(() => window.scrollTo(0, 500));
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);

    // Click Wants in the desktop sidebar
    const sidebar = page.locator('#primary-sidebar');
    const wantsLink = sidebar.getByRole('link', { name: 'Wants' });
    await wantsLink.click();

    await page.waitForURL('**/wants');

    // Expected: scrolls to top (0,0) and focuses #main-content
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    const activeId = await page.evaluate(() => document.activeElement?.id);
    expect(activeId).toBe('main-content');

    // Exactly one primary destination active
    expect(await wantsLink.getAttribute('aria-current')).toBe('page');
    expect(
      await sidebar.getByRole('link', { name: 'My Store' }).getAttribute('aria-current'),
    ).toBeNull();
  });

  test('mobile bottom navigation scrolls to (0,0) and focuses #main-content', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/store');

    // Scroll down the store page on mobile
    await page.evaluate(() => window.scrollTo(0, 400));
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);

    // Click Wants in the mobile navigation bar
    const mobileNav = page.locator('.mobile-navigation');
    const wantsLink = mobileNav.getByRole('link', { name: 'Wants' });
    await wantsLink.click();

    await page.waitForURL('**/wants');

    // Expected: scrolls to top (0,0) and focuses #main-content, NOT stranded on bottom bar
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    const activeId = await page.evaluate(() => document.activeElement?.id);
    expect(activeId).toBe('main-content');
  });

  test('mobile More menu closes and focuses #main-content on navigation, or restores to More on Escape', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/store');

    const mobileNav = page.locator('.mobile-navigation');
    const moreTrigger = mobileNav.getByRole('button', { name: /More destinations/ });

    // Open More menu
    await moreTrigger.click();
    const goalsItem = page.getByRole('menuitem', { name: 'Goals' });
    await expect(goalsItem).toBeVisible();

    // Dismiss with Escape: focus returns to More trigger
    await page.keyboard.press('Escape');
    await expect(goalsItem).not.toBeVisible();
    expect(await page.evaluate(() => document.activeElement?.getAttribute('aria-label'))).toMatch(
      /More destinations/,
    );

    // Open More menu again and select Goals
    await moreTrigger.click();
    await expect(goalsItem).toBeVisible();
    await goalsItem.click();

    await page.waitForURL('**/goals');

    // Focus lands on #main-content of Goals, NOT hijacked back to More button
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    const activeId = await page.evaluate(() => document.activeElement?.id);
    expect(activeId).toBe('main-content');

    // More button shows active state for child destination
    await expect(moreTrigger).toHaveAttribute('aria-label', 'More destinations, current page');
  });

  test('breakpoint changes close More menu and transfer navigation focus cleanly', async ({
    page,
  }) => {
    // 1. Mobile to Desktop while More menu is open
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/store');

    const moreTrigger = page.locator('.mobile-navigation button[aria-label*="More destinations"]');
    await moreTrigger.click();
    await expect(page.getByRole('menuitem', { name: 'Goals' })).toBeVisible();

    // Resize to desktop (1024px)
    await page.setViewportSize({ width: 1024, height: 720 });

    // More menu closes immediately, no stale portal
    await expect(page.getByRole('menuitem', { name: 'Goals' })).not.toBeVisible();

    // Exactly one navigation surface visible (desktop sidebar)
    await expect(page.locator('#primary-sidebar')).toBeVisible();
    await expect(page.locator('.mobile-navigation')).not.toBeVisible();

    // Focus is not trapped or on body; recovered to desktop sidebar
    await expect
      .poll(async () => page.evaluate(() => document.activeElement?.tagName))
      .not.toBe('BODY');

    // 2. Desktop to Mobile with focused sidebar link
    const desktopStoreLink = page.locator('#primary-sidebar a[href="/store"]');
    await desktopStoreLink.focus();

    // Resize to mobile (390px)
    await page.setViewportSize({ width: 390, height: 844 });

    await expect(page.locator('.mobile-navigation')).toBeVisible();
    await expect(page.locator('#primary-sidebar')).not.toBeVisible();

    // Focus transfers to the mobile store link
    await expect
      .poll(async () => page.evaluate(() => document.activeElement?.getAttribute('href')))
      .toBe('/store');
  });

  test('list → details → back restores URL query, scroll position and focuses the item card', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/store?q=kettle');

    // Wait for store catalog to load
    const itemCard = page.locator(`[data-item-id="${itemId}"]`);
    await expect(itemCard).toBeVisible();

    // Scroll item into view and click it
    await itemCard.scrollIntoViewIfNeeded();
    await itemCard.click();
    await page.waitForURL(`**/items/${itemId}**`);

    // Details page starts at top
    expect(await page.evaluate(() => window.scrollY)).toBe(0);

    // Click "Back to My Store" in-page link
    const backLink = page.getByRole('link', { name: /Back to My Store/ });
    await backLink.click();

    await page.waitForURL('**/store?q=kettle');

    // Query is preserved
    expect(page.url()).toContain('q=kettle');

    // The item card is restored into view and receives focus
    await expect(itemCard).toBeVisible();
    await expect(itemCard).toBeFocused();
  });

  test('browser Back button restores list position and item focus', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/store?q=kettle');

    const itemCard = page.locator(`[data-item-id="${itemId}"]`);
    await expect(itemCard).toBeVisible();
    await itemCard.scrollIntoViewIfNeeded();
    await itemCard.click();

    await page.waitForURL(`**/items/${itemId}**`);

    // Press browser Back button
    await page.goBack();
    await page.waitForURL('**/store?q=kettle');

    // Item is focused and restored into view
    await expect(itemCard).toBeVisible();
    await expect(itemCard).toBeFocused();
  });

  test('in-page search query does not cause scroll jump or focus loss', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/store');

    const searchInput = page.getByPlaceholder(/Search what you own/);
    await searchInput.focus();
    await searchInput.fill('kettle');
    await searchInput.press('Enter');

    // Query in URL updates without full page reload or scroll jump
    await expect(page).toHaveURL(/q=kettle/);
    expect(await searchInput.evaluate((el) => el === document.activeElement)).toBe(true);
  });

  test('closing Delete item dialog returns focus to Delete button', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto(`/items/${itemId}`);

    const deleteButton = page.getByRole('button', { name: 'Delete item…' });
    await deleteButton.scrollIntoViewIfNeeded();
    await deleteButton.click();

    const dialog = page.getByRole('alertdialog', { name: /Delete .* permanently/ });
    await expect(dialog).toBeVisible();

    // Cancel / dismiss dialog
    const cancelButton = page.getByRole('button', { name: 'Keep item' });
    await cancelButton.click();
    await expect(dialog).not.toBeVisible();

    // Focus returns to the Delete item button
    const deleteFocused = await deleteButton.evaluate((el) => el === document.activeElement);
    expect(deleteFocused).toBe(true);
  });

  test('preserves behavior with dark mode and reduced motion', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('theme', 'dark');
      localStorage.setItem('havefolio:palette-preset:v1', 'forest');
    });
    await page.emulateMedia({ reducedMotion: 'reduce' });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/store');

    const mobileNav = page.locator('.mobile-navigation');
    const wantsLink = mobileNav.getByRole('link', { name: 'Wants' });
    await wantsLink.click();
    await page.waitForURL('**/wants');

    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    const activeId = await page.evaluate(() => document.activeElement?.id);
    expect(activeId).toBe('main-content');
  });
});
