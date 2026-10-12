import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  approximateDate,
  compareApproximateDates,
  couldFallInRange,
  dateInterval,
  formatApproximateDate,
  parseCalendarDay,
  relationToRange,
  toDateComponents,
} from '../dist/index.js';

const code = (fn) => {
  try {
    fn();
  } catch (error) {
    return error.code;
  }
  return 'NO_ERROR';
};
const exact = (year, month, day) => approximateDate({ precision: 'exact', year, month, day });

test('each precision keeps only its own components and round-trips', () => {
  for (const input of [
    { precision: 'exact', year: 2024, month: 3, day: 5 },
    { precision: 'month', year: 2024, month: 3, day: null },
    { precision: 'year', year: 2024, month: null, day: null },
    { precision: 'unknown', year: null, month: null, day: null },
  ]) {
    const date = approximateDate(input);
    assert.deepEqual(toDateComponents(date), input);
    // Wire round trip through JSON keeps the same value.
    assert.deepEqual(approximateDate(JSON.parse(JSON.stringify(toDateComponents(date)))), date);
  }
  assert.deepEqual(approximateDate({ precision: 'unknown' }), { precision: 'unknown' });
});

test('missing or extra components are precision errors; nothing is invented', () => {
  for (const bad of [
    { precision: 'exact', year: 2024, month: 3 },
    { precision: 'month', year: 2024 },
    { precision: 'month', year: 2024, month: 3, day: 1 },
    { precision: 'year', year: 2024, month: 1 },
    { precision: 'year' },
    { precision: 'unknown', year: 2024 },
    { precision: 'week', year: 2024 },
    { precision: 'EXACT', year: 2024, month: 1, day: 1 },
  ])
    assert.equal(
      code(() => approximateDate(bad)),
      'INVALID_DATE_PRECISION',
      JSON.stringify(bad),
    );
});

test('leap days and impossible calendar dates', () => {
  assert.equal(exact(2024, 2, 29).day, 29);
  assert.equal(exact(2000, 2, 29).day, 29);
  assert.equal(
    code(() => exact(2023, 2, 29)),
    'INVALID_CALENDAR_DATE',
  );
  assert.equal(
    code(() => exact(1900, 2, 29)),
    'INVALID_CALENDAR_DATE',
  );
  assert.equal(
    code(() => exact(2024, 4, 31)),
    'INVALID_CALENDAR_DATE',
  );
  assert.equal(
    code(() => exact(2024, 13, 1)),
    'INVALID_CALENDAR_DATE',
  );
  assert.equal(
    code(() => exact(2024, 0, 1)),
    'INVALID_CALENDAR_DATE',
  );
  assert.equal(
    code(() => exact(0, 1, 1)),
    'INVALID_CALENDAR_DATE',
  );
  assert.equal(
    code(() => exact(10000, 1, 1)),
    'INVALID_CALENDAR_DATE',
  );
  assert.equal(
    code(() => exact(2024, 1.5, 1)),
    'INVALID_CALENDAR_DATE',
  );
  assert.equal(
    code(() => exact(2024, '1', 1)),
    'INVALID_CALENDAR_DATE',
  );
});

test('strict calendar-day parsing', () => {
  assert.deepEqual(parseCalendarDay('2024-02-29'), exact(2024, 2, 29));
  for (const bad of [
    '2023-02-29',
    '2024-2-29',
    '0000-01-01',
    '2024-01-01T00:00:00Z',
    '20240101',
    '',
  ])
    assert.equal(
      code(() => parseCalendarDay(bad)),
      'INVALID_CALENDAR_DATE',
      bad,
    );
});

test('intervals cover month and year boundaries exactly', () => {
  assert.deepEqual(dateInterval(approximateDate({ precision: 'month', year: 2024, month: 2 })), {
    start: '2024-02-01',
    end: '2024-02-29',
  });
  assert.deepEqual(dateInterval(approximateDate({ precision: 'month', year: 2023, month: 12 })), {
    start: '2023-12-01',
    end: '2023-12-31',
  });
  assert.deepEqual(dateInterval(approximateDate({ precision: 'year', year: 2024 })), {
    start: '2024-01-01',
    end: '2024-12-31',
  });
  assert.equal(dateInterval({ precision: 'unknown' }), null);
});

test('partial dates use honest overlap semantics against a range', () => {
  const march = approximateDate({ precision: 'month', year: 2024, month: 3 });
  const year = approximateDate({ precision: 'year', year: 2024 });
  const q1 = { from: '2024-01-01', to: '2024-03-31' };
  assert.equal(relationToRange(march, q1), 'within');
  assert.equal(relationToRange(year, q1), 'overlaps');
  assert.equal(relationToRange(exact(2024, 4, 1), q1), 'outside');
  assert.equal(relationToRange(exact(2023, 12, 31), q1), 'outside');
  assert.equal(relationToRange(exact(2024, 3, 31), q1), 'within');
  assert.equal(relationToRange({ precision: 'unknown' }, q1), 'unknown');
  // Filtering includes anything that could fall in range; unknown is decided by the caller.
  assert.equal(couldFallInRange(year, q1), true);
  assert.equal(couldFallInRange(exact(2024, 4, 1), q1), false);
  assert.equal(couldFallInRange({ precision: 'unknown' }, q1), null);
  assert.equal(relationToRange(year, { from: '2024-06-15' }), 'overlaps');
  assert.equal(relationToRange(year, {}), 'within');
});

test('ordering is by earliest possible day, narrower first, unknown last', () => {
  const dates = [
    { precision: 'unknown' },
    approximateDate({ precision: 'year', year: 2024 }),
    approximateDate({ precision: 'month', year: 2024, month: 1 }),
    exact(2024, 1, 1),
    exact(2023, 12, 31),
  ];
  assert.deepEqual(
    [...dates].sort(compareApproximateDates).map((d) => JSON.stringify(toDateComponents(d))),
    [dates[4], dates[3], dates[2], dates[1], dates[0]].map((d) =>
      JSON.stringify(toDateComponents(d)),
    ),
  );
});

test('display formatting per precision never shifts the calendar day in any timezone', () => {
  const original = process.env.TZ;
  try {
    for (const zone of ['UTC', 'Pacific/Kiritimati', 'Pacific/Pago_Pago', 'Asia/Kolkata']) {
      process.env.TZ = zone;
      assert.equal(
        formatApproximateDate({ precision: 'exact', year: 2024, month: 2, day: 29 }),
        '29 February 2024',
      );
      assert.equal(
        formatApproximateDate({ precision: 'exact', year: 2024, month: 1, day: 1 }),
        '1 January 2024',
      );
    }
  } finally {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  }
  assert.equal(formatApproximateDate({ precision: 'month', year: 2024, month: 3 }), 'March 2024');
  assert.equal(formatApproximateDate({ precision: 'year', year: 2024 }), '2024');
  assert.equal(formatApproximateDate({ precision: 'unknown' }), 'Date not recorded');
  assert.equal(
    formatApproximateDate({ precision: 'exact', year: 99, month: 6, day: 1 }),
    '1 June 99',
  );
});
