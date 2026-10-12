import { fail } from './errors.js';

export const datePrecisions = ['exact', 'month', 'year', 'unknown'] as const;
export type DatePrecision = (typeof datePrecisions)[number];

/**
 * A calendar date known only as precisely as the owner recorded it. Missing components are
 * never invented, and unknown is never replaced by today or by a record-created time.
 */
export type ApproximateDate =
  | { readonly precision: 'unknown' }
  | { readonly precision: 'year'; readonly year: number }
  | { readonly precision: 'month'; readonly year: number; readonly month: number }
  | {
      readonly precision: 'exact';
      readonly year: number;
      readonly month: number;
      readonly day: number;
    };

/** Database/API component form: precision plus nullable integer components. */
export interface DateComponents {
  precision: string;
  year?: number | null | undefined;
  month?: number | null | undefined;
  day?: number | null | undefined;
}
export interface StoredDateComponents {
  precision: DatePrecision;
  year: number | null;
  month: number | null;
  day: number | null;
}

/** `YYYY-MM-DD` calendar day with no time or timezone. Compares correctly as a string. */
export type CalendarDay = string;

export const unknownDate: ApproximateDate = Object.freeze({ precision: 'unknown' });

export function isLeapYear(year: number): boolean {
  return year % 400 === 0 || (year % 4 === 0 && year % 100 !== 0);
}

export function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

const isPrecision = (value: unknown): value is DatePrecision =>
  typeof value === 'string' && (datePrecisions as readonly string[]).includes(value);

function component(value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max)
    return fail('INVALID_CALENDAR_DATE');
  return value;
}

/**
 * Validates components against their precision. A component that is present when it should be
 * absent (or absent when required) is an INVALID_DATE_PRECISION; an impossible year, month or
 * day (including 29 February outside a leap year) is an INVALID_CALENDAR_DATE.
 */
export function approximateDate(input: DateComponents): ApproximateDate {
  if (!input || typeof input !== 'object' || !isPrecision(input.precision))
    return fail('INVALID_DATE_PRECISION');
  const { precision } = input;
  const required = { unknown: 0, year: 1, month: 2, exact: 3 }[precision];
  const present = [input.year, input.month, input.day].map((v) => v !== null && v !== undefined);
  if (present.some((has, index) => has !== index < required)) return fail('INVALID_DATE_PRECISION');
  if (precision === 'unknown') return unknownDate;
  const year = component(input.year, 1, 9999);
  if (precision === 'year') return Object.freeze({ precision, year });
  const month = component(input.month, 1, 12);
  if (precision === 'month') return Object.freeze({ precision, year, month });
  const day = component(input.day, 1, daysInMonth(year, month));
  return Object.freeze({ precision, year, month, day });
}

export function toDateComponents(date: ApproximateDate): StoredDateComponents {
  return {
    precision: date.precision,
    year: date.precision === 'unknown' ? null : date.year,
    month: date.precision === 'month' || date.precision === 'exact' ? date.month : null,
    day: date.precision === 'exact' ? date.day : null,
  };
}

const pad = (value: number, length: number): string => String(value).padStart(length, '0');

export function calendarDay(year: number, month: number, day: number): CalendarDay {
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
}

/** Strict `YYYY-MM-DD` parsing without `Date`, so no timezone can shift the day. */
export function parseCalendarDay(value: unknown): ApproximateDate & { precision: 'exact' } {
  if (typeof value !== 'string') return fail('INVALID_CALENDAR_DATE');
  const match = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/.exec(value);
  if (!match) return fail('INVALID_CALENDAR_DATE');
  return approximateDate({
    precision: 'exact',
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  }) as ApproximateDate & { precision: 'exact' };
}

/**
 * The inclusive span of days the recorded date could refer to. Exact is one day, month-only is
 * the whole month, year-only the whole year. Unknown has no span (null), never an assumed one.
 */
export function dateInterval(
  date: ApproximateDate,
): { start: CalendarDay; end: CalendarDay } | null {
  switch (date.precision) {
    case 'unknown':
      return null;
    case 'year':
      return { start: calendarDay(date.year, 1, 1), end: calendarDay(date.year, 12, 31) };
    case 'month':
      return {
        start: calendarDay(date.year, date.month, 1),
        end: calendarDay(date.year, date.month, daysInMonth(date.year, date.month)),
      };
    case 'exact': {
      const day = calendarDay(date.year, date.month, date.day);
      return { start: day, end: day };
    }
  }
}

/** Inclusive day range; an omitted bound is open. */
export interface DayRange {
  from?: CalendarDay | undefined;
  to?: CalendarDay | undefined;
}

/**
 * How a recorded date relates to a range:
 * - `within`: every day it could be is inside the range (safe to attribute, e.g. for totals).
 * - `overlaps`: some but not all possible days are inside (a partial date straddling a bound).
 * - `outside`: no possible day is inside.
 * - `unknown`: no date recorded; report it separately rather than guessing.
 */
export type RangeRelation = 'within' | 'overlaps' | 'outside' | 'unknown';

export function relationToRange(date: ApproximateDate, range: DayRange): RangeRelation {
  const span = dateInterval(date);
  if (!span) return 'unknown';
  const from = range.from ?? '0000-01-01';
  const to = range.to ?? '9999-12-31';
  if (span.end < from || span.start > to) return 'outside';
  return span.start >= from && span.end <= to ? 'within' : 'overlaps';
}

/**
 * Inventory filtering semantics: a date matches when it could fall in the range (`within` or
 * `overlaps`). This mirrors the SQL purchase-date filter; unknown dates follow `dateKnown`.
 */
export function couldFallInRange(date: ApproximateDate, range: DayRange): boolean | null {
  const relation = relationToRange(date, range);
  return relation === 'unknown' ? null : relation !== 'outside';
}

/**
 * Deterministic ordering: earliest possible day first, then the narrower span first (so an
 * exact 1 March sorts before "March"), with unknown dates last.
 */
export function compareApproximateDates(a: ApproximateDate, b: ApproximateDate): number {
  const left = dateInterval(a);
  const right = dateInterval(b);
  if (!left || !right) return left === right ? 0 : left ? -1 : 1;
  if (left.start !== right.start) return left.start < right.start ? -1 : 1;
  if (left.end !== right.end) return left.end < right.end ? -1 : 1;
  return 0;
}
