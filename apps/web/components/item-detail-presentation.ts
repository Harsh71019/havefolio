import {
  formatMinorUnitsToDisplay,
  getCurrencyMinorUnitDigits,
  type ItemAcquisition,
  type ItemCondition,
  type ItemEvent,
  type ItemFrequency,
  type ItemResponse,
  type ItemStatus,
  type PurchaseDate,
} from '@havefolio/contracts';
import { statusLabel } from './item-presentation';

export const conditionLabels: Record<ItemCondition, string> = {
  working: 'Working',
  needs_repair: 'Needs repair',
  broken: 'Broken',
  unknown: 'Not recorded',
};
export const frequencyLabels: Record<ItemFrequency, string> = {
  often: 'Often',
  sometimes: 'Sometimes',
  rarely: 'Rarely',
  never: 'Not used',
  unknown: 'Not recorded',
};
export const acquisitionLabels: Record<ItemAcquisition, string> = {
  bought: 'Bought new',
  secondhand: 'Bought secondhand',
  gift: 'Gift',
  other: 'Other',
  unknown: 'Not recorded',
};

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
];
export const monthOptions = monthNames.map((label, index) => ({
  value: String(index + 1),
  label,
}));

export function formatMoney(minor: string, currency: string): string {
  const digits = getCurrencyMinorUnitDigits(currency);
  const decimal = formatMinorUnitsToDisplay(minor, currency);
  const whole = !decimal.includes('.') || /\.0+$/.test(decimal);
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency,
    minimumFractionDigits: whole ? 0 : digits,
    maximumFractionDigits: digits,
    // Decimal strings keep integer minor units exact; no floating-point conversion.
  }).format(decimal as `${number}`);
}

export type Shown = { value: string; note?: string; muted?: boolean };

/**
 * The historical amount the owner paid. Null is unknown, "0" is an explicit zero, and a gift
 * never implies spending unless an amount was recorded. Never presented as a current value.
 */
export function pricePaid(
  item: Pick<ItemResponse, 'pricePaidMinor' | 'currency' | 'acquisitionType'>,
): Shown {
  const gift = item.acquisitionType === 'gift';
  if (item.pricePaidMinor === null)
    return gift
      ? { value: 'Gift — nothing paid recorded', muted: true }
      : { value: 'Not recorded', note: 'Unknown prices are left out of totals.', muted: true };
  const amount = formatMoney(item.pricePaidMinor, item.currency);
  if (item.pricePaidMinor === '0')
    return { value: `${amount} (nothing paid)`, note: `Recorded as zero in ${item.currency}.` };
  return {
    value: amount,
    note: gift
      ? `You recorded paying this towards a gift, in ${item.currency}.`
      : `Amount paid at the time, in ${item.currency}. Not a current value.`,
  };
}

/** Shows only the precision the owner recorded; never invents a day, month or today. */
export function purchaseDateText(date: PurchaseDate): Shown {
  const { precision, year, month, day } = date;
  if (precision === 'unknown' || !year) return { value: 'Not recorded', muted: true };
  if (precision === 'exact' && month && day)
    return {
      value: new Intl.DateTimeFormat('en-IN', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
      }).format(Date.UTC(year, month - 1, day)),
    };
  if (precision === 'month' && month)
    return { value: `${monthNames[month - 1]} ${year}`, note: 'Month only' };
  return { value: String(year), note: 'Year only' };
}

export function auditTime(iso: string): string {
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(iso));
}
export function eventDay(iso: string): string {
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(iso));
}

/** Plain-language source of the original record; raw provenance metadata is never shown. */
export function provenanceText(source: string): string {
  switch (source) {
    case 'manual':
      return 'Entered by you';
    case 'url':
      return 'Started from a product link; details shown are the ones you kept or corrected';
    case 'barcode':
      return 'Started from a barcode scan; details shown are the ones you kept or corrected';
    case 'photo':
    case 'receipt':
      return 'Started from a suggestion; details shown are the ones you kept or corrected';
    case 'import':
      return 'Imported by you';
    default:
      return 'Entered by you';
  }
}

// ---- Lifecycle actions ----------------------------------------------------------------------

export type LifecycleChoice = {
  key: string;
  label: string;
  title: string;
  /** What will and will not change; shown before confirming. */
  effect: string;
  action: 'used' | 'repaired' | 'ownership_changed';
  ownershipStatus?: ItemStatus;
  /** Changes ownership: needs an explicit confirmation step. */
  confirm: boolean;
  confirmLabel: string;
};

const keepsPurchase = 'Your purchase details and spending history stay exactly as recorded.';

/** Only actions the PER-10 domain contract accepts for the current status. */
export function lifecycleChoices(status: ItemStatus): LifecycleChoice[] {
  if (status === 'owned')
    return [
      {
        key: 'used',
        label: 'Used it again',
        title: 'Record that you used this again',
        effect: `Adds a “used again” entry to its history. Ownership, condition and how often you use it stay the same.`,
        action: 'used',
        confirm: false,
        confirmLabel: 'Record use',
      },
      {
        key: 'repaired',
        label: 'Record a repair',
        title: 'Record a repair',
        effect: `Adds a repair entry to its history. It is still the same item — nothing is replaced. Update its condition separately if it changed. ${keepsPurchase}`,
        action: 'repaired',
        confirm: false,
        confirmLabel: 'Record repair',
      },
      ...(
        [
          [
            'sold',
            'Sold it',
            'Mark as sold',
            'Havefolio does not record or estimate a sale price; add a note if you want to remember it.',
          ],
          [
            'donated',
            'Donated it',
            'Mark as donated',
            'It will show as donated and no longer in your home.',
          ],
          [
            'disposed',
            'Disposed of it',
            'Mark as disposed of',
            'It will show as disposed of and no longer in your home.',
          ],
          ['lost', 'Lost it', 'Mark as lost', 'You can mark it as found later.'],
          [
            'returned',
            'Returned it',
            'Mark as returned',
            'Use this when it went back to the seller. Record any refund separately when that is supported.',
          ],
        ] as const
      ).map(([to, label, title, extra]) => ({
        key: to,
        label,
        title,
        effect: `${extra} ${keepsPurchase} It stays in your records and history; you can mark it as owned again later.`,
        action: 'ownership_changed' as const,
        ownershipStatus: to,
        confirm: true,
        confirmLabel: title,
      })),
    ];
  const back: Record<Exclude<ItemStatus, 'owned'>, string> = {
    lost: 'Found it',
    returned: 'Got it back',
    sold: 'Own it again',
    donated: 'Own it again',
    disposed: 'Own it again',
  };
  return [
    {
      key: 'owned',
      label: back[status],
      title: 'Mark as owned again',
      effect: `It will show as owned and back in your home. The earlier ${statusLabel(status).toLowerCase()} entry stays in its history. ${keepsPurchase}`,
      action: 'ownership_changed',
      ownershipStatus: 'owned',
      confirm: true,
      confirmLabel: 'Mark as owned again',
    },
  ];
}

// ---- History ------------------------------------------------------------------------------

const fieldLabels: Record<string, string> = {
  name: 'name',
  currency: 'currency',
  pricePaidMinor: 'price paid',
  purchaseDate: 'purchase date',
  acquisitionType: 'how you got it',
  condition: 'condition',
  useFrequency: 'how often you use it',
  categoryId: 'category',
  subcategoryId: 'subcategory',
  tagIds: 'tags',
  brand: 'brand',
  model: 'model',
  description: 'description',
  notes: 'notes',
  specifications: 'specifications',
};

const list = (values: string[]): string =>
  values.length < 2 ? (values[0] ?? '') : `${values.slice(0, -1).join(', ')} and ${values.at(-1)}`;

const str = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);

export type HistoryEntry = { id: string; title: string; detail?: string; note?: string };

/** Understandable labels from known metadata only; unknown keys are never rendered raw. */
export function describeEvent(event: ItemEvent): HistoryEntry {
  const m = event.metadata;
  const note = str(m.note)?.trim() || undefined;
  const base = { id: event.id, ...(note ? { note } : {}) };
  const from = str(m.from);
  const to = str(m.to);
  switch (event.eventType) {
    case 'created': {
      const status = str(m.ownershipStatus);
      return {
        ...base,
        title: 'Added to Havefolio',
        ...(status && status !== 'owned' && status in ownershipPast
          ? { detail: `Recorded as ${statusLabel(status as ItemStatus).toLowerCase()}` }
          : {}),
      };
    }
    case 'details_updated': {
      const fields = Array.isArray(m.fields)
        ? [...new Set(m.fields.filter((f): f is string => typeof f === 'string'))]
        : [];
      const named = fields.map((f) => fieldLabels[f]).filter((f): f is string => Boolean(f));
      return {
        ...base,
        title: 'Details corrected',
        ...(named.length ? { detail: `Updated ${list(named)}` } : {}),
      };
    }
    case 'ownership_changed': {
      const toLabel = to && to in ownershipPast ? ownershipPast[to as ItemStatus] : undefined;
      return {
        ...base,
        title: toLabel ?? 'Ownership changed',
        ...(to === 'owned' && from && from in ownershipPast
          ? { detail: `Previously ${statusLabel(from as ItemStatus).toLowerCase()}` }
          : {}),
      };
    }
    case 'condition_changed':
      return {
        ...base,
        title: 'Condition updated',
        ...(from && to && from in conditionLabels && to in conditionLabels
          ? {
              detail: `${conditionLabels[from as ItemCondition]} → ${conditionLabels[to as ItemCondition]}`,
            }
          : {}),
      };
    case 'usage_changed':
      return {
        ...base,
        title: 'How often you use it updated',
        ...(from && to && from in frequencyLabels && to in frequencyLabels
          ? {
              detail: `${frequencyLabels[from as ItemFrequency]} → ${frequencyLabels[to as ItemFrequency]}`,
            }
          : {}),
      };
    case 'used':
      return { ...base, title: 'Used again' };
    case 'repaired':
      return { ...base, title: 'Repaired' };
    case 'refund_recorded':
      return { ...base, title: 'Refund recorded' };
    case 'correction':
      return {
        ...base,
        title: 'Correction recorded',
        detail: 'Earlier entries are kept as they were',
      };
    default:
      return { ...base, title: 'Update recorded' };
  }
}

const ownershipPast: Record<ItemStatus, string> = {
  owned: 'Marked as owned again',
  sold: 'Sold',
  donated: 'Donated',
  disposed: 'Disposed of',
  lost: 'Marked as lost',
  returned: 'Returned',
};

/** Recorded later than it happened (backdated) by at least a day, so both times are shown. */
export function recordedSeparately(event: Pick<ItemEvent, 'occurredAt' | 'createdAt'>): boolean {
  return eventDay(event.occurredAt) !== eventDay(event.createdAt);
}
