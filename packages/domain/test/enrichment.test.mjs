import assert from 'node:assert/strict';
import test from 'node:test';
import {
  callEnrichmentProvider,
  validateEnrichmentCandidates,
  EnrichmentCircuit,
} from '../dist/index.js';
const field = {
  field: 'brand',
  value: 'Synthetic',
  confidence: 0.42,
  source: { provider: 'fake', inputKind: 'name', reference: 'fixture-v1' },
};
const candidates = [
  { id: 'first', fields: [field] },
  { id: 'ambiguous', fields: [{ ...field, value: 'Alternative' }] },
];
test('ambiguous candidates retain per-field provenance/confidence; payload extras are stripped', () => {
  assert.deepEqual(validateEnrichmentCandidates(candidates, 'fake', 'name'), candidates);
  assert.equal(
    validateEnrichmentCandidates(
      [{ id: 'first', fields: [{ ...field, prompt: 'private' }] }],
      'fake',
      'name',
    )[0].fields[0].prompt,
    undefined,
  );
});
test('untrusted adapters cannot suggest financial/date/media fields, invalid confidence, duplicates or arbitrary payloads', () => {
  for (const bad of [
    { ...field, field: 'pricePaidMinor' },
    { ...field, confidence: -1 },
    { ...field, confidence: NaN },
    { ...field, confidence: 1.1 },
    { ...field, value: '' },
    { ...field, value: 'x'.repeat(301) },
    { ...field, source: { ...field.source, provider: 'other' } },
    { ...field, source: { ...field.source, inputKind: 'receipt' } },
  ])
    assert.throws(() =>
      validateEnrichmentCandidates([{ id: 'first', fields: [bad] }], 'fake', 'name'),
    );
  assert.throws(() =>
    validateEnrichmentCandidates([{ id: 'first', fields: [field, field] }], 'fake', 'name'),
  );
  assert.throws(() => validateEnrichmentCandidates([...candidates, ...candidates], 'fake', 'name'));
  assert.throws(() =>
    validateEnrichmentCandidates(
      Array.from({ length: 6 }, (_, i) => ({ id: String(i), fields: [field] })),
      'fake',
      'name',
    ),
  );
});
test('timeout aborts adapter; late success cannot become a returned candidate', async () => {
  let aborted = false,
    resolve;
  const provider = {
    id: 'fake',
    kinds: ['name'],
    suggest: (_input, signal) => {
      signal.addEventListener('abort', () => (aborted = true));
      return new Promise((r) => (resolve = r));
    },
  };
  await assert.rejects(
    callEnrichmentProvider(provider, { kind: 'name', name: 'private' }, 10),
    /ENRICHMENT_TIMEOUT/,
  );
  assert.equal(aborted, true);
  resolve(candidates);
});
test('success and failure settle cleanly without returning provider exception text as suggestions', async () => {
  assert.deepEqual(
    await callEnrichmentProvider(
      { id: 'fake', kinds: ['name'], suggest: async () => candidates },
      { kind: 'name', name: 'private' },
    ),
    candidates,
  );
  await assert.rejects(
    callEnrichmentProvider(
      {
        id: 'fake',
        kinds: ['url'],
        suggest: async () => {
          throw new Error('private payload');
        },
      },
      { kind: 'url', url: 'http://private.test' },
    ),
  );
});
test('circuit opens after three failures, blocks until cooldown and resets on success', () => {
  let now = 0;
  const c = new EnrichmentCircuit(() => now);
  c.failure();
  c.failure();
  assert.equal(c.isOpen(), false);
  c.failure();
  assert.equal(c.isOpen(), true);
  now = 60000;
  assert.equal(c.isOpen(), false);
  c.success();
  c.failure();
  assert.equal(c.isOpen(), false);
});
