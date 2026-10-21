import type { Page, Route } from '@playwright/test';
import type {
  Desire,
  Goal,
  HomeSummary,
  ItemListEntry,
  ItemResponse,
  Merchant,
  SpendingBucket,
  TaxonomySnapshot,
} from '@havefolio/contracts';
import {
  desire,
  goal,
  id,
  item,
  itemId,
  desireId,
  goalId,
  taxonomy,
} from '../support/core-journeys';
import { homeFixture } from '../../test/home-fixture';

// PER-91: synthetic, removable adversarial content layered over the PER-36 core-journey mocks.
// Long unbroken names, long URLs, the largest plausible amounts and missing media. No owner data.

/** One unbroken token: no spaces or hyphens for the browser to break on. */
export const longWord = 'Ultrawidestainlesssteelinsulatedpressurecookerwithreplaceablegasket';
/** A realistic long name that does contain spaces. */
export const longName =
  'Extra-large stainless steel pressure cooker with replaceable gasket, glass lid, steamer insert and induction base (family size)';
export const longName2 = `${longWord} ${longWord}`;
export const longUrl = `https://shop.example.test/products/${longWord.toLowerCase()}/variants/${'a1b2c3d4'.repeat(
  12,
)}?utm_source=synthetic&ref=${'z'.repeat(60)}`;
export const longHost = `${'very-long-merchant-subdomain-'.repeat(3)}example.test`;
/** ₹99,99,99,99,99,999.99 — far above any real purchase, still within 15 significant digits. */
export const hugeMinor = '999999999999999';

const longMerchant: Merchant = {
  id: id(90),
  displayName: `${longWord} Superstore and Home Appliances Outlet`,
  websiteHost: longHost,
  state: 'active',
  createdAt: item.createdAt,
  updatedAt: item.updatedAt,
};
const merchantSummary = {
  id: longMerchant.id,
  displayName: longMerchant.displayName,
  websiteHost: longMerchant.websiteHost,
  state: longMerchant.state,
};

const longTaxonomy: TaxonomySnapshot = {
  ...taxonomy,
  categories: taxonomy.categories.map((c) => ({ ...c, name: `Kitchen ${longWord}` })),
  subcategories: taxonomy.subcategories.map((s) => ({ ...s, name: `Appliances ${longWord}` })),
  tags: taxonomy.tags.map((t) => ({ ...t, name: `Daily ${longWord}` })),
};

const longItem: ItemResponse = {
  ...item,
  name: longName2,
  pricePaidMinor: hugeMinor,
  brand: `${longWord} Brand`,
  model: `MODEL-${'X9'.repeat(30)}`,
  description: `${longName} ${longWord}`,
  notes: `${longUrl}\n${longWord}`,
  specifications: { [`Capacity ${longWord}`]: `${longWord} litres`, Link: longUrl },
  merchantId: longMerchant.id,
  merchant: longMerchant,
  purchaseUrl: longUrl,
  originalEntry: { name: longName2 },
};
const cover = { photoId: id(70), width: 800, height: 600, altText: longName, decorative: false };
const entry = (n: number, patch: Partial<ItemListEntry> = {}): ItemListEntry => ({
  ...longItem,
  id: n === 1 ? itemId : id(100 + n),
  name: n % 2 ? longName2 : longName,
  cover,
  ...patch,
});
const listEntries: ItemListEntry[] = [
  entry(1),
  entry(2, { cover: null, pricePaidMinor: null }),
  entry(3, { currency: 'USD', pricePaidMinor: '99999999999' }),
  entry(4),
];

const longDesire: Desire = {
  ...desire,
  name: longName2,
  likelyPriceMinor: hugeMinor,
  productUrl: longUrl,
  reason: `${longName} ${longWord} ${longUrl}`,
};
const longGoal: Goal = {
  ...goal,
  name: longName2,
  targetMinor: hugeMinor,
  progressMinor: '99999999999999',
  notes: `${longWord} ${longUrl}`,
};
const bucket = (patch: Partial<SpendingBucket> = {}): SpendingBucket => ({
  currency: 'INR',
  key: null,
  dateBucket: 'dated',
  grossMinor: hugeMinor,
  refundedMinor: '99999999999',
  netMinor: '999899999999999',
  totalItemCount: 123456,
  pricedItemCount: 123000,
  unknownPriceCount: 456,
  notSpendingCount: 12,
  explicitZeroCount: 3,
  knownDateCount: 123000,
  unknownDateCount: 456,
  missingMerchantCount: 789,
  ...patch,
});
const home: HomeSummary = {
  ...homeFixture,
  inventory: { ownedCount: 123456, sampleOwnedCount: 2 },
  spending: {
    ...homeFixture.spending,
    buckets: [
      bucket(),
      bucket({ dateBucket: 'unknownDate', netMinor: hugeMinor }),
      bucket({ currency: 'USD', netMinor: '99999999999' }),
    ],
  },
  recentItems: listEntries,
  desires: {
    ...homeFixture.desires,
    items: homeFixture.desires.items.map((d) => ({ ...d, name: longName2 })),
  },
  goals: {
    ...homeFixture.goals,
    items: homeFixture.goals.items.map((g) => ({
      ...g,
      name: longName2,
      targetMinor: hugeMinor,
      progressMinor: '99999999999999',
    })),
  },
  rediscovery: {
    eligibleCount: 6,
    item: { ...homeFixture.rediscovery.item!, name: longName2, cover },
  },
};

function body(path: string, search: URLSearchParams): unknown {
  const items = `/api/v1/items/${itemId}`;
  switch (path) {
    case '/api/v1/home':
      return home;
    case '/api/v1/taxonomy':
      return longTaxonomy;
    case '/api/v1/items':
      return { items: listEntries, nextCursor: null, hasMore: false };
    case '/api/v1/items/facets':
      return {
        total: listEntries.length,
        ownershipStatus: [{ value: 'owned', count: 4 }],
        useFrequency: [{ value: 'often', count: 4 }],
        categories: [{ value: longTaxonomy.categories[0]!.id, count: 4 }],
        subcategories: [{ value: longTaxonomy.subcategories[0]!.id, count: 4 }],
        brands: [
          { value: `${longWord} Brand`, count: 3 },
          { value: longName, count: 1 },
        ],
        brandsTruncated: false,
        prices: [
          { currency: 'INR', minMinor: '100', maxMinor: hugeMinor, count: 3 },
          { currency: 'USD', minMinor: '99999999999', maxMinor: '99999999999', count: 1 },
        ],
      };
    case items:
      return longItem;
    case `${items}/refunds`:
      return {
        revision: longItem.revision,
        ownershipStatus: 'owned',
        acquisitionType: 'bought',
        totals: {
          currency: 'INR',
          amountPaidMinor: hugeMinor,
          refundedMinor: '99999999999',
          netMinor: '999899999999999',
        },
        refunds: [],
      };
    case '/api/v1/merchants':
      return { merchants: [longMerchant], nextCursor: null, hasMore: false };
    case '/api/v1/spending':
      return {
        scope: search.get('scope') ?? 'current-owned',
        grouping: search.get('grouping') ?? 'overall',
        basis: 'purchase-date',
        purchasedFrom: null,
        purchasedTo: null,
        buckets:
          search.get('grouping') === 'category'
            ? [bucket({ key: longTaxonomy.categories[0]!.id })]
            : [bucket(), bucket({ currency: 'USD', netMinor: '99999999999' })],
      };
    case '/api/v1/spending/merchants':
      return {
        scope: 'all-history',
        rows: [
          {
            currency: 'INR',
            merchant: merchantSummary,
            grossMinor: hugeMinor,
            refundedMinor: '99999999999',
            netMinor: '999899999999999',
            pricedItemCount: 123000,
            unknownPriceCount: 456,
            totalItemCount: 123456,
          },
        ],
      };
    case '/api/v1/desires':
      return { items: [longDesire], nextCursor: null, hasMore: false };
    case `/api/v1/desires/${desireId}`:
      return longDesire;
    case '/api/v1/goals':
      return { items: [longGoal], nextAfter: null };
    case `/api/v1/goals/${goalId}`:
      return longGoal;
    default:
      return undefined;
  }
}

/**
 * Registers after {@link mockCoreJourneys} so it wins for the paths it knows and falls back to the
 * core mocks for everything else. With `missingMedia`, private media requests return 404 so the
 * accessible fallbacks render instead of images.
 */
export async function mockAdversarialContent(
  page: Page,
  { missingMedia = false }: { missingMedia?: boolean } = {},
): Promise<void> {
  await page.route('**/api/v1/**', async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (missingMedia && /\/(content|thumbnail|display)(\/|$)/.test(url.pathname))
      return route.fulfill({ status: 404, json: { message: 'NOT_FOUND' } });
    const json = request.method() === 'GET' ? body(url.pathname, url.searchParams) : undefined;
    if (json === undefined) return route.fallback();
    return route.fulfill({ json, headers: { 'Cache-Control': 'no-store' } });
  });
}
