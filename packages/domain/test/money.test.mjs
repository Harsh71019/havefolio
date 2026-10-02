import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  MAX_MINOR_UNITS,
  addMoney,
  compareMoney,
  currencyMinorDigits,
  formatMoney,
  money,
  parseDecimalAmount,
  parseMinorUnits,
  parseOptionalMinorUnits,
  subtractMoney,
  sumMoney,
  toDecimalString,
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

test('explicit zero is valid and distinct from unknown', () => {
  const zero = parseMinorUnits('0', 'INR');
  assert.equal(zero.minor, 0n);
  assert.equal(zero.currency, 'INR');
  assert.equal(parseOptionalMinorUnits(null, 'INR'), null);
  assert.equal(parseOptionalMinorUnits(undefined, 'INR'), null);
  assert.notEqual(parseOptionalMinorUnits('0', 'INR'), null);
});

test('positive integer minor units round-trip through the wire form', () => {
  const value = parseMinorUnits('129950', 'INR');
  assert.equal(value.minor, 129950n);
  assert.equal(toMinorUnitsString(value), '129950');
  assert.equal(toDecimalString(value), '1299.50');
  assert.ok(Object.isFrozen(value));
});

test('values beyond Number.MAX_SAFE_INTEGER are preserved exactly; storage bound is enforced', () => {
  const unsafe = '9007199254740993'; // 2^53 + 1, not representable as a JS number
  assert.equal(toMinorUnitsString(parseMinorUnits(unsafe, 'INR')), unsafe);
  assert.equal(
    toMinorUnitsString(parseMinorUnits('9223372036854775807', 'INR')),
    '9223372036854775807',
  );
  assert.equal(
    code(() => parseMinorUnits('9223372036854775808', 'INR')),
    'UNSAFE_MONEY_VALUE',
  );
  assert.equal(
    code(() => parseMinorUnits('123456789012345678901', 'INR')),
    'UNSAFE_MONEY_VALUE',
  );
  assert.equal(
    code(() => money(MAX_MINOR_UNITS + 1n, 'INR')),
    'UNSAFE_MONEY_VALUE',
  );
  // JSON numbers are rejected: precision may already be lost.
  assert.equal(
    code(() => parseMinorUnits(Number('9007199254740993'), 'INR')),
    'INVALID_MONEY_AMOUNT',
  );
});

test('malformed minor-unit strings and currencies are rejected', () => {
  for (const bad of ['', '-1', '01', '1.5', '1e3', ' 1', '١٢', '0x10'])
    assert.equal(
      code(() => parseMinorUnits(bad, 'INR')),
      'INVALID_MONEY_AMOUNT',
      bad,
    );
  for (const bad of ['inr', 'XXX', 'XTS', 'ABC', '', 'INRR'])
    assert.equal(
      code(() => parseMinorUnits('1', bad)),
      'INVALID_CURRENCY',
      bad,
    );
  assert.equal(
    code(() => money(-1n, 'INR')),
    'INVALID_MONEY_AMOUNT',
  );
});

test('decimal entry respects zero, two and three minor digits without rounding', () => {
  assert.equal(currencyMinorDigits('JPY'), 0);
  assert.equal(currencyMinorDigits('INR'), 2);
  assert.equal(currencyMinorDigits('KWD'), 3);
  assert.equal(parseDecimalAmount('1500', 'JPY').minor, 1500n);
  assert.equal(
    code(() => parseDecimalAmount('1500.5', 'JPY')),
    'MONEY_PRECISION_EXCEEDED',
  );
  assert.equal(parseDecimalAmount('1500.00', 'JPY').minor, 1500n);
  assert.equal(parseDecimalAmount('1,299.5', 'INR').minor, 129950n);
  assert.equal(parseDecimalAmount('12,34,567.89', 'INR').minor, 123456789n);
  assert.equal(parseDecimalAmount('1,234,567', 'USD').minor, 123456700n);
  assert.equal(
    code(() => parseDecimalAmount('10.999', 'INR')),
    'MONEY_PRECISION_EXCEEDED',
  );
  assert.equal(parseDecimalAmount('1.234', 'KWD').minor, 1234n);
  assert.equal(
    code(() => parseDecimalAmount('1.2345', 'KWD')),
    'MONEY_PRECISION_EXCEEDED',
  );
  assert.equal(parseDecimalAmount('0', 'INR').minor, 0n);
  assert.equal(parseDecimalAmount('0.00', 'INR').minor, 0n);
  assert.equal(parseDecimalAmount('  42 ', 'INR').minor, 4200n);
});

test('malformed decimal input is rejected rather than reinterpreted', () => {
  for (const bad of [
    '',
    '.',
    '.5',
    '5.',
    '-5',
    '+5',
    '1,2,3',
    '1,23',
    '12,3456',
    '1e3',
    '₹10',
    '10 00',
    'NaN',
    '1.2.3',
    '1_000',
  ])
    assert.equal(
      code(() => parseDecimalAmount(bad, 'INR')),
      'INVALID_MONEY_AMOUNT',
      bad,
    );
  assert.equal(
    code(() => parseDecimalAmount('100000000000000000000', 'INR')),
    'UNSAFE_MONEY_VALUE',
  );
});

test('arithmetic requires matching currencies and never converts', () => {
  const inr = parseMinorUnits('100', 'INR');
  const usd = parseMinorUnits('100', 'USD');
  assert.equal(
    code(() => addMoney(inr, usd)),
    'CURRENCY_MISMATCH',
  );
  assert.equal(
    code(() => subtractMoney(inr, usd)),
    'CURRENCY_MISMATCH',
  );
  assert.equal(
    code(() => compareMoney(inr, usd)),
    'CURRENCY_MISMATCH',
  );
  assert.equal(
    code(() => sumMoney('INR', [inr, usd])),
    'CURRENCY_MISMATCH',
  );
  assert.equal(
    code(() => subtractMoney(inr, parseMinorUnits('101', 'INR'))),
    'INVALID_MONEY_AMOUNT',
  );
  assert.equal(sumMoney('INR', []).minor, 0n);
});

test('no floating-point drift across many small additions', () => {
  // 0.1 + 0.2 style drift cannot occur: ten thousand 0.10 additions are exactly 1000.00.
  const tenPaise = parseDecimalAmount('0.10', 'INR');
  const total = sumMoney(
    'INR',
    Array.from({ length: 10000 }, () => tenPaise),
  );
  assert.equal(toDecimalString(total), '1000.00');
  const big = parseMinorUnits('9007199254740993', 'INR');
  assert.equal(addMoney(big, parseMinorUnits('2', 'INR')).minor, 9007199254740995n);
});

test('formatting is presentation-only and does not mutate the value', () => {
  const value = parseMinorUnits('129950', 'INR');
  assert.equal(formatMoney(value), '₹1,299.50');
  assert.equal(formatMoney(parseMinorUnits('129900', 'INR')), '₹1,299');
  assert.equal(formatMoney(parseMinorUnits('0', 'INR')), '₹0');
  assert.equal(formatMoney(parseMinorUnits('1500', 'JPY')), 'JP¥1,500');
  assert.match(formatMoney(parseMinorUnits('1234', 'KWD')), /1\.234/);
  assert.match(formatMoney(parseMinorUnits('5', 'USD')), /0\.05/);
  // Exact beyond 2^53: every digit survives formatting.
  assert.equal(
    formatMoney(parseMinorUnits('9007199254740993', 'INR')).replace(/[^0-9]/g, ''),
    '9007199254740993',
  );
  assert.equal(value.minor, 129950n);
  assert.equal(value.currency, 'INR');
});
