import { test, expect, type Page, type Locator } from '@playwright/test';
import path from 'node:path';

const evidenceDir = path.resolve(import.meta.dirname, '../../../docs/screenshots');

async function follow(page: Page, link: Locator, keyboard: boolean): Promise<Locator> {
  if (keyboard) {
    await link.focus();
    await page.keyboard.press('Enter');
  } else await link.click();
  const id = (await link.getAttribute('href'))!.slice(1);
  const target = page.locator(`[id="${id}"]`);
  await expect(target).toBeVisible();
  await expect(target).toBeFocused();
  await expect(target).toHaveAttribute('aria-invalid', 'true');
  const message = await link.textContent();
  expect(
    await target.evaluate((el) =>
      el
        .getAttribute('aria-describedby')
        ?.split(' ')
        .map((id) => document.getElementById(id)?.textContent)
        .join(' '),
    ),
  ).toContain(message);
  await expect
    .poll(async () =>
      target.evaluate((el) => {
        const rect = el.getBoundingClientRect();
        const nav = document
          .querySelector('[data-testid="mobile-navbar"]')
          ?.getBoundingClientRect();
        return rect.top >= 0 && rect.bottom <= (nav && nav.height ? nav.top : innerHeight);
      }),
    )
    .toBe(true);
  return target;
}

test.beforeEach(async ({ page }) => {
  await page.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === 'POST') throw new Error('Validation must not save');
    const json = url.pathname.endsWith('/auth/me')
      ? { id: 'synthetic-per72', email: 'owner@example.test', displayName: 'Synthetic owner' }
      : url.pathname.endsWith('/taxonomy')
        ? { categories: [], subcategories: [], tags: [], defaultsSeeded: true }
        : url.pathname.endsWith('/merchants')
          ? { merchants: [], nextCursor: null, hasMore: false }
          : {};
    await route.fulfill({ json });
  });
});

test('PER-72 item summary dates, URL, keyboard and retained metadata', async ({ page }, info) => {
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' });
  await page.goto('/items/new');
  await page.getByLabel('Item name', { exact: false }).fill('Synthetic validation item');
  await page.getByLabel('Price unknown', { exact: true }).check();
  const disclosure = page.getByRole('button', { name: /Additional details/ });
  await disclosure.click();
  await page.getByRole('combobox', { name: 'Acquisition', exact: true }).click();
  await page.getByRole('option', { name: 'Gift', exact: true }).click();
  await page.getByRole('textbox', { name: 'Notes', exact: true }).fill('Synthetic retained note');
  await disclosure.click();
  await page.getByLabel('Purchase URL (optional)', { exact: true }).fill('broken');
  await page.getByRole('textbox', { name: 'Exact purchase date' }).fill('31/02/2024');
  await page.getByRole('button', { name: 'Save item', exact: true }).click();
  const summary = page.getByRole('alert').filter({ hasText: 'Please check' });
  await expect(summary).toBeFocused();
  const dateLink = summary.getByRole('link', { name: /complete purchase date/ });
  await follow(page, dateLink, true);
  await expect(page.getByRole('textbox', { name: 'Exact purchase date' })).toHaveValue(
    '31/02/2024',
  );
  await follow(page, summary.getByRole('link', { name: /absolute HTTP/ }), false);
  for (const [precision, label] of [
    ['Month & year', 'Year'],
    ['Year only', 'Year'],
  ] as const) {
    await page.getByRole('radio', { name: precision, exact: true }).check();
    await page.getByRole('textbox', { name: label, exact: true }).fill('0000');
    await page.getByRole('button', { name: 'Save item', exact: true }).click();
    await expect(summary).toBeFocused();
    await follow(page, summary.getByRole('link', { name: /purchase year/ }), true);
  }
  await disclosure.click();
  await expect(page.getByRole('combobox', { name: 'Acquisition', exact: true })).toHaveText('Gift');
  await expect(page.getByRole('textbox', { name: 'Notes', exact: true })).toHaveValue(
    'Synthetic retained note',
  );
  await follow(page, summary.getByRole('link', { name: /purchase year/ }), true);
  await page.screenshot({
    path: path.join(evidenceDir, `per-72-after-item-${info.project.name}-mock-api.png`),
  });
});

test('PER-72 collapsed want panels reveal before pointer and keyboard focus', async ({
  page,
}, info) => {
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' });
  await page.goto('/wants/new');
  await page
    .getByLabel('What are you considering?', { exact: false })
    .fill('Synthetic validation want');
  const price = page.getByRole('button', { name: /Likely price/ });
  const link = page.getByRole('button', { name: /Product link/ });
  const waiting = page.getByRole('button', { name: /Waiting period/ });
  await price.click();
  await page.getByLabel('Estimated amount').fill('abc');
  await price.click();
  await link.click();
  await page.locator('input[type="url"]').fill('broken');
  await link.click();
  await waiting.click();
  await page.getByRole('button', { name: /Custom/ }).click();
  await page.locator('input[type="datetime-local"]').fill('2020-01-01T12:00');
  await waiting.click();
  await page.getByRole('button', { name: 'Save desire', exact: true }).click();
  const summary = page.getByRole('alert').filter({ hasText: 'Please check' });
  await expect(summary).toBeFocused();
  const links = await summary.getByRole('link').all();
  expect(links).toHaveLength(3);
  for (const [index, errorLink] of links.entries()) await follow(page, errorLink, index % 2 === 0);
  for (const toggle of [price, link, waiting])
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByLabel('Estimated amount')).toHaveValue('abc');
  await expect(page.locator('input[type="datetime-local"]')).toHaveValue('2020-01-01T12:00');
  const ids = await page.locator('[id]').evaluateAll((elements) => elements.map((el) => el.id));
  expect(new Set(ids).size).toBe(ids.length);
  await page.screenshot({
    path: path.join(evidenceDir, `per-72-after-want-${info.project.name}-mock-api.png`),
  });
});

test('PER-72 focus clearance across viewport, palette and motion states', async ({ page }) => {
  const states = [
    [360, 'neutral', false, 'reduce'],
    [390, 'ocean', true, 'no-preference'],
    [768, 'forest', false, 'reduce'],
    [1280, 'neutral', true, 'no-preference'],
    [1512, 'ocean', false, 'reduce'],
    [1920, 'forest', true, 'no-preference'],
  ] as const;
  await page.goto('/wants/new');
  for (const [width, palette, dark, reducedMotion] of states) {
    await page.setViewportSize({ width, height: 820 });
    await page.emulateMedia({ reducedMotion });
    await page.locator('html').evaluate(
      (el, state) => {
        el.setAttribute('data-palette', state.palette);
        el.classList.toggle('dark', state.dark);
      },
      { palette, dark },
    );
    if (width >= 768) {
      const toggle = page.getByRole('button', { name: /Collapse sidebar|Expand sidebar/ });
      await toggle.click();
    }
    const panel = page.getByRole('button', { name: /Likely price/ });
    await panel.click();
    await page.getByLabel('Estimated amount').fill('abc');
    await panel.click();
    await page.getByRole('button', { name: 'Save desire', exact: true }).click();
    const summary = page.getByRole('alert').filter({ hasText: 'Please check' });
    await expect(summary).toBeFocused();
    await follow(page, summary.getByRole('link', { name: /valid positive number/ }), true);
    await expect(panel).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByLabel('Estimated amount')).toHaveValue('abc');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await panel.click();
  }
});
