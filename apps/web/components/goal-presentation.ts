import type { Goal, GoalContribution, GoalStatus } from '@havefolio/contracts';
import { assertCurrency, formatMoney } from '@havefolio/domain';

/**
 * Exact display of a canonical minor-unit string in its own currency. Progress can exceed the
 * bigint range, so this deliberately bypasses `parseMinorUnits`; Intl formats the decimal string.
 */
export function goalMoney(minor: string, currency: string): string {
  if (!/^(0|[1-9][0-9]*)$/.test(minor)) throw new Error('Invalid goal amount');
  return formatMoney({ minor: BigInt(minor), currency: assertCurrency(currency) });
}

/** Floor of `part / whole` as a percentage with up to two decimals, using BigInt only. */
export function exactPercent(part: bigint, whole: bigint): string {
  const hundredths = (part * 10000n) / whole;
  const fraction = (hundredths % 100n).toString().padStart(2, '0').replace(/0+$/, '');
  return `${(hundredths / 100n).toLocaleString('en-IN')}${fraction ? `.${fraction}` : ''}`;
}

export const goalStatusLabels: Record<GoalStatus, string> = {
  active: 'Active',
  completed: 'Completed',
  archived: 'Archived',
};

export interface GoalProgressSummary {
  /** Whole percentage for the decorative bar, capped at 100; null without a target amount. */
  bar: number | null;
  /** Complete text equivalent of the bar. */
  text: string;
  /** Exact distance to the target, or how far confirmed progress exceeds it. */
  remaining: string | null;
}

/** Confirmed progress only: the effective ledger sum the API returns, never an estimate. */
export function goalProgressSummary(
  goal: Pick<Goal, 'progressMinor' | 'targetMinor' | 'currency'>,
): GoalProgressSummary {
  const progress = BigInt(goal.progressMinor);
  const target = BigInt(goal.targetMinor);
  const shown = goalMoney(goal.progressMinor, goal.currency);
  if (target === 0n)
    return { bar: null, text: `${shown} confirmed · no target amount set`, remaining: null };
  const whole = (progress * 100n) / target;
  const difference = target - progress;
  return {
    bar: Number(whole > 100n ? 100n : whole),
    text: `${shown} of ${goalMoney(goal.targetMinor, goal.currency)} confirmed (${exactPercent(progress, target)}%)`,
    remaining:
      difference > 0n
        ? `${goalMoney(difference.toString(), goal.currency)} still to go`
        : difference === 0n
          ? 'Target amount reached'
          : `Target amount reached, ${goalMoney((-difference).toString(), goal.currency)} beyond it`,
  };
}

/**
 * IDs of loaded ledger entries that no loaded entry supersedes. History is newest-first, so a
 * successor always loads before (or on the same page as) the entry it replaces.
 */
export function effectiveEntryIds(entries: readonly GoalContribution[]): Set<string> {
  const superseded = new Set(entries.flatMap((e) => (e.supersedesId ? [e.supersedesId] : [])));
  return new Set(entries.filter((e) => !superseded.has(e.id)).map((e) => e.id));
}

export const contributionKindLabels: Record<string, string> = {
  contribution: 'Contribution',
  correction: 'Correction',
  reversal: 'Reversal',
};

export type PriceComparison =
  | { kind: 'unknown' }
  | { kind: 'mismatch'; priceCurrency: string; goalCurrency: string }
  | { kind: 'zero-target' }
  | { kind: 'zero-price' }
  | {
      kind: 'percent';
      ofTarget: string;
      coversTarget: boolean;
      ofRemaining: string | null;
      remaining: string | null;
    };

/**
 * A hypothetical ratio between a want's likely price and a goal target. It never reads or
 * changes confirmed progress except to describe what is still to go, and never converts currency.
 */
export function comparePriceWithGoal(
  price: { minor: string | null; currency: string | null },
  goal: Pick<Goal, 'targetMinor' | 'progressMinor' | 'currency'>,
): PriceComparison {
  if (price.minor === null || price.currency === null) return { kind: 'unknown' };
  if (price.currency !== goal.currency)
    return { kind: 'mismatch', priceCurrency: price.currency, goalCurrency: goal.currency };
  const amount = BigInt(price.minor);
  const target = BigInt(goal.targetMinor);
  if (target === 0n) return { kind: 'zero-target' };
  if (amount === 0n) return { kind: 'zero-price' };
  const left = target - BigInt(goal.progressMinor);
  return {
    kind: 'percent',
    ofTarget: exactPercent(amount, target),
    coversTarget: amount >= target,
    ofRemaining: left > 0n ? exactPercent(amount, left) : null,
    remaining: left > 0n ? goalMoney(left.toString(), goal.currency) : null,
  };
}

/** `YYYY-MM-DD` that names a real Gregorian date between 0001 and 9999, as the API requires. */
export function isCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match || match[1] === '0000') return false;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(2000, m - 1, d));
  date.setUTCFullYear(y);
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}
