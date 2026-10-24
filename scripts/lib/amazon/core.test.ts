import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {
  amazonProduct,
  imageId,
  fullSize,
  initialImages,
  imageCandidates,
  jpegImage,
  retry,
  NetworkError,
} from './core.js';
const cdn = (id: string): string => `https://m.media-amazon.com/images/I/${id}.jpg`;
void test('canonical product URLs reject deceptive hosts and strip tracking', () => {
  assert.deepEqual(amazonProduct('https://www.amazon.in/name/dp/B07V78GMXS?ref=anything'), {
    asin: 'B07V78GMXS',
    url: 'https://www.amazon.in/dp/B07V78GMXS',
  });
  assert.equal(
    amazonProduct('https://amazon.co.uk/gp/product/b07v78gmxs/').url,
    'https://www.amazon.co.uk/dp/B07V78GMXS',
  );
  for (const input of [
    'https://amazon.in.evil.test/dp/B07V78GMXS',
    'https://evilamazon.in/dp/B07V78GMXS',
    'https://a@amazon.in/dp/B07V78GMXS',
    'file:///dp/B07V78GMXS',
    'https://amazon.in/dp/no',
    'https://amazon.in:9999/dp/B07V78GMXS',
  ])
    assert.throws(() => amazonProduct(input));
});
void test('parse initial JSON safely; use hiRes then large; no eval or video', () => {
  const script = `data={'colorImages': {'initial': ${JSON.stringify([
    { hiRes: cdn('main'), large: cdn('small') },
    { hiRes: null, large: cdn('second') },
    { hiRes: cdn('clip'), isVideo: true },
  ])}}, other=1`;
  assert.deepEqual(initialImages(script), [cdn('main'), cdn('second')]);
  assert.deepEqual(initialImages(`'colorImages': {'initial': [runMaliciousCode()]}`), []);
  assert.deepEqual(
    initialImages(
      `'colorImages': {'initial': [{"hiRes":"${cdn('x')}","caption":"] escaped \\""}]}`,
    ),
    [cdn('x')],
  );
});
void test('image fallback ranking, thumbnail size removal and dedup preserve main first', () => {
  const main = cdn('51main');
  const other = cdn('71other');
  const values = imageCandidates({
    scripts: [`"colorImages":{"initial":[{"hiRes":"${other}"},{"hiRes":"${main}"}]}`],
    hires: main,
    dynamic: JSON.stringify({ [main]: [1500, 1500] }),
    thumbnails: [
      `${cdn('71other').replace('.jpg', '._AC_US40_.jpg')}`,
      cdn('last'),
      cdn('video-sprite'),
      'https://evil.test/I/e.jpg',
    ],
  });
  assert.deepEqual(values, [main, other, cdn('last')]);
  assert.equal(fullSize(cdn('51main').replace('.jpg', '._AC_US40_.jpg')), main);
  assert.equal(imageId(cdn('51main').replace('.jpg', '._AC_SL1500_.jpg')), '51main');
  assert.equal(imageId('http://m.media-amazon.com/images/I/a.jpg'), undefined);
  assert.equal(imageId('https://m.media-amazon.com.evil.test/images/I/a.jpg'), undefined);
  assert.deepEqual(
    imageCandidates({
      scripts: [],
      hires: null,
      dynamic: JSON.stringify({ [cdn('small')]: [500, 500], [main]: [1600, 1200] }),
      thumbnails: [],
    }),
    [main, cdn('small')],
  );
  assert.deepEqual(
    imageCandidates({ scripts: [], hires: null, dynamic: 'invalid', thumbnails: [cdn('last')] }),
    [cdn('last')],
  );
});
void test('only transient network failures retry, with two backoffs', async () => {
  let attempts = 0;
  const delays: number[] = [];
  assert.equal(
    await retry(
      () => {
        attempts++;
        if (attempts < 3) throw new NetworkError('transient');
        return Promise.resolve('ok');
      },
      (ms) => {
        delays.push(ms);
        return Promise.resolve();
      },
    ),
    'ok',
  );
  assert.deepEqual(delays, [1000, 2000]);
  attempts = 0;
  await assert.rejects(
    retry(() => {
      attempts++;
      throw new Error('bad input');
    }),
  );
  assert.equal(attempts, 1);
  attempts = 0;
  await assert.rejects(
    retry(
      () => {
        attempts++;
        throw new NetworkError('offline');
      },
      () => Promise.resolve(),
    ),
  );
  assert.equal(attempts, 3);
});
void test('image validation decodes bytes, rejects small/animated/oversized images and converts PNG', async () => {
  // Deterministic noise prevents tiny compressed fixtures.
  const raw = Buffer.alloc(600 * 600 * 3);
  for (let i = 0; i < raw.length; i++) raw[i] = (i * 31 + Math.floor(i / 13) * 17) % 256;
  const bytes = await sharp(raw, { raw: { width: 600, height: 600, channels: 3 } })
    .png()
    .toBuffer();
  assert(bytes.length > 5120);
  const output = await jpegImage(bytes, 'image/png');
  assert.equal((await sharp(output).metadata()).format, 'jpeg');
  await assert.rejects(jpegImage(bytes, 'text/html'));
  await assert.rejects(jpegImage(Buffer.alloc(5120), 'image/jpeg'));
  const small = await sharp(raw.subarray(0, 300 * 300 * 3), {
    raw: { width: 300, height: 300, channels: 3 },
  })
    .png()
    .toBuffer();
  await assert.rejects(jpegImage(small, 'image/png'));
  await assert.rejects(jpegImage(Buffer.alloc(21 * 1024 * 1024), 'image/jpeg'));
  await assert.rejects(jpegImage(Buffer.alloc(6000, 1), 'image/jpeg'));
});

void test('Amazon parseJSON-wrapped galleries decode escaped quotes without eval', () => {
  const data = JSON.stringify([
    { hiRes: cdn('main'), caption: "A user's product" },
    { hiRes: null, large: cdn('second') },
  ]);
  const single = data.replaceAll('\\', '\\\\').replaceAll("'", "\\'");
  assert.deepEqual(initialImages(`'colorImages': {'initial': A.$.parseJSON('${single}')}`), [
    cdn('main'),
    cdn('second'),
  ]);
  assert.deepEqual(initialImages(`"colorImages":{"initial":JSON.parse(${JSON.stringify(data)})}`), [
    cdn('main'),
    cdn('second'),
  ]);
  assert.deepEqual(initialImages(`'colorImages': {'initial': A.$.parseJSON('bad')}`), []);
});
