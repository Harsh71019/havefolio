import { Parser } from 'htmlparser2';
import {
  validBarcode,
  validEnrichmentValue,
  type EnrichmentCandidate,
  type EnrichmentField,
  type EnrichmentInput,
  type EnrichmentProvider,
} from '@havefolio/domain';
import { PublicFetcher, publicUrl } from './public-fetch.js';
type ObjectValue = Record<string, unknown>;
const object = (v: unknown): ObjectValue =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as ObjectValue) : {};
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : v === undefined ? [] : [v]);
function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  let result = '',
    hidden = 0;
  const parser = new Parser(
    {
      onopentag(name) {
        if (['script', 'style'].includes(name)) hidden++;
      },
      onclosetag(name) {
        if (['script', 'style'].includes(name)) hidden = Math.max(0, hidden - 1);
      },
      ontext(part) {
        if (!hidden) result += part;
      },
    },
    { decodeEntities: true },
  );
  parser.end(value);
  return (
    result
      .replace(/[\p{Cc}\p{Cf}]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim() || undefined
  );
}
function fields(
  product: ObjectValue,
  provider: string,
  kind: 'url' | 'barcode',
  reference: string,
  base: string,
  confidence: number,
): EnrichmentCandidate['fields'] {
  const result: EnrichmentCandidate['fields'] = [];
  const add = (field: EnrichmentField, raw: unknown): void => {
    const value = text(raw);
    if (
      value &&
      validEnrichmentValue(field, value) &&
      !result.some((f) => f.field === field) &&
      result.length < 16
    )
      result.push({ field, value, confidence, source: { provider, inputKind: kind, reference } });
  };
  add('name', product.name);
  add('brand', typeof product.brand === 'string' ? product.brand : object(product.brand).name);
  add('model', product.model);
  add('description', product.description);
  const rawImage = list(product.image)[0];
  const image =
    typeof rawImage === 'string' ? rawImage : (object(rawImage).url ?? object(rawImage).contentUrl);
  if (typeof image === 'string') {
    try {
      const value = publicUrl(new URL(image, base).href).href;
      result.push({
        field: 'image',
        value,
        confidence,
        source: { provider, inputKind: kind, reference },
      });
    } catch {
      /* Unsafe suggestions are discarded before storage. */
    }
  }
  for (const property of list(product.additionalProperty).slice(0, 10)) {
    const p = object(property),
      name = text(p.name);
    if (name && /^[a-zA-Z0-9][a-zA-Z0-9 _-]{0,63}$/.test(name))
      add(
        `specification:${name}`,
        typeof p.value === 'number' && Number.isFinite(p.value) ? String(p.value) : p.value,
      );
  }
  // Offers/prices and dates are intentionally outside supported suggestions.
  return result;
}
export function extractProducts(html: string, url: string): EnrichmentCandidate[] {
  const products: ObjectValue[] = [],
    meta: Record<string, string> = Object.create(null) as Record<string, string>;
  let json = '',
    inJson = false,
    blocks = 0;
  const parser = new Parser(
    {
      onopentag(name, attributes) {
        if (name === 'script') {
          inJson = attributes.type?.toLowerCase().trim() === 'application/ld+json' && blocks++ < 12;
          json = '';
        }
        if (name === 'meta') {
          const key = attributes.property ?? attributes.name;
          if (
            key &&
            ['og:title', 'og:description', 'og:image', 'description'].includes(key) &&
            attributes.content
          )
            meta[key] = attributes.content;
        }
      },
      ontext(value) {
        if (inJson) json += value;
      },
      onclosetag(name) {
        if (name !== 'script' || !inJson) return;
        inJson = false;
        try {
          const pending: unknown[] = [JSON.parse(json)];
          for (let nodes = 0; pending.length && nodes < 200; nodes++) {
            const node = pending.shift();
            if (Array.isArray(node)) {
              pending.push(...(node as unknown[]).slice(0, 50));
              continue;
            }
            const p = object(node);
            if (
              list(p['@type']).some(
                (t) =>
                  t === 'Product' ||
                  t === 'https://schema.org/Product' ||
                  t === 'http://schema.org/Product',
              )
            ) {
              if (products.length < 5) products.push(p);
            }
            for (const key of ['@graph', 'mainEntity', 'itemListElement', 'item'])
              if (p[key]) pending.push(p[key]);
          }
        } catch {
          /* Malformed JSON-LD is not executable and does not suppress other blocks. */
        }
      },
    },
    { decodeEntities: true },
  );
  parser.end(html);
  const reference = (new URL(url).origin + new URL(url).pathname).slice(0, 512);
  if (!products.length && meta['og:title'])
    products.push({
      name: meta['og:title'],
      description: meta['og:description'] ?? meta.description,
      image: meta['og:image'],
    });
  return products
    .map((p, i) => ({
      id: `product-${i + 1}`,
      fields: fields(p, 'public-product-metadata', 'url', reference, url, 0.5),
    }))
    .filter((p) => p.fields.length > 0);
}
export class ProductLinkProvider implements EnrichmentProvider {
  readonly id = 'public-product-metadata';
  readonly kinds = ['url'] as const;
  supports(input: EnrichmentInput): boolean {
    return input.kind === 'url' && input.consent === 'public-product-metadata-v1';
  }
  constructor(private readonly fetcher = new PublicFetcher()) {}
  async suggest(input: EnrichmentInput, signal: AbortSignal): Promise<EnrichmentCandidate[]> {
    if (input.kind !== 'url' || !this.supports(input)) return [];
    const response = await this.fetcher.fetch(
      input.url,
      ['text/html', 'application/xhtml+xml'],
      512 * 1024,
      signal,
    );
    return extractProducts(response.bytes.toString('utf8'), response.url);
  }
}
let lastFoodRequest = 0;
export class FoodBarcodeProvider implements EnrichmentProvider {
  readonly id = 'open-food-facts';
  readonly kinds = ['barcode'] as const;
  supports(input: EnrichmentInput): boolean {
    return input.kind === 'barcode' && input.consent === 'open-food-facts-v1';
  }
  constructor(private readonly fetcher = new PublicFetcher()) {}
  async suggest(input: EnrichmentInput, signal: AbortSignal): Promise<EnrichmentCandidate[]> {
    if (input.kind !== 'barcode' || !this.supports(input) || !validBarcode(input.barcode))
      return [];
    // At most 30 queries/minute per process, no unbounded wait queue. Worker retries are bounded.
    if (Date.now() - lastFoodRequest < 2000) throw new Error('CATALOGUE_BUSY');
    lastFoodRequest = Date.now();
    const code = input.barcode;
    const url = `https://world.openfoodfacts.org/api/v3/product/${code}?fields=code,product_name,brands,generic_name,quantity,image_front_url`;
    const response = await this.fetcher.fetch(url, ['application/json'], 256 * 1024, signal, true);
    if (response.status === 404) return [];
    const data = object(JSON.parse(response.bytes.toString('utf8'))),
      p = object(data.product);
    // Require exact GTIN identity (padding zeros is the standard GTIN representation).
    if (
      typeof p.code !== 'string' ||
      !validBarcode(p.code) ||
      p.code.padStart(14, '0') !== code.padStart(14, '0')
    )
      return [];
    const result = fields(
      {
        name: p.product_name,
        brand: p.brands,
        description: p.generic_name,
        image: p.image_front_url,
        additionalProperty: [{ name: 'Quantity', value: p.quantity }],
      },
      this.id,
      'barcode',
      `https://world.openfoodfacts.org/product/${code}`,
      response.url,
      0.5,
    );
    return result.length ? [{ id: 'food-product', fields: result }] : [];
  }
}
