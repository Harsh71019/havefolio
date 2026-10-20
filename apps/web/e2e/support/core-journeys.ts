import type { Page, Route } from '@playwright/test';
import type {
  Desire,
  DesireAllocationState,
  DesireConversionState,
  Goal,
  GoalContribution,
  ItemResponse,
  OnboardingStatus,
  SettingsOverview,
  SpendingBucket,
  TaxonomySnapshot,
} from '@havefolio/contracts';
import { homeFixture } from '../../test/home-fixture';

// PER-36: synthetic, removable fixtures for cross-journey accessibility/responsive sweeps.
// No owner data, credentials or provider identifiers. Business rules stay in API integration tests.
export const id = (n: number): string => `00000000-0000-4000-a036-${String(n).padStart(12, '0')}`;
export const itemId = id(1);
export const desireId = id(2);
export const goalId = id(3);
const kitchen = id(10);
const appliances = id(11);
const daily = id(12);
const at = '2026-10-01T05:30:00.000Z';

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="100%" height="100%" fill="#7c9a92"/></svg>`;

export const taxonomy: TaxonomySnapshot = {
  categories: [
    { id: kitchen, name: 'Kitchen', position: 0, isDemo: false, retiredAt: null, itemCount: 2 },
  ],
  subcategories: [
    {
      id: appliances,
      categoryId: kitchen,
      name: 'Appliances',
      position: 0,
      isDemo: false,
      retiredAt: null,
      itemCount: 2,
    },
  ],
  tags: [{ id: daily, name: 'Daily use', itemCount: 1 }],
  defaultsSeeded: true,
};
export const item: ItemResponse = {
  isDemo: false,
  id: itemId,
  name: 'Synthetic electric kettle',
  ownershipStatus: 'owned',
  currency: 'INR',
  pricePaidMinor: '249900',
  purchaseDate: { precision: 'month', year: 2024, month: 3, day: null },
  acquisitionType: 'bought',
  condition: 'working',
  useFrequency: 'often',
  categoryId: kitchen,
  subcategoryId: appliances,
  tagIds: [daily],
  brand: 'Synthetic brand',
  model: 'S-1',
  description: 'Steel body, 1.5 litre.',
  notes: 'Synthetic private note.',
  specifications: { Capacity: '1.5 L' },
  revision: 2,
  createdAt: at,
  updatedAt: at,
  originalEntry: { name: 'Synthetic electric kettle' },
  originalSource: 'manual',
};
export const desire: Desire = {
  id: desireId,
  name: 'Synthetic headphones',
  classification: 'want',
  likelyPriceMinor: '800000',
  currency: 'INR',
  productUrl: 'https://shop.example.test/headphones',
  reason: 'Quieter commute.',
  status: 'waiting',
  effectiveState: 'ready_for_review',
  waitingStartedAt: '2026-09-01T00:00:00.000Z',
  reviewAt: '2026-10-01T00:00:00.000Z',
  photo: null,
  revision: 2,
  createdAt: at,
  updatedAt: at,
};
export const goal: Goal = {
  id: goalId,
  name: 'Synthetic trip',
  targetMinor: '4000000',
  currency: 'INR',
  targetDate: '2027-03-01',
  notes: 'Synthetic note',
  status: 'active',
  revision: 3,
  progressMinor: '1000000',
  createdAt: at,
  updatedAt: at,
};
const contribution: GoalContribution = {
  id: id(30),
  sequence: 1,
  kind: 'contribution',
  amountMinor: '1000000',
  currency: 'INR',
  supersedesId: null,
  note: null,
  createdAt: at,
};
const onboarding: OnboardingStatus = {
  state: 'completed',
  genuineItemCount: 2,
  demoItemCount: 0,
  browsedStore: true,
  reviewedItem: true,
  triedDemo: false,
  removedDemo: false,
};
const settings: SettingsOverview = {
  preferences: {
    defaultCurrency: 'INR',
    notifyInApp: true,
    notifyNtfy: false,
    revision: 1,
    updatedAt: at,
  },
  sessions: [
    { id: id(40), createdAt: at, lastUsedAt: at, idleExpiresAt: at, isCurrent: true },
    { id: id(41), createdAt: at, lastUsedAt: at, idleExpiresAt: at, isCurrent: false },
  ],
  privacy: {
    storageType: 'authenticated_cloudinary',
    storageDescription: 'Synthetic private storage description.',
    accessType: 'authenticated_proxy',
    accessDescription: 'Synthetic authenticated access description.',
    publicSharing: false,
    sharingDescription: 'Synthetic no-sharing description.',
    registrationLock: { locked: true, reason: 'Synthetic single-owner lock.' },
  },
  demoStatus: { demoItemCount: 0, genuineItemCount: 2, triedDemo: false, removedDemo: false },
};
const bucket = (patch: Partial<SpendingBucket> = {}): SpendingBucket => ({
  currency: 'INR',
  key: null,
  dateBucket: 'dated',
  grossMinor: '275000',
  refundedMinor: '25000',
  netMinor: '250000',
  totalItemCount: 3,
  pricedItemCount: 2,
  unknownPriceCount: 1,
  notSpendingCount: 0,
  explicitZeroCount: 0,
  knownDateCount: 3,
  unknownDateCount: 0,
  missingMerchantCount: 0,
  ...patch,
});
const allocation: DesireAllocationState = {
  currentReviewEventId: id(50),
  estimatedNotSpentMinor: '800000',
  currency: 'INR',
  allocation: null,
};
const conversion: DesireConversionState = {
  desireId,
  eligibility: 'eligible',
  boughtEventId: id(51),
  suggestions: {
    name: desire.name,
    notes: null,
    productUrl: desire.productUrl,
    photo: null,
    likelyPriceMinor: desire.likelyPriceMinor,
    likelyCurrency: 'INR',
  },
  conversion: null,
};
const listEntry = { ...item, cover: null };

export type JourneyOptions = {
  /** Every API request fails at the network layer, as when offline. */
  offline?: boolean;
  /** Every API request returns this status with a neutral error code. */
  status?: number;
  /** Collections and summaries are empty. */
  empty?: boolean;
  /** Paths answered with 404 by the generic fallback; reported by the sweep. */
  unhandled?: string[];
};

function body(path: string, search: URLSearchParams, empty: boolean): unknown {
  const items = `/api/v1/items/${itemId}`;
  const want = `/api/v1/desires/${desireId}`;
  const goalPath = `/api/v1/goals/${goalId}`;
  switch (path) {
    case '/api/v1/auth/me':
      return { id: 'synthetic-owner', email: 'owner@example.test', displayName: 'Owner' };
    case '/api/v1/onboarding':
      return empty ? { ...onboarding, state: 'not_started', genuineItemCount: 0 } : onboarding;
    case '/api/v1/home':
      return empty
        ? {
            inventory: { ownedCount: 0, sampleOwnedCount: 0 },
            spending: { ...homeFixture.spending, buckets: [] },
            recentItems: [],
            desires: { activeCount: 0, readyForReviewCount: 0, items: [] },
            goals: { activeCount: 0, items: [] },
            rediscovery: { eligibleCount: 0, item: null },
          }
        : homeFixture;
    case '/api/v1/taxonomy':
      return empty
        ? { categories: [], subcategories: [], tags: [], defaultsSeeded: true }
        : taxonomy;
    case '/api/v1/items':
      return { items: empty ? [] : [listEntry], nextCursor: null, hasMore: false };
    case '/api/v1/items/facets':
      return {
        total: empty ? 0 : 1,
        ownershipStatus: empty ? [] : [{ value: listEntry.ownershipStatus, count: 1 }],
        useFrequency: empty ? [] : [{ value: listEntry.useFrequency, count: 1 }],
        categories: empty ? [] : [{ value: listEntry.categoryId, count: 1 }],
        subcategories: [],
        brands: empty || !listEntry.brand ? [] : [{ value: listEntry.brand, count: 1 }],
        brandsTruncated: false,
        prices:
          empty || listEntry.pricePaidMinor === null
            ? []
            : [
                {
                  currency: listEntry.currency,
                  minMinor: listEntry.pricePaidMinor,
                  maxMinor: listEntry.pricePaidMinor,
                  count: 1,
                },
              ],
      };
    case items:
      return item;
    case `${items}/history`:
      return {
        events: [
          {
            id: id(60),
            eventType: 'created',
            occurredAt: at,
            createdAt: at,
            metadata: { source: 'user', revision: 1, ownershipStatus: 'owned' },
          },
        ],
        nextCursor: null,
        hasMore: false,
      };
    case `${items}/photos`:
      return {
        revision: item.revision,
        photos: empty
          ? []
          : [
              {
                id: id(70),
                position: 0,
                cover: true,
                width: 800,
                height: 600,
                byteSize: 1000,
                mimeType: 'image/webp',
                altText: 'Synthetic kettle on a counter',
                decorative: false,
              },
            ],
      };
    case `${items}/documents`:
      return { revision: item.revision, documents: [] };
    case `${items}/refunds`:
      return {
        revision: item.revision,
        ownershipStatus: 'owned',
        acquisitionType: 'bought',
        totals: {
          currency: 'INR',
          amountPaidMinor: item.pricePaidMinor,
          refundedMinor: '0',
          netMinor: item.pricePaidMinor,
        },
        refunds: [],
      };
    case '/api/v1/merchants':
      return { merchants: [], nextCursor: null, hasMore: false };
    case '/api/v1/spending':
      return {
        scope: search.get('scope') ?? 'current-owned',
        grouping: search.get('grouping') ?? 'overall',
        basis: 'purchase-date',
        purchasedFrom: null,
        purchasedTo: null,
        buckets: empty ? [] : [bucket()],
      };
    case '/api/v1/spending/merchants':
      return {
        scope: 'all-history',
        rows: empty
          ? []
          : [
              {
                currency: 'INR',
                merchant: null,
                grossMinor: '10000',
                refundedMinor: '0',
                netMinor: '10000',
                pricedItemCount: 1,
                unknownPriceCount: 0,
                totalItemCount: 1,
              },
            ],
      };
    case '/api/v1/desires':
      return { items: empty ? [] : [desire], nextCursor: null, hasMore: false };
    case want:
      return desire;
    case `${want}/matches`:
      return { items: [], nextCursor: null, hasMore: false, totalCount: 0 };
    case `${want}/matches/suggestions`:
      return { items: [], nextCursor: null, hasMore: false, totalCount: 0 };
    case `${want}/matches/candidates`:
      return { items: [], nextCursor: null, hasMore: false };
    case `${want}/reviews`:
      return {
        items: [],
        nextBefore: null,
        currentEventId: null,
        estimatedNotSpentMinor: null,
        currency: null,
      };
    case `${want}/allocation`:
      return allocation;
    case `${want}/allocation/history`:
      return { items: [], nextBefore: null };
    case `${want}/conversion`:
      return conversion;
    case '/api/v1/goals':
      return { items: empty ? [] : [goal], nextAfter: null };
    case goalPath:
      return goal;
    case `${goalPath}/contributions`:
      return { items: [contribution], nextBefore: null };
    case '/api/v1/settings':
      return settings;
    case '/api/v1/settings/preferences':
      return settings.preferences;
    default:
      return undefined;
  }
}

/** Routes every `/api/v1` read to synthetic data, or to the requested failure mode. */
export async function mockCoreJourneys(page: Page, options: JourneyOptions = {}): Promise<void> {
  await page.route('**/api/v1/**', async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (options.offline) return route.abort('internetdisconnected');
    if (/\/(content|thumbnail|display)(\/|$)/.test(url.pathname))
      return route.fulfill({ contentType: 'image/svg+xml', body: svg });
    if (url.pathname !== '/api/v1/auth/me' && options.status)
      return route.fulfill({ status: options.status, json: { message: 'SYNTHETIC_FAILURE' } });
    const json = body(url.pathname, url.searchParams, Boolean(options.empty));
    if (url.pathname === '/api/v1/onboarding/actions') return route.fulfill({ json: onboarding });
    if (json === undefined || request.method() !== 'GET') {
      options.unhandled?.push(`${request.method()} ${url.pathname}`);
      return route.fulfill({ status: 404, json: { message: 'NOT_FOUND' } });
    }
    return route.fulfill({ json, headers: { 'Cache-Control': 'no-store' } });
  });
}

/** Every implemented owner journey reachable by URL. PER-35 export/deletion screens do not exist yet. */
export const coreRoutes = [
  ['home', '/'],
  ['store', '/store'],
  ['item-new', '/items/new'],
  ['item-detail', `/items/${itemId}`],
  ['item-photos', `/items/${itemId}/photos`],
  ['item-photos-new', `/items/${itemId}/photos/new`],
  ['insights', '/insights'],
  ['wants', '/wants'],
  ['want-new', '/wants/new'],
  ['want-edit', `/wants/${desireId}/edit`],
  ['want-matches', `/wants/${desireId}/matches`],
  ['want-compare', `/wants/${desireId}/compare`],
  ['want-history', `/wants/${desireId}/history`],
  ['want-allocate', `/wants/${desireId}/allocate`],
  ['want-convert', `/wants/${desireId}/convert`],
  ['want-goals', `/wants/${desireId}/goals`],
  ['goals', '/goals'],
  ['goal-new', '/goals/new'],
  ['goal-detail', `/goals/${goalId}`],
  ['goal-edit', `/goals/${goalId}/edit`],
  ['settings', '/settings'],
  ['taxonomy', '/settings/taxonomy'],
] as const;
