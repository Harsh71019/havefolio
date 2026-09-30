import { test, expect } from '@playwright/test';

test('starts the production shell and navigates every collection', async ({ page }) => {
  const failures: string[] = [];
  page.on('pageerror', (error) => failures.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'Remember what your home already holds.',
  );
  const navigation = page.getByRole('navigation', { name: 'Primary' }).filter({ visible: true });
  for (const [name, path, heading] of [
    ['My Store', '/store', 'The useful things you already own.'],
    ['Wants', '/wants', 'Make room between wanting and buying.'],
    ['Goals', '/goals', 'Keep the other possibility in view.'],
    ['Home', '/', 'Remember what your home already holds.'],
  ] as const) {
    await navigation.getByRole('link', { name, exact: true }).click();
    await expect(page).toHaveURL(`http://127.0.0.1:3100${path}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(heading);
    await expect(navigation.getByRole('link', { name, exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
  }
  expect(failures).toEqual([]);
});
