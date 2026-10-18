import type { SpendingBucket, SpendingReport } from '@havefolio/contracts';
import { formatAggregate } from './spending-presentation';

export interface CurrencySpending {
  currency: string;
  /** Known purchase dates. Unknown-date spending stays a separate disclosure, never added. */
  dated: SpendingBucket | undefined;
  unknownDate: SpendingBucket | undefined;
  unknownPriceCount: number;
}
export function spendingByCurrency(report: SpendingReport): CurrencySpending[] {
  const currencies = [...new Set(report.buckets.map((b) => b.currency))];
  return currencies.map((currency) => {
    const rows = report.buckets.filter((b) => b.currency === currency);
    return {
      currency,
      dated: rows.find((b) => b.dateBucket === 'dated'),
      unknownDate: rows.find((b) => b.dateBucket === 'unknownDate'),
      unknownPriceCount: rows.reduce((n, b) => n + b.unknownPriceCount, 0),
    };
  });
}

export interface GoalProgressView {
  /** Whole percentage for the bar, capped at 100; null when no target amount is set. */
  percent: number | null;
  text: string;
}
/** Exact BigInt arithmetic on confirmed progress; no floating-point money. */
export function goalProgress(
  progressMinor: string,
  targetMinor: string,
  currency: string,
): GoalProgressView {
  const progress = formatAggregate(progressMinor, currency);
  const target = BigInt(targetMinor);
  if (target === 0n) return { percent: null, text: `${progress} confirmed · no target amount set` };
  const ratio = (BigInt(progressMinor) * 100n) / target;
  const percent = Number(ratio > 100n ? 100n : ratio);
  return {
    percent,
    text: `${progress} of ${formatAggregate(targetMinor, currency)} confirmed (${ratio > 999n ? 'over 999' : ratio.toString()}%)`,
  };
}

export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count.toLocaleString('en-IN')} ${count === 1 ? one : many}`;
}

/** A `YYYY-MM-DD` calendar date, formatted without any timezone shift. */
export function calendarDay(day: string): string {
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${day}T00:00:00Z`));
}
