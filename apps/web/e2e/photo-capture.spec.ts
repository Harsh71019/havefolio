import { expect, test } from '@playwright/test';
const item = '13131313-1313-4131-a131-131313131313';
// Generated 1x1 PNG, no user content or EXIF.
const photo = {
  name: 'synthetic.png',
  mimeType: 'image/png',
  buffer: Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=',
    'base64',
  ),
};
test('capture preview, partial failure, retry and neutral 360px themes', async ({
  page,
}, testInfo) => {
  let release: () => void = () => undefined;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  let count = 0;
  const attempts: string[] = [];
  await page.route(`**/api/v1/items/${item}/photos`, async (route) => {
    attempts.push(route.request().headers()['upload-id']!);
    count++;
    if (count === 1) await waiting;
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        results: [
          count === 2
            ? { index: 0, error: 'PHOTO_PROCESSING_BUSY' }
            : { index: 0, photo: { id: item } },
        ],
      }),
    });
  });
  await page.goto(`/items/${item}/photos/new`);
  await expect(page.getByLabel('Take a photo')).toHaveAttribute('capture', 'environment');
  await page
    .getByLabel('Choose from gallery or files')
    .setInputFiles([photo, { ...photo, name: 'synthetic-2.png' }]);
  await expect(page.getByRole('img')).toHaveCount(2);
  await page.getByRole('button', { name: 'Upload photos', exact: true }).click();
  await expect(
    page.getByRole('progressbar', { name: 'Upload progress for photo 1' }),
  ).toBeVisible();
  release();
  await expect(page.getByRole('status').filter({ hasText: '1 of 2 photos saved.' })).toBeVisible();
  await expect(
    page.getByText('Image processing is busy. Try this photo again shortly.'),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Upload or retry unsaved photos' }).click();
  await expect(page.getByRole('status').filter({ hasText: '2 of 2 photos saved.' })).toBeVisible();
  expect(attempts[1]).toBe(attempts[2]);
  await expect(page.getByRole('link', { name: 'Back to item' })).toHaveAttribute(
    'href',
    `/items/${item}`,
  );
  await page.setViewportSize({
    width: testInfo.project.name === 'mobile' ? 360 : 1280,
    height: 900,
  });
  for (const theme of ['light', 'dark']) {
    const current = await page.locator('html').getAttribute('class');
    if (!current?.split(' ').includes(theme))
      await page.getByRole('button', { name: 'Toggle color theme' }).click();
    await expect(page.locator('html')).toHaveClass(new RegExp(theme));
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.screenshot({
      path: `../../docs/screenshots/per-13-${testInfo.project.name}-${theme}.png`,
      fullPage: true,
      animations: 'disabled',
    });
  }
});
test('removal and unsupported selection remain accessible', async ({ page }) => {
  await page.goto(`/items/${item}/photos/new`);
  await page.getByLabel('Choose from gallery or files').setInputFiles(photo);
  await page.getByRole('button', { name: 'Remove photo 1' }).click();
  await expect(page.getByRole('img')).toHaveCount(0);
  await page.getByLabel('Choose from gallery or files').setInputFiles({
    name: 'synthetic.heic',
    mimeType: 'image/heic',
    buffer: Buffer.from('synthetic unsupported'),
  });
  await expect(
    page.getByRole('alert').filter({ hasText: 'Choose JPEG, PNG or WebP' }),
  ).toContainText('HEIC/HEIF is not supported');
});
