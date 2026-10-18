import type { Money } from './money.js';

/** Hypothetical comparison only. Integer arithmetic, rounded down to two decimal places. */
export function estimatedGoalPercentage(estimate: Money | null, target: Money): string | null {
  if (estimate === null || estimate.currency !== target.currency || target.minor === 0n)
    return null;
  const hundredths = (estimate.minor * 10000n) / target.minor;
  const fractional = (hundredths % 100n).toString().padStart(2, '0').replace(/0+$/, '');
  return `${hundredths / 100n}${fractional ? `.${fractional}` : ''}`;
}
