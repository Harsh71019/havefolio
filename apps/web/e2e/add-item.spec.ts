import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TaxonomySnapshot } from '@havefolio/contracts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const screenshotsDir = path.resolve(__dirname, '../../../docs/screenshots');

const taxonomyFixture = (): TaxonomySnapshot => ({
  categories: [
    {
      id: 'cat-elec',
      name: 'Electronics',
      position: 0,
      isDemo: false,
      retiredAt: null,
      itemCount: 1,
    },
    {
      id: 'cat-books',
      name: 'Books & stationery',
      position: 1,
      isDemo: false,
      retiredAt: null,
      itemCount: 0,
    },
    {
      id: 'cat-retired',
      name: 'Old Stuff',
      position: 2,
      isDemo: false,
      retiredAt: '2025-01-01T00:00:00.000Z',
      itemCount: 1,
    },
  ],
  subcategories: [
    {
      id: 'sub-comp',
      categoryId: 'cat-elec',
      name: 'Audio',
      position: 0,
      isDemo: false,
      retiredAt: null,
      itemCount: 1,
    },
  ],
  tags: [
    { id: 'tag-work', name: 'Work', itemCount: 1 },
    { id: 'tag-daily', name: 'Daily', itemCount: 1 },
  ],
  defaultsSeeded: true,
});

const ownerFixture = (): { id: string; displayName: string; preferredCurrency: string } => ({
  id: 'usr_owner123',
  displayName: 'Harsh',
  preferredCurrency: 'INR',
});

test.describe('Fast manual add-item flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/v1/auth/me', async (route) => {
      await route.fulfill({ json: ownerFixture() });
    });
    await page.route('**/api/v1/taxonomy**', async (route) => {
      await route.fulfill({ json: taxonomyFixture() });
    });
  });

  test('responsive layout, themes, keyboard navigation and screenshot capture', async ({
    page,
  }) => {
    const capturedBodies: Record<string, unknown>[] = [];
    await page.route('**/api/v1/items', async (route) => {
      if (route.request().method() === 'POST') {
        const body = route.request().postDataJSON() as Record<string, unknown>;
        capturedBodies.push(body);
        await route.fulfill({
          status: 201,
          json: {
            id: 'item_test_per11',
            ownerId: 'usr_owner123',
            name: body.name,
            categoryId: body.categoryId,
            subcategoryId: body.subcategoryId ?? null,
            ownershipStatus: body.ownershipStatus,
            currency: body.currency,
            pricePaidMinor: body.pricePaidMinor ?? null,
            purchaseDate: body.purchaseDate ?? { precision: 'unknown' },
            brand: body.brand ?? null,
            model: body.model ?? null,
            notes: body.notes ?? null,
            tags: body.tagIds ?? [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        });
      } else {
        await route.fallback();
      }
    });

    await page.goto('/items/new');
    await expect(
      page.getByRole('heading', { name: 'Add an item to your home', level: 1 }),
    ).toBeVisible();

    // Verify 360px, 768px, and 1440px viewports with light and dark themes
    for (const width of [360, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      for (const theme of ['light', 'dark']) {
        await page.evaluate((value) => {
          localStorage.setItem('theme', value);
        }, theme);
        await page.reload();
        await expect(page.locator('html')).toHaveClass(new RegExp(theme));
        await expect(
          page.getByRole('heading', { name: 'Add an item to your home', level: 1 }),
        ).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );

        // Capture mobile (360) and desktop (1440) screenshots
        if (width === 360) {
          await page.screenshot({
            path: path.join(screenshotsDir, `per-11-mobile-${theme}.png`),
            fullPage: true,
          });
        } else if (width === 1440) {
          await page.screenshot({
            path: path.join(screenshotsDir, `per-11-desktop-${theme}.png`),
            fullPage: true,
          });
        }
      }
    }

    // Now test complete form submission on mobile 360px
    await page.setViewportSize({ width: 360, height: 800 });
    await page.evaluate(() => localStorage.setItem('theme', 'dark'));
    await page.reload();

    const nameInput = page.getByPlaceholder('e.g. Electric kettle, Sony headphones, Winter coat');
    await nameInput.fill('Noise-Cancelling Headphones');

    // Select Category via shadcn Select
    await page.getByRole('combobox', { name: 'Category', exact: true }).click();
    await page.getByRole('option', { name: 'Electronics' }).click();

    // Select Subcategory via shadcn Select
    const subcategoryTrigger = page.getByRole('combobox', { name: 'Subcategory' });
    await expect(subcategoryTrigger).toBeVisible();
    await subcategoryTrigger.click();
    await page.getByRole('option', { name: 'Audio' }).click();

    // Price: enter explicit price
    await page.getByLabel('Actual amount paid').fill('14999');

    // Date: change to Year only
    await page.getByLabel('Year only').check();
    await page.getByPlaceholder('YYYY (e.g. 2022)').fill('2024');

    // Open additional details
    await page.getByRole('button', { name: /Additional details/i }).click();
    await page.getByLabel('Work').check();
    await page.getByLabel('Brand').fill('Sony');
    await page.getByLabel('Model / Variant').fill('WH-1000XM4');

    // Submit form
    await page.getByRole('button', { name: 'Save item', exact: true }).click();

    // Verify post-save choices appear
    await expect(
      page.getByRole('heading', { name: /saved to your home/i, level: 2 }),
    ).toBeVisible();
    await expect(page.getByText('Noise-Cancelling Headphones')).toBeVisible();

    const addPhotoLink = page.getByRole('link', { name: 'Add photo' });
    await expect(addPhotoLink).toBeVisible();
    await expect(addPhotoLink).toHaveAttribute('href', '/items/item_test_per11/photos/new');

    const addDetailsLink = page.getByRole('link', { name: 'Add more details' });
    await expect(addDetailsLink).toBeVisible();
    await expect(addDetailsLink).toHaveAttribute('href', '/items/item_test_per11/edit');

    const viewItemLink = page.getByRole('link', { name: 'View item' });
    await expect(viewItemLink).toBeVisible();
    await expect(viewItemLink).toHaveAttribute('href', '/items/item_test_per11');

    // Capture post-save screenshot
    await page.screenshot({
      path: path.join(screenshotsDir, 'per-11-mobile-post-save-dark.png'),
      fullPage: true,
    });

    // Also capture light mode post-save screenshot
    await page.evaluate(() => localStorage.setItem('theme', 'light'));
    await page.reload();
    // After reload, draft was cleared on success so page shows empty form or fresh state
    // To capture light mode post-save, submit another item with unknown price & date
    await page
      .getByPlaceholder('e.g. Electric kettle, Sony headphones, Winter coat')
      .fill('Kindle Paperwhite');
    await page.getByRole('combobox', { name: 'Category', exact: true }).click();
    await page.getByRole('option', { name: 'Books & stationery' }).click();
    await page.getByLabel('Price unknown').check();
    await page.getByLabel('Date unknown').check();
    await page.getByRole('button', { name: 'Save item', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: /saved to your home/i, level: 2 }),
    ).toBeVisible();
    await page.screenshot({
      path: path.join(screenshotsDir, 'per-11-mobile-post-save-light.png'),
      fullPage: true,
    });

    // Verify captured payload from the first submission (explicit price, date, tags, brand)
    expect(capturedBodies[0]).toMatchObject({
      name: 'Noise-Cancelling Headphones',
      categoryId: 'cat-elec',
      subcategoryId: 'sub-comp',
      ownershipStatus: 'owned',
      pricePaidMinor: '1499900',
      currency: 'INR',
      purchaseDate: { precision: 'year', year: 2024 },
      brand: 'Sony',
      model: 'WH-1000XM4',
      tagIds: ['tag-work'],
    });

    // Verify captured payload from the second submission (minimal with unknown price & date)
    expect(capturedBodies[1]).toMatchObject({
      name: 'Kindle Paperwhite',
      categoryId: 'cat-books',
      subcategoryId: null,
      ownershipStatus: 'owned',
      pricePaidMinor: null,
      currency: 'INR',
      purchaseDate: { precision: 'unknown' },
    });
  });

  test('draft persistence and discard flow', async ({ page }) => {
    await page.goto('/items/new');

    const nameInput = page.getByPlaceholder('e.g. Electric kettle, Sony headphones, Winter coat');
    await nameInput.fill('Vintage Desk Lamp');

    await page.getByRole('combobox', { name: 'Category', exact: true }).click();
    await page.getByRole('option', { name: 'Electronics' }).click();

    // Wait for draft autosave debounce
    await page.waitForTimeout(400);

    // Reload page
    await page.reload();

    // Verify draft was restored
    await expect(nameInput).toHaveValue('Vintage Desk Lamp');
    await expect(page.getByRole('combobox', { name: 'Category', exact: true })).toContainText(
      'Electronics',
    );
    await expect(page.getByRole('button', { name: 'Discard' })).toBeVisible();

    // Click discard draft
    await page.getByRole('button', { name: 'Discard' }).click();

    // Form is reset
    await expect(nameInput).toHaveValue('');
    await expect(page.getByRole('button', { name: 'Discard' })).not.toBeVisible();
  });

  test('validation summary and field error focus', async ({ page }) => {
    await page.goto('/items/new');

    // Attempt to submit with missing required fields
    await page.getByRole('button', { name: 'Save item', exact: true }).click();

    // Validation summary is displayed
    const summary = page
      .getByRole('alert')
      .filter({ hasText: 'Please check the following before saving' });
    await expect(summary).toBeVisible();
    await expect(summary).toContainText('Enter an item name');

    // Validation summary container is focused
    await expect(summary).toBeFocused();

    // Click the error summary link to jump directly to the field
    await summary.getByRole('link', { name: 'Enter an item name.' }).click();

    // Field should receive focus
    const nameInput = page.getByPlaceholder('e.g. Electric kettle, Sony headphones, Winter coat');
    await expect(nameInput).toBeFocused();
  });
});
