import { expect, test, type Locator, type Page } from '@playwright/test';
import { id, itemId, mockCoreJourneys } from './support/core-journeys';

// PER-87: overlays open and close without moving the page, leaking scroll to the background or
// losing focus. Chromium emulation with synthetic data: wheel gestures stand in for real input,
// and no touch scrolling, mobile browser chrome or software keyboard is modelled.

const onboarding = {
  state: 'active',
  genuineItemCount: 2,
  demoItemCount: 1,
  browsedStore: true,
  reviewedItem: true,
  triedDemo: true,
  removedDemo: false,
};

test.beforeEach(async ({ page }) => {
  await mockCoreJourneys(page);
  await page.route(/\/api\/v1\/onboarding(\/actions)?$/, (route) =>
    route.fulfill({ json: onboarding }),
  );
  await page.route(`**/api/v1/items/${itemId}/documents`, (route) =>
    route.fulfill({
      json: {
        revision: 1,
        documents: [
          {
            id: id(401),
            kind: 'receipt',
            mimeType: 'application/pdf',
            byteSize: 245000,
            width: null,
            height: null,
          },
        ],
      },
    }),
  );
});

type PageState = { y: number; overflow: string; pointerEvents: string };

const released = (y: number): PageState => ({ y, overflow: 'visible', pointerEvents: 'auto' });

function pageState(page: Page): Promise<PageState> {
  return page.evaluate(() => ({
    y: Math.round(scrollY),
    overflow: getComputedStyle(document.body).overflow,
    pointerEvents: getComputedStyle(document.body).pointerEvents,
  }));
}

/**
 * Wheels over a point (by default the content column, clear of the sidebar, which scrolls on its
 * own) towards whichever end has room, and reports how far the window moved. CDP touch-scroll
 * gestures were not applied on the Linux CI runner, so the wheel is used in both projects.
 */
async function scrollOver(page: Page, point?: { x: number; y: number }): Promise<number> {
  const { x, y } = point ?? { x: page.viewportSize()!.width - 24, y: 160 };
  const before = await page.evaluate(() => scrollY);
  const down = await page.evaluate(
    () => scrollY + innerHeight < document.documentElement.scrollHeight - 1,
  );
  await page.mouse.move(x, y);
  await page.mouse.wheel(0, down ? 200 : -200);
  // Let the wheel's scroll events land before measuring.
  await page.waitForTimeout(200);
  return (await page.evaluate(() => scrollY)) - before;
}

/** Shortens the viewport so the page scrolls, then centres the trigger mid-page. */
async function midPage(page: Page, trigger: Locator): Promise<number> {
  const { width } = page.viewportSize()!;
  await page.setViewportSize({ width, height: 520 });
  await trigger.evaluate((element) => element.scrollIntoView({ block: 'center' }));
  await trigger.focus();
  return (await pageState(page)).y;
}

type Case = {
  name: string;
  url: string;
  trigger: (page: Page) => Locator;
  dialog: (page: Page) => Locator;
  /** `Escape`, or the name of the dialog button that dismisses it. */
  dismiss: string;
  /** Widest viewport where the opener is shown. */
  maxWidth?: number;
};

// Each opens a controlled dialog from a button that is not a Radix trigger, so Radix had no
// element to return focus to and focus fell to <body>.
const cases: Case[] = [
  {
    name: 'store filters',
    url: '/store',
    trigger: (page) => page.getByRole('button', { name: /^Filters/ }),
    dialog: (page) => page.getByRole('dialog', { name: 'Filters' }),
    dismiss: 'Escape',
    // Wider screens show the filters beside the results instead.
    maxWidth: 1279,
  },
  {
    name: 'item add details',
    url: `/items/${itemId}`,
    trigger: (page) => page.getByRole('button', { name: /^Add details/ }),
    dialog: (page) => page.getByRole('dialog', { name: 'Add details' }),
    dismiss: 'Escape',
  },
  {
    name: 'document removal',
    url: `/items/${itemId}`,
    trigger: (page) => page.getByRole('button', { name: 'Remove Receipt 1' }),
    dialog: (page) => page.getByRole('alertdialog', { name: /Remove this receipt/ }),
    dismiss: 'Keep it',
  },
  {
    name: 'demo removal',
    url: '/',
    trigger: (page) => page.getByRole('button', { name: 'Remove all demo data' }),
    dialog: (page) => page.getByRole('dialog', { name: 'Remove all demo data?' }),
    dismiss: 'Keep demos',
  },
];

const appearances = [
  { theme: 'light', palette: 'neutral', motion: 'no-preference' },
  { theme: 'dark', palette: 'ocean', motion: 'reduce' },
] as const;

for (const { theme, palette, motion } of appearances)
  test.describe(`${theme} ${palette}, ${motion} motion`, () => {
    test.beforeEach(async ({ page }) => {
      await page.addInitScript(
        (appearance) => {
          localStorage.setItem('theme', appearance.theme);
          localStorage.setItem('havefolio:palette-preset:v1', appearance.palette);
        },
        { theme, palette },
      );
      await page.emulateMedia({ reducedMotion: motion });
    });

    for (const c of cases)
      test(`${c.name} keeps the page still and returns focus to its opener`, async ({ page }) => {
        const { width, height } = page.viewportSize()!;
        if (c.maxWidth && width > c.maxWidth)
          await page.setViewportSize({ width: c.maxWidth, height });
        await page.goto(c.url);
        const trigger = c.trigger(page);
        await expect(trigger).toBeVisible();
        const y = await midPage(page, trigger);

        await page.keyboard.press('Enter');
        const dialog = c.dialog(page);
        await expect(dialog).toBeVisible();
        expect(await pageState(page)).toMatchObject({ y, overflow: 'hidden' });
        // The background stays put while the modal is open.
        expect(await scrollOver(page)).toBe(0);

        if (c.dismiss === 'Escape') await page.keyboard.press('Escape');
        else await dialog.getByRole('button', { name: c.dismiss }).click();
        await expect(dialog).toBeHidden();
        await expect(trigger).toBeFocused();
        await expect.poll(() => pageState(page)).toEqual(released(y));
        // Scrolling works again once the overlay has gone.
        expect(await scrollOver(page)).not.toBe(0);
      });
  });

test('store filters scroll inside the dialog, not behind it', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 520 });
  await page.goto('/store');
  const trigger = page.getByRole('button', { name: /^Filters/ });
  const y = await midPage(page, trigger);
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Filters' });
  await expect(dialog).toBeVisible();

  const box = (await dialog.boundingBox())!;
  const viewport = page.viewportSize()!;
  // Bounded to the viewport, with the overflow scrolling inside it.
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
  expect(await dialog.evaluate((d) => d.scrollHeight > d.clientHeight)).toBe(true);

  const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  expect(await scrollOver(page, centre)).toBe(0);
  expect(await dialog.evaluate((d) => d.scrollTop)).toBeGreaterThan(0);
  expect((await pageState(page)).y).toBe(y);

  // "Show results" closes the dialog through the same path as Escape.
  await dialog.getByRole('button', { name: /^Show/ }).click();
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
  await expect.poll(() => pageState(page)).toEqual(released(y));
});

test('choosing an optional detail hands focus to its editor, not back to Add details', async ({
  page,
}) => {
  await page.goto(`/items/${itemId}`);
  await page.getByRole('button', { name: /^Add details/ }).click();
  const details = page.getByRole('dialog', { name: 'Add details' });
  await details.getByRole('button').first().click();
  await expect(details).toBeHidden();
  const editor = page.getByRole('dialog').filter({ hasNot: page.getByText('All optional') });
  await expect(editor).toBeVisible();
  // Wait past the closing animation, when the Add details dialog would restore focus.
  await page.waitForTimeout(400);
  expect(await editor.evaluate((d) => d.contains(document.activeElement))).toBe(true);
});

test('nested overlays close one layer at a time and release the page last', async ({ page }) => {
  await page.goto(`/items/${itemId}`);
  const trigger = page.getByRole('button', { name: 'Edit condition and use' });
  const y = await midPage(page, trigger);
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Edit condition and use' });
  await expect(dialog).toBeVisible();

  await dialog.getByRole('combobox').first().click();
  await expect(page.getByRole('listbox')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('listbox')).toBeHidden();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('combobox').first()).toBeFocused();
  expect(await pageState(page)).toMatchObject({ y, overflow: 'hidden' });
  expect(await scrollOver(page)).toBe(0);

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
  await expect.poll(() => pageState(page)).toEqual(released(y));
  expect(await scrollOver(page)).not.toBe(0);
});

test('a confirmation opened from a menu returns focus to the menu button', async ({ page }) => {
  await page.goto(`/items/${itemId}`);
  const trigger = page.getByRole('button', { name: 'No longer have it' });
  const y = await midPage(page, trigger);
  await page.keyboard.press('Enter');
  await page.getByRole('menuitem').first().click();
  const confirm = page.getByRole('alertdialog');
  await expect(confirm).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(confirm).toBeHidden();
  await expect(trigger).toBeFocused();
  await expect.poll(() => pageState(page)).toEqual(released(y));
});

test('the More menu returns focus without moving the page', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'The bottom navigation only exists below 768px.');
  await page.goto('/');
  await page.setViewportSize({ width: 390, height: 520 });
  await page.evaluate(() => window.scrollTo(0, 120));
  const y = (await pageState(page)).y;
  const more = page.getByRole('button', { name: /^More destinations/ });
  await more.tap();
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(more).toBeFocused();
  await expect.poll(() => pageState(page)).toEqual(released(y));
});
