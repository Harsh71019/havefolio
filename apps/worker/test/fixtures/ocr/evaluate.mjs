/**
 * PER-45 field-level evaluation of real local OCR on the labelled synthetic set. Runs the
 * production sandboxed runner and interpreter; prints a Markdown table when executed:
 *   node apps/worker/test/fixtures/ocr/evaluate.mjs
 */
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { confidenceBand, ocrCandidates } from '@havefolio/domain';
import { SandboxedOcrRunner } from '../../../dist/enrichment/ocr/local-ocr.provider.js';

const here = dirname(fileURLToPath(import.meta.url));
export const today = '2026-10-20';

/** Per-field outcome: correct, wrong (different or unsupported value) or missing. */
export async function evaluate(runner = new SandboxedOcrRunner()) {
  const labels = JSON.parse(await readFile(join(here, 'labels.json'), 'utf8'));
  const results = [];
  for (const [name, label] of Object.entries(labels)) {
    if (name.startsWith('$')) continue;
    const image = await readFile(join(here, `${name}.webp`));
    const started = performance.now();
    const signal = new AbortController().signal;
    const lines = await runner.recognize(await runner.prepare(image, signal), signal);
    const ms = Math.round(performance.now() - started);
    const candidates = ocrCandidates(label.kind, lines, 'local-ocr', today);
    const fields = [];
    const count = Math.max(candidates.length, label.candidates.length);
    for (let i = 0; i < count; i++) {
      const expected = label.candidates[i] ?? {};
      const actual = candidates[i]?.fields ?? [];
      const names = new Set([...Object.keys(expected), ...actual.map((f) => f.field)]);
      for (const field of names) {
        const truth = expected[field] ?? null;
        const got = actual.find((f) => f.field === field);
        const outcome = got
          ? got.value === truth
            ? 'correct'
            : 'wrong'
          : truth === null
            ? 'correct-absent'
            : 'missing';
        fields.push({
          candidate: i,
          field,
          truth,
          value: got?.value ?? null,
          band: got ? confidenceBand(got.confidence) : null,
          outcome,
        });
      }
    }
    results.push({ name, kind: label.kind, ms, candidates, fields });
  }
  return results;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const results = await evaluate();
  const totals = {};
  console.log('| Fixture | ms | Correct | Correctly absent | Wrong (band) | Missing |');
  console.log('| --- | ---: | ---: | ---: | --- | ---: |');
  for (const r of results) {
    const by = (o) => r.fields.filter((f) => f.outcome === o);
    const wrong = by('wrong').map((f) => `${f.field}=${JSON.stringify(f.value)} (${f.band})`);
    console.log(
      `| ${r.name} | ${r.ms} | ${by('correct').length} | ${by('correct-absent').length} | ${wrong.join('; ') || '0'} | ${
        by('missing')
          .map((f) => f.field)
          .join(', ') || '0'
      } |`,
    );
    for (const f of r.fields) {
      totals[f.field] ??= { correct: 0, absent: 0, wrong: 0, missing: 0 };
      totals[f.field][
        { correct: 'correct', 'correct-absent': 'absent', wrong: 'wrong', missing: 'missing' }[
          f.outcome
        ]
      ]++;
    }
  }
  console.log('\n| Field | Correct | Correctly absent | Wrong | Missing |');
  console.log('| --- | ---: | ---: | ---: | ---: |');
  for (const [field, t] of Object.entries(totals))
    console.log(`| ${field} | ${t.correct} | ${t.absent} | ${t.wrong} | ${t.missing} |`);
}
