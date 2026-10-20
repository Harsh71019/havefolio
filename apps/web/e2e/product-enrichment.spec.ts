import { createRequire } from 'node:module';
import { test, expect } from '@playwright/test';
const id = '00000000-0000-4000-a000-000000000044';
for (const theme of ['light', 'dark'] as const)
  test(`PER-44 explicit product review and private image action in ${theme}`, async ({
    page,
  }, info) => {
    await page.addInitScript((value) => {
      localStorage.setItem('theme', value);
      Object.defineProperty(window, 'BarcodeDetector', { value: undefined, configurable: true });
    }, theme);
    const item = {
      id,
      name: 'Manual kettle',
      brand: null,
      model: null,
      description: null,
      specifications: {},
      revision: 1,
      currency: 'INR',
      pricePaidMinor: '249900',
      purchaseDate: { precision: 'year', year: 2024 },
      purchaseUrl: null,
      isDemo: false,
    };
    const requests: Array<Record<string, unknown>> = [],
      reviews: Array<Record<string, unknown>> = [];
    const source = {
      provider: 'public-product-metadata',
      inputKind: 'url',
      reference: 'https://shop.example.org/kettle',
    };
    const work = {
      id: '00000000-0000-4000-a000-000000000144',
      itemId: id,
      inputKind: 'url',
      baseRevision: 1,
      state: 'succeeded',
      attempts: 1,
      failureCode: null,
      createdAt: '2026-10-20T08:00:00Z',
      candidates: [
        {
          id: 'first',
          fields: [
            { field: 'name', value: 'Steel kettle', confidence: 0.5, source },
            { field: 'specification:Capacity', value: '1.5 L', confidence: 0.5, source },
            {
              field: 'image',
              value: 'https://images.example.org/kettle.jpg',
              confidence: 0.5,
              source,
            },
          ],
        },
        {
          id: 'second',
          fields: [{ field: 'name', value: 'Travel kettle', confidence: 0.3, source }],
        },
      ],
    };
    await page.route('**/api/v1/**', async (route) => {
      const url = new URL(route.request().url()),
        method = route.request().method();
      if (url.pathname === `/api/v1/items/${id}`) return route.fulfill({ json: item });
      if (url.pathname.endsWith('/reviews') && method === 'POST') {
        const body = route.request().postDataJSON() as Record<string, unknown>;
        reviews.push(body);
        item.revision++;
        if (body.field === 'name' && body.decision === 'accept') item.name = 'Steel kettle';
        return route.fulfill({
          json: {
            ...body,
            id: 'event',
            workId: work.id,
            previousValue: 'Manual kettle',
            confirmedValue: item.name,
            resultingRevision: item.revision,
            createdAt: work.createdAt,
          },
        });
      }
      if (url.pathname.endsWith('/enrichment') && method === 'POST') {
        requests.push(route.request().postDataJSON() as Record<string, unknown>);
        return route.fulfill({ status: 201, json: work });
      }
      if (url.pathname.endsWith('/enrichment'))
        return route.fulfill({
          json: { providerStatus: 'available', items: [work], nextBefore: null },
        });
      return route.fulfill({ json: { items: [], nextBefore: null } });
    });
    const external: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('images.example.org')) external.push(request.url());
    });
    await page.goto(`/items/${id}/enrichment`);
    await expect(page.getByText('Manual kettle', { exact: true })).toBeVisible();
    expect(requests).toHaveLength(0);
    await page.getByLabel('Public product URL').fill('https://shop.example.org/kettle');
    await page.getByRole('button', { name: 'Request link suggestions' }).click();
    await expect(page.getByText('Choose the matching product (2 candidates)')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Accept Name' })).toHaveCount(0);
    await page.getByRole('radio', { name: /Candidate 1/ }).check();
    await expect(page.getByRole('button', { name: 'Import private image' })).toBeVisible();
    expect(external).toHaveLength(0);
    expect(reviews).toHaveLength(0);
    await expect(page.locator('html')).toHaveClass(new RegExp(theme));
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.addScriptTag({
      path: createRequire(import.meta.url).resolve('axe-core/axe.min.js'),
    });
    const violations = await page.evaluate(async () => {
      const axe = (
        window as unknown as {
          axe: { run: (context: Document, options: unknown) => Promise<{ violations: unknown[] }> };
        }
      ).axe;
      return (
        await axe.run(document, {
          runOnly: {
            type: 'tag',
            values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'],
          },
        })
      ).violations;
    });
    expect(violations).toEqual([]);
    const shortButtons = await page
      .getByRole('main')
      .getByRole('button')
      .evaluateAll((buttons) =>
        buttons
          .filter(
            (button) =>
              !button.hasAttribute('disabled') && button.getBoundingClientRect().height < 44,
          )
          .map((button) => button.textContent),
      );
    expect(shortButtons).toEqual([]);
    await page.screenshot({
      path: `../../docs/screenshots/per-44-${info.project.name}-${theme}.png`,
      fullPage: true,
    });
    await page.getByRole('button', { name: 'Accept Name' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Name accepted.' })).toBeVisible();
    expect(reviews[0]).toMatchObject({
      candidateId: 'first',
      field: 'name',
      decision: 'accept',
      revision: 1,
    });
    expect(item.pricePaidMinor).toBe('249900');
    expect(item.purchaseDate).toEqual({ precision: 'year', year: 2024 });
    await page.getByRole('button', { name: 'Scan barcode' }).click();
    await expect(page.getByText(/Camera scanning is unavailable here/)).toBeVisible();
    await page.getByLabel('Barcode number').fill('3017620422003');
    await page.getByRole('button', { name: 'Request food barcode suggestions' }).click();
    await expect.poll(() => requests.length).toBe(2);
    expect(requests[1]).toMatchObject({ kind: 'barcode', barcode: '3017620422003', revision: 2 });
    expect(external).toHaveLength(0);
  });
