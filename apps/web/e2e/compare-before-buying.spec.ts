import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Desire, DesireMatch, ItemResponse, ReviewHistoryPage } from '@havefolio/contracts';

const desireId = 'd1000000-0000-4000-a000-000000000001';
const itemId1 = 'i1000000-0000-4000-a000-000000000001';
const itemId2 = 'i2000000-0000-4000-a000-000000000002';

const mockDesire: Desire = {
  id: desireId,
  name: 'Noise-canceling headphones',
  classification: 'want',
  likelyPriceMinor: '1499900',
  currency: 'INR',
  productUrl: 'https://example.com/headphones',
  reason: 'For quiet work during travel and flights.',
  status: 'considering',
  effectiveState: 'considering',
  waitingStartedAt: null,
  reviewAt: null,
  photo: null,
  revision: 1,
  createdAt: '2026-10-10T00:00:00.000Z',
  updatedAt: '2026-10-10T00:00:00.000Z',
};

const mockItem1: ItemResponse = {
  isDemo: false,
  id: itemId1,
  name: 'Everyday wired earphones',
  ownershipStatus: 'owned',
  currency: 'INR',
  pricePaidMinor: '249900',
  purchaseDate: {
    precision: 'month',
    year: 2024,
    month: 10,
    day: null,
  },
  acquisitionType: 'bought',
  condition: 'working',
  useFrequency: 'often',
  categoryId: 'c1000000-0000-4000-a000-000000000001',
  subcategoryId: null,
  tagIds: [],
  brand: 'AudioTech',
  model: 'AT-100',
  description: 'Good everyday earphones.',
  notes: null,
  specifications: null,
  revision: 1,
  createdAt: '2024-10-15T00:00:00.000Z',
  updatedAt: '2024-10-15T00:00:00.000Z',
  originalEntry: {},
  originalSource: 'manual',
};

const mockItem2: ItemResponse = {
  isDemo: false,
  id: itemId2,
  name: 'Old Bluetooth speaker',
  ownershipStatus: 'owned',
  currency: 'INR',
  pricePaidMinor: null,
  purchaseDate: {
    precision: 'year',
    year: 2023,
    month: null,
    day: null,
  },
  acquisitionType: 'gift',
  condition: 'needs_repair',
  useFrequency: 'rarely',
  categoryId: 'c1000000-0000-4000-a000-000000000001',
  subcategoryId: null,
  tagIds: [],
  brand: 'SoundBox',
  model: 'SB-1',
  description: 'Battery needs replacement.',
  notes: null,
  specifications: null,
  revision: 1,
  createdAt: '2023-05-01T00:00:00.000Z',
  updatedAt: '2023-05-01T00:00:00.000Z',
  originalEntry: {},
  originalSource: 'manual',
};

const mockMatches: DesireMatch[] = [
  {
    id: 'm1000000-0000-4000-a000-000000000001',
    desireId,
    itemId: itemId1,
    reason: 'Similar audio accessory already owned and used regularly.',
    relevance: 'relevant',
    source: 'manual',
    item: {
      id: itemId1,
      name: mockItem1.name,
      brand: mockItem1.brand,
      model: mockItem1.model,
      ownershipStatus: 'owned',
      condition: 'working',
      useFrequency: 'often',
      categoryId: mockItem1.categoryId,
      categoryName: 'Electronics',
      subcategoryId: null,
      subcategoryName: null,
      tags: ['audio'],
      cover: null,
      isUsableAlternative: true,
    },
    hints: {
      categoryHint: 'Same category: Electronics',
      usageHint: 'Usage: Often used',
      conditionHint: 'Condition: Working',
      traitHints: ['audio'],
    },
    createdAt: '2026-10-11T00:00:00.000Z',
    updatedAt: '2026-10-11T00:00:00.000Z',
  },
  {
    id: 'm2000000-0000-4000-a000-000000000002',
    desireId,
    itemId: itemId2,
    reason: 'Audio device that could be repaired instead of buying new.',
    relevance: 'relevant',
    source: 'manual',
    item: {
      id: itemId2,
      name: mockItem2.name,
      brand: mockItem2.brand,
      model: mockItem2.model,
      ownershipStatus: 'owned',
      condition: 'needs_repair',
      useFrequency: 'rarely',
      categoryId: mockItem2.categoryId,
      categoryName: 'Electronics',
      subcategoryId: null,
      subcategoryName: null,
      tags: ['audio'],
      cover: null,
      isUsableAlternative: true,
    },
    hints: {
      categoryHint: 'Same category: Electronics',
      usageHint: 'Usage: Rarely used',
      conditionHint: 'Condition: Needs repair',
      traitHints: ['audio'],
    },
    createdAt: '2026-10-12T00:00:00.000Z',
    updatedAt: '2026-10-12T00:00:00.000Z',
  },
];

const mockReviewHistory: ReviewHistoryPage = {
  items: [],
  nextBefore: null,
  currentEventId: null,
  estimatedNotSpentMinor: null,
  currency: null,
};

test.describe('PER-26: Compare-before-buying decision screen', () => {
  test.beforeEach(async ({ page }) => {
    await page.route(new RegExp(`/api/v1/auth/me`), (r) =>
      r.fulfill({
        json: { id: 'usr_per26', email: 'owner@example.test', displayName: 'Harsh' },
      }),
    );
    await page.route(new RegExp(`/api/v1/desires/${desireId}/matches`), (r) =>
      r.fulfill({ json: { items: mockMatches } }),
    );
    await page.route(new RegExp(`/api/v1/desires/${desireId}/reviews`), (r) =>
      r.fulfill({ json: mockReviewHistory }),
    );
    await page.route(new RegExp(`/api/v1/desires/${desireId}(\\?.*)?$`), (r) =>
      r.fulfill({ json: mockDesire }),
    );
    await page.route(new RegExp(`/api/v1/items/${itemId1}`), (r) => r.fulfill({ json: mockItem1 }));
    await page.route(new RegExp(`/api/v1/items/${itemId2}`), (r) => r.fulfill({ json: mockItem2 }));
  });

  test('presents desire and possessions side by side, prompts differentiation, and captures screenshots', async ({
    page,
  }, testInfo) => {
    await page.goto(`/wants/${desireId}/compare`);

    // Verify main headings and neutral guidance
    await expect(page.getByRole('heading', { name: 'Compare before buying' })).toBeVisible();
    await expect(
      page.getByText(
        'Owning something in the same category does not mean this purchase is unnecessary. Consider how they differ in function, comfort, or frequency of use.',
      ),
    ).toBeVisible();

    // Verify desire presentation
    await expect(
      page.getByRole('heading', { name: 'Noise-canceling headphones', exact: true }),
    ).toBeVisible();
    await expect(page.getByText('Likely price: ₹14,999')).toBeVisible();
    await expect(page.getByText('For quiet work during travel and flights.')).toBeVisible();

    // Verify honest matched possessions representation
    await expect(
      page.getByRole('heading', { name: 'Everyday wired earphones', exact: true }),
    ).toBeVisible();
    await expect(page.getByText('Paid: ₹2,499')).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Old Bluetooth speaker', exact: true }),
    ).toBeVisible();
    await expect(page.getByText('Paid: Gift, no amount')).toBeVisible();
    await expect(page.getByText('Condition: Needs repair').first()).toBeVisible();

    // Verify reflection prompt
    const reflectionTextarea = page.getByLabel('What would this product do differently?');
    await expect(reflectionTextarea).toBeVisible();
    await reflectionTextarea.fill('Better active noise isolation for frequent flights.');

    // Verify decision actions are available as radio options
    await expect(page.getByRole('radio', { name: /Use something already owned/i })).toBeVisible();
    await expect(page.getByRole('radio', { name: /Repair an owned item/i })).toBeVisible();
    await expect(page.getByRole('radio', { name: /Replace an owned item/i })).toBeVisible();
    await expect(
      page.getByRole('radio', { name: /Wait and choose another review date/i }),
    ).toBeVisible();
    await expect(page.getByRole('radio', { name: /Buy intentionally/i })).toBeVisible();
    await expect(page.getByRole('radio', { name: /Pass on this purchase/i })).toBeVisible();

    // Responsive and theming verification + screenshots
    const screenshotsDir = resolve(process.cwd(), '../../docs/screenshots');
    await mkdir(screenshotsDir, { recursive: true });

    for (const theme of ['light', 'dark']) {
      await page.evaluate((value) => {
        document.documentElement.classList.remove('light', 'dark');
        document.documentElement.classList.add(value);
        document.documentElement.style.colorScheme = value;
      }, theme);

      await expect(page.locator('html')).toHaveClass(new RegExp(theme));

      // Verify no horizontal overflow
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth,
      );
      expect(overflow).toBe(false);

      await page.screenshot({
        path: resolve(screenshotsDir, `per-26-compare-${testInfo.project.name}-${theme}.png`),
        fullPage: true,
      });
    }
  });

  test('PER-55: discloses a worn-out possession without offering it as ready to use', async ({
    page,
  }, testInfo) => {
    const wornMatches: DesireMatch[] = [
      mockMatches[0]!,
      {
        ...mockMatches[1]!,
        reason: 'Speaker I still keep, though it has worn out.',
        item: { ...mockMatches[1]!.item, condition: 'worn_out', isUsableAlternative: false },
        hints: { ...mockMatches[1]!.hints, conditionHint: 'Condition: worn out' },
      },
    ];
    await page.route(new RegExp(`/api/v1/desires/${desireId}/matches`), (r) =>
      r.fulfill({ json: { items: wornMatches } }),
    );
    await page.route(new RegExp(`/api/v1/items/${itemId2}`), (r) =>
      r.fulfill({ json: { ...mockItem2, condition: 'worn_out' } }),
    );
    await page.goto(`/wants/${desireId}/compare`);

    const worn = page
      .getByRole('heading', { name: 'Old Bluetooth speaker', exact: true })
      .locator('xpath=ancestor::div[contains(@class,"space-y-2")][1]');
    await expect(worn.getByText('Worn out', { exact: true }).first()).toBeVisible();
    await expect(worn.getByText('Condition: worn out', { exact: true })).toBeVisible();
    // Only the working possession offers the use shortcut (auto-selected on load).
    const useShortcut = /^(Use this item|Selected to use)$/;
    await expect(worn.getByRole('button', { name: useShortcut })).toHaveCount(0);
    await expect(worn.getByRole('button', { name: /Repair this item/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: useShortcut })).toHaveCount(1);
    await expect(page.getByRole('radio', { name: /Pass on this purchase/i })).toBeEnabled();

    // Use the real theme toggle and settle transitions so captured colours are final.
    for (const theme of ['light', 'dark']) {
      const current = await page.locator('html').getAttribute('class');
      if (!current?.split(' ').includes(theme))
        await page.getByRole('button', { name: 'Toggle color theme' }).click();
      await expect(page.locator('html')).toHaveClass(new RegExp(theme));
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
      ).toBe(false);
      await worn.scrollIntoViewIfNeeded();
      await page.screenshot({
        path: resolve(
          process.cwd(),
          `../../docs/screenshots/per-55-compare-${testInfo.project.name}-${theme}.png`,
        ),
        fullPage: true,
        animations: 'disabled',
      });
    }
  });

  test('records a review decision and navigates to decision history', async ({ page }) => {
    let recordedPayload: unknown = null;
    const recordedEvent = {
      id: 'e1000000-0000-4000-a000-000000000001',
      sequence: 1,
      outcome: 'used_owned',
      occurredAt: new Date().toISOString(),
      note: 'Decided to use existing earphones.',
      linkedItemId: itemId1,
      linkedItemName: 'Everyday wired earphones',
      reviewAt: null,
      supersedesEventId: null,
      estimatedNotSpentMinor: '1499900',
      currency: 'INR',
    };

    await page.route(new RegExp(`/api/v1/desires/${desireId}/reviews`), async (route) => {
      if (route.request().method() === 'POST') {
        recordedPayload = route.request().postDataJSON();
        await route.fulfill({
          status: 201,
          json: recordedEvent,
        });
      } else {
        await route.fulfill({
          json: {
            items: recordedPayload ? [recordedEvent] : [],
            nextBefore: null,
            currentEventId: recordedPayload ? recordedEvent.id : null,
            estimatedNotSpentMinor: '1499900',
            currency: 'INR',
          },
        });
      }
    });

    await page.goto(`/wants/${desireId}/compare`);
    await expect(page.getByRole('heading', { name: 'Compare before buying' })).toBeVisible();

    // Verify "Use something already owned" is checked by default
    await expect(page.getByRole('radio', { name: /Use something already owned/i })).toBeChecked();

    // Enter reflection note
    await page
      .getByLabel('What would this product do differently?')
      .fill('Decided to use existing earphones.');

    // Submit decision
    await page.getByRole('button', { name: 'Record decision' }).click();

    // Verify confirmation status
    await expect(page.getByRole('status')).toBeVisible();
    await expect(page.getByRole('status').getByText('Decision recorded: used_owned')).toBeVisible();

    // Navigate to history via confirmation button
    await page.getByRole('link', { name: 'View decision history' }).click();
    await page.waitForURL(`**/wants/${desireId}/history`);

    expect(recordedPayload).toMatchObject({
      outcome: 'used_owned',
      linkedItemId: itemId1,
      note: 'Decided to use existing earphones.',
    });
  });
});
