import { expect, test, type Page } from '@playwright/test';
import { createRequire } from 'node:module';
import { formatOcrReference } from '@havefolio/domain';

// PER-45: synthetic receipt/photo review only. No real receipts, owners or storage details.
const id = (n: number): string => `00000000-0000-4000-a000-${String(n).padStart(12, '0')}`;
const itemId = id(45);
const receiptId = id(401);
const workId = id(701);
const shot = (name: string): string => `../../docs/screenshots/per-45-${name}.png`;
const axeSource = createRequire(import.meta.url).resolve('axe-core/axe.min.js');
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="100%" height="100%" fill="#7c9a92"/></svg>`;
const ref = (line: number, flags: string[], text: string): string =>
  formatOcrReference({ line, flags: flags as never, text });
const source = (reference: string): { provider: string; inputKind: string; reference: string } => ({
  provider: 'local-ocr',
  inputKind: 'receipt',
  reference,
});

async function mock(page: Page): Promise<{ reviews: Record<string, unknown>[] }> {
  const state = {
    reviews: [] as Record<string, unknown>[],
    events: [] as Record<string, unknown>[],
    item: {
      id: itemId,
      name: 'Steel kettle',
      ownershipStatus: 'owned',
      currency: 'INR',
      pricePaidMinor: null as string | null,
      purchaseDate: { precision: 'unknown', year: null, month: null, day: null },
      acquisitionType: 'bought',
      condition: 'unknown',
      useFrequency: 'unknown',
      categoryId: null,
      subcategoryId: null,
      tagIds: [],
      brand: null,
      model: null,
      description: null,
      notes: null,
      specifications: null,
      revision: 3,
      isDemo: false,
      createdAt: '2026-10-01T05:30:00.000Z',
      updatedAt: '2026-10-01T05:30:00.000Z',
      originalEntry: { name: 'Steel kettle' },
      originalSource: 'manual',
    },
  };
  const work = {
    id: workId,
    itemId,
    inputKind: 'receipt',
    attachmentId: receiptId,
    baseRevision: 3,
    state: 'succeeded',
    attempts: 1,
    failureCode: null,
    createdAt: '2026-10-20T08:00:00.000Z',
    candidates: [
      {
        id: 'receipt-line-2',
        fields: [
          {
            field: 'name',
            value: 'Steel Kettle 1.5L',
            confidence: 0.86,
            source: source(ref(2, [], 'Steel Kettle 1.5L 1 Rs 1,299.00')),
          },
          {
            field: 'pricePaid',
            value: 'INR 129900',
            confidence: 0.79,
            source: source(ref(2, ['line-amount'], 'Steel Kettle 1.5L 1 Rs 1,299.00')),
          },
          {
            field: 'purchaseDate',
            value: '2026',
            confidence: 0.6,
            source: source(ref(4, ['date-order-unclear'], 'Date 03/04/2026')),
          },
        ],
      },
      {
        id: 'receipt-line-3',
        fields: [
          {
            field: 'name',
            value: 'Cotton tea towel',
            confidence: 0.84,
            source: source(ref(3, [], 'Cotton tea towel 2 Rs 398.00')),
          },
          {
            field: 'pricePaid',
            value: 'INR 39800',
            confidence: 0.5,
            source: source(
              ref(3, ['line-amount', 'multiple-units'], 'Cotton tea towel 2 Rs 398.00'),
            ),
          },
        ],
      },
    ],
  };
  await page.route(`**/api/v1/items/${itemId}`, (route) => route.fulfill({ json: state.item }));
  await page.route(`**/api/v1/items/${itemId}/photos`, (route) =>
    route.fulfill({
      json: {
        revision: state.item.revision,
        photos: [
          {
            id: id(501),
            position: 0,
            cover: true,
            width: 800,
            height: 600,
            byteSize: 2000,
            mimeType: 'image/webp',
            altText: null,
            decorative: false,
          },
        ],
      },
    }),
  );
  await page.route('**/api/v1/items/*/photos/*/content/*', (route) =>
    route.fulfill({ contentType: 'image/svg+xml', body: svg }),
  );
  await page.route(`**/api/v1/items/${itemId}/documents`, (route) =>
    route.fulfill({
      json: {
        revision: state.item.revision,
        documents: [
          {
            id: receiptId,
            kind: 'receipt',
            mimeType: 'image/webp',
            byteSize: 91000,
            width: 900,
            height: 1200,
          },
          {
            id: id(402),
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
  await page.route(`**/api/v1/items/${itemId}/enrichment?**`, (route) =>
    route.fulfill({
      json: {
        providerStatus: 'available',
        availableKinds: ['photo', 'receipt'],
        items: [work],
        nextBefore: null,
      },
    }),
  );
  await page.route(`**/api/v1/items/${itemId}/enrichment/reviews?**`, (route) =>
    route.fulfill({ json: { items: state.events, nextBefore: null } }),
  );
  await page.route(`**/api/v1/items/${itemId}/enrichment/${workId}/reviews`, (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    state.reviews.push(body);
    const previous = state.item.name;
    if (body.field === 'name' && body.decision === 'accept') state.item.name = 'Steel Kettle 1.5L';
    state.item.revision += 1;
    const event = {
      id: id(800 + state.events.length),
      workId,
      ...body,
      previousValue: previous,
      confirmedValue: state.item.name,
      resultingRevision: state.item.revision,
      createdAt: '2026-10-20T08:05:00.000Z',
    };
    state.events.push(event);
    return route.fulfill({ status: 201, json: event });
  });
  return state;
}

async function setTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await page.addStyleTag({
    content: '*,*::before,*::after{transition:none!important;animation:none!important}',
  });
  await page.evaluate((value) => {
    document.documentElement.classList.remove('light', 'dark');
    document.documentElement.classList.add(value);
    document.documentElement.style.colorScheme = value;
  }, theme);
}

async function axeViolations(page: Page): Promise<string[]> {
  if (!(await page.evaluate(() => 'axe' in window))) await page.addScriptTag({ path: axeSource });
  return page.evaluate(async () => {
    type Result = { violations: { id: string; nodes: { target: string[] }[] }[] };
    const axe = (window as unknown as { axe: { run: (...a: unknown[]) => Promise<Result> } }).axe;
    const result = await axe.run(document, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
    });
    return result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(', ')}`);
  });
}

test('receipt suggestions are explained, accessible and applied only field by field', async ({
  page,
}, testInfo) => {
  const state = await mock(page);
  await page.goto(`/items/${itemId}/text-suggestions`);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Suggestions from photos and receipts' }),
  ).toBeVisible();
  await expect(page.getByText('Read privately, changed only by you')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Read text from Receipt 2' })).toBeDisabled();
  await expect(page.getByText('Receipt line 2')).toBeVisible();
  await expect(page.getByText(/only the year is suggested/)).toBeVisible();
  await expect(page.getByText(/may be for more than one unit/)).toBeVisible();
  const html = await page.content();
  expect(html).not.toMatch(/cloudinary|api_key|signature=|havefolio\/(test|production)/i);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  const small = await page.evaluate(() =>
    [...document.querySelectorAll('main button, main a[href]')]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && r.height < 44;
      })
      .map((el) => el.textContent?.trim()),
  );
  expect(small).toEqual([]);
  for (const theme of ['light', 'dark'] as const) {
    await setTheme(page, theme);
    expect(await axeViolations(page)).toEqual([]);
    await page.screenshot({
      path: shot(`${testInfo.project.name}-${theme}`),
      fullPage: true,
      animations: 'disabled',
    });
  }
  await page.getByRole('button', { name: 'Use suggested name' }).first().click();
  await expect(page.getByRole('status').filter({ hasText: 'Name updated' })).toBeVisible();
  expect(state.reviews).toEqual([
    expect.objectContaining({
      revision: 3,
      candidateId: 'receipt-line-2',
      field: 'name',
      decision: 'accept',
    }),
  ]);
  await expect(
    page.getByRole('region', { name: 'Your decisions' }).getByText('Name: used suggestion'),
  ).toBeVisible();
  // Suggestions and decisions never persist in browser storage.
  expect(
    await page.evaluate(() => JSON.stringify({ ...window.localStorage, ...window.sessionStorage })),
  ).not.toMatch(/Kettle|INR|receipt/i);
});
