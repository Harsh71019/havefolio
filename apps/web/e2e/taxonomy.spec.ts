import { test, expect } from '@playwright/test';
import type { TaxonomySnapshot } from '@havefolio/contracts';

const fixture = (): TaxonomySnapshot => ({
  categories: [
    { id: 'root', name: 'Electronics', position: 0, isDemo: true, retiredAt: null, itemCount: 2 },
    {
      id: 'books',
      name: 'Books & stationery',
      position: 1,
      isDemo: false,
      retiredAt: null,
      itemCount: 0,
    },
    {
      id: 'retired',
      name: 'Earlier hobbies',
      position: 2,
      isDemo: false,
      retiredAt: '2026-01-01T00:00:00.000Z',
      itemCount: 1,
    },
  ],
  subcategories: [
    {
      id: 'child',
      categoryId: 'root',
      name: 'Audio',
      position: 0,
      isDemo: false,
      retiredAt: null,
      itemCount: 2,
    },
  ],
  tags: [{ id: 'tag', name: 'Daily use', itemCount: 2 }],
  defaultsSeeded: true,
});
test('taxonomy layouts, theme, keyboard dialogs and safe-delete consent', async ({ page }) => {
  let data = fixture();
  const requests: { path: string; body: unknown }[] = [];
  await page.route('**/api/v1/taxonomy**', async (route) => {
    const request = route.request();
    if (request.method() !== 'GET') {
      requests.push({ path: new URL(request.url()).pathname, body: request.postDataJSON() });
      if (request.method() === 'DELETE')
        data = {
          ...data,
          categories: data.categories.filter((row) => row.id !== 'root'),
          subcategories: [],
        };
    }
    await route.fulfill({ json: data });
  });
  await page.goto('/settings/taxonomy');
  await expect(page.getByRole('heading', { name: 'Categories & tags', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Rename Electronics' })).toBeVisible();
  for (const width of [360, 768, 1440]) {
    await page.setViewportSize({ width, height: 950 });
    for (const theme of ['light', 'dark']) {
      await page.evaluate((value) => {
        localStorage.setItem('theme', value);
      }, theme);
      await page.reload();
      await expect(page.locator('html')).toHaveClass(new RegExp(theme));
      await expect(
        page.getByRole('button', { name: 'Create category', exact: true }),
      ).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    }
  }
  await page.setViewportSize({ width: 360, height: 800 });
  const rename = page.getByRole('button', { name: 'Rename Electronics' });
  await rename.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Rename category' });
  await expect(dialog.getByLabel('Name')).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(rename).toBeFocused();
  await page.getByRole('button', { name: 'Delete Electronics' }).click();
  const deletion = page.getByRole('dialog', { name: 'Delete category' });
  await expect(deletion.getByText(/deletes 1 child subcategories/)).toBeVisible();
  await expect(deletion.getByRole('button', { name: 'Reassign items and delete' })).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await deletion.getByRole('combobox', { name: 'Replacement category' }).focus();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await deletion.getByRole('button', { name: 'Reassign items and delete' }).click();
  await expect(deletion).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Create category', exact: true })).toBeFocused();
  expect(requests.at(-1)).toEqual({
    path: '/api/v1/taxonomy/categories/root',
    body: { replacementId: 'books', removeSubcategories: true },
  });
});

test('taxonomy empty, long-name, conflict and offline states remain usable at 360px', async ({
  page,
}) => {
  let data: TaxonomySnapshot = {
    categories: [],
    subcategories: [],
    tags: [],
    defaultsSeeded: false,
  };
  let conflict = false;
  let offline = false;
  await page.route('**/api/v1/taxonomy**', async (route) => {
    if (offline) {
      await route.abort('failed');
      return;
    }
    if (conflict && route.request().method() === 'POST') {
      await route.fulfill({ status: 409, json: { message: 'NAME_ALREADY_EXISTS' } });
      return;
    }
    await route.fulfill({ json: data });
  });
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('/settings/taxonomy');
  await expect(page.getByText(/No categories yet/)).toBeVisible();
  data = fixture();
  data.categories[0]!.name = 'A'.repeat(120);
  await page.getByRole('button', { name: 'Reload', exact: true }).click();
  await expect(page.getByText('A'.repeat(120), { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Create category', exact: true }).click();
  await page.getByRole('textbox', { name: 'Name' }).fill('Books');
  conflict = true;
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('already exists');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  offline = true;
  await page.getByRole('button', { name: 'Reload', exact: true }).click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText('Check your connection');
  await expect(page.getByRole('button', { name: 'Create category', exact: true })).toBeEnabled();
});
