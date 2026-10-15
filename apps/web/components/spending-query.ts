import type { SpendingQuery, TaxonomySnapshot } from '@havefolio/contracts';
import { isCurrencyCode, parseCalendarDay } from '@havefolio/domain';

export type InsightsQuery = SpendingQuery & {
  grouping: 'overall' | 'category' | 'subcategory' | 'year';
};
export type InsightsPatch = { [K in keyof InsightsQuery]?: InsightsQuery[K] | undefined };
const keys = [
  'scope',
  'grouping',
  'currency',
  'categoryId',
  'subcategoryId',
  'purchasedFrom',
  'purchasedTo',
] as const;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const defaultInsightsQuery: InsightsQuery = { scope: 'current-owned', grouping: 'category' };

/** URL state contains only allowlisted filters, never results. Invalid state is normalized away. */
export function readSpendingQuery(params: URLSearchParams): InsightsQuery {
  const q: InsightsQuery = { ...defaultInsightsQuery };
  for (const key of keys) {
    if (params.getAll(key).length !== 1) continue;
    const value = params.get(key)!;
    if (key === 'scope' && (value === 'current-owned' || value === 'all-history')) q.scope = value;
    if (key === 'grouping' && ['overall', 'category', 'subcategory', 'year'].includes(value))
      q.grouping = value as InsightsQuery['grouping'];
    if (key === 'currency' && isCurrencyCode(value.toUpperCase())) q.currency = value.toUpperCase();
    if ((key === 'categoryId' || key === 'subcategoryId') && uuid.test(value)) q[key] = value;
    if (key === 'purchasedFrom' || key === 'purchasedTo') {
      try {
        parseCalendarDay(value);
        q[key] = value;
      } catch {
        /* No invented calendar components. */
      }
    }
  }
  if (!q.categoryId) delete q.subcategoryId;
  if (q.purchasedFrom && q.purchasedTo && q.purchasedFrom > q.purchasedTo) {
    delete q.purchasedFrom;
    delete q.purchasedTo;
  }
  return q;
}
export function spendingQueryParams(q: SpendingQuery): URLSearchParams {
  const params = new URLSearchParams();
  for (const key of keys) if (q[key]) params.set(key, q[key]);
  return params;
}
export function changeSpendingQuery(q: InsightsQuery, patch: InsightsPatch): InsightsQuery {
  const next = { ...q, ...patch };
  if ('categoryId' in patch && patch.categoryId !== q.categoryId) delete next.subcategoryId;
  return readSpendingQuery(
    spendingQueryParams(
      Object.fromEntries(
        Object.entries(next).filter(([, v]) => v !== undefined),
      ) as unknown as InsightsQuery,
    ),
  );
}
export function reconcileSpendingTaxonomy(
  q: InsightsQuery,
  taxonomy: TaxonomySnapshot,
): InsightsQuery {
  if (
    q.subcategoryId &&
    !taxonomy.subcategories.some((s) => s.id === q.subcategoryId && s.categoryId === q.categoryId)
  ) {
    const next = { ...q };
    delete next.subcategoryId;
    return next;
  }
  return q;
}
