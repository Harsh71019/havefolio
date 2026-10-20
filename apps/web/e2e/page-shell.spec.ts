import { expect, test, type Page } from '@playwright/test';
import {
  coreRoutes,
  desireId,
  goalId,
  itemId,
  mockCoreJourneys,
  type JourneyOptions,
} from './support/core-journeys';

// PER-75: every inventory page pins its heading and content to one left rail. Positions are
// measured relative to the content column (#main-content), never as full-page pixels, so the
// assertions hold for both sidebar widths. Synthetic mocked-API fixtures only.
type Width = 'form' | 'content' | 'wide' | 'full';
const maxWidth: Record<Width, number> = { form: 672, content: 896, wide: 1280, full: 1792 };
const shellWidth: Record<(typeof coreRoutes)[number][0] | 'merchants' | 'text-suggestions', Width> =
  {
    home: 'wide',
    store: 'full',
    'item-new': 'form',
    'item-detail': 'wide',
    'item-photos': 'wide',
    'item-photos-new': 'form',
    insights: 'wide',
    wants: 'wide',
    'want-new': 'form',
    'want-edit': 'form',
    'want-matches': 'content',
    'want-compare': 'wide',
    'want-history': 'content',
    'want-allocate': 'form',
    'want-convert': 'form',
    'want-goals': 'content',
    goals: 'wide',
    'goal-new': 'form',
    'goal-detail': 'content',
    'goal-edit': 'form',
    settings: 'content',
    taxonomy: 'content',
    merchants: 'content',
    'text-suggestions': 'content',
  };
const routes = [
  ...coreRoutes,
  ['merchants', '/settings/merchants'],
  ['text-suggestions', `/items/${itemId}/text-suggestions`],
] as const;
const gutter = (viewport: number): number => (viewport >= 1024 ? 32 : viewport >= 640 ? 24 : 16);

type Geometry = {
  shells: number;
  mains: number;
  railOffset: number;
  railWidth: number;
  contentWidth: number;
  h1Offset: number | null;
  searchOffset: number | null;
  /** Direct rail children that start away from the rail (centred islands). */
  strayChildren: string[];
  /** The first form or card, which self-centring forms used to push off the rail. */
  firstFormOffset: number | null;
  overflow: number;
};

function measure(page: Page): Promise<Geometry> {
  return page.evaluate(() => {
    const content = document.querySelector('#main-content')!.getBoundingClientRect();
    const rail = document.querySelector('#main-content [data-page-rail]')?.getBoundingClientRect();
    const railEl = document.querySelector<HTMLElement>('#main-content [data-page-rail]');
    const h1 = railEl?.querySelector('h1')?.getBoundingClientRect();
    const search = document
      .querySelector('input[aria-label="Search what you own"]')
      ?.getBoundingClientRect();
    const form = railEl
      ?.querySelector('form, [data-slot="card"], [role="status"][aria-label="Loading form"]')
      ?.getBoundingClientRect();
    const strayChildren: string[] = [];
    for (const child of Array.from(railEl?.children ?? []) as HTMLElement[]) {
      const box = child.getBoundingClientRect();
      if (child.classList.contains('sr-only') || box.width === 0) continue;
      // Ghost back buttons use a -12 px margin so their text, not their hit area, meets the rail.
      if (box.left < rail!.left - 12.5 || box.left > rail!.left + 0.5)
        strayChildren.push(
          `${child.tagName.toLowerCase()} at ${Math.round(box.left - rail!.left)}`,
        );
    }
    return {
      shells: document.querySelectorAll('[data-page-shell]').length,
      mains: document.querySelectorAll('main').length,
      railOffset: rail ? Math.round(rail.left - content.left) : -1,
      railWidth: rail ? Math.round(rail.width) : -1,
      contentWidth: Math.round(content.width),
      h1Offset: h1 && rail ? Math.round(h1.left - rail.left) : null,
      searchOffset: search ? Math.round(search.left - content.left) : null,
      strayChildren,
      firstFormOffset: form && rail ? Math.round(form.left - rail.left) : null,
      overflow: document.documentElement.scrollWidth - window.innerWidth,
    };
  });
}

function expectOnRail(geometry: Geometry, width: Width, viewport: number, label: string): void {
  const g = gutter(viewport);
  expect(geometry.shells, `${label}: one page shell`).toBe(1);
  expect(geometry.mains, `${label}: one main landmark`).toBe(1);
  expect(geometry.railOffset, `${label}: rail starts at the gutter`).toBe(g);
  expect(geometry.h1Offset, `${label}: heading starts on the rail`).toBe(0);
  expect(geometry.searchOffset, `${label}: header search starts on the rail`).toBe(g);
  expect(geometry.strayChildren, `${label}: no centred islands`).toEqual([]);
  // Left-pinned: readable forms stop at their cap, wide pages use the space that is there.
  expect(geometry.railWidth, `${label}: rail width`).toBe(
    Math.min(maxWidth[width], geometry.contentWidth - 2 * g),
  );
  expect(geometry.overflow, `${label}: no horizontal overflow`).toBeLessThanOrEqual(0);
}

async function open(page: Page, path: string, options: JourneyOptions = {}): Promise<void> {
  await mockCoreJourneys(page, options);
  await page.goto(path);
  await page.waitForLoadState('networkidle');
  await page.addStyleTag({
    content: '*,*::before,*::after{transition:none!important;animation:none!important}',
  });
}

test.describe('shared left rail', () => {
  for (const [name, path] of routes)
    test(`${name}: heading and content share the rail`, async ({ page, isMobile }) => {
      const width = shellWidth[name];
      await page.setViewportSize({ width: isMobile ? 390 : 1280, height: 900 });
      await open(page, path);
      await expect(page.locator('h1')).toHaveCount(1);

      // 320 px is the WCAG 1.4.10 reflow width (1280 px at 400% zoom).
      const viewports = isMobile ? [320, 360, 390] : [768, 1280, 1512, 1920];
      const sidebars = isMobile ? ['expanded'] : ['expanded', 'collapsed'];
      for (const sidebar of sidebars) {
        // The same attribute the saved preference sets before first paint (PER-66).
        await page.evaluate((state) => (document.documentElement.dataset.sidebar = state), sidebar);
        for (const viewport of viewports) {
          await page.setViewportSize({ width: viewport, height: 900 });
          const geometry = await measure(page);
          expectOnRail(geometry, width, viewport, `${name} ${viewport}px ${sidebar}`);
          if (width === 'form')
            expect(geometry.firstFormOffset, `${name} ${viewport}px form on the rail`).toBe(0);
        }
      }
    });

  test('every route starts its heading at the same x within the content column', async ({
    page,
    isMobile,
  }) => {
    test.skip(isMobile, 'Covered per route at phone widths.');
    await page.setViewportSize({ width: 1512, height: 900 });
    const offsets = new Map<string, number>();
    for (const [name, path] of routes) {
      await open(page, path);
      const { railOffset, h1Offset } = await measure(page);
      offsets.set(name, railOffset + (h1Offset ?? Number.NaN));
    }
    expect(new Set(offsets.values()), JSON.stringify(Object.fromEntries(offsets))).toEqual(
      new Set([32]),
    );
  });
});

test.describe('state surfaces use the same rail', () => {
  const sample = [
    ['home', '/'],
    ['store', '/store'],
    ['item-detail', `/items/${itemId}`],
    ['want-edit', `/wants/${desireId}/edit`],
    ['want-history', `/wants/${desireId}/history`],
    ['goal-detail', `/goals/${goalId}`],
    ['settings', '/settings'],
  ] as const;
  for (const [mode, options] of [
    ['failed', { status: 503 }],
    ['offline', { offline: true }],
    ['empty', { empty: true }],
  ] as const)
    for (const [name, path] of sample)
      test(`${mode} ${name}`, async ({ page, isMobile }) => {
        const viewport = isMobile ? 360 : 1512;
        await page.setViewportSize({ width: viewport, height: 900 });
        await open(page, path, options);
        await expect(page.locator('h1')).toHaveCount(1);
        const geometry = await measure(page);
        expect(geometry.railOffset).toBe(gutter(viewport));
        expect(geometry.h1Offset).toBe(0);
        expect(geometry.strayChildren).toEqual([]);
        expect(geometry.overflow).toBeLessThanOrEqual(0);
      });

  test('the item skeleton reserves the loaded rail', async ({ page, isMobile }) => {
    const viewport = isMobile ? 360 : 1512;
    await page.setViewportSize({ width: viewport, height: 900 });
    await mockCoreJourneys(page);
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => (release = resolve));
    await page.route(`**/api/v1/items/${itemId}`, async (route) => {
      await held;
      await route.fallback();
    });
    await page.goto(`/items/${itemId}`);
    await expect(page.getByText('Loading item.')).toBeAttached();
    const loading = await measure(page);
    release();
    await expect(page.locator('h1')).toHaveCount(1);
    const loaded = await measure(page);
    expect(loading.railOffset).toBe(gutter(viewport));
    expect(loading.railOffset).toBe(loaded.railOffset);
    expect(loading.railWidth).toBe(loaded.railWidth);
  });
});

test('skip link moves focus to the content before the rail heading', async ({ page }) => {
  await open(page, '/insights');
  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: 'Skip to main content' });
  await expect(skip).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#main-content')).toBeFocused();
  await expect(page.locator('#main-content [data-page-rail] h1')).toBeInViewport();
});
