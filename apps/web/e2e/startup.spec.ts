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
    ['My Store', '/store', 'My Store'],
    ['Insights', '/insights', 'Recorded spending'],
    ['Wants', '/wants', 'Make room between wanting and buying.'],
    ['Goals', '/goals', 'Keep the other possibility in view.'],
    ['Home', '/', 'Remember what your home already holds.'],
  ] as const) {
    const inMore =
      name === 'Goals' &&
      (await navigation.getByRole('button', { name: /More destinations/ }).isVisible());
    if (inMore) {
      await navigation.getByRole('button', { name: /More destinations/ }).click();
      await page.getByRole('menuitem', { name, exact: true }).click();
    } else await navigation.getByRole('link', { name, exact: true }).click();
    await expect(page).toHaveURL((url) => url.pathname === path);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(heading);
    if (inMore) await navigation.getByRole('button', { name: /More destinations/ }).click();
    await expect(
      inMore
        ? page.getByRole('menuitem', { name, exact: true })
        : navigation.getByRole('link', { name, exact: true }),
    ).toHaveAttribute('aria-current', 'page');
    if (inMore) await page.keyboard.press('Escape');
  }
  expect(failures).toEqual([]);
});
