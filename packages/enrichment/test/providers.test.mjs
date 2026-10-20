import assert from 'node:assert/strict';
import test from 'node:test';
import { extractProducts, ProductLinkProvider, FoodBarcodeProvider } from '../dist/index.js';
import { validBarcode, validateEnrichmentCandidates } from '@havefolio/domain';
const base = 'https://shop.example.org/kettle';
test('multiple JSON-LD products remain ambiguous; hostile content, offers and unsafe images never become confirmed facts', () => {
  const html = `<script>throw new Error('must never run')</script><script type="application/ld+json">${JSON.stringify(
    {
      '@graph': [
        {
          '@type': 'Product',
          name: '<b>Kettle</b>',
          brand: { name: 'Brand &amp; Co' },
          description: '<script>private</script>Safe',
          image: 'http://127.0.0.1/private',
          offers: { price: '123.45' },
          additionalProperty: [
            { name: 'Capacity', value: '1.5 L' },
            { name: '__proto__', value: 'hostile' },
          ],
        },
        { '@type': 'Product', name: 'Other', image: '/image.jpg' },
      ],
    },
  ).replaceAll('<', '\\u003c')}</script>`;
  const results = extractProducts(html, base);
  assert.equal(results.length, 2);
  assert.equal(results[0].fields.find((f) => f.field === 'name').value, 'Kettle');
  assert.equal(results[0].fields.find((f) => f.field === 'description').value, 'Safe');
  assert.equal(
    results[0].fields.some((f) => f.field === 'image'),
    false,
  );
  assert.equal(
    results[0].fields.some((f) => f.field === 'pricePaidMinor'),
    false,
  );
  assert.equal(results[0].fields.find((f) => f.field === 'specification:Capacity').value, '1.5 L');
  assert.equal(
    results[1].fields.find((f) => f.field === 'image').value,
    'https://shop.example.org/image.jpg',
  );
  assert.deepEqual(
    validateEnrichmentCandidates(results, 'public-product-metadata', 'url'),
    results,
  );
});
test('malformed metadata uses bounded Open Graph fallback and never follows base tags or executes scripts', () => {
  const result = extractProducts(
    '<base href="http://127.0.0.1/"><script type="application/ld+json">{malformed</script><meta content="A &amp; B" property="og:title"><meta property="og:image" content="/safe.png">',
    base,
  );
  assert.equal(result[0].fields[0].value, 'A & B');
  assert.equal(result[0].fields[1].value, 'https://shop.example.org/safe.png');
  assert.deepEqual(extractProducts('<h1>No metadata</h1>', base), []);
});
test('static extraction caps candidates, fields and rejects oversized values', () => {
  const products = Array.from({ length: 20 }, () => ({
    '@type': 'Product',
    name: 'N',
    description: 'x'.repeat(5001),
    additionalProperty: Array.from({ length: 50 }, (_, i) => ({ name: `Key${i}`, value: 'v' })),
  }));
  const result = extractProducts(
    `<script type="application/ld+json">${JSON.stringify(products)}</script>`,
    base,
  );
  assert.equal(result.length, 5);
  assert.ok(
    result.every((c) => c.fields.length <= 16 && !c.fields.some((f) => f.field === 'description')),
  );
});
test('link provider uses controlled transport bounds and honours failure', async () => {
  let captured;
  const provider = new ProductLinkProvider({
    fetch: async (...args) => {
      captured = args;
      return {
        url: base,
        bytes: Buffer.from('<meta property="og:title" content="Kettle">'),
        mime: 'text/html',
      };
    },
  });
  assert.equal(
    (
      await provider.suggest(
        { kind: 'url', url: base, consent: 'public-product-metadata-v1' },
        new AbortController().signal,
      )
    )[0].fields[0].value,
    'Kettle',
  );
  assert.equal(captured[2], 512 * 1024);
  await assert.rejects(
    new ProductLinkProvider({
      fetch: async () => {
        throw new Error('secret');
      },
    }).suggest(
      { kind: 'url', url: base, consent: 'public-product-metadata-v1' },
      new AbortController().signal,
    ),
  );
});
test('GTIN check digits and food catalogue identity prevent misleading barcode matches', async () => {
  for (const code of ['96385074', '036000291452', '3017620422003', '03017620422003'])
    assert.equal(validBarcode(code), true, code);
  for (const code of ['123', 'https://example.org', '3017620422004', '3017620422003x'])
    assert.equal(validBarcode(code), false);
  let captured;
  const provider = new FoodBarcodeProvider({
    fetch: async (...args) => {
      captured = args;
      return {
        url: 'https://world.openfoodfacts.org',
        mime: 'application/json',
        bytes: Buffer.from(
          JSON.stringify({
            product: {
              code: '3017620422003',
              product_name: 'Synthetic food',
              brands: 'Synthetic',
              quantity: '100 g',
              image_front_url: 'https://images.openfoodfacts.org/a.jpg',
            },
          }),
        ),
      };
    },
  });
  assert.deepEqual(
    await provider.suggest(
      { kind: 'barcode', barcode: 'bad', consent: 'open-food-facts-v1' },
      new AbortController().signal,
    ),
    [],
  );
  const results = await provider.suggest(
    { kind: 'barcode', barcode: '3017620422003', consent: 'open-food-facts-v1' },
    new AbortController().signal,
  );
  assert.equal(results.length, 1);
  assert.equal(results[0].fields[0].source.provider, 'open-food-facts');
  assert.ok(captured[0].includes('/api/v3/product/3017620422003?fields='));
});

test('food catalogue no-match, missing identity and mismatched GTIN never become candidates', async (t) => {
  let now = Date.now() + 3000;
  t.mock.method(Date, 'now', () => (now += 3000));
  for (const response of [
    { status: 404, bytes: Buffer.from('{}') },
    { status: 200, bytes: Buffer.from('{"product":{}}') },
    {
      status: 200,
      bytes: Buffer.from('{"product":{"code":"036000291452","product_name":"Wrong item"}}'),
    },
  ]) {
    const provider = new FoodBarcodeProvider({
      fetch: async () => ({
        ...response,
        url: 'https://world.openfoodfacts.org',
        mime: 'application/json',
      }),
    });
    assert.deepEqual(
      await provider.suggest(
        { kind: 'barcode', barcode: '3017620422003', consent: 'open-food-facts-v1' },
        new AbortController().signal,
      ),
      [],
    );
  }
});

test('legacy URL and barcode requests never acquire permission to contact a new provider', async () => {
  let calls = 0;
  const fetcher = {
    fetch: async () => {
      calls++;
      throw new Error('must not fetch');
    },
  };
  for (const [provider, input] of [
    [new ProductLinkProvider(fetcher), { kind: 'url', url: base }],
    [new FoodBarcodeProvider(fetcher), { kind: 'barcode', barcode: '3017620422003' }],
  ]) {
    assert.equal(provider.supports(input), false);
    assert.deepEqual(await provider.suggest(input, new AbortController().signal), []);
  }
  assert.equal(calls, 0);
});
