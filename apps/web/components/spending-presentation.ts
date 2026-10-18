import type { SpendingBucket, SpendingGrouping, TaxonomySnapshot } from '@havefolio/contracts';
import { currencyMinorDigits, isCurrencyCode } from '@havefolio/domain';

/** Unbounded aggregate formatting: never the bounded per-item Money constructor or Number. */
export function formatAggregate(minor: string, currency: string): string {
  if (!/^[0-9]+$/.test(minor) || !isCurrencyCode(currency))
    throw new Error('Invalid spending amount');
  const digits = currencyMinorDigits(currency);
  const raw = BigInt(minor)
    .toString()
    .padStart(digits + 1, '0');
  const whole = digits ? raw.slice(0, -digits) : raw;
  // Intl formats only the BigInt integral part. The fractional digits remain exact strings.
  const grouped = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(
    BigInt(whole),
  );
  return `${currency} ${grouped}${digits ? '.' + raw.slice(-digits) : ''}`;
}
export const scopeNames = {
  'current-owned': 'Currently owned',
  'all-history': 'All recorded history',
} as const;
export const dateNames = {
  dated: 'Dated purchases',
  spanningRange: 'Overlapping the selected range',
  unknownDate: 'Purchase date unknown',
} as const;
export const dateDescriptions = {
  dated:
    'Known purchase dates contained in the selected range, or all known dates when no range is selected.',
  spanningRange:
    'These month- or year-only dates overlap the range. They are separate disclosures, not part of the dated amount.',
  unknownDate:
    'These records have no purchase date. They are separate disclosures, not part of any selected-period amount.',
} as const;
export function spendingGroupName(
  b: SpendingBucket,
  grouping: SpendingGrouping,
  taxonomy?: TaxonomySnapshot,
): string {
  if (grouping === 'overall') return 'All records';
  if (grouping === 'year' || grouping === 'month') return b.key ?? 'Date unknown';
  if (grouping === 'merchant') {
    if (b.merchant) {
      return `${b.merchant.displayName}${b.merchant.state === 'retired' ? ' (retired)' : ''}`;
    }
    if (!b.key) return 'Not recorded';
    return 'Merchant unavailable';
  }
  if (!b.key) return grouping === 'category' ? 'Unassigned category' : 'Unassigned subcategory';
  const entry = (grouping === 'category' ? taxonomy?.categories : taxonomy?.subcategories)?.find(
    (row) => row.id === b.key,
  );
  if (!entry)
    return grouping === 'category' ? 'Category name unavailable' : 'Subcategory name unavailable';
  const parentRetired =
    grouping === 'subcategory' &&
    taxonomy?.categories.some(
      (c) => c.id === (entry as { categoryId?: string }).categoryId && c.retiredAt,
    );
  return `${entry.name}${entry.retiredAt || parentRetired ? ' (retired)' : ''}`;
}
