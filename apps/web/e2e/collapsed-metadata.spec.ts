import { test, expect } from '@playwright/test';
import path from 'node:path';

// Default smoke evidence uses an HTTP fixture. The optional loopback bridge is
// used only with an isolated IntegrationRun and a synthetic session.
const api = process.env.PER73_TEST_API;
const cookie = process.env.PER73_TEST_COOKIE;
if (api && (!/^http:\/\/127\.0\.0\.1:\d+$/.test(api) || !cookie)) {
  throw new Error('PER-73 requires a loopback test API and synthetic session');
}

test('PER-73 collapsed metadata, keyboard disclosure and retry', async ({ page }, testInfo) => {
  const requests: Record<string, unknown>[] = [];
  const persisted = new Map<string, Record<string, unknown>>();
  const evidence = api ? 'real-api' : 'mock-api';
  await page.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url());
    if (api) {
      const response = await page.request.fetch(`${api}${url.pathname}${url.search}`, {
        method: route.request().method(),
        headers: { Cookie: cookie!, 'Content-Type': 'application/json' },
        data: route.request().postData() ?? undefined,
      });
      if (url.pathname === '/api/v1/items' && route.request().method() === 'POST') {
        requests.push(route.request().postDataJSON() as Record<string, unknown>);
        expect(response.status()).toBe(201);
        if (requests.length === 1) return route.abort('failed');
      }
      return route.fulfill({ response });
    }
    if (url.pathname === '/api/v1/auth/me')
      return route.fulfill({
        json: {
          id: 'synthetic-per73',
          email: 'owner@example.test',
          displayName: 'Synthetic owner',
        },
      });
    if (url.pathname === '/api/v1/taxonomy')
      return route.fulfill({
        json: { categories: [], subcategories: [], tags: [], defaultsSeeded: true },
      });
    if (url.pathname === '/api/v1/merchants')
      return route.fulfill({ json: { merchants: [], nextCursor: null, hasMore: false } });
    if (url.pathname === '/api/v1/items' && route.request().method() === 'POST') {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      requests.push(body);
      const key = body.commandId as string;
      if (!persisted.has(key)) persisted.set(key, { ...body, id: 'synthetic-item-per73' });
      if (requests.length === 1) return route.abort('failed');
      return route.fulfill({ status: 201, json: persisted.get(key) });
    }
    return route.fulfill({ json: {} });
  });
  await page.goto('/items/new');
  await page.getByLabel('Item name', { exact: false }).fill('Synthetic PER-73 gifted jacket');
  await page.getByLabel('Price unknown', { exact: true }).check();
  await page.getByLabel('Date unknown', { exact: true }).check();
  const disclosure = page.getByRole('button', { name: /Additional details/ });
  await disclosure.focus();
  await page.keyboard.press('Enter');
  await expect(disclosure).toHaveAttribute('aria-expanded', 'true');
  for (const [label, option] of [
    ['Acquisition', 'Gift'],
    ['Condition', 'Worn out'],
    ['Use frequency', 'Rarely (a few times a year)'],
  ] as const) {
    await page.getByRole('combobox', { name: label, exact: true }).click();
    await page.getByRole('option', { name: option, exact: true }).click();
  }
  await disclosure.focus();
  await page.keyboard.press('Space');
  await expect(disclosure).toBeFocused();
  await expect(disclosure).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByRole('combobox', { name: 'Condition', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Save item', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'not confirmed saved' })).toBeVisible();
  const expected = {
    acquisitionType: 'gift',
    condition: 'worn_out',
    useFrequency: 'rarely',
    pricePaidMinor: null,
  };
  expect(requests[0]).toMatchObject(expected);
  await disclosure.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('combobox', { name: 'Acquisition', exact: true })).toContainText(
    'Gift',
  );
  await expect(page.getByRole('combobox', { name: 'Condition', exact: true })).toContainText(
    'Worn out',
  );
  await expect(page.getByRole('combobox', { name: 'Use frequency', exact: true })).toContainText(
    'Rarely',
  );
  for (const width of [360, 390, 768, 1280, 1512, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  for (const theme of ['light', 'dark']) {
    if (
      !(await page.locator('html').evaluate((root, value) => root.classList.contains(value), theme))
    ) {
      await page.getByRole('button', { name: 'Toggle color theme' }).click();
    }
    await expect(page.locator('html')).toHaveClass(new RegExp(theme));
    await page.setViewportSize({
      width: testInfo.project.name === 'mobile' ? 390 : 1280,
      height: 900,
    });
    await page.screenshot({
      path: api
        ? path.resolve(
            '..',
            '..',
            'docs',
            'screenshots',
            `per-73-${testInfo.project.name}-${theme}-${evidence}.png`,
          )
        : testInfo.outputPath(`per-73-${testInfo.project.name}-${theme}-${evidence}.png`),
      fullPage: true,
    });
  }
  await disclosure.click();
  await page.getByRole('button', { name: 'Save item', exact: true }).click();
  await expect(page.getByText(/saved to your home/)).toBeVisible();
  expect(requests).toHaveLength(2);
  expect(requests[1]).toEqual(requests[0]);
  if (api) {
    const list = await page.request.get(`${api}/api/v1/items`, {
      headers: { Cookie: cookie! },
    });
    expect(list.status()).toBe(200);
    const result = (await list.json()) as { items: { id: string; name: string }[] };
    const matches = result.items.filter((item) => item.name === requests[0]?.name);
    // Each project runs with a fresh synthetic item name/command; identify this command's response via replay.
    const replay = await page.request.post(`${api}/api/v1/items`, {
      headers: { Cookie: cookie! },
      data: requests[0],
    });
    const saved = (await replay.json()) as { id: string };
    expect(matches.filter((item) => item.id === saved.id)).toHaveLength(1);
    const detail = await page.request.get(`${api}/api/v1/items/${saved.id}`, {
      headers: { Cookie: cookie! },
    });
    expect(detail.status()).toBe(200);
    expect(await detail.json()).toMatchObject(expected);
  } else {
    expect(persisted.size).toBe(1);
    expect([...persisted.values()][0]).toMatchObject(expected);
  }
});
