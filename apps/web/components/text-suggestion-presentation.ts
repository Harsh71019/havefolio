import type {
  EnrichmentField,
  EnrichmentReviewEvent,
  EnrichmentWork,
  ItemResponse,
} from '@havefolio/contracts';
import {
  confidenceBand,
  parseOcrReference,
  parsePricePaidValue,
  parsePurchaseDateValue,
  type OcrFlag,
} from '@havefolio/domain';
import { formatMoney, purchaseDateText } from './item-detail-presentation';

export const fieldLabels: Record<EnrichmentField, string> = {
  name: 'Name',
  brand: 'Brand',
  model: 'Model',
  description: 'Description',
  pricePaid: 'Price paid',
  purchaseDate: 'Purchase date',
};

export const bandLabels = {
  clear: 'Clearly read',
  check: 'Check this',
  unclear: 'Unclear',
} as const;

/** Plain explanations of each caveat the reader attached; shown beside the suggestion. */
export const flagText: Record<OcrFlag, string> = {
  'currency-from-receipt': 'The currency is printed elsewhere on this receipt, not on this line.',
  'line-amount': 'This is the amount on this line. It may not include tax, discounts or delivery.',
  'order-total':
    'This is the receipt total. Only one item line was found, so it may include tax or delivery.',
  'order-total-unmatched':
    'This is the receipt total. No item lines were recognised, so it may cover several things.',
  'multiple-units': 'This line may be for more than one unit.',
  'date-order-unclear':
    'The day and month could be read either way round, so only the year is suggested.',
  'month-only': 'The receipt shows only a month and year.',
  'two-digit-year': 'The year was printed with two digits.',
  'more-lines': 'The receipt has more item lines than are shown here.',
  'prominent-text': 'This is the largest text on the photo. It is often a brand or slogan.',
  labelled: 'This was printed next to a label on the photo.',
};

export function candidateTitle(id: string): string {
  const line = /^receipt-line-([0-9]+)$/.exec(id);
  if (line) return `Receipt line ${line[1]}`;
  if (id === 'receipt-summary') return 'Receipt total and date';
  if (id === 'photo-label') return 'Text on the photo';
  return 'Suggestion';
}

/** Canonical review value as the owner reads it; malformed values are shown verbatim. */
export function displayValue(field: EnrichmentField, value: string | null): string {
  if (value === null) return 'Not recorded';
  if (field === 'pricePaid') {
    const money = parsePricePaidValue(value);
    return money
      ? `${formatMoney(money.minor.toString(), money.currency)} (${money.currency})`
      : value;
  }
  if (field === 'purchaseDate') {
    const date = parsePurchaseDateValue(value);
    if (!date) return value;
    const shown = purchaseDateText({
      precision: date.precision,
      year: date.year,
      month: date.precision === 'year' ? null : date.month,
      day: date.precision === 'exact' ? date.day : null,
    });
    return shown.note ? `${shown.value} (${shown.note.toLowerCase()})` : shown.value;
  }
  return value;
}

/** The item's current value in the same canonical form the review API compares. */
export function currentValue(item: ItemResponse, field: EnrichmentField): string | null {
  if (field === 'pricePaid')
    return item.pricePaidMinor === null ? null : `${item.currency} ${item.pricePaidMinor}`;
  if (field === 'purchaseDate') {
    const { precision, year, month, day } = item.purchaseDate;
    if (precision === 'unknown' || !year) return null;
    const pad = (n: number): string => String(n).padStart(2, '0');
    if (precision === 'year') return String(year);
    if (precision === 'month' && month) return `${year}-${pad(month)}`;
    return month && day ? `${year}-${pad(month)}-${pad(day)}` : String(year);
  }
  return item[field];
}

export interface Evidence {
  band: 'clear' | 'check' | 'unclear';
  line: number | null;
  text: string | null;
  caveats: string[];
}

export function evidence(confidence: number, reference: string): Evidence {
  const parsed = parseOcrReference(reference);
  return {
    band: confidenceBand(confidence),
    line: parsed?.line ?? null,
    text: parsed?.text ?? null,
    caveats: parsed ? parsed.flags.map((flag) => flagText[flag]) : [],
  };
}

/** Latest decision per (work, candidate, field); later corrections supersede earlier ones. */
export function latestDecisions(
  events: readonly EnrichmentReviewEvent[],
): Map<string, EnrichmentReviewEvent> {
  const latest = new Map<string, EnrichmentReviewEvent>();
  for (const event of events) {
    const key = `${event.workId}|${event.candidateId}|${event.field}`;
    const seen = latest.get(key);
    if (!seen || seen.resultingRevision < event.resultingRevision) latest.set(key, event);
  }
  return latest;
}

/**
 * A suggestion set can still be applied only while the item's revision is the head of its own
 * review chain. Any other edit means its evidence may no longer match the item.
 */
export function workIsCurrent(
  work: EnrichmentWork,
  events: readonly EnrichmentReviewEvent[],
  revision: number,
): boolean {
  const head = events
    .filter((event) => event.workId === work.id)
    .reduce((max, event) => Math.max(max, event.resultingRevision), work.baseRevision);
  return head === revision;
}

export const activeStates: ReadonlySet<EnrichmentWork['state']> = new Set([
  'pending',
  'processing',
  'retry',
]);
