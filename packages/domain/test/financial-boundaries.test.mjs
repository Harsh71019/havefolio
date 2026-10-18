import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  MAX_MINOR_UNITS,
  addMoney,
  compareMoney,
  currencyMinorDigits,
  money,
  parseDecimalAmount,
  parseMinorUnits,
  subtractMoney,
  sumMoney,
  toMinorUnitsString,
  acquisitionSpending,
  refundTotals,
  summarizeSpending,
  approximateDate,
  compareApproximateDates,
  dateInterval,
} from '../dist/index.js';

const code = (fn) => {
  try {
    fn();
  } catch (error) {
    return error.code;
  }
  return 'NO_ERROR';
};

test('exact money boundaries: 0, 1, safe-integer threshold, and signed 64-bit maximum', () => {
  const boundaries = [
    0n,
    1n,
    99n,
    100n,
    9007199254740991n, // Number.MAX_SAFE_INTEGER
    9007199254740992n, // MAX_SAFE_INTEGER + 1
    9007199254740993n, // MAX_SAFE_INTEGER + 2
    MAX_MINOR_UNITS - 1n,
    MAX_MINOR_UNITS, // 9223372036854775807n
  ];

  for (const minor of boundaries) {
    const str = minor.toString();
    const parsed = parseMinorUnits(str, 'INR');
    assert.equal(parsed.minor, minor);
    assert.equal(toMinorUnitsString(parsed), str);
    assert.equal(parsed.currency, 'INR');
    assert.ok(Object.isFrozen(parsed));
  }

  // Exact 1 minor unit above signed 64-bit integer limit is rejected
  assert.equal(
    code(() => parseMinorUnits('9223372036854775808', 'INR')),
    'UNSAFE_MONEY_VALUE',
  );
  assert.equal(
    code(() => money(MAX_MINOR_UNITS + 1n, 'INR')),
    'UNSAFE_MONEY_VALUE',
  );
  assert.equal(
    code(() => money(-1n, 'INR')),
    'INVALID_MONEY_AMOUNT',
  );
});

test('arithmetic invariants across boundary amounts', () => {
  const zero = parseMinorUnits('0', 'INR');
  const one = parseMinorUnits('1', 'INR');
  const mid = parseMinorUnits('9007199254740993', 'INR');
  const max = parseMinorUnits(MAX_MINOR_UNITS.toString(), 'INR');

  // Commutativity: a + b === b + a
  assert.equal(addMoney(one, mid).minor, addMoney(mid, one).minor);
  assert.equal(addMoney(zero, max).minor, addMoney(max, zero).minor);

  // Identity: a + 0 === a, a - 0 === a
  assert.equal(addMoney(mid, zero).minor, mid.minor);
  assert.equal(subtractMoney(mid, zero).minor, mid.minor);

  // Inverse: a - a === 0
  assert.equal(subtractMoney(mid, mid).minor, 0n);
  assert.equal(subtractMoney(max, max).minor, 0n);

  // Subtraction underflow: smaller - larger throws
  assert.equal(
    code(() => subtractMoney(one, mid)),
    'INVALID_MONEY_AMOUNT',
  );
  assert.equal(
    code(() => subtractMoney(zero, one)),
    'INVALID_MONEY_AMOUNT',
  );

  // Addition overflow: MAX + 1 throws UNSAFE_MONEY_VALUE
  assert.equal(
    code(() => addMoney(max, one)),
    'UNSAFE_MONEY_VALUE',
  );

  // sumMoney on empty list returns exact zero
  const emptySum = sumMoney('INR', []);
  assert.equal(emptySum.minor, 0n);
  assert.equal(emptySum.currency, 'INR');
});

test('currency decimals and precision limits for 0, 2, and 3 minor-digit ISO currencies', () => {
  // 0-decimal: JPY
  assert.equal(currencyMinorDigits('JPY'), 0);
  assert.equal(parseDecimalAmount('500', 'JPY').minor, 500n);
  assert.equal(parseDecimalAmount('500.00', 'JPY').minor, 500n);
  assert.equal(
    code(() => parseDecimalAmount('500.5', 'JPY')),
    'MONEY_PRECISION_EXCEEDED',
  );

  // 2-decimal: INR, USD, EUR
  assert.equal(currencyMinorDigits('INR'), 2);
  assert.equal(currencyMinorDigits('USD'), 2);
  assert.equal(parseDecimalAmount('1299.50', 'INR').minor, 129950n);
  assert.equal(parseDecimalAmount('1299.5', 'INR').minor, 129950n);
  assert.equal(
    code(() => parseDecimalAmount('1299.555', 'INR')),
    'MONEY_PRECISION_EXCEEDED',
  );

  // 3-decimal: KWD, BHD, OMR
  assert.equal(currencyMinorDigits('KWD'), 3);
  assert.equal(currencyMinorDigits('BHD'), 3);
  assert.equal(currencyMinorDigits('OMR'), 3);
  assert.equal(parseDecimalAmount('1.234', 'KWD').minor, 1234n);
  assert.equal(parseDecimalAmount('1.23', 'KWD').minor, 1230n);
  assert.equal(parseDecimalAmount('1.2', 'KWD').minor, 1200n);
  assert.equal(
    code(() => parseDecimalAmount('1.2345', 'KWD')),
    'MONEY_PRECISION_EXCEEDED',
  );
});

test('multi-currency isolation: currency mismatches never silently convert', () => {
  const inr = parseMinorUnits('10000', 'INR');
  const usd = parseMinorUnits('10000', 'USD');
  const eur = parseMinorUnits('10000', 'EUR');
  const jpy = parseMinorUnits('10000', 'JPY');

  assert.equal(
    code(() => addMoney(inr, usd)),
    'CURRENCY_MISMATCH',
  );
  assert.equal(
    code(() => subtractMoney(inr, eur)),
    'CURRENCY_MISMATCH',
  );
  assert.equal(
    code(() => compareMoney(inr, jpy)),
    'CURRENCY_MISMATCH',
  );
  assert.equal(
    code(() => sumMoney('INR', [inr, usd])),
    'CURRENCY_MISMATCH',
  );
});

test('acquisition combinations and spending classification matrix', () => {
  // Gift with no price is not spending
  assert.equal(acquisitionSpending('gift', null), 'not_spending');
  // Gift with explicit price paid is spending
  assert.equal(acquisitionSpending('gift', '50000'), 'priced');
  // Bought with explicit zero is priced spending of zero
  assert.equal(acquisitionSpending('bought', '0'), 'priced');
  // Bought with null price is unknown price
  assert.equal(acquisitionSpending('bought', null), 'unknown_price');
  // Secondhand with price is priced
  assert.equal(acquisitionSpending('secondhand', '25000'), 'priced');
  // Secondhand with null price is unknown
  assert.equal(acquisitionSpending('secondhand', null), 'unknown_price');
  // Unknown acquisition type
  assert.equal(acquisitionSpending('unknown', null), 'unknown_price');
});

test('refund boundaries: exact matching, partial accumulation, and overflow prevention', () => {
  const item = { currency: 'INR', pricePaidMinor: '100000', acquisitionType: 'bought' };

  // Zero refunds
  const zeroRefunds = refundTotals(item, []);
  assert.equal(toMinorUnitsString(zeroRefunds.refunded), '0');
  assert.equal(toMinorUnitsString(zeroRefunds.net), '100000');

  // Exact full refund brings net to 0
  const fullRefund = refundTotals(item, [{ amountMinor: '100000', currency: 'INR' }]);
  assert.equal(toMinorUnitsString(fullRefund.refunded), '100000');
  assert.equal(toMinorUnitsString(fullRefund.net), '0');

  // Partial refunds totaling exact gross amount
  const partials = refundTotals(item, [
    { amountMinor: '30000', currency: 'INR' },
    { amountMinor: '25000', currency: 'INR' },
    { amountMinor: '45000', currency: 'INR' },
  ]);
  assert.equal(toMinorUnitsString(partials.refunded), '100000');
  assert.equal(toMinorUnitsString(partials.net), '0');

  // Partial refunds exceeding gross by 1 minor unit throws REFUND_EXCEEDS_AMOUNT_PAID
  assert.equal(
    code(() =>
      refundTotals(item, [
        { amountMinor: '50000', currency: 'INR' },
        { amountMinor: '50001', currency: 'INR' },
      ]),
    ),
    'REFUND_EXCEEDS_AMOUNT_PAID',
  );

  // Refund on item with null price throws REFUND_REQUIRES_AMOUNT_PAID
  assert.equal(
    code(() =>
      refundTotals({ ...item, pricePaidMinor: null }, [{ amountMinor: '1000', currency: 'INR' }]),
    ),
    'REFUND_REQUIRES_AMOUNT_PAID',
  );

  // Refund on gift with null price throws INVALID_ACQUISITION_COMBINATION
  assert.equal(
    code(() =>
      refundTotals({ ...item, acquisitionType: 'gift', pricePaidMinor: null }, [
        { amountMinor: '1000', currency: 'INR' },
      ]),
    ),
    'INVALID_ACQUISITION_COMBINATION',
  );

  // Refund on zero-priced item throws REFUND_EXCEEDS_AMOUNT_PAID
  assert.equal(
    code(() =>
      refundTotals({ ...item, pricePaidMinor: '0' }, [{ amountMinor: '1', currency: 'INR' }]),
    ),
    'REFUND_EXCEEDS_AMOUNT_PAID',
  );

  // Non-positive refund amounts throw INVALID_MONEY_AMOUNT
  assert.equal(
    code(() => refundTotals(item, [{ amountMinor: '0', currency: 'INR' }])),
    'INVALID_MONEY_AMOUNT',
  );
  assert.equal(
    code(() => refundTotals(item, [{ amountMinor: '-100', currency: 'INR' }])),
    'INVALID_MONEY_AMOUNT',
  );

  // Currency mismatch throws CURRENCY_MISMATCH
  assert.equal(
    code(() => refundTotals(item, [{ amountMinor: '1000', currency: 'USD' }])),
    'CURRENCY_MISMATCH',
  );
});

test('spending summaries across multiple currencies preserve distinct buckets without conversion', () => {
  const items = [
    {
      currency: 'INR',
      pricePaidMinor: '50000',
      acquisitionType: 'bought',
      ownershipStatus: 'owned',
      purchaseDate: { precision: 'exact', year: 2024, month: 1, day: 10 },
      refunds: [{ amountMinor: '10000', currency: 'INR' }],
    },
    {
      currency: 'INR',
      pricePaidMinor: '25000',
      acquisitionType: 'bought',
      ownershipStatus: 'owned',
      purchaseDate: { precision: 'exact', year: 2024, month: 2, day: 15 },
      refunds: [],
    },
    {
      currency: 'USD',
      pricePaidMinor: '12000',
      acquisitionType: 'bought',
      ownershipStatus: 'owned',
      purchaseDate: { precision: 'exact', year: 2024, month: 3, day: 20 },
      refunds: [],
    },
    {
      currency: 'EUR',
      pricePaidMinor: '8000',
      acquisitionType: 'bought',
      ownershipStatus: 'owned',
      purchaseDate: { precision: 'month', year: 2024, month: 4 },
      refunds: [],
    },
    {
      currency: 'INR',
      pricePaidMinor: null,
      acquisitionType: 'bought',
      ownershipStatus: 'owned',
      purchaseDate: { precision: 'year', year: 2024 },
      refunds: [],
    },
    {
      currency: 'INR',
      pricePaidMinor: null,
      acquisitionType: 'gift',
      ownershipStatus: 'owned',
      purchaseDate: { precision: 'year', year: 2024 },
      refunds: [],
    },
  ];

  const summary = summarizeSpending(items, { scope: 'current_owned' });

  // Currencies are kept separate
  const inrBucket = summary.dated.find((b) => b.currency === 'INR');
  const usdBucket = summary.dated.find((b) => b.currency === 'USD');
  const eurBucket = summary.dated.find((b) => b.currency === 'EUR');

  assert.ok(inrBucket && usdBucket && eurBucket);
  assert.equal(inrBucket.grossMinor, '75000');
  assert.equal(inrBucket.refundedMinor, '10000');
  assert.equal(inrBucket.netMinor, '65000');
  assert.equal(inrBucket.pricedItemCount, 2);
  assert.equal(inrBucket.unknownPriceCount, 1);
  assert.equal(inrBucket.notSpendingCount, 1);

  assert.equal(usdBucket.grossMinor, '12000');
  assert.equal(usdBucket.netMinor, '12000');
  assert.equal(usdBucket.pricedItemCount, 1);

  assert.equal(eurBucket.grossMinor, '8000');
  assert.equal(eurBucket.netMinor, '8000');
  assert.equal(eurBucket.pricedItemCount, 1);
});

test('historical vs current-owned spending scopes with returns and refunds', () => {
  const itemReturnedWithoutRefund = {
    currency: 'INR',
    pricePaidMinor: '100000',
    acquisitionType: 'bought',
    ownershipStatus: 'returned',
    purchaseDate: { precision: 'exact', year: 2024, month: 1, day: 5 },
    refunds: [],
  };

  const itemReturnedWithFullRefund = {
    currency: 'INR',
    pricePaidMinor: '80000',
    acquisitionType: 'bought',
    ownershipStatus: 'returned',
    purchaseDate: { precision: 'exact', year: 2024, month: 2, day: 10 },
    refunds: [{ amountMinor: '80000', currency: 'INR' }],
  };

  // current_owned scope excludes returned items
  const current = summarizeSpending([itemReturnedWithoutRefund, itemReturnedWithFullRefund], {
    scope: 'current_owned',
  });
  assert.equal(current.dated.length, 0);

  // all_history keeps returned items:
  // Item 1: gross 100000, refund 0, net 100000
  // Item 2: gross 80000, refund 80000, net 0
  // Total INR: gross 180000, refund 80000, net 100000
  const history = summarizeSpending([itemReturnedWithoutRefund, itemReturnedWithFullRefund], {
    scope: 'all_history',
  });
  const inrHist = history.dated.find((b) => b.currency === 'INR');
  assert.ok(inrHist);
  assert.equal(inrHist.grossMinor, '180000');
  assert.equal(inrHist.refundedMinor, '80000');
  assert.equal(inrHist.netMinor, '100000');
  assert.equal(inrHist.pricedItemCount, 2);
});

test('date precision leap year matrix across century boundaries', () => {
  // Divisible by 4, not century -> leap year
  assert.equal(approximateDate({ precision: 'exact', year: 2024, month: 2, day: 29 }).day, 29);
  assert.equal(approximateDate({ precision: 'exact', year: 2020, month: 2, day: 29 }).day, 29);

  // Century divisible by 400 -> leap year
  assert.equal(approximateDate({ precision: 'exact', year: 2000, month: 2, day: 29 }).day, 29);
  assert.equal(approximateDate({ precision: 'exact', year: 2400, month: 2, day: 29 }).day, 29);

  // Century not divisible by 400 -> NOT leap year
  assert.equal(
    code(() => approximateDate({ precision: 'exact', year: 1900, month: 2, day: 29 })),
    'INVALID_CALENDAR_DATE',
  );
  assert.equal(
    code(() => approximateDate({ precision: 'exact', year: 2100, month: 2, day: 29 })),
    'INVALID_CALENDAR_DATE',
  );
  assert.equal(
    code(() => approximateDate({ precision: 'exact', year: 1800, month: 2, day: 29 })),
    'INVALID_CALENDAR_DATE',
  );

  // Common years
  assert.equal(
    code(() => approximateDate({ precision: 'exact', year: 2023, month: 2, day: 29 })),
    'INVALID_CALENDAR_DATE',
  );
  assert.equal(
    code(() => approximateDate({ precision: 'exact', year: 2025, month: 2, day: 29 })),
    'INVALID_CALENDAR_DATE',
  );

  // 30-day month boundaries: April, June, September, November
  for (const m of [4, 6, 9, 11]) {
    assert.equal(approximateDate({ precision: 'exact', year: 2024, month: m, day: 30 }).day, 30);
    assert.equal(
      code(() => approximateDate({ precision: 'exact', year: 2024, month: m, day: 31 })),
      'INVALID_CALENDAR_DATE',
    );
  }

  // 31-day month boundaries: Jan, Mar, May, Jul, Aug, Oct, Dec
  for (const m of [1, 3, 5, 7, 8, 10, 12]) {
    assert.equal(approximateDate({ precision: 'exact', year: 2024, month: m, day: 31 }).day, 31);
    assert.equal(
      code(() => approximateDate({ precision: 'exact', year: 2024, month: m, day: 32 })),
      'INVALID_CALENDAR_DATE',
    );
  }

  // Day 0 or negative
  assert.equal(
    code(() => approximateDate({ precision: 'exact', year: 2024, month: 1, day: 0 })),
    'INVALID_CALENDAR_DATE',
  );
  assert.equal(
    code(() => approximateDate({ precision: 'exact', year: 2024, month: 1, day: -1 })),
    'INVALID_CALENDAR_DATE',
  );
});

test('date intervals for exact, month, year, and unknown precision', () => {
  // February in leap year
  const febLeap = approximateDate({ precision: 'month', year: 2024, month: 2 });
  assert.deepEqual(dateInterval(febLeap), { start: '2024-02-01', end: '2024-02-29' });

  // February in common year
  const febCommon = approximateDate({ precision: 'month', year: 2023, month: 2 });
  assert.deepEqual(dateInterval(febCommon), { start: '2023-02-01', end: '2023-02-28' });

  // Year interval spans Jan 1 to Dec 31
  const year2024 = approximateDate({ precision: 'year', year: 2024 });
  assert.deepEqual(dateInterval(year2024), { start: '2024-01-01', end: '2024-12-31' });

  // Unknown date interval is null (never invented dates)
  const unknownDate = approximateDate({ precision: 'unknown' });
  assert.equal(dateInterval(unknownDate), null);
});

test('approximate date sorting is deterministic and orders earliest possible day first', () => {
  const dates = [
    approximateDate({ precision: 'unknown' }),
    approximateDate({ precision: 'year', year: 2024 }),
    approximateDate({ precision: 'month', year: 2024, month: 6 }),
    approximateDate({ precision: 'exact', year: 2024, month: 6, day: 15 }),
    approximateDate({ precision: 'exact', year: 2024, month: 1, day: 1 }),
    approximateDate({ precision: 'month', year: 2024, month: 1 }),
    approximateDate({ precision: 'exact', year: 2023, month: 12, day: 31 }),
  ];

  const sorted = [...dates].sort(compareApproximateDates);

  // Expected order:
  // 1. 2023-12-31 (exact: start 2023-12-31)
  // 2. 2024-01-01 (exact: start 2024-01-01, end 2024-01-01)
  // 3. 2024-01 (month: start 2024-01-01, end 2024-01-31)
  // 4. 2024-06 (month: start 2024-06-01)
  // 5. 2024-06-15 (exact: start 2024-06-15)
  // 6. 2024 (year: start 2024-01-01, end 2024-12-31) - wait, year 2024 starts 2024-01-01, end 2024-12-31!
  assert.equal(sorted[0].year, 2023);
  assert.equal(sorted[1].day, 1);
  assert.equal(sorted[2].precision, 'month');
  assert.equal(sorted[2].month, 1);
  assert.equal(sorted[3].precision, 'year');
  assert.equal(sorted[4].precision, 'month');
  assert.equal(sorted[4].month, 6);
  assert.equal(sorted[5].day, 15);
  assert.equal(sorted[6].precision, 'unknown');
});
