import { expect, test, type Locator, type Page } from '@playwright/test';
import { itemId, mockCoreJourneys } from './support/core-journeys';

// PER-87: with a classic (space-taking) scrollbar, a modal overlay hides the scrollbar and the
// scroll lock adds the same width back as body margin. Fixed elements must be compensated once:
// neither widened by the missing scrollbar nor shifted twice. Headless Chromium hides scrollbars,
// so they are re-enabled and styled as classic 15px bars; desktop Chromium only, since mobile
// emulation uses overlay scrollbars.
test.use({ launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] } });

test.beforeEach(async ({ page, isMobile }) => {
  test.skip(isMobile, 'Mobile emulation uses overlay scrollbars that take no space.');
  await mockCoreJourneys(page);
});

type Rect = { left: number; width: number };
type Layout = { gutter: number; bodyMargin: string; content: Rect; header: Rect; nav: Rect | null };

async function classicScrollbars(page: Page): Promise<void> {
  await page.addStyleTag({
    content: '::-webkit-scrollbar { width: 15px; height: 15px; background: #ddd; }',
  });
  // Room to scroll, so the scrollbar is present before an overlay opens.
  await page.evaluate(() => {
    const spacer = document.createElement('div');
    spacer.style.height = '150vh';
    document.getElementById('main-content')!.append(spacer);
    window.scrollTo(0, 40);
  });
}

function layout(page: Page): Promise<Layout> {
  return page.evaluate(() => {
    const rect = (element: Element | null): Rect | null => {
      if (!element || !element.getClientRects().length) return null;
      const { left, width } = element.getBoundingClientRect();
      return { left, width };
    };
    const main = document.getElementById('main-content')!;
    return {
      gutter: innerWidth - document.documentElement.clientWidth,
      bodyMargin: getComputedStyle(document.body).marginRight,
      content: rect(main.querySelector('h1'))!,
      header: rect(main.previousElementSibling)!,
      nav: rect(document.querySelector('nav.fixed[aria-label="Primary"]')),
    };
  });
}

async function expectStillWhileOpen(
  page: Page,
  open: () => Promise<Locator>,
  close: () => Promise<void>,
): Promise<void> {
  const before = await layout(page);
  expect(before.gutter).toBe(15);
  expect(before.bodyMargin).toBe('0px');

  const overlay = await open();
  await expect(overlay).toBeVisible();
  const during = await layout(page);
  // The scrollbar is gone and its width is added back once.
  expect(during.gutter).toBe(0);
  expect(during.bodyMargin).toBe('15px');
  expect(during.content).toEqual(before.content);
  expect(during.header).toEqual(before.header);
  expect(during.nav).toEqual(before.nav);

  await close();
  await expect(overlay).toBeHidden();
  expect(await layout(page)).toEqual(before);
}

test('phone-width overlays keep the bottom bar and content still', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 640 });
  await page.goto('/store');
  await expect(page.getByRole('button', { name: /^Filters/ })).toBeVisible();
  await classicScrollbars(page);
  expect((await layout(page)).nav).not.toBeNull();

  await expectStillWhileOpen(
    page,
    async () => {
      await page.getByRole('button', { name: /^Filters/ }).click();
      return page.getByRole('dialog', { name: 'Filters' });
    },
    () => page.keyboard.press('Escape'),
  );
  await expectStillWhileOpen(
    page,
    async () => {
      await page.getByRole('combobox', { name: 'Sort by' }).click();
      return page.getByRole('listbox');
    },
    () => page.keyboard.press('Escape'),
  );
  await expectStillWhileOpen(
    page,
    async () => {
      await page.getByRole('button', { name: /^More destinations/ }).click();
      return page.getByRole('menu');
    },
    () => page.keyboard.press('Escape'),
  );
});

test('desktop dialogs keep the sidebar, header and content still', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(`/items/${itemId}`);
  const trigger = page.getByRole('button', { name: 'Edit condition and use' });
  await expect(trigger).toBeVisible();
  await classicScrollbars(page);

  await expectStillWhileOpen(
    page,
    async () => {
      await trigger.click();
      return page.getByRole('dialog', { name: 'Edit condition and use' });
    },
    () => page.keyboard.press('Escape'),
  );
});
