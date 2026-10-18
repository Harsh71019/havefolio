import type { HomeSummary, ItemListEntry, SpendingBucket } from '@havefolio/contracts';

/** Synthetic, removable Home data for component tests and screenshots only. */
const bucket = (fields: Partial<SpendingBucket>): SpendingBucket => ({
  currency: 'INR',
  key: null,
  dateBucket: 'dated',
  grossMinor: '0',
  refundedMinor: '0',
  netMinor: '0',
  pricedItemCount: 0,
  unknownPriceCount: 0,
  notSpendingCount: 0,
  explicitZeroCount: 0,
  knownDateCount: 0,
  unknownDateCount: 0,
  totalItemCount: 0,
  missingMerchantCount: 0,
  ...fields,
});
const recent = (n: number, name: string, isDemo = false): ItemListEntry => ({
  id: `00000000-0000-4000-a000-0000000033${String(n).padStart(2, '0')}`,
  isDemo,
  name,
  ownershipStatus: 'owned',
  currency: 'INR',
  pricePaidMinor: null,
  purchaseDate: { precision: 'unknown', year: null, month: null, day: null },
  acquisitionType: 'bought',
  condition: 'working',
  useFrequency: 'often',
  categoryId: null,
  subcategoryId: null,
  tagIds: [],
  brand: null,
  model: null,
  revision: 1,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  cover: null,
});
export const homeFixture: HomeSummary = {
  inventory: { ownedCount: 42, sampleOwnedCount: 2 },
  spending: {
    scope: 'current-owned',
    grouping: 'overall',
    basis: 'purchase-date',
    purchasedFrom: null,
    purchasedTo: null,
    buckets: [
      bucket({
        netMinor: '18450000',
        grossMinor: '19000000',
        refundedMinor: '550000',
        totalItemCount: 30,
        unknownPriceCount: 3,
      }),
      bucket({
        dateBucket: 'unknownDate',
        netMinor: '1250000',
        totalItemCount: 9,
        unknownPriceCount: 2,
      }),
      bucket({ currency: 'USD', netMinor: '12999', totalItemCount: 3 }),
    ],
  },
  recentItems: [
    recent(1, 'Cast-iron kadhai'),
    recent(2, 'Steel tiffin box'),
    recent(3, 'Cotton bedsheet set'),
    recent(4, 'Sample steel kettle', true),
  ],
  desires: {
    activeCount: 5,
    readyForReviewCount: 1,
    items: [
      {
        id: '00000000-0000-4000-a000-000000003311',
        name: 'Air fryer',
        effectiveState: 'ready_for_review',
        reviewAt: '2026-10-10T00:00:00.000Z',
      },
      {
        id: '00000000-0000-4000-a000-000000003312',
        name: 'Hiking shoes',
        effectiveState: 'waiting',
        reviewAt: '2026-11-01T00:00:00.000Z',
      },
      {
        id: '00000000-0000-4000-a000-000000003313',
        name: 'Bookshelf',
        effectiveState: 'considering',
        reviewAt: null,
      },
    ],
  },
  goals: {
    activeCount: 2,
    items: [
      {
        id: '00000000-0000-4000-a000-000000003321',
        name: 'Goa trip',
        targetMinor: '4000000',
        progressMinor: '800000',
        currency: 'INR',
        targetDate: '2027-03-31',
      },
      {
        id: '00000000-0000-4000-a000-000000003322',
        name: 'Emergency fund',
        targetMinor: '0',
        progressMinor: '250000',
        currency: 'INR',
        targetDate: null,
      },
    ],
  },
  rediscovery: {
    eligibleCount: 6,
    item: {
      id: '00000000-0000-4000-a000-000000003331',
      name: 'Yoga mat',
      condition: 'needs_repair',
      useFrequency: 'rarely',
      lastUsedAt: '2025-12-14T08:00:00.000Z',
      cover: null,
    },
  },
};
export const emptyHomeFixture: HomeSummary = {
  inventory: { ownedCount: 0, sampleOwnedCount: 0 },
  spending: { ...homeFixture.spending, buckets: [] },
  recentItems: [],
  desires: { activeCount: 0, readyForReviewCount: 0, items: [] },
  goals: { activeCount: 0, items: [] },
  rediscovery: { eligibleCount: 0, item: null },
};
