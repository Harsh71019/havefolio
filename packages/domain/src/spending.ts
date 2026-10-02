import {
  approximateDate,
  relationToRange,
  type DateComponents,
  type DayRange,
} from './approximate-date.js';
import { assertCurrency } from './money.js';
import {
  acquisitionSpending,
  refundTotals,
  type AcquisitionType,
  type OwnershipStatus,
  type RecordedRefund,
} from './refunds.js';

/**
 * PER-20 calculation contract. These are the reference rules an aggregation query must match;
 * this module performs no I/O and is not itself the aggregation endpoint.
 *
 * - Gross recorded amount paid: the immutable purchase amount, in its original currency.
 * - Confirmed refunded amount: the sum of explicit refund records (never inferred from status).
 * - Net recorded spend: gross minus refunded; an invariant violation throws instead of going
 *   negative.
 * - Unknown prices are excluded from money totals and counted; gifts with nothing paid are
 *   counted separately as not spending.
 * - Currencies are never summed together or converted.
 * - `current_owned` includes only items currently owned; `all_history` includes every
 *   ownership status, because selling or returning an item does not erase what was paid.
 * - Purchase date (never record-created time) places spending in time. Unknown dates, and
 *   partial dates that straddle a range bound, are reported in their own buckets.
 */
export type SpendingScope = 'current_owned' | 'all_history';

export function inSpendingScope(status: OwnershipStatus, scope: SpendingScope): boolean {
  return scope === 'all_history' || status === 'owned';
}

export interface SpendingItemInput {
  currency: string;
  pricePaidMinor: string | null;
  acquisitionType: AcquisitionType;
  ownershipStatus: OwnershipStatus;
  purchaseDate: DateComponents;
  refunds: readonly RecordedRefund[];
}

export type ItemSpending =
  | {
      kind: 'priced';
      currency: string;
      grossMinor: bigint;
      refundedMinor: bigint;
      netMinor: bigint;
    }
  | { kind: 'unknown_price'; currency: string }
  | { kind: 'not_spending'; currency: string };

export function itemSpending(input: SpendingItemInput): ItemSpending {
  const currency = assertCurrency(input.currency);
  // Validates refund currency, positivity and the never-exceeds-paid invariant.
  const totals = refundTotals(input, input.refunds);
  const kind = acquisitionSpending(input.acquisitionType, input.pricePaidMinor);
  if (kind !== 'priced') return { kind, currency };
  // A recorded price always yields paid and net totals.
  if (!totals.paid || !totals.net) return { kind: 'unknown_price', currency };
  return {
    kind,
    currency,
    grossMinor: totals.paid.minor,
    refundedMinor: totals.refunded.minor,
    netMinor: totals.net.minor,
  };
}

/** One currency's totals. Amounts are minor-unit decimal strings, exact beyond 2^53. */
export interface CurrencySpending {
  currency: string;
  grossMinor: string;
  refundedMinor: string;
  netMinor: string;
  pricedItemCount: number;
  unknownPriceCount: number;
  notSpendingCount: number;
}

export interface SpendingSummary {
  scope: SpendingScope;
  /** Purchase dates entirely inside the range (or every known date when no range is given). */
  dated: CurrencySpending[];
  /** Month/year-only purchases that may or may not fall inside the range. */
  spanningRange: CurrencySpending[];
  /** No purchase date recorded. */
  unknownDate: CurrencySpending[];
}

interface Accumulator {
  gross: bigint;
  refunded: bigint;
  net: bigint;
  priced: number;
  unknown: number;
  notSpending: number;
}

function add(bucket: Map<string, Accumulator>, spending: ItemSpending): void {
  const totals = bucket.get(spending.currency) ?? {
    gross: 0n,
    refunded: 0n,
    net: 0n,
    priced: 0,
    unknown: 0,
    notSpending: 0,
  };
  if (spending.kind === 'priced') {
    totals.gross += spending.grossMinor;
    totals.refunded += spending.refundedMinor;
    totals.net += spending.netMinor;
    totals.priced += 1;
  } else if (spending.kind === 'unknown_price') totals.unknown += 1;
  else totals.notSpending += 1;
  bucket.set(spending.currency, totals);
}

function report(bucket: Map<string, Accumulator>): CurrencySpending[] {
  return [...bucket.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([currency, t]) => ({
      currency,
      grossMinor: t.gross.toString(),
      refundedMinor: t.refunded.toString(),
      netMinor: t.net.toString(),
      pricedItemCount: t.priced,
      unknownPriceCount: t.unknown,
      notSpendingCount: t.notSpending,
    }));
}

export function summarizeSpending(
  items: readonly SpendingItemInput[],
  options: { scope: SpendingScope; range?: DayRange | undefined },
): SpendingSummary {
  const dated = new Map<string, Accumulator>();
  const spanning = new Map<string, Accumulator>();
  const unknown = new Map<string, Accumulator>();
  for (const item of items) {
    if (!inSpendingScope(item.ownershipStatus, options.scope)) continue;
    const relation = relationToRange(approximateDate(item.purchaseDate), options.range ?? {});
    if (relation === 'outside') continue;
    const bucket = relation === 'unknown' ? unknown : relation === 'overlaps' ? spanning : dated;
    add(bucket, itemSpending(item));
  }
  return {
    scope: options.scope,
    dated: report(dated),
    spanningRange: report(spanning),
    unknownDate: report(unknown),
  };
}
