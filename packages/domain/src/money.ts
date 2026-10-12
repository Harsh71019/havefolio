import { currencyMinorDigits, isCurrencyCode, type CurrencyCode } from './currencies.js';
import { fail } from './errors.js';

/** PostgreSQL bigint maximum: the largest storable amount in minor units. */
export const MAX_MINOR_UNITS = 9223372036854775807n;

/**
 * An exact, non-negative amount in integer minor units with an explicit ISO 4217 currency.
 * Unknown money is represented by `null` at the call site, never by zero.
 */
export interface Money {
  readonly currency: CurrencyCode;
  readonly minor: bigint;
}

/** JSON/OpenAPI wire form shared with existing item fields: decimal string minor units. */
export const minorUnitsPattern = /^(0|[1-9][0-9]{0,18})$/;

export function assertCurrency(currency: unknown): CurrencyCode {
  return isCurrencyCode(currency) ? currency : fail('INVALID_CURRENCY');
}

export function money(minor: bigint, currency: string): Money {
  const code = assertCurrency(currency);
  if (typeof minor !== 'bigint') return fail('INVALID_MONEY_AMOUNT');
  if (minor < 0n) return fail('INVALID_MONEY_AMOUNT');
  if (minor > MAX_MINOR_UNITS) return fail('UNSAFE_MONEY_VALUE');
  return Object.freeze({ currency: code, minor });
}

/**
 * Parses the wire form ("0", "129900") to an exact bigint within storage bounds. Numbers are
 * rejected because JSON numbers above 2^53 have already lost precision before they reach us.
 */
export function parseMinorUnitAmount(value: unknown): bigint {
  if (typeof value !== 'string') return fail('INVALID_MONEY_AMOUNT');
  if (/^[0-9]{20,}$/.test(value)) return fail('UNSAFE_MONEY_VALUE');
  if (!minorUnitsPattern.test(value)) return fail('INVALID_MONEY_AMOUNT');
  const minor = BigInt(value);
  return minor > MAX_MINOR_UNITS ? fail('UNSAFE_MONEY_VALUE') : minor;
}

export function parseMinorUnits(value: unknown, currency: string): Money {
  return money(parseMinorUnitAmount(value), currency);
}

/** `null`/`undefined` stay unknown; "0" is an explicit zero. */
export function parseOptionalMinorUnits(
  value: string | null | undefined,
  currency: string,
): Money | null {
  return value == null ? null : parseMinorUnits(value, currency);
}

// Plain digits, or consistent western (1,234,567) or Indian (12,34,567) grouping.
const integerPart = /^(?:[0-9]+|[0-9]{1,3}(?:,[0-9]{3})+|[0-9]{1,2}(?:,[0-9]{2})*,[0-9]{3})$/;

/**
 * Converts a user-entered decimal ("1,299.50") to exact minor units using string arithmetic.
 * Malformed input and digits beyond the currency's precision are rejected, never rounded.
 */
export function parseDecimalAmount(input: string, currency: string): Money {
  const code = assertCurrency(currency);
  if (typeof input !== 'string') return fail('INVALID_MONEY_AMOUNT');
  const trimmed = input.trim();
  const match = /^([0-9,]+)(?:\.([0-9]+))?$/.exec(trimmed);
  if (!match || !integerPart.test(match[1]!)) return fail('INVALID_MONEY_AMOUNT');
  const digits = currencyMinorDigits(code);
  const fraction = match[2] ?? '';
  // Trailing zeros beyond the currency precision change nothing; any other digit would round.
  const significant = fraction.replace(/0+$/, '');
  if (significant.length > digits) return fail('MONEY_PRECISION_EXCEEDED');
  const combined = (match[1]!.replace(/,/g, '') + significant.padEnd(digits, '0')).replace(
    /^0+(?=[0-9])/,
    '',
  );
  if (combined.length > 19) return fail('UNSAFE_MONEY_VALUE');
  return money(BigInt(combined), code);
}

export function toMinorUnitsString(value: Money): string {
  return value.minor.toString();
}

/** Exact plain decimal ("1299.50", "0.000" for KWD zero, "1500" for JPY). No grouping. */
export function toDecimalString(value: Money): string {
  const digits = currencyMinorDigits(value.currency);
  const raw = value.minor.toString();
  if (digits === 0) return raw;
  const padded = raw.padStart(digits + 1, '0');
  return `${padded.slice(0, -digits)}.${padded.slice(-digits)}`;
}

export function isZero(value: Money): boolean {
  return value.minor === 0n;
}

function sameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) fail('CURRENCY_MISMATCH');
}

export function addMoney(a: Money, b: Money): Money {
  sameCurrency(a, b);
  return money(a.minor + b.minor, a.currency);
}

/** Never produces a negative amount; callers decide what an over-subtraction means. */
export function subtractMoney(a: Money, b: Money): Money {
  sameCurrency(a, b);
  return money(a.minor - b.minor, a.currency);
}

export function compareMoney(a: Money, b: Money): -1 | 0 | 1 {
  sameCurrency(a, b);
  return a.minor < b.minor ? -1 : a.minor > b.minor ? 1 : 0;
}

export function moneyEquals(a: Money, b: Money): boolean {
  return a.currency === b.currency && a.minor === b.minor;
}

/** Sums one currency. An empty list is an explicit zero in that currency. */
export function sumMoney(currency: string, values: readonly Money[]): Money {
  let total = money(0n, currency);
  for (const value of values) total = addMoney(total, value);
  return total;
}
