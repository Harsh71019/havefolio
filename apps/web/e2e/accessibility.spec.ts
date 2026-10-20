import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { coreRoutes, goalId, itemId, mockCoreJourneys } from './support/core-journeys';

// PER-36: cross-journey accessibility, responsive and resilient-state regression.
// Synthetic fixtures only; automated checks do not replace the manual screen-reader review.
const axeSource = createRequire(import.meta.url).resolve('axe-core/axe.min.js');
const screenshots = resolve(process.cwd(), '../../docs/screenshots');
const tags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];
const routes = [...coreRoutes, ['login', '/login'] as const];
const screenshotRoutes = new Set(['home', 'wants', 'goal-detail', 'settings']);

async function freezeMotion(page: Page): Promise<void> {
  // Colour transitions would let axe sample a half-switched theme.
  await page.addStyleTag({
    content: '*,*::before,*::after{transition:none!important;animation:none!important}',
  });
}
async function setTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await page.evaluate((value) => {
    document.documentElement.classList.remove('light', 'dark');
    document.documentElement.classList.add(value);
    document.documentElement.style.colorScheme = value;
  }, theme);
}
async function axeViolations(page: Page): Promise<string[]> {
  if (!(await page.evaluate(() => 'axe' in window))) await page.addScriptTag({ path: axeSource });
  return page.evaluate(async (values) => {
    type Result = { violations: { id: string; nodes: { target: string[] }[] }[] };
    const axe = (window as unknown as { axe: { run: (...a: unknown[]) => Promise<Result> } }).axe;
    const result = await axe.run(document, { runOnly: { type: 'tag', values } });
    return result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(', ')}`);
  }, tags);
}
/** Document overflow, or the furthest any visible element pokes past the viewport (clipped cards hide it from scrollWidth). */
async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => {
    let worst = document.documentElement.scrollWidth - window.innerWidth;
    for (const el of document.querySelectorAll<HTMLElement>('body *')) {
      if (el.closest('.sr-only, [data-radix-popper-content-wrapper]')) continue;
      let scroller = el.parentElement;
      while (scroller && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowX))
        scroller = scroller.parentElement;
      if (scroller) continue;
      const box = el.getBoundingClientRect();
      if (box.width && box.height) worst = Math.max(worst, box.right - window.innerWidth);
    }
    return Math.round(worst);
  });
}
/** Visible controls under 44 × 44 px, excluding inline prose links and visually hidden inputs. */
async function smallTargets(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const selector =
      'a[href],button,input:not([type=hidden]),select,textarea,summary,[role=button],[role=radio],[role=checkbox],[role=switch],[role=combobox]';
    const small: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>(selector)) {
      let box = el.getBoundingClientRect();
      if (box.width <= 1 || box.height <= 1 || getComputedStyle(el).visibility === 'hidden')
        continue;
      // Radix bubble inputs mirror an accessible control; an unfocused skip link is off-screen.
      if (el.getAttribute('aria-hidden') === 'true' || el.matches('.sr-only:not(:focus)')) continue;
      if (el.tagName === 'A' && el.closest('p')) continue;
      const after = getComputedStyle(el, '::after');
      if (after.content !== 'none' && after.position === 'absolute') {
        const parent = el.offsetParent?.getBoundingClientRect();
        if (parent && el.className.includes('after:inset-0')) box = parent;
        else {
          const inset = Math.abs(parseFloat(after.top) || 0);
          box = new DOMRect(0, 0, box.width + inset * 2, box.height + inset * 2);
        }
      }
      if (el.matches('[role=radio],[role=checkbox],input[type=radio],input[type=checkbox]')) {
        const label = el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`) : null;
        const holder = label ?? el.closest('label');
        if (holder) box = holder.getBoundingClientRect();
      }
      if (box.width < 44 || box.height < 44) {
        const name = (el.getAttribute('aria-label') ?? el.textContent ?? el.id).trim().slice(0, 40);
        small.push(
          `${el.tagName.toLowerCase()} "${name}" ${Math.round(box.width)}×${Math.round(box.height)}`,
        );
      }
    }
    return small;
  });
}

test.describe('core journeys with data', () => {
  for (const [name, path] of routes)
    test(`${name}: axe clean in light and dark, no overflow, 44px targets`, async ({
      page,
    }, info) => {
      const unhandled: string[] = [];
      await mockCoreJourneys(page, { unhandled });
      const mobile = info.project.name === 'mobile';
      if (mobile) await page.setViewportSize({ width: 360, height: 780 });
      await page.goto(path);
      await freezeMotion(page);
      await page.waitForLoadState('networkidle');
      await expect(page.locator('h1')).toHaveCount(1);
      await expect(page.getByRole('link', { name: 'Skip to main content' })).toHaveCount(1);
      for (const theme of ['light', 'dark'] as const) {
        await setTheme(page, theme);
        expect(await axeViolations(page), `${name} ${theme}`).toEqual([]);
        if (screenshotRoutes.has(name)) {
          await mkdir(screenshots, { recursive: true });
          await page.screenshot({
            path: resolve(screenshots, `per-36-${name}-${mobile ? '360' : 'desktop'}-${theme}.png`),
            fullPage: true,
            animations: 'disabled',
          });
        }
      }
      if (mobile) expect(await smallTargets(page), name).toEqual([]);
      const widths = mobile ? [360, 412] : [768, 1024, 1440];
      for (const width of widths) {
        await page.setViewportSize({ width, height: 900 });
        expect(await horizontalOverflow(page), `${name} at ${width}px`).toBeLessThanOrEqual(0);
      }
      expect(unhandled, 'fixture gaps').toEqual([]);
    });
});

test.describe('failed and offline reads', () => {
  for (const mode of ['error', 'offline'] as const)
    for (const [name, path] of coreRoutes)
      test(`${mode} ${name}: keeps a heading, explains the failure and stays accessible`, async ({
        page,
      }, info) => {
        test.skip(info.project.name !== 'mobile', 'State presentation is width-independent.');
        await mockCoreJourneys(page, mode === 'offline' ? { offline: true } : { status: 503 });
        await page.setViewportSize({ width: 360, height: 780 });
        await page.goto(path);
        await freezeMotion(page);
        await page.waitForLoadState('networkidle');
        await expect(page.locator('h1')).toHaveCount(1);
        expect(await axeViolations(page)).toEqual([]);
        expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
        // Failures never mention the wrong service.
        if (name.startsWith('goal'))
          await expect(page.locator('body')).not.toContainText('desires service');
        if (name === 'goal-detail' || name === 'want-history') {
          await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
          if (mode === 'error') {
            await page.screenshot({
              path: resolve(screenshots, `per-36-${name}-failed-360-light.png`),
              fullPage: true,
              animations: 'disabled',
            });
          }
        }
      });

  test('goal detail recovers in place after a failed read', async ({ page }) => {
    let fail = true;
    await mockCoreJourneys(page);
    await page.route(`**/api/v1/goals/${goalId}`, (route) =>
      fail ? route.abort('internetdisconnected') : route.fallback(),
    );
    await page.goto(`/goals/${goalId}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Goal details' })).toBeVisible();
    await expect(page.getByRole('alert').filter({ hasText: 'Could not load' })).toContainText(
      'Nothing has been changed.',
    );
    fail = false;
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Synthetic trip' })).toBeVisible();
  });
});

test.describe('keyboard, focus and motion', () => {
  test('skip link is the first stop and moves focus past navigation', async ({ page }) => {
    await mockCoreJourneys(page);
    await page.goto('/goals');
    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', { name: 'Skip to main content' });
    await expect(skip).toBeFocused();
    await expect(skip).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(page.locator('#main-content')).toBeFocused();
    await page.keyboard.press('Tab');
    // The next stop is inside the page content, not the primary navigation.
    expect(
      await page.evaluate(() => Boolean(document.activeElement?.closest('#main-content'))),
    ).toBe(true);
  });

  test('controlled dialogs trap focus, close with Escape and restore focus', async ({ page }) => {
    await mockCoreJourneys(page);
    await page.goto(`/goals/${goalId}`);
    for (const name of ['Archive', 'Record a contribution']) {
      const trigger = page.getByRole('button', { name, exact: true });
      await trigger.focus();
      await page.keyboard.press('Enter');
      const dialog = page.getByRole('alertdialog');
      await expect(dialog).toBeVisible();
      expect(await dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true);
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      await expect(trigger).toBeFocused();
    }
  });

  test('reduced motion collapses dialog animation', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await mockCoreJourneys(page);
    await page.goto(`/goals/${goalId}`);
    await page.getByRole('button', { name: 'Archive', exact: true }).click();
    const duration = await page
      .getByRole('alertdialog')
      .evaluate((d) => parseFloat(getComputedStyle(d).animationDuration));
    expect(duration).toBeLessThan(0.001);
  });
});

test.describe('failed writes keep what the owner entered', () => {
  test('a goal that fails to save keeps every field', async ({ page }) => {
    await mockCoreJourneys(page);
    await page.route('**/api/v1/goals', (route) =>
      route.request().method() === 'POST'
        ? route.fulfill({ status: 503, json: { message: 'GOALS_UNAVAILABLE' } })
        : route.fallback(),
    );
    await page.goto('/goals/new');
    await page.getByLabel('Goal name').fill('Synthetic emergency fund');
    await page.getByLabel('Target amount').fill('25000');
    await page.getByLabel('Private notes (optional)').fill('Synthetic note to keep');
    await page.getByRole('button', { name: 'Create goal' }).click();
    await expect(page.getByRole('alert').first()).toContainText(
      'Goals are temporarily unavailable',
    );
    await expect(page.getByLabel('Goal name')).toHaveValue('Synthetic emergency fund');
    await expect(page.getByLabel('Target amount')).toHaveValue('25000');
    await expect(page.getByLabel('Private notes (optional)')).toHaveValue('Synthetic note to keep');
  });

  test('a desire that cannot reach the API keeps its name', async ({ page }) => {
    await mockCoreJourneys(page);
    await page.route('**/api/v1/desires', (route) =>
      route.request().method() === 'POST' ? route.abort('internetdisconnected') : route.fallback(),
    );
    await page.goto('/wants/new');
    const name = page.getByLabel(/What are you considering\?/);
    await name.fill('Synthetic standing desk');
    await page
      .getByRole('button', { name: /Save|Add/ })
      .last()
      .click();
    await expect(page.getByRole('alert').first()).toBeVisible();
    await expect(name).toHaveValue('Synthetic standing desk');
  });

  test('an item that fails to save keeps its name and price', async ({ page }) => {
    await mockCoreJourneys(page);
    await page.route('**/api/v1/items', (route) =>
      route.request().method() === 'POST'
        ? route.fulfill({ status: 503, json: { message: 'ITEMS_UNAVAILABLE' } })
        : route.fallback(),
    );
    await page.goto('/items/new');
    const name = page.getByPlaceholder('e.g. Electric kettle, Sony headphones, Winter coat');
    await name.fill('Synthetic table lamp');
    await page.getByLabel('Actual amount paid').fill('1299');
    await page.getByRole('button', { name: 'Save item', exact: true }).click();
    await expect(page.getByRole('alert').first()).toBeVisible();
    await expect(name).toHaveValue('Synthetic table lamp');
    await expect(page.getByLabel('Actual amount paid')).toHaveValue('1299');
  });

  test('a dropped photo upload keeps the selected preview for retry', async ({ page }) => {
    await mockCoreJourneys(page);
    await page.route(`**/api/v1/items/${itemId}/photos`, (route) =>
      route.request().method() === 'POST' ? route.abort('internetdisconnected') : route.fallback(),
    );
    await page.goto(`/items/${itemId}/photos/new`);
    await expect(page.getByLabel('Choose from gallery or files')).toBeEnabled();
    await page.getByLabel('Choose from gallery or files').setInputFiles({
      name: 'synthetic.png',
      mimeType: 'image/png',
      buffer: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=',
        'base64',
      ),
    });
    await page.getByRole('button', { name: 'Upload photos' }).click();
    await expect(page.getByRole('button', { name: 'Remove photo 1' })).toBeVisible();
    await expect(page.getByRole('button', { name: /retry/i }).first()).toBeEnabled();
  });
});
