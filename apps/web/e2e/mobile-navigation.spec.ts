import { expect, test, type Locator, type Page } from '@playwright/test';
import { desireId, goalId, itemId, mockCoreJourneys } from './support/core-journeys';

// PER-85: the bottom navigation keeps one geometry relative to the layout viewport, and content,
// focused controls and More destinations stay clear of it. Chromium mobile emulation only: it does
// not model browser toolbars, software keyboards or device safe areas.
const routes = [
  '/',
  '/store',
  '/insights',
  '/wants',
  '/goals',
  '/settings',
  '/settings/taxonomy',
  '/items/new',
  `/items/${itemId}`,
  '/wants/new',
  `/wants/${desireId}/compare`,
  `/goals/${goalId}`,
];

type Geometry = { top: number; bottom: number; left: number; right: number; height: number };

const bottomNavigation = (page: Page): Locator => page.locator('nav.fixed[aria-label="Primary"]');

function geometry(page: Page): Promise<Geometry> {
  return bottomNavigation(page).evaluate((element) => {
    const { top, bottom, left, right, height } = element.getBoundingClientRect();
    return { top, bottom, left, right, height };
  });
}

/** Where the contract places the bar for a given safe-area bottom inset. */
function expected(page: Page, inset = 12): Geometry {
  const { width, height } = page.viewportSize()!;
  return {
    top: height - inset - 70,
    bottom: height - inset,
    left: 12,
    right: width - 12,
    height: 70,
  };
}

async function settle(page: Page, route: string): Promise<void> {
  await page.goto(route);
  await page.waitForLoadState('networkidle');
}

test.beforeEach(async ({ page }) => {
  await mockCoreJourneys(page);
});

test.describe('mobile bottom navigation', () => {
  test.skip(({ isMobile }) => !isMobile, 'The bottom navigation only exists below 768px.');

  for (const [width, height] of [
    [360, 780],
    [390, 844],
  ] as const) {
    test(`keeps one position and clears the last content at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      for (const route of routes) {
        await settle(page, route);
        // Overflowing pages must not widen the layout viewport; that zooms out and moves the bar.
        expect(await page.evaluate(() => innerWidth), route).toBe(width);
        expect(await geometry(page), route).toEqual(expected(page));

        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        expect(await geometry(page), route).toEqual(expected(page));
        const lastContentBottom = await page.locator('#main-content').evaluate((main) => {
          const padding = parseFloat(getComputedStyle(main).paddingBottom);
          return main.getBoundingClientRect().bottom - padding;
        });
        expect(lastContentBottom, route).toBeLessThanOrEqual(expected(page).top);
      }
    });
  }

  test('ignores page content wider than the phone', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    await settle(page, '/store');
    await page.locator('#main-content').evaluate((main) => {
      const wide = document.createElement('div');
      wide.style.width = '480px';
      wide.style.height = '1px';
      main.prepend(wide);
    });
    expect(await page.evaluate(() => [innerWidth, document.documentElement.scrollWidth])).toEqual([
      360, 360,
    ]);
    expect(await geometry(page)).toEqual(expected(page));
  });

  test('derives the offset and clearance once from the safe-area inset', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await settle(page, '/wants/new');
    // Stands in for env(safe-area-inset-bottom) on a device with a home indicator.
    await page.addStyleTag({ content: ':root{--mobile-nav-offset:max(0.75rem, 34px)}' });
    expect(await geometry(page)).toEqual(expected(page, 34));
    // Height + inset + gap; a doubled inset would be 150px.
    await expect(page.locator('#main-content')).toHaveCSS('padding-bottom', '116px');
  });

  test('scrolls keyboard focus clear of the bar', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    for (const route of ['/wants/new', '/items/new', '/settings']) {
      await settle(page, route);
      const bar = expected(page);
      for (let step = 0; step < 40; step += 1) {
        await page.keyboard.press('Tab');
        const focused = await page.evaluate(() => {
          const element = document.activeElement;
          if (!element || element === document.body || element.closest('nav')) return null;
          const { top, bottom } = element.getBoundingClientRect();
          return { name: element.outerHTML.slice(0, 80), top, bottom };
        });
        if (!focused) continue;
        const obscured = focused.bottom > bar.top + 1 && focused.top < bar.bottom;
        expect(obscured, `${route} ${focused.name}`).toBe(false);
      }
    }
  });

  test('opens More above the bar without moving it or the page', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    await settle(page, '/store');
    await page.evaluate(() => window.scrollTo(0, 240));
    const scrolled = await page.evaluate(() => scrollY);
    const trigger = page.getByRole('button', { name: 'More destinations' });

    await trigger.click();
    const menu = page.getByRole('menu');
    await expect(menu.getByRole('menuitem', { name: 'Settings' })).toBeVisible();
    // Measured once the open animation has finished scaling the menu.
    await expect
      .poll(async () => menu.evaluate((element) => element.getAnimations().length))
      .toBe(0);
    const box = (await menu.boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(expected(page).top);
    expect(await geometry(page)).toEqual(expected(page));
    expect(await page.evaluate(() => scrollY)).toBe(scrolled);

    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(trigger).toBeFocused();
    expect(await geometry(page)).toEqual(expected(page));
    expect(await page.evaluate(() => scrollY)).toBe(scrolled);

    await trigger.click();
    await page.getByRole('menuitem', { name: 'Goals' }).click();
    await expect(page).toHaveURL(/\/goals$/);
    expect(await geometry(page)).toEqual(expected(page));
  });

  test('keeps the same geometry in dark mode, reduced motion and after rotation', async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 390, height: 844 });
    await settle(page, '/wants');
    expect(await geometry(page)).toEqual(expected(page));
    // A landscape phone of 667px still uses the bar; wider ones switch to the sidebar.
    await page.setViewportSize({ width: 667, height: 375 });
    expect(await geometry(page)).toEqual(expected(page));
    await page.setViewportSize({ width: 844, height: 390 });
    await expect(bottomNavigation(page)).toBeHidden();
    await expect(page.locator('#main-content')).toHaveCSS('padding-bottom', '0px');
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await geometry(page)).toEqual(expected(page));
  });
});
