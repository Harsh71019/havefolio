import { deflateSync } from 'node:zlib';
import { expect, test, type Page, type Route } from '@playwright/test';

const item = '15151515-1515-4151-a151-151515151515';
const id = (n: number): string => `00000000-0000-4000-a000-${String(n).padStart(12, '0')}`;
// Synthetic flat illustrations only: no user content, EXIF or provider data.
const colours = ['#7c9a92', '#c9a66b', '#8d7fa8', '#b5655d', '#6b8fb5', '#9aa36b'];
const svg = (n: number, portrait = false): string => {
  const [w, h] = portrait ? [600, 800] : [800, 600];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="100%" height="100%" fill="${colours[n % colours.length]}"/><circle cx="${w / 2}" cy="${h / 2}" r="${Math.min(w, h) / 4}" fill="#ffffff" fill-opacity="0.55"/></svg>`;
};
/** Minimal valid solid-colour RGB PNG, generated so no real photo is ever used. */
function png(width: number, height: number, [r, g, b]: [number, number, number]): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (data: Buffer): number => {
    let c = 0xffffffff;
    for (const byte of data) c = crcTable[(c ^ byte) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer): Buffer => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([length, body, sum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array(width).fill([r, g, b]).flat())]);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat(Array(height).fill(row)))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
const shot = (name: string): string => `../../docs/screenshots/per-15-${name}.png`;

interface Photo {
  id: string;
  n: number;
  portrait: boolean;
  altText: string | null;
  decorative: boolean;
}
/** Stateful mock of the authenticated photo API so refreshes observe persisted changes. */
interface MockState {
  revision: number;
  photos: Photo[];
  next: number;
}
async function mockApi(
  page: Page,
  initial: Photo[],
  options: { holdUploads?: boolean } = {},
): Promise<{ state: MockState; held: Route[] }> {
  const state: MockState = { revision: 1, photos: [...initial], next: 50 };
  const held: Route[] = [];
  const snapshot = (): { revision: number; photos: Record<string, unknown>[] } => ({
    revision: state.revision,
    photos: state.photos.map((p, position) => ({
      id: p.id,
      position,
      cover: position === 0,
      width: p.portrait ? 600 : 800,
      height: p.portrait ? 800 : 600,
      byteSize: 1000,
      mimeType: 'image/webp',
      altText: p.altText,
      decorative: p.decorative,
    })),
  });
  await page.route(`**/api/v1/items/${item}/photos**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(`/api/v1/items/${item}/photos`, '');
    const body = request.postData() && request.method() !== 'POST' ? request.postDataJSON() : {};
    if (path.includes('/content/')) {
      const photo = state.photos.find((p) => path.startsWith(`/${p.id}/`));
      if (!photo) return route.fulfill({ status: 404, json: { message: 'MEDIA_NOT_FOUND' } });
      return route.fulfill({
        contentType: 'image/svg+xml',
        headers: { 'cache-control': 'private, no-store' },
        body: svg(photo.n, photo.portrait),
      });
    }
    if (request.method() === 'GET') return route.fulfill({ json: snapshot() });
    if (request.method() === 'POST') {
      if (options.holdUploads) {
        held.push(route);
        return;
      }
      const created = {
        id: id(state.next),
        n: state.next++,
        portrait: false,
        altText: null,
        decorative: false,
      };
      state.photos.push(created);
      state.revision++;
      const photo = snapshot().photos.find((p) => p.id === created.id);
      return route.fulfill({ status: 201, json: { results: [{ index: 0, photo }] } });
    }
    if (body.revision !== state.revision)
      return route.fulfill({ status: 409, json: { message: 'STALE_ITEM_REVISION' } });
    if (request.method() === 'PATCH' && path === '/order')
      state.photos = (body.photoIds as string[]).map((pid) =>
        state.photos.find((p) => p.id === pid)!,
      );
    else if (request.method() === 'PATCH')
      state.photos = state.photos.map((p) =>
        `/${p.id}` === path ? { ...p, altText: body.altText, decorative: body.decorative } : p,
      );
    else if (request.method() === 'DELETE')
      state.photos = state.photos.filter((p) => `/${p.id}` !== path);
    state.revision++;
    return route.fulfill({ json: snapshot() });
  });
  return { state, held };
}
const photos = (count: number): Photo[] =>
  Array.from({ length: count }, (_, n) => ({
    id: id(n + 1),
    n,
    portrait: n === 2,
    altText: n === 0 ? 'Front of the kettle with the lid closed' : null,
    decorative: false,
  }));

async function setTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  const current = await page.locator('html').getAttribute('class');
  if (!current?.split(' ').includes(theme))
    await page.getByRole('button', { name: 'Toggle color theme' }).click();
  await expect(page.locator('html')).toHaveClass(new RegExp(theme));
}
async function expectNoOverflow(page: Page): Promise<void> {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
}
async function expectTouchTargets(page: Page): Promise<void> {
  const small = await page.evaluate(
    () =>
      [...document.querySelectorAll('main button, main a, main input')]
        .filter((el) => (el as HTMLElement).offsetParent !== null)
        .filter((el) => !el.closest('.sr-only'))
        .map((el) => el.getBoundingClientRect())
        .filter((r) => r.height < 44 || r.width < 44).length,
  );
  expect(small).toBe(0);
}

test('empty gallery and no-cover state at 360px in both themes', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'Captured once at mobile width.');
  await mockApi(page, []);
  await page.setViewportSize({ width: 360, height: 900 });
  await page.goto(`/items/${item}/photos`);
  await expect(page.getByText('No photos yet')).toBeVisible();
  await expect(page.getByText('No cover photo yet')).toBeVisible();
  for (const theme of ['light', 'dark'] as const) {
    await setTheme(page, theme);
    await expectNoOverflow(page);
    await page.screenshot({
      path: shot(`empty-360-${theme}`),
      fullPage: true,
      animations: 'disabled',
    });
  }
});

test('populated gallery is responsive, lazy and private at 360px, tablet and desktop', async ({
  page,
}, testInfo) => {
  await mockApi(page, photos(5));
  await page.goto(`/items/${item}/photos`);
  const gallery = page.locator('section', { has: page.getByRole('heading', { name: /^Photos/ }) });
  await expect(gallery.getByRole('img')).toHaveCount(5);
  await expect(gallery.getByRole('img').nth(4)).toHaveAttribute('loading', 'lazy');
  await expect(gallery.getByRole('img').first()).toHaveAttribute('sizes', /45vw/);
  // Every rendered image has an accessible alternative and layout-reserving dimensions.
  for (const image of await gallery.getByRole('img').all()) {
    await expect(image).toHaveAttribute('alt', /.+/);
    await expect(image).toHaveAttribute('width', /\d+/);
  }
  const html = await page.content();
  expect(html).not.toMatch(
    /cloudinary|api_key|signature=|havefolio\/(test|production|development)/i,
  );
  const widths =
    testInfo.project.name === 'mobile'
      ? [{ width: 360, label: '360' }]
      : [
          { width: 768, label: 'tablet' },
          { width: 1280, label: 'desktop' },
        ];
  for (const { width, label } of widths) {
    await page.setViewportSize({ width, height: 1000 });
    for (const theme of ['light', 'dark'] as const) {
      await setTheme(page, theme);
      await expectNoOverflow(page);
      await expectTouchTargets(page);
      await page.screenshot({
        path: shot(`populated-${label}-${theme}`),
        fullPage: true,
        animations: 'disabled',
      });
    }
  }
});

test('keyboard-only reorder, cover change and delete persist across refresh', async ({
  page,
}, testInfo) => {
  const { state } = await mockApi(page, photos(3));
  await page.goto(`/items/${item}/photos`);
  const moveEarlier = page.getByRole('button', { name: 'Move photo 2 earlier' });
  await moveEarlier.focus();
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('status').filter({ hasText: 'moved to position 1 of 3' }),
  ).toHaveCount(1);
  await expect(page.locator(`#photo-later-${id(2)}`)).toBeFocused();
  await page.reload();
  await expect(page.locator('ol li').first().getByText('Cover', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'More actions for photo 1' })).toHaveAttribute(
    'id',
    `photo-menu-${id(2)}`,
  );
  // Set the third photo as cover with the keyboard menu.
  if (testInfo.project.name === 'mobile') {
    await page.setViewportSize({ width: 360, height: 900 });
    await setTheme(page, 'dark');
  }
  await page.getByRole('button', { name: 'More actions for photo 3' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menuitem', { name: 'Set as cover' })).toBeFocused();
  if (testInfo.project.name === 'mobile')
    await page.screenshot({ path: shot('cover-menu-360-dark'), animations: 'disabled' });
  await page.keyboard.press('Enter');
  await expect(page.getByRole('status').filter({ hasText: 'is now the cover' })).toHaveCount(1);
  expect(state.photos[0]!.id).toBe(id(3));
  if (testInfo.project.name === 'desktop') {
    await page.setViewportSize({ width: 1280, height: 1000 });
    await setTheme(page, 'light');
    await page.screenshot({
      path: shot('cover-desktop-light'),
      fullPage: true,
      animations: 'disabled',
    });
  }
  // Delete the cover via keyboard; focus lands on the next photo's actions.
  await page.getByRole('button', { name: 'More actions for photo 1' }).focus();
  await page.keyboard.press('Enter');
  await page.getByRole('menuitem', { name: 'Delete photo' }).focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText('It is the cover, so the next photo will become the cover.');
  await expect(dialog.getByRole('button', { name: 'Keep photo' })).toBeFocused();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('status').filter({ hasText: 'Photo deleted.' })).toHaveCount(1);
  await expect(page.locator(`#photo-menu-${state.photos[0]!.id}`)).toBeFocused();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Photos (2 of 8)' })).toBeVisible();
  // Escape closes a dialog and restores focus to its trigger.
  await page.getByRole('button', { name: 'More actions for photo 1' }).focus();
  await page.keyboard.press('Enter');
  await page.getByRole('menuitem', { name: 'Edit description' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'More actions for photo 1' })).toBeFocused();
});

test('upload progress and processing states are visible and announced', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'Captured once at mobile width.');
  const { held, state } = await mockApi(page, photos(2), { holdUploads: true });
  await page.setViewportSize({ width: 360, height: 900 });
  await page.goto(`/items/${item}/photos`);
  await page.getByLabel('Choose from gallery or files').setInputFiles([
    { name: 'synthetic-1.png', mimeType: 'image/png', buffer: png(64, 48, [107, 143, 181]) },
    { name: 'synthetic-2.heic', mimeType: 'image/heic', buffer: Buffer.from('synthetic') },
  ]);
  await expect(page.getByText('HEIC/HEIF is not supported yet')).toBeVisible();
  await page.getByRole('button', { name: 'Upload photos' }).click();
  await expect(
    page.getByRole('progressbar', { name: 'Upload progress for photo 1' }),
  ).toBeVisible();
  // Intercepted requests may not emit upload progress; either per-file state is honest.
  await expect(page.getByText(/^(Uploading \d+%|Processing and saving…)$/)).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'Uploading photo 1 of 2.' })).toHaveCount(
    1,
  );
  await setTheme(page, 'light');
  await page.getByRole('heading', { name: 'Add photos' }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: shot('upload-progress-360-light'), animations: 'disabled' });
  await expect.poll(() => held.length).toBe(1);
  const created = { id: id(60), n: 5, portrait: false, altText: null, decorative: false };
  state.photos.push(created);
  state.revision++;
  await held[0]!.fulfill({
    status: 201,
    json: {
      results: [
        {
          index: 0,
          photo: {
            id: created.id,
            position: 2,
            cover: false,
            width: 800,
            height: 600,
            byteSize: 1,
            mimeType: 'image/webp',
            altText: null,
            decorative: false,
          },
        },
      ],
    },
  });
  await expect(page.getByRole('status').filter({ hasText: '1 of 1 photos saved.' })).toHaveCount(1);
  await expect(page.getByRole('heading', { name: 'Photos (3 of 8)' })).toBeVisible();
});
