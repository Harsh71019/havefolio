import { test, expect, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import type {
  Desire,
  DesireSuggestionItem,
  DesireSuggestionsPage,
  DesireMatchesPage,
  DesireSuggestionFeedback,
  CreateSuggestionFeedbackRequest,
} from '@havefolio/contracts';

const axeSource = createRequire(import.meta.url).resolve('axe-core/axe.min.js');
const tags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];

async function freezeMotion(page: Page): Promise<void> {
  await page.addStyleTag({
    content: '*,*::before,*::after{transition:none!important;animation:none!important}',
  });
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

const desireId = 'd1000000-0000-4000-a000-000000000046';
const itemId1 = 'i1000000-0000-4000-a000-000000000046';
const itemId2 = 'i2000000-0000-4000-a000-000000000047';

const mockDesire: Desire = {
  id: desireId,
  name: 'Noise-canceling headphones',
  classification: 'want',
  likelyPriceMinor: '1999900',
  currency: 'INR',
  productUrl: 'https://example.com/headphones',
  reason: 'For quiet work during flights and focused coding.',
  status: 'considering',
  effectiveState: 'considering',
  waitingStartedAt: null,
  reviewAt: null,
  photo: null,
  revision: 1,
  createdAt: '2026-10-10T00:00:00.000Z',
  updatedAt: '2026-10-10T00:00:00.000Z',
};

const mockSuggestion1: DesireSuggestionItem = {
  item: {
    id: itemId1,
    name: 'Sony WH-1000XM4 Wireless Headphones',
    brand: 'Sony',
    model: 'WH-1000XM4',
    categoryName: 'Electronics',
    subcategoryName: 'Headphones',
    cover: null,
    condition: 'working',
    useFrequency: 'rarely',
    ownershipStatus: 'owned',
  },
  score: 85,
  isUsableAlternative: true,
  explanation:
    'Matches headphones subcategory and electronics category, purpose overlaps (flights, coding), working condition and rarely used.',
  factors: [
    { kind: 'subcategory_match', weight: 35, label: 'Same subcategory', detail: 'Headphones' },
    { kind: 'category_match', weight: 20, label: 'Same category', detail: 'Electronics' },
    { kind: 'purpose_overlap', weight: 15, label: 'Matching purpose', detail: 'flights, coding' },
    { kind: 'rarely_used_working', weight: 5, label: 'Rarely used', detail: 'Working condition' },
  ],
  workingRarelyUsed: true,
  feedback: null,
};

const mockSuggestion2: DesireSuggestionItem = {
  item: {
    id: itemId2,
    name: 'Bose QuietComfort Earbuds',
    brand: 'Bose',
    model: 'QC Earbuds',
    categoryName: 'Electronics',
    subcategoryName: 'Earphones',
    cover: null,
    condition: 'working',
    useFrequency: 'often',
    ownershipStatus: 'owned',
  },
  score: 60,
  isUsableAlternative: true,
  explanation: 'Matches electronics category, purpose overlaps (flights).',
  factors: [
    { kind: 'category_match', weight: 20, label: 'Same category', detail: 'Electronics' },
    { kind: 'purpose_overlap', weight: 10, label: 'Matching purpose', detail: 'flights' },
  ],
  workingRarelyUsed: false,
  feedback: null,
};

test.describe('PER-46: Explainable suggestions and feedback UX', () => {
  test('renders suggestions with explanations, factor badges, interactive dismissal and undo, capturing screenshots', async ({
    page,
  }, testInfo) => {
    let suggestionsList: DesireSuggestionItem[] = [mockSuggestion1, mockSuggestion2];
    let dismissedList: DesireSuggestionItem[] = [];
    let recordedFeedback: DesireSuggestionFeedback[] = [];

    await page.route('**/api/v1/auth/me', (r) =>
      r.fulfill({
        json: { id: 'synthetic-owner', email: 'owner@example.test', displayName: 'Owner' },
      }),
    );

    await page.route(new RegExp(`/api/v1/desires/${desireId}$`), (r) =>
      r.fulfill({ json: mockDesire }),
    );

    await page.route(new RegExp(`/api/v1/desires/${desireId}/matches(\\?.*)?$`), (r) => {
      if (r.request().method() === 'GET') {
        const res: DesireMatchesPage = {
          items: [],
          nextCursor: null,
          hasMore: false,
          totalCount: 0,
        };
        return r.fulfill({ json: res });
      }
      if (r.request().method() === 'POST') {
        return r.fulfill({
          status: 201,
          json: {
            id: 'm1000000-0000-4000-a000-000000000046',
            desireId,
            itemId: itemId1,
            relevance: 'alternative',
            reason: 'Connected from suggestion',
            source: 'suggestion',
            item: mockSuggestion1.item,
            hints: { conditionHint: null, usageHint: null },
            createdAt: new Date().toISOString(),
          },
        });
      }
      return r.fulfill({ status: 200, json: {} });
    });

    await page.route(new RegExp(`/api/v1/desires/${desireId}/matches/candidates`), (r) =>
      r.fulfill({ json: { items: [], nextCursor: null, hasMore: false } }),
    );

    await page.route(
      new RegExp(`/api/v1/desires/${desireId}/matches/suggestions(\\?.*)?$`),
      async (r) => {
        const url = new URL(r.request().url());
        const isDismissed = url.searchParams.get('includeDismissed') === 'true';
        if (isDismissed) {
          const pageRes: DesireSuggestionsPage = {
            items: dismissedList,
            nextCursor: null,
            hasMore: false,
            totalCount: dismissedList.length,
          };
          return r.fulfill({ json: pageRes });
        }
        const pageRes: DesireSuggestionsPage = {
          items: suggestionsList,
          nextCursor: null,
          hasMore: false,
          totalCount: suggestionsList.length,
        };
        return r.fulfill({ json: pageRes });
      },
    );

    await page.route(
      new RegExp(`/api/v1/desires/${desireId}/matches/suggestions/feedback`),
      async (r) => {
        const method = r.request().method();
        if (method === 'GET') {
          return r.fulfill({ json: recordedFeedback });
        }
        if (method === 'POST') {
          const body = r.request().postDataJSON() as CreateSuggestionFeedbackRequest;
          const newFb: DesireSuggestionFeedback = {
            id: 'fb100000-0000-4000-a000-000000000046',
            desireId,
            itemId: body.itemId,
            action: body.action,
            scope: body.scope,
            reason: body.reason ?? null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
          recordedFeedback.push(newFb);
          dismissedList.push({
            ...mockSuggestion1,
            feedback: newFb,
          });
          suggestionsList = suggestionsList.filter((s) => s.item.id !== body.itemId);
          return r.fulfill({ status: 201, json: newFb });
        }
        if (method === 'DELETE') {
          recordedFeedback = [];
          dismissedList = [];
          suggestionsList = [mockSuggestion1, mockSuggestion2];
          return r.fulfill({ status: 204, body: '' });
        }
        return r.fulfill({ status: 200, json: {} });
      },
    );

    await page.route('**/api/v1/taxonomy', (r) =>
      r.fulfill({ categories: [], subcategories: [], tags: [], defaultsSeeded: true }),
    );

    await page.goto(`/wants/${desireId}/matches`);
    await freezeMotion(page);
    await page.waitForLoadState('networkidle');

    // Verify Suggested possessions section exists
    const suggestionsSection = page.getByRole('region', { name: 'Suggested possessions' });
    await expect(suggestionsSection).toBeVisible();

    // Verify first suggestion details
    await expect(suggestionsSection.getByText('Sony WH-1000XM4 Wireless Headphones')).toBeVisible();
    await expect(suggestionsSection.getByText('Same subcategory')).toBeVisible();
    await expect(suggestionsSection.getByText('Working condition · Rarely used')).toBeVisible();
    await expect(
      suggestionsSection.getByText(
        'Matches headphones subcategory and electronics category, purpose overlaps (flights, coding), working condition and rarely used.',
      ),
    ).toBeVisible();

    // Verify touch targets (buttons must be at least 44px tall)
    const connectBtn = suggestionsSection
      .getByRole('button', { name: /Connect as alternative/i })
      .first();
    const dismissBtn = suggestionsSection
      .getByRole('button', { name: /Dismiss for this want/i })
      .first();
    await expect(connectBtn).toBeVisible();
    await expect(dismissBtn).toBeVisible();

    const connectBox = await connectBtn.boundingBox();
    expect(connectBox).not.toBeNull();
    expect(connectBox!.height).toBeGreaterThanOrEqual(44);

    const dismissBox = await dismissBtn.boundingBox();
    expect(dismissBox).not.toBeNull();
    expect(dismissBox!.height).toBeGreaterThanOrEqual(44);

    // Verify responsive and theming + capture screenshots
    const screenshotsDir = resolve(process.cwd(), '../../docs/screenshots');
    await mkdir(screenshotsDir, { recursive: true });

    for (const theme of ['light', 'dark'] as const) {
      await page.evaluate((value) => {
        document.documentElement.classList.remove('light', 'dark');
        document.documentElement.classList.add(value);
        document.documentElement.style.colorScheme = value;
      }, theme);

      await expect(page.locator('html')).toHaveClass(new RegExp(theme));

      // No horizontal overflow
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth,
      );
      expect(overflow).toBe(false);

      // Verify accessibility with axe
      const violations = await axeViolations(page);
      expect(violations).toEqual([]);

      // Screenshot suggestions section and page
      await page.screenshot({
        path: resolve(screenshotsDir, `per-46-suggestions-${testInfo.project.name}-${theme}.png`),
        fullPage: true,
      });
    }

    // Dismiss the first suggestion
    await dismissBtn.click();

    // Verify item is removed from active suggestions
    await expect(
      suggestionsSection.getByText('Sony WH-1000XM4 Wireless Headphones'),
    ).not.toBeVisible();

    // Verify "View dismissed (1)" button appears
    const viewDismissedBtn = suggestionsSection.getByRole('button', {
      name: /View dismissed \(1\)/i,
    });
    await expect(viewDismissedBtn).toBeVisible();
    expect((await viewDismissedBtn.boundingBox())!.height).toBeGreaterThanOrEqual(44);

    // Open dismissed suggestions
    await viewDismissedBtn.click();
    await expect(suggestionsSection.getByText('Dismissed for this want (1)')).toBeVisible();

    // Verify Undo dismissal button is present and works
    const undoBtn = suggestionsSection.getByRole('button', { name: /Undo dismissal/i });
    await expect(undoBtn).toBeVisible();
    expect((await undoBtn.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await undoBtn.click();

    // Verify item restored to suggestions
    await expect(suggestionsSection.getByText('Sony WH-1000XM4 Wireless Headphones')).toBeVisible();
  });
});
