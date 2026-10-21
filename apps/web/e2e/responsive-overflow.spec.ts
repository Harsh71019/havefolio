import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { coreRoutes, goalId, itemId, mockCoreJourneys } from './support/core-journeys';
import { longName2, longWord, mockAdversarialContent } from './fixtures/adversarial-content';

// PER-91: long names, long URLs, huge amounts and missing media must not widen the page, push
// controls off-screen or hide text without another way to read it. Synthetic mocked-API data only.
//
// PER-85 clips the content column on phones (`max-md:overflow-x-clip`) so stray overflow cannot
// zoom the layout viewport. That guard would also hide the defects this suite looks for, so every
// measurement neutralises it first and asserts that nothing needed clipping.
const unclip = '.max-md\\:overflow-x-clip{overflow-x:visible!important}';
const screenshotsDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../docs/screenshots',
);
const capture = Boolean(process.env.PER91_SCREENSHOTS);
const routes = [...coreRoutes, ['merchants', '/settings/merchants']] as const;

type Case = { label: string; width: number; text?: '200%'; sidebar?: 'collapsed' };
// 320 px is the WCAG 1.4.10 reflow width. Text-only 200% (WCAG 1.4.4) is checked where a page
// zoom of 200% would leave the same CSS width (640) and on desktop with the rail collapsed.
const phoneCases: Case[] = [
  { label: '320', width: 320 },
  { label: '360', width: 360 },
  { label: '390', width: 390 },
];
const desktopCases: Case[] = [
  { label: '640 text 200%', width: 640, text: '200%' },
  { label: '767', width: 767 },
  { label: '768', width: 768 },
  { label: '768 collapsed', width: 768, sidebar: 'collapsed' },
  { label: '1024', width: 1024 },
  { label: '1279', width: 1279 },
  { label: '1280', width: 1280 },
  { label: '1280 collapsed', width: 1280, sidebar: 'collapsed' },
  { label: '1512', width: 1512 },
  { label: '1280 text 200% collapsed', width: 1280, text: '200%', sidebar: 'collapsed' },
];

async function open(page: Page, url: string): Promise<void> {
  await mockCoreJourneys(page);
  await mockAdversarialContent(page, { missingMedia: true });
  await page.goto(url);
  await page.waitForLoadState('networkidle');
  await page.addStyleTag({
    content: `${unclip}*,*::before,*::after{transition:none!important;animation:none!important}`,
  });
}

async function apply(page: Page, c: Case, height = 900): Promise<void> {
  await page.evaluate(
    ([text, sidebar]) => {
      document.documentElement.style.fontSize = text;
      document.documentElement.dataset.sidebar = sidebar;
    },
    [c.text ?? '', c.sidebar ?? 'expanded'] as const,
  );
  await page.setViewportSize({ width: c.width, height });
}

type Report = { overflow: number; offscreen: string[] };

/**
 * Document overflow plus every visible focusable control that starts or ends outside the viewport.
 * Controls inside an intentional horizontal scroll region are judged against that region instead.
 */
function inspect(page: Page): Promise<Report> {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const offscreen: string[] = [];
    const focusable = document.querySelectorAll<HTMLElement>(
      'a[href], button, input:not([type="hidden"]), select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    for (const el of Array.from(focusable)) {
      const box = el.getBoundingClientRect();
      if (!box.width || !box.height || el.closest('.sr-only, [aria-hidden="true"], [inert]'))
        continue;
      if (getComputedStyle(el).visibility === 'hidden') continue;
      let left = 0;
      let right = vw;
      for (let p = el.parentElement; p; p = p.parentElement) {
        const style = getComputedStyle(p);
        if (style.overflowX === 'auto' || style.overflowX === 'scroll') {
          const region = p.getBoundingClientRect();
          left = region.left - p.scrollLeft;
          right = region.left + p.scrollWidth;
          break;
        }
      }
      if (box.left < left - 1 || box.right > right + 1)
        offscreen.push(
          `${el.tagName.toLowerCase()} "${(el.getAttribute('aria-label') ?? el.textContent ?? '')
            .trim()
            .slice(0, 40)}" ${Math.round(box.left)}..${Math.round(box.right)} of ${vw}`,
        );
    }
    return { overflow: document.documentElement.scrollWidth - vw, offscreen };
  });
}

test.describe('long content reflows on every route', () => {
  for (const [name, url] of routes)
    test(`${name}`, async ({ page, isMobile }) => {
      await page.setViewportSize({ width: isMobile ? 390 : 1280, height: 900 });
      await open(page, url);
      await expect(page.locator('h1')).toHaveCount(1);
      for (const c of isMobile ? phoneCases : [...phoneCases, ...desktopCases]) {
        await apply(page, c);
        const report = await inspect(page);
        expect(
          report.overflow,
          `${name} ${c.label}: no horizontal page scroll`,
        ).toBeLessThanOrEqual(0);
        expect(report.offscreen, `${name} ${c.label}: controls stay on screen`).toEqual([]);
      }
    });

  test('phone landscape keeps every route inside the viewport', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'Touch landscape only.');
    await page.setViewportSize({ width: 740, height: 360 });
    for (const [name, url] of routes) {
      await open(page, url);
      const report = await inspect(page);
      expect(report.overflow, `${name} landscape`).toBeLessThanOrEqual(0);
      expect(report.offscreen, `${name} landscape`).toEqual([]);
    }
  });
});

test.describe('My Store densities', () => {
  test.skip(({ isMobile }) => isMobile, 'Density is a desktop preference (PER-58).');
  for (const density of ['compact', 'comfortable', 'large'] as const)
    test(`${density} keeps long cards and filters inside the content column`, async ({ page }) => {
      await page.addInitScript((value) => {
        try {
          window.localStorage.setItem('havefolio:store-density:v1', value);
        } catch {
          // Storage can be unavailable; the bootstrap falls back to comfortable.
        }
      }, density);
      await page.setViewportSize({ width: 1280, height: 900 });
      await open(page, '/store');
      await expect(page.locator('html')).toHaveAttribute('data-store-density', density);
      for (const c of desktopCases.filter((d) => d.width >= 1024)) {
        await apply(page, c);
        const report = await inspect(page);
        expect(report.overflow, `${density} ${c.label}`).toBeLessThanOrEqual(0);
        expect(report.offscreen, `${density} ${c.label}`).toEqual([]);
      }
      // Two-line clamped card names keep the full name as the link's accessible name.
      await expect(page.getByRole('link', { name: longName2 }).first()).toBeVisible();
    });
});

test.describe('long values stay readable', () => {
  test('filters wrap long names and truncated chips expose the full value', async ({
    page,
    isMobile,
  }) => {
    test.skip(isMobile, 'Desktop filter rail.');
    await page.setViewportSize({ width: 1280, height: 900 });
    await open(page, `/store?brand=${encodeURIComponent(`${longWord} Brand`)}`);
    const brands = page.getByRole('radiogroup', { name: /brand/i });
    const option = brands.getByText(`${longWord} Brand`, { exact: true });
    await expect(option).toBeVisible();
    // Wrapped, not ellipsised: the whole label is painted inside the filter rail.
    expect(await option.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    const chip = page.getByRole('button', { name: `Remove filter: ${longWord} Brand` });
    await expect(chip).toHaveAttribute('title', `${longWord} Brand`);
  });

  test('huge amounts keep their currency and digits on one line', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 900 });
    for (const url of [`/goals/${goalId}`, `/items/${itemId}`]) {
      await open(page, url);
      const lines = await page.evaluate((digits) => {
        const found: number[] = [];
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          const text = node.textContent ?? '';
          const at = text.indexOf(digits);
          if (at < 0) continue;
          // Include the currency symbol immediately before the grouped digits.
          const range = document.createRange();
          range.setStart(node, Math.max(0, at - 1));
          range.setEnd(node, at + digits.length);
          const tops = new Set(Array.from(range.getClientRects(), (r) => Math.round(r.top)));
          if (tops.size) found.push(tops.size);
        }
        return found;
      }, '99,99,99,99,99,999.99');
      expect(lines.length, `${url}: huge amount rendered`).toBeGreaterThan(0);
      expect(new Set(lines), `${url}: amounts unbroken`).toEqual(new Set([1]));
    }
  });

  test('item details wrap long names, tags and links without hiding them', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 900 });
    await open(page, `/items/${itemId}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(longName2);
    const tag = page.getByRole('list', { name: 'Tags' }).getByText(`Daily ${longWord}`);
    await expect(tag).toBeVisible();
    const box = await tag.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { right: r.right, clipped: el.scrollWidth > el.clientWidth + 1 };
    });
    expect(box.clipped).toBe(false);
    expect(box.right).toBeLessThanOrEqual(320);
  });
});

test.describe('evidence', () => {
  test.skip(!capture, 'Set PER91_SCREENSHOTS=1 to refresh the PR screenshots.');
  const shots = [
    ['home', '/', 320, '', 'light', 'neutral'],
    ['item-detail', `/items/${itemId}`, 320, '', 'dark', 'ocean'],
    ['store', '/store', 1280, '', 'light', 'neutral'],
    ['wants', '/wants', 390, '', 'dark', 'neutral'],
    ['goal-detail', `/goals/${goalId}`, 768, '', 'light', 'ocean'],
    [
      'want-compare',
      '/wants/00000000-0000-4000-a036-000000000002/compare',
      1024,
      '',
      'dark',
      'forest',
    ],
    ['insights', '/insights', 640, '200%', 'light', 'neutral'],
  ] as const;
  for (const [name, url, width, text, theme, palette] of shots)
    test(`${name} ${width}`, async ({ page, isMobile }) => {
      test.skip(isMobile, 'Captured once from the desktop project.');
      await page.addInitScript(
        ([t, p]) => {
          window.localStorage.setItem('theme', t);
          window.localStorage.setItem('havefolio:palette-preset:v1', p);
        },
        [theme, palette] as const,
      );
      await page.setViewportSize({ width, height: 900 });
      await open(page, url);
      await apply(page, { label: name, width, ...(text ? { text } : {}) });
      await page.screenshot({
        path: path.join(
          screenshotsDir,
          `per-91-after-${name}-${width}${text ? '-text200' : ''}-${theme}-${palette}.png`,
        ),
        fullPage: true,
      });
    });
});
