import { approximateDate, type DateComponents } from './approximate-date.js';
import { currencyMinorDigits } from './currencies.js';
import { toDecimalString, type Money } from './money.js';

/** Initial display locale. Formatting never changes the stored currency or amount. */
export const defaultDisplayLocale = 'en-IN';

/**
 * Presentation-boundary currency formatting. The exact decimal string is passed to
 * `Intl.NumberFormat`, so no floating-point conversion occurs, and the value keeps its own
 * currency. Whole amounts drop trailing zero minor units (₹1,299 rather than ₹1,299.00).
 */
export function formatMoney(value: Money, locale = defaultDisplayLocale): string {
  const digits = currencyMinorDigits(value.currency);
  const whole = value.minor % 10n ** BigInt(digits) === 0n;
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: value.currency,
    minimumFractionDigits: whole ? 0 : digits,
    maximumFractionDigits: digits,
  }).format(toDecimalString(value) as `${number}`);
}

const monthNames = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

export function monthName(month: number): string {
  return monthNames[month - 1] ?? '';
}

/**
 * Shows only the recorded precision: "5 March 2024", "March 2024", "2024", or the supplied
 * unknown label. Formatted in UTC from calendar components so no timezone shifts the day.
 */
export function formatApproximateDate(
  input: DateComponents,
  options: { locale?: string; unknown?: string } = {},
): string {
  const date = approximateDate(input);
  switch (date.precision) {
    case 'unknown':
      return options.unknown ?? 'Date not recorded';
    case 'year':
      return String(date.year);
    case 'month':
      return `${monthName(date.month)} ${date.year}`;
    case 'exact': {
      const instant = new Date(0);
      instant.setUTCFullYear(date.year, date.month - 1, date.day);
      return new Intl.DateTimeFormat(options.locale ?? defaultDisplayLocale, {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
      }).format(instant);
    }
  }
}
