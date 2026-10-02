import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

test('login has its own image layout, no inventory navigation and both themes', async ({
  page,
}, info) => {
  await page.goto('/login');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Welcome home.');
  await expect(page.locator('nav')).toHaveCount(0);
  const image = page.getByRole('img', { name: /Books, a camera/ });
  await expect(image).toBeVisible();
  await expect
    .poll(() => image.evaluate((element) => (element as HTMLImageElement).naturalWidth))
    .toBeGreaterThan(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  const screenshots = resolve(process.cwd(), '../../docs/screenshots');
  await mkdir(screenshots, { recursive: true });
  for (const theme of ['light', 'dark'] as const) {
    await page.evaluate((value) => {
      localStorage.setItem('theme', value);
    }, theme);
    await page.reload();
    await expect(page.locator('html')).toHaveClass(new RegExp(theme));
    await expect
      .poll(() => image.evaluate((element) => (element as HTMLImageElement).naturalWidth))
      .toBeGreaterThan(0);
    await page.screenshot({
      path: resolve(screenshots, `per-52-${info.project.name}-${theme}.png`),
      fullPage: true,
    });
  }
  await page.setViewportSize({ width: 320, height: 740 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  await page.getByLabel('Email', { exact: true }).focus();
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('Password', { exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Show password' })).toBeFocused();
});

test('keyboard sign-in reports invalid and offline states and restores the inventory shell on success', async ({
  page,
}) => {
  let state: 'invalid' | 'offline' | 'success' = 'invalid';
  await page.route('**/api/v1/auth/login', async (route) => {
    if (state === 'offline') {
      await route.abort();
      return;
    }
    await route.fulfill({
      status: state === 'success' ? 200 : 401,
      contentType: 'application/json',
      body: JSON.stringify(
        state === 'success'
          ? { id: 'synthetic-owner' }
          : { message: 'synthetic server details must not render' },
      ),
    });
  });
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill('owner@example.test');
  await page.getByLabel('Password', { exact: true }).fill('a synthetic long password');
  await page.getByLabel('Password', { exact: true }).press('Enter');
  await expect(page.locator('#login-error')).toContainText('Check your details');
  await expect(page.getByText('synthetic server details must not render')).toHaveCount(0);
  state = 'offline';
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.locator('#login-error')).toContainText('Unable to connect');
  state = 'success';
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/store$/);
  await expect(
    page.getByRole('navigation', { name: 'Primary' }).filter({ visible: true }),
  ).toBeVisible();
});
