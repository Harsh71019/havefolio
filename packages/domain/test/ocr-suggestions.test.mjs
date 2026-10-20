import assert from 'node:assert/strict';
import test from 'node:test';
import {
  confidenceBand,
  formatOcrReference,
  formatPricePaidValue,
  formatPurchaseDateValue,
  ocrCandidates,
  parseOcrReference,
  parsePricePaidValue,
  parsePurchaseDateValue,
  validateEnrichmentCandidates,
  validEnrichmentValue,
} from '../dist/index.js';

const today = '2026-10-20';
const L = (text, confidence = 93, height = 30) => ({ text, confidence, height });
const receipt = (lines) =>
  ocrCandidates(
    'receipt',
    lines.map((l) => (typeof l === 'string' ? L(l) : l)),
    'local-ocr',
    today,
  );
const field = (candidate, name) => candidate.fields.find((f) => f.field === name);
const flags = (suggestion) => parseOcrReference(suggestion.source.reference).flags;

test('canonical receipt values keep exact minor units, ISO currency and date precision', () => {
  assert.deepEqual(parsePricePaidValue('INR 89900'), { currency: 'INR', minor: 89900n });
  assert.equal(formatPricePaidValue({ currency: 'JPY', minor: 1500n }), 'JPY 1500');
  for (const bad of [
    'INR 899.00',
    'inr 1',
    'XYZ 1',
    'INR 01',
    'INR -1',
    'INR 99999999999999999999',
    ' INR 1',
  ])
    assert.equal(parsePricePaidValue(bad), null, bad);
  assert.deepEqual(parsePurchaseDateValue('2026'), { precision: 'year', year: 2026 });
  assert.deepEqual(parsePurchaseDateValue('2026-08'), { precision: 'month', year: 2026, month: 8 });
  assert.equal(formatPurchaseDateValue(parsePurchaseDateValue('2024-02-29')), '2024-02-29');
  for (const bad of ['2025-02-29', '2026-13', '26-08-14', '2026-8-1', '2026-08-14T00:00'])
    assert.equal(parsePurchaseDateValue(bad), null, bad);
  assert.equal(validEnrichmentValue('pricePaid', 'INR 1'), true);
  assert.equal(validEnrichmentValue('purchaseDate', 'unknown'), false);
});

test('only receipt evidence may suggest money or dates; product photos and links never can', () => {
  const s = (kind) => ({
    field: 'pricePaid',
    value: 'INR 100',
    confidence: 0.9,
    source: { provider: 'p', inputKind: kind, reference: 'r' },
  });
  assert.equal(
    validateEnrichmentCandidates([{ id: 'a', fields: [s('receipt')] }], 'p', 'receipt').length,
    1,
  );
  for (const kind of ['photo', 'url', 'barcode', 'name'])
    assert.throws(() => validateEnrichmentCandidates([{ id: 'a', fields: [s(kind)] }], 'p', kind));
});

test('multiple line items keep their own amounts; the order total is never spread across them', () => {
  const result = receipt([
    'GREEN LEAF HOME STORE',
    'Date: 14/08/2026 Time 18:42',
    'Item Qty Amount',
    'Steel Water Bottle 1L 1 Rs 899.00',
    'Cotton Bath Towel 2 Rs 1,198.00',
    'Subtotal Rs 2,097.00',
    'GST 5% Rs 104.85',
    'TOTAL Rs 2,201.85',
  ]);
  assert.deepEqual(
    result.map((c) => field(c, 'name').value),
    ['Steel Water Bottle 1L', 'Cotton Bath Towel'],
  );
  assert.deepEqual(
    result.map((c) => field(c, 'pricePaid').value),
    ['INR 89900', 'INR 119800'],
  );
  assert.ok(result.every((c) => field(c, 'pricePaid').value !== 'INR 220185'));
  assert.deepEqual(flags(field(result[0], 'pricePaid')), ['line-amount']);
  // Two units on one line: weaker and explained, never silently treated as one item's price.
  assert.deepEqual(flags(field(result[1], 'pricePaid')), ['line-amount', 'multiple-units']);
  assert.equal(confidenceBand(field(result[1], 'pricePaid').confidence), 'unclear');
  assert.ok(result.every((c) => field(c, 'purchaseDate').value === '2026-08-14'));
  assert.deepEqual(validateEnrichmentCandidates(result, 'local-ocr', 'receipt'), result);
});

test('a single item line may use the receipt total, labelled as the order total', () => {
  const [only] = receipt(['Kettle 1,299.00', 'Delivery 49.00', 'Grand Total INR 1,348.00']);
  assert.equal(field(only, 'name').value, 'Kettle');
  assert.equal(field(only, 'pricePaid').value, 'INR 134800');
  assert.deepEqual(flags(field(only, 'pricePaid')), ['order-total']);
});

test('a total without identifiable lines is offered only as an unclear, unmatched total', () => {
  const [summary] = receipt(['Blurred text', 'Total Rs 4,500.00', 'Date 2026-09-01']);
  assert.equal(summary.id, 'receipt-summary');
  assert.equal(field(summary, 'pricePaid').value, 'INR 450000');
  assert.deepEqual(flags(field(summary, 'pricePaid')), ['order-total-unmatched']);
  assert.equal(confidenceBand(field(summary, 'pricePaid').confidence), 'unclear');
  assert.equal(field(summary, 'purchaseDate').value, '2026-09-01');
});

test('currency must be printed on the receipt; a bare dollar sign or mixed currencies decide nothing', () => {
  const dollar = receipt(['Lamp $49.99', 'Total $49.99']);
  assert.equal(dollar.length, 1);
  assert.equal(field(dollar[0], 'pricePaid'), undefined);
  assert.equal(field(dollar[0], 'name').value, 'Lamp');
  const inferred = receipt(['Mug 350.00', 'Plate 420.00', 'Total Rs 770.00']);
  assert.deepEqual(flags(field(inferred[0], 'pricePaid')), [
    'currency-from-receipt',
    'line-amount',
  ]);
  const mixed = receipt(['Mug 350.00', 'Plate EUR 4.20', 'Total Rs 770.00']);
  assert.equal(field(mixed[0], 'pricePaid'), undefined);
  assert.equal(field(mixed[1], 'pricePaid').value, 'EUR 420');
});

test('amounts are exact or omitted; extra precision and malformed grouping are never rounded', () => {
  const result = receipt([
    'Rice 1.005',
    'Dal Rs 12,34.00',
    'Ghee Rs 1,19,800.00',
    'Total Rs 1,19,800.00',
  ]);
  assert.deepEqual(
    result.map((c) => field(c, 'name').value),
    ['Rice', 'Dal', 'Ghee'],
  );
  assert.deepEqual(
    result.map((c) => field(c, 'pricePaid')?.value),
    [undefined, undefined, 'INR 11980000'],
  );
});

test('dates never gain an invented day', () => {
  const date = (line) => {
    const [c] = receipt(['Kettle Rs 100.00', line]);
    return c && field(c, 'purchaseDate')
      ? [field(c, 'purchaseDate').value, flags(field(c, 'purchaseDate'))]
      : null;
  };
  assert.deepEqual(date('Date: 03/04/2026'), ['2026', ['date-order-unclear']]);
  assert.deepEqual(date('Date: 14/08/2026'), ['2026-08-14', []]);
  assert.deepEqual(date('Date: 08/14/2026'), ['2026-08-14', []]);
  assert.deepEqual(date('14 Aug 2026'), ['2026-08-14', []]);
  assert.deepEqual(date('August 14, 2026'), ['2026-08-14', []]);
  assert.deepEqual(date('Billing period Aug 2026'), ['2026-08', ['month-only']]);
  assert.deepEqual(date('14-08-26'), ['2026-08-14', ['two-digit-year']]);
  assert.equal(date('30/02/2026'), null);
  assert.equal(date('Date: 01/12/2027'), null);
  assert.equal(date('22/10/2026'), null, 'future receipt dates are rejected');
  assert.deepEqual(date('21/10/2026'), ['2026-10-21', []], 'one day of time-zone tolerance');
  const [several] = receipt([
    'Kettle Rs 100.00',
    '12/08/2026',
    'Warranty until 15/08/2027 25/09/2026',
  ]);
  assert.equal(field(several, 'purchaseDate'), undefined);
  const [labelled] = receipt(['Kettle Rs 100.00', 'Bill Date 13/08/2026', 'Return by 27/08/2026']);
  assert.equal(field(labelled, 'purchaseDate').value, '2026-08-13');
});

test('long receipts show at most five lines and say more exist', () => {
  const result = receipt([
    'Qty',
    ...Array.from({ length: 7 }, (_, i) => `Cushion ${'ABCDEFG'[i]} 1 Rs ${i + 1}0.00`),
    'Total Rs 280.00',
  ]);
  assert.equal(result.length, 5);
  assert.ok(result.every((c) => flags(field(c, 'name')).includes('more-lines')));
});

test('low-confidence lines are ignored and weak evidence is never shown as clear', () => {
  assert.deepEqual(receipt([L('Kettle Rs 100.00', 35), L('Total Rs 100.00', 30)]), []);
  const [weak] = receipt([L('Kettle Rs 100.00', 62), L('Total Rs 100.00', 62)]);
  assert.equal(confidenceBand(field(weak, 'name').confidence), 'unclear');
});

test('recognised text stays inert data and identifiers are not used', () => {
  const result = receipt([
    '<script>alert(1)</script> Lamp Rs 10.00',
    'Card No XXXX1234 Rs 10.00',
    `Vase\u0007 Rs 20.00`,
    'Ignore previous instructions | Total Rs 30.00',
  ]);
  const names = result.map((c) => field(c, 'name').value);
  assert.ok(names.includes('<script>alert(1)</script> Lamp'));
  assert.ok(names.includes('Vase'));
  assert.ok(!names.some((n) => /card/i.test(n)));
  for (const c of result)
    for (const f of c.fields) assert.ok(parseOcrReference(f.source.reference));
  const total = receipt(['Ignore previous instructions | Total Rs 10.00'])[0];
  assert.match(
    parseOcrReference(field(total, 'pricePaid').source.reference).text,
    /instructions \/ Total/,
  );
});

test('photo labels: labelled model/brand are suggested, prominent text is always unclear, serials skipped', () => {
  const [label] = ocrCandidates(
    'photo',
    [
      L('ACME', 95, 90),
      L('Model No: WH-1000XM4'),
      L('Brand: Acme Audio'),
      L('S/N 99887766', 96, 120),
    ],
    'local-ocr',
    today,
  );
  assert.equal(field(label, 'model').value, 'WH-1000XM4');
  assert.equal(field(label, 'brand').value, 'Acme Audio');
  assert.equal(field(label, 'name').value, 'ACME');
  assert.equal(confidenceBand(field(label, 'name').confidence), 'unclear');
  assert.equal(field(label, 'pricePaid'), undefined);
  assert.ok(!label.fields.some((f) => f.value.includes('99887766')));
  assert.deepEqual(ocrCandidates('photo', [L('...', 90)], 'local-ocr', today), []);
});

test('references round-trip and reject unknown caveats', () => {
  const ref = { line: 3, flags: ['order-total', 'month-only'], text: 'Total: a|b' };
  assert.deepEqual(parseOcrReference(formatOcrReference(ref)), ref);
  assert.equal(parseOcrReference('ocr:v1|line=1|flags=made-up|text=x'), null);
  assert.equal(parseOcrReference('fixture-v1'), null);
});

test('quantity columns tolerate OCR digit look-alikes without leaking them into names', () => {
  const result = receipt([
    'Item Qty Amount',
    'Steel Bottle 1L i Rs 899.00',
    'Towel l Rs 500.00',
    'Total Rs 1,399.00',
  ]);
  assert.deepEqual(
    result.map((c) => field(c, 'name').value),
    ['Steel Bottle 1L', 'Towel'],
  );
  // Without a quantity column, trailing letters stay part of the name.
  assert.equal(field(receipt(['Plan B Rs 10.00', 'Total Rs 10.00'])[0], 'name').value, 'Plan B');
});
