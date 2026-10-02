import {
  getCurrencyMinorUnitDigits,
  formatMinorUnitsToDisplay,
  type ItemFrequency,
  type ItemListEntry,
  type ItemStatus,
  type PurchaseDate,
} from '@havefolio/contracts';

import { itemDetailHref } from './navigation-context';

export type Fact = { label: string; value: string; muted?: boolean };

const statusLabels: Record<ItemStatus, string> = {
  owned: 'Owned',
  sold: 'Sold',
  donated: 'Donated',
  disposed: 'Disposed',
  lost: 'Lost',
  returned: 'Returned',
};
export const statusLabel = (status: ItemStatus): string => statusLabels[status];
export const isInactive = (status: ItemStatus): boolean => status !== 'owned';

/** Historical amount actually paid. Null is unknown; "0" is an explicit zero. */
export function priceFact(
  item: Pick<ItemListEntry, 'pricePaidMinor' | 'currency' | 'acquisitionType'>,
): Fact {
  if (item.pricePaidMinor === null) {
    // A gift with no recorded amount is not spending and is not an unknown purchase price.
    if (item.acquisitionType === 'gift')
      return { label: 'Paid', value: 'Gift, no amount', muted: true };
    return { label: 'Paid', value: 'Not recorded', muted: true };
  }
  const digits = getCurrencyMinorUnitDigits(item.currency);
  const decimal = formatMinorUnitsToDisplay(item.pricePaidMinor, item.currency);
  const whole = !decimal.includes('.') || /\.0+$/.test(decimal);
  const value = new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: item.currency,
    minimumFractionDigits: whole ? 0 : digits,
    maximumFractionDigits: digits,
    // Decimal strings keep integer minor units exact; no floating-point conversion.
  }).format(decimal as `${number}`);
  return { label: 'Paid', value };
}

const monthName = (year: number, month: number): string =>
  new Intl.DateTimeFormat('en-IN', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(
    Date.UTC(year, month - 1, 1),
  );
const plural = (n: number, unit: string): string => `${n} ${unit}${n === 1 ? '' : 's'}`;

/** Keeps exact, month, year and unknown precision distinct; never invents a day or month. */
export function acquiredFact(date: PurchaseDate, now = new Date()): Fact {
  const nowY = now.getFullYear();
  const nowM = now.getMonth() + 1;
  const { precision, year, month, day } = date;
  if (precision === 'unknown' || !year)
    return { label: 'Acquired', value: 'Date not recorded', muted: true };
  let shown: string;
  let months: number;
  let approximate = true;
  if (precision === 'exact' && month && day) {
    shown = new Intl.DateTimeFormat('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(Date.UTC(year, month - 1, day));
    months = (nowY - year) * 12 + (nowM - month) - (now.getDate() < day ? 1 : 0);
    approximate = false;
  } else if (precision === 'month' && month) {
    shown = monthName(year, month);
    months = (nowY - year) * 12 + (nowM - month);
  } else {
    shown = String(year);
    const years = nowY - year;
    if (years < 0) return { label: 'Acquired', value: shown };
    return {
      label: 'Acquired',
      value: `${shown} · ${years === 0 ? 'this year' : `about ${plural(years, 'year')} ago`}`,
    };
  }
  if (months < 0) return { label: 'Acquired', value: shown };
  const about = approximate ? 'about ' : '';
  const age =
    months === 0
      ? precision === 'month'
        ? 'this month'
        : 'under a month ago'
      : months < 12
        ? `${about}${plural(months, 'month')} ago`
        : `${about}${plural(Math.floor(months / 12), 'year')} ago`;
  return { label: 'Acquired', value: `${shown} · ${age}` };
}

const frequencyLabels: Record<ItemFrequency, string> = {
  often: 'Often',
  sometimes: 'Sometimes',
  rarely: 'Rarely',
  never: 'Not used',
  unknown: 'Not recorded',
};
export function useFact(frequency: ItemFrequency): Fact {
  return { label: 'Use', value: frequencyLabels[frequency], muted: frequency === 'unknown' };
}

/** Opens the item record, carrying the validated My Store location back with it. */
export function itemHref(id: string, returnTo?: string): string {
  return itemDetailHref(id, returnTo);
}
