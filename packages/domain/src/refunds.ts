import { fail } from './errors.js';
import {
  compareMoney,
  money,
  parseMinorUnits,
  parseOptionalMinorUnits,
  subtractMoney,
  sumMoney,
  type Money,
} from './money.js';

export const acquisitionTypes = ['bought', 'gift', 'secondhand', 'other', 'unknown'] as const;
export type AcquisitionType = (typeof acquisitionTypes)[number];

export const ownershipStatuses = [
  'owned',
  'sold',
  'donated',
  'disposed',
  'lost',
  'returned',
] as const;
export type OwnershipStatus = (typeof ownershipStatuses)[number];

export const refundLimits = { maxRefundsPerItem: 50, maxNoteLength: 1000 } as const;

/** The purchase facts a refund is measured against. */
export interface RefundablePurchase {
  currency: string;
  pricePaidMinor: string | null;
  acquisitionType: AcquisitionType;
}

/** A confirmed refund the owner received, in wire form. */
export interface RecordedRefund {
  currency: string;
  amountMinor: string;
}

export interface RefundTotals {
  /** Historical amount paid; null when not recorded. Never mutated by refunds. */
  paid: Money | null;
  /** Sum of confirmed refunds; explicit zero in the purchase currency when there are none. */
  refunded: Money;
  /** Paid minus refunded; null when the amount paid is not recorded. Never negative. */
  net: Money | null;
}

/**
 * Validates a complete set of refunds against the original purchase and returns exact totals.
 *
 * - Refunds share the purchase currency; there is no conversion.
 * - Each refund is a positive amount; together they cannot exceed the amount paid.
 * - A refund needs a recorded amount paid. For a gift with nothing paid recorded there is
 *   nothing to refund, which is an acquisition combination rather than missing data.
 */
export function refundTotals(
  purchase: RefundablePurchase,
  refunds: readonly RecordedRefund[],
): RefundTotals {
  const paid = parseOptionalMinorUnits(purchase.pricePaidMinor, purchase.currency);
  if (refunds.length > refundLimits.maxRefundsPerItem) fail('REFUND_LIMIT_EXCEEDED');
  const amounts = refunds.map((refund) => {
    if (refund.currency !== purchase.currency) fail('CURRENCY_MISMATCH');
    const amount = parseMinorUnits(refund.amountMinor, refund.currency);
    if (amount.minor === 0n) fail('INVALID_MONEY_AMOUNT');
    return amount;
  });
  const refunded = sumMoney(purchase.currency, amounts);
  if (!paid) {
    if (amounts.length)
      fail(
        purchase.acquisitionType === 'gift'
          ? 'INVALID_ACQUISITION_COMBINATION'
          : 'REFUND_REQUIRES_AMOUNT_PAID',
      );
    return { paid: null, refunded, net: null };
  }
  if (compareMoney(refunded, paid) > 0) fail('REFUND_EXCEEDS_AMOUNT_PAID');
  return { paid, refunded, net: subtractMoney(paid, refunded) };
}

/** How an acquisition contributes to recorded spending, independent of refunds. */
export type AcquisitionSpending = 'priced' | 'unknown_price' | 'not_spending';

/**
 * Gifts with no amount recorded are not spending (and not an unknown price). A gift with an
 * amount the owner paid, a secondhand purchase and an explicit zero all keep their recorded
 * value; secondhand never implies a discount, free item or particular condition.
 */
export function acquisitionSpending(
  acquisitionType: AcquisitionType,
  pricePaidMinor: string | null,
): AcquisitionSpending {
  if (pricePaidMinor !== null) return 'priced';
  return acquisitionType === 'gift' ? 'not_spending' : 'unknown_price';
}

export const zeroIn = (currency: string): Money => money(0n, currency);
