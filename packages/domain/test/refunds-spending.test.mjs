import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  acquisitionSpending,
  inSpendingScope,
  itemSpending,
  refundLimits,
  refundTotals,
  summarizeSpending,
  toMinorUnitsString,
} from '../dist/index.js';

const code = (fn) => {
  try {
    fn();
  } catch (error) {
    return error.code;
  }
  return 'NO_ERROR';
};
const bought = { currency: 'INR', pricePaidMinor: '100000', acquisitionType: 'bought' };
const refund = (amountMinor, currency = 'INR') => ({ amountMinor, currency });
const strings = (totals) => ({
  paid: totals.paid && toMinorUnitsString(totals.paid),
  refunded: toMinorUnitsString(totals.refunded),
  net: totals.net && toMinorUnitsString(totals.net),
});

test('full, partial and multiple refunds leave the purchase amount untouched', () => {
  assert.deepEqual(strings(refundTotals(bought, [])), {
    paid: '100000',
    refunded: '0',
    net: '100000',
  });
  assert.deepEqual(strings(refundTotals(bought, [refund('25000')])), {
    paid: '100000',
    refunded: '25000',
    net: '75000',
  });
  assert.deepEqual(strings(refundTotals(bought, [refund('25000'), refund('75000')])), {
    paid: '100000',
    refunded: '100000',
    net: '0',
  });
  assert.equal(bought.pricePaidMinor, '100000');
});

test('refunds cannot exceed the amount paid, mismatch currency or be non-positive', () => {
  assert.equal(
    code(() => refundTotals(bought, [refund('60000'), refund('40001')])),
    'REFUND_EXCEEDS_AMOUNT_PAID',
  );
  assert.equal(
    code(() => refundTotals(bought, [refund('100', 'USD')])),
    'CURRENCY_MISMATCH',
  );
  assert.equal(
    code(() => refundTotals(bought, [refund('0')])),
    'INVALID_MONEY_AMOUNT',
  );
  assert.equal(
    code(() => refundTotals(bought, [refund('1.5')])),
    'INVALID_MONEY_AMOUNT',
  );
  assert.equal(
    code(() => refundTotals({ ...bought, pricePaidMinor: '0' }, [refund('1')])),
    'REFUND_EXCEEDS_AMOUNT_PAID',
  );
  const tooMany = Array.from({ length: refundLimits.maxRefundsPerItem + 1 }, () => refund('1'));
  assert.equal(
    code(() => refundTotals(bought, tooMany)),
    'REFUND_LIMIT_EXCEEDED',
  );
});

test('refunds need a recorded amount paid; a gift with nothing paid has nothing to refund', () => {
  assert.equal(
    code(() => refundTotals({ ...bought, pricePaidMinor: null }, [refund('1')])),
    'REFUND_REQUIRES_AMOUNT_PAID',
  );
  assert.equal(
    code(() =>
      refundTotals({ ...bought, acquisitionType: 'gift', pricePaidMinor: null }, [refund('1')]),
    ),
    'INVALID_ACQUISITION_COMBINATION',
  );
  assert.deepEqual(strings(refundTotals({ ...bought, pricePaidMinor: null }, [])), {
    paid: null,
    refunded: '0',
    net: null,
  });
});

test('acquisition rules: gifts, secondhand, explicit zero and unknown', () => {
  assert.equal(acquisitionSpending('gift', null), 'not_spending');
  assert.equal(acquisitionSpending('gift', '50000'), 'priced');
  assert.equal(acquisitionSpending('secondhand', '20000'), 'priced');
  assert.equal(acquisitionSpending('secondhand', null), 'unknown_price');
  assert.equal(acquisitionSpending('bought', '0'), 'priced');
  assert.equal(acquisitionSpending('bought', null), 'unknown_price');
  assert.equal(acquisitionSpending('unknown', null), 'unknown_price');
});

const item = (overrides) => ({
  currency: 'INR',
  pricePaidMinor: '100000',
  acquisitionType: 'bought',
  ownershipStatus: 'owned',
  purchaseDate: { precision: 'exact', year: 2024, month: 3, day: 5 },
  refunds: [],
  ...overrides,
});

test('per-item spending: gross, refunded, net and non-spending kinds', () => {
  assert.deepEqual(itemSpending(item({ refunds: [refund('40000')] })), {
    kind: 'priced',
    currency: 'INR',
    grossMinor: 100000n,
    refundedMinor: 40000n,
    netMinor: 60000n,
  });
  assert.deepEqual(itemSpending(item({ acquisitionType: 'gift', pricePaidMinor: null })), {
    kind: 'not_spending',
    currency: 'INR',
  });
  assert.deepEqual(itemSpending(item({ pricePaidMinor: null })), {
    kind: 'unknown_price',
    currency: 'INR',
  });
  // Net spend never silently becomes negative: inconsistent input is an error.
  assert.equal(
    code(() => itemSpending(item({ refunds: [refund('100001')] }))),
    'REFUND_EXCEEDS_AMOUNT_PAID',
  );
});

test('returned without refund keeps spending; refund without ownership change reduces it', () => {
  const returned = itemSpending(item({ ownershipStatus: 'returned' }));
  assert.equal(returned.netMinor, 100000n);
  const keptWithRefund = itemSpending(item({ refunds: [refund('10000')] }));
  assert.equal(keptWithRefund.netMinor, 90000n);
});

test('scope: current-owned excludes inactive items; history keeps them', () => {
  assert.equal(inSpendingScope('owned', 'current_owned'), true);
  assert.equal(inSpendingScope('sold', 'current_owned'), false);
  assert.equal(inSpendingScope('returned', 'all_history'), true);
});

test('summaries keep currencies separate and unknown dates and prices visible', () => {
  const items = [
    item({}),
    item({ refunds: [refund('100000')], ownershipStatus: 'returned' }),
    item({ currency: 'USD', pricePaidMinor: '9007199254740993' }),
    item({ pricePaidMinor: null }),
    item({ acquisitionType: 'gift', pricePaidMinor: null }),
    item({ purchaseDate: { precision: 'unknown' }, pricePaidMinor: '500' }),
    item({ ownershipStatus: 'sold', pricePaidMinor: '700' }),
  ];
  const history = summarizeSpending(items, { scope: 'all_history' });
  assert.deepEqual(history.dated, [
    {
      currency: 'INR',
      grossMinor: '200700',
      refundedMinor: '100000',
      netMinor: '100700',
      pricedItemCount: 3,
      unknownPriceCount: 1,
      notSpendingCount: 1,
    },
    {
      currency: 'USD',
      grossMinor: '9007199254740993',
      refundedMinor: '0',
      netMinor: '9007199254740993',
      pricedItemCount: 1,
      unknownPriceCount: 0,
      notSpendingCount: 0,
    },
  ]);
  assert.deepEqual(history.unknownDate, [
    {
      currency: 'INR',
      grossMinor: '500',
      refundedMinor: '0',
      netMinor: '500',
      pricedItemCount: 1,
      unknownPriceCount: 0,
      notSpendingCount: 0,
    },
  ]);
  const owned = summarizeSpending(items, { scope: 'current_owned' });
  assert.equal(owned.dated.find((c) => c.currency === 'INR').grossMinor, '100000');
});

test('purchase-date ranges: within, spanning and outside', () => {
  const items = [
    item({ purchaseDate: { precision: 'month', year: 2024, month: 3 } }),
    item({ purchaseDate: { precision: 'year', year: 2024 }, pricePaidMinor: '300' }),
    item({
      purchaseDate: { precision: 'exact', year: 2023, month: 12, day: 31 },
      pricePaidMinor: '7',
    }),
  ];
  const q1 = summarizeSpending(items, {
    scope: 'all_history',
    range: { from: '2024-01-01', to: '2024-03-31' },
  });
  assert.deepEqual(
    q1.dated.map((c) => c.grossMinor),
    ['100000'],
  );
  assert.deepEqual(
    q1.spanningRange.map((c) => c.grossMinor),
    ['300'],
  );
  assert.deepEqual(q1.unknownDate, []);
});
