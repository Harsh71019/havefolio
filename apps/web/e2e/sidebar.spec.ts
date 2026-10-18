import { expect, test, type Locator, type Page } from '@playwright/test';
import { createRequire } from 'node:module';
import { mockCoreJourneys } from './support/core-journeys';

// PER-66: the desktop navigation collapses to an icon rail; mobile keeps its bottom navigation.
const axeSource = createRequire(import.meta.url).resolve('axe-core/axe.min.js');
const tags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];

const sidebar = (page: Page): Locator => page.locator('#primary-sidebar');
const width = (page: Page, selector: string): Promise<number> =>
  page.locator(selector).evaluate((element) => element.getBoundingClientRect().width);

async function axeViolations(page: Page): Promise<string[]> {
  if (!(await page.evaluate(() => 'axe' in window))) await page.addScriptTag({ path: axeSource });
  return page.evaluate(async (values) => {
    type Result = { violations: { id: string; nodes: { target: string[] }[] }[] };
    const axe = (window as unknown as { axe: { run: (...a: unknown[]) => Promise<Result> } }).axe;
    const result = await axe.run(document, { runOnly: { type: 'tag', values } });
    return result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(', ')}`);
  }, tags);
}

test.beforeEach(async ({ page }) => {
  await mockCoreJourneys(page);
});

test.describe('desktop', () => {
  test.skip(({ isMobile }) => isMobile, 'The sidebar only exists from 768px.');

  test('collapses to a remembered icon rail that widens the content', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/store');
    const toggle = page.getByRole('button', { name: 'Collapse sidebar' });
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(sidebar(page)).toHaveCSS('width', '272px');
    const before = await width(page, '#main-content');

    await toggle.click();
    const expand = page.getByRole('button', { name: 'Expand sidebar' });
    await expect(expand).toHaveAttribute('aria-expanded', 'false');
    await expect(sidebar(page)).toHaveCSS('width', '64px');
    await expect.poll(() => width(page, '#main-content')).toBe(before + 208);
    await expect(page.getByText('Your inventory stays private.')).toBeHidden();
    const navigation = sidebar(page).getByRole('navigation', { name: 'Primary' });
    await expect(navigation.getByRole('link', { name: 'My Store' })).toHaveAttribute(
      'aria-current',
      'page',
    );

    // The saved width applies before hydration, so there is no expanded frame on reload.
    await page.reload({ waitUntil: 'commit' });
    await page.waitForSelector('#primary-sidebar');
    expect(await width(page, '#primary-sidebar')).toBe(64);

    await navigation.getByRole('link', { name: 'Insights' }).hover();
    await expect(page.getByRole('tooltip')).toHaveText('Insights');
    await navigation.getByRole('link', { name: 'Insights' }).click();
    await expect(page).toHaveURL(/\/insights(\?|$)/);
    await page.waitForLoadState('networkidle');
    await page.addStyleTag({
      content: '*,*::before,*::after{transition:none!important;animation:none!important}',
    });
    expect(await axeViolations(page)).toEqual([]);

    await page.getByRole('button', { name: 'Expand sidebar' }).click();
    await expect(sidebar(page)).toHaveCSS('width', '272px');
    await page.reload();
    await expect(sidebar(page)).toHaveCSS('width', '272px');
  });

  test('toggles with the keyboard shortcut outside text fields', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/store');
    await page.keyboard.press('ControlOrMeta+b');
    await expect(sidebar(page)).toHaveCSS('width', '64px');

    await page.getByRole('searchbox', { name: 'Search what you own' }).focus();
    await page.keyboard.press('ControlOrMeta+b');
    await expect(sidebar(page)).toHaveCSS('width', '64px');

    await page.getByRole('searchbox', { name: 'Search what you own' }).blur();
    await page.keyboard.press('ControlOrMeta+b');
    await expect(sidebar(page)).toHaveCSS('width', '272px');
  });

  test('resizes instantly with reduced motion', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    await expect(sidebar(page)).toHaveCSS('transition-property', 'none');
  });
});

test('mobile keeps the bottom navigation and has no sidebar toggle', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'Mobile layout only.');
  await page.goto('/');
  // The desktop sidebar is display:none, so only the bottom navigation is exposed.
  await expect(page.getByRole('navigation', { name: 'Primary' })).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'More destinations' })).toBeVisible();
  await expect(page.getByRole('button', { name: /sidebar/ })).toBeHidden();
  await page.keyboard.press('Control+b');
  await expect(page.locator('html')).toHaveAttribute('data-sidebar', 'expanded');
});
