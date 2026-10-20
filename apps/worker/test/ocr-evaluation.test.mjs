import assert from 'node:assert/strict';
import test from 'node:test';
import { parseOcrReference, validateEnrichmentCandidates } from '@havefolio/domain';
import { evaluate } from './fixtures/ocr/evaluate.mjs';

// Real local OCR on the labelled synthetic set (see docs/architecture/photo-receipt-ocr.md).
test(
  'PER-45 local OCR evaluation: honest invariants hold and core fixtures read exactly',
  { timeout: 180000 },
  async (t) => {
    const results = await evaluate();
    const byName = Object.fromEntries(results.map((r) => [r.name, r]));
    for (const r of results) {
      t.diagnostic(
        `${r.name}: ${r.ms}ms ${r.fields.map((f) => `${f.field}:${f.outcome}${f.band ? `/${f.band}` : ''}`).join(' ')}`,
      );
      assert.deepEqual(
        validateEnrichmentCandidates(r.candidates, 'local-ocr', r.kind),
        r.candidates,
      );
      for (const candidate of r.candidates)
        for (const field of candidate.fields) {
          const reference = parseOcrReference(field.source.reference);
          assert.ok(reference, 'every suggestion carries parseable line provenance');
          // A wrong value must never be presented as clear.
          const outcome = r.fields.find((f) => f.field === field.field && f.value === field.value);
          if (outcome?.outcome === 'wrong')
            assert.notEqual(outcome.band, 'clear', `${r.name} ${field.field}`);
          // Several item lines never share the order total.
          if (r.candidates.length > 1) assert.ok(!reference.flags.includes('order-total'));
          // Purchase money/date never come from a product photo.
          if (r.kind === 'photo') assert.ok(!['pricePaid', 'purchaseDate'].includes(field.field));
        }
    }
    for (const name of [
      'receipt-multi-clean',
      'receipt-single-total',
      'receipt-ambiguous-date',
      'receipt-dollar',
      'receipt-long',
      'receipt-noisy',
    ])
      assert.deepEqual(
        byName[name].fields.filter((f) => f.outcome === 'wrong' || f.outcome === 'missing'),
        [],
        name,
      );
    const ambiguous = byName['receipt-ambiguous-date'].candidates[0].fields.find(
      (f) => f.field === 'purchaseDate',
    );
    assert.equal(ambiguous.value, '2026');
    assert.deepEqual(parseOcrReference(ambiguous.source.reference).flags, ['date-order-unclear']);
    assert.ok(
      byName['receipt-long'].candidates.every((c) =>
        c.fields.some((f) => parseOcrReference(f.source.reference).flags.includes('more-lines')),
      ),
    );
    assert.deepEqual(byName['photo-no-text'].candidates, []);
  },
);
