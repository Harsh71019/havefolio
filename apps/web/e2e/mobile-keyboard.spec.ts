import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { goalId, itemId, mockCoreJourneys } from './support/core-journeys';

// PER-86: forms stay usable with the software keyboard. Chromium mobile emulation (touch, coarse
// pointer) cannot open a software keyboard, so a short viewport stands in for the space left
// above it; real iOS Safari and Android Chrome behaviour is recorded in
// docs/testing/per-86-mobile-keyboard.md.
const textEntry =
  'input:not([type=checkbox],[type=radio],[type=range],[type=file],[type=color],[type=button],[type=submit],[type=reset],[type=image]):not([aria-hidden=true]), textarea';

const bottomNavigation = (page: Page): Locator => page.locator('nav.fixed[aria-label="Primary"]');

async function settle(page: Page, route: string): Promise<void> {
  await page.goto(route);
  await page.waitForLoadState('networkidle');
}

/** Font sizes of every rendered text-entry field inside `scope`. */
function fontSizes(scope: Locator): Promise<{ name: string; size: number }[]> {
  return scope.evaluate((root, selector) => {
    return [...root.querySelectorAll<HTMLElement>(selector)]
      .filter((el) => el.getClientRects().length > 0)
      .map((el) => ({
        name: el.getAttribute('aria-label') ?? el.id,
        size: parseFloat(getComputedStyle(el).fontSize),
      }));
  }, textEntry);
}

test.beforeEach(async ({ page }) => {
  await mockCoreJourneys(page);
});

test.describe('software keyboard on touch phones', () => {
  test.skip(({ isMobile }) => !isMobile, 'Touch-device behaviour only.');

  for (const [width, height] of [
    [360, 780],
    [844, 390],
  ] as const) {
    test(`text-entry fields are at least 16px so iOS does not zoom at ${width}x${height}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height });
      for (const route of ['/items/new', '/wants/new', '/settings', '/store']) {
        await settle(page, route);
        const sizes = await fontSizes(page.locator('body'));
        expect(sizes.length, route).toBeGreaterThan(0);
        for (const field of sizes)
          expect(field.size, `${route} ${field.name}`).toBeGreaterThanOrEqual(16);
      }
      await settle(page, `/items/${itemId}`);
      await page.getByRole('button', { name: 'Edit purchase details' }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      for (const field of await fontSizes(dialog))
        expect(field.size, `purchase dialog ${field.name}`).toBeGreaterThanOrEqual(16);
    });
  }

  test('hides the bottom bar only while a text-entry field has focus', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await settle(page, '/items/new');
    const nav = bottomNavigation(page);
    await expect(nav).toBeVisible();

    const name = page.getByLabel('Item name');
    await name.focus();
    await expect(nav).toBeHidden();
    // Nothing of the bar may stay painted over the form, including its icons and labels.
    expect(await page.getByRole('link', { name: 'Home' }).last().isVisible()).toBe(false);

    await name.blur();
    await expect(nav).toBeVisible();

    // Choice controls do not open a keyboard, so the bar stays.
    await page.getByRole('radio', { name: 'Exact date' }).focus();
    await expect(nav).toBeVisible();
  });

  test('typed values, focus and selection survive rotation and keyboard-sized viewports', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await settle(page, '/items/new');
    const name = page.getByLabel('Item name');
    await name.fill('Synthetic travel kettle');
    const amount = page.getByLabel('Actual amount paid');
    await amount.fill('1499.50');
    await amount.evaluate((el: HTMLInputElement) => el.setSelectionRange(2, 4));

    // Keyboard opens (short viewport), the phone rotates across the md breakpoint and back.
    for (const [width, height] of [
      [390, 420],
      [844, 390],
      [844, 200],
      [390, 844],
    ] as const) {
      await page.setViewportSize({ width, height });
      await expect(amount).toBeFocused();
      await expect(amount).toHaveValue('1499.50');
      await expect(name).toHaveValue('Synthetic travel kettle');
      expect(
        await amount.evaluate((el: HTMLInputElement) => [el.selectionStart, el.selectionEnd]),
      ).toEqual([2, 4]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        width,
      );
    }
  });

  test('a confirmation with fields stays reachable on a keyboard-sized viewport', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 420 });
    await settle(page, `/goals/${goalId}`);
    await page.getByRole('button', { name: 'Record a contribution' }).click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toBeVisible();
    // Measure the settled dialog, not its zoom-in animation.
    await page.waitForFunction(() => document.getAnimations().length === 0);

    const box = (await dialog.boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(420);

    // The dialog scrolls itself; the page behind it stays locked.
    const amount = dialog.getByLabel(/Amount/);
    await amount.fill('250');
    const confirm = dialog.getByRole('button', { name: 'Confirm' });
    await confirm.scrollIntoViewIfNeeded();
    const button = (await confirm.boundingBox())!;
    expect(button.y).toBeGreaterThanOrEqual(box.y);
    expect(button.y + button.height).toBeLessThanOrEqual(box.y + box.height + 0.5);
    await expect(amount).toHaveValue('250');
  });
});

test('desktop pointers keep the compact field size', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Fine-pointer behaviour only.');
  await settle(page, '/items/new');
  const sizes = await fontSizes(page.locator('main'));
  expect(sizes.map((field) => field.size)).toContain(14);
});

test('records synthetic keyboard-layout screenshots', async ({ page, isMobile }) => {
  const stage = process.env.PER86_SCREENSHOTS;
  test.skip(!isMobile || !stage, 'Run with PER86_SCREENSHOTS=before|after to refresh evidence.');
  const out = resolve(process.cwd(), '../../docs/screenshots');
  await mkdir(out, { recursive: true });

  await page.setViewportSize({ width: 360, height: 780 });
  await settle(page, '/items/new');
  await page.getByLabel('Item name').focus();
  await page.waitForFunction(() => document.getAnimations().length === 0);
  await page.screenshot({ path: `${out}/per-86-${stage}-add-item-focused-360.png` });

  await page.setViewportSize({ width: 360, height: 420 });
  await settle(page, `/goals/${goalId}`);
  await page.getByRole('button', { name: 'Record a contribution' }).click();
  await expect(page.getByRole('alertdialog')).toBeVisible();
  await page.waitForFunction(() => document.getAnimations().length === 0);
  await page.screenshot({ path: `${out}/per-86-${stage}-goal-contribution-360x420.png` });

  await page.setViewportSize({ width: 844, height: 390 });
  await settle(page, '/store');
  await page.screenshot({ path: `${out}/per-86-${stage}-store-landscape-844x390.png` });
});
