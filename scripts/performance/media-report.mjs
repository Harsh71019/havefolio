// PER-97: before/after tables from the validated numerical media-audit artifacts.
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { summary, validateReport } from './core.mjs';
const directory = resolve(import.meta.dirname, '../../docs/testing');
const load = async (name) =>
  validateReport(JSON.parse(await readFile(`${directory}/per-97-media-${name}.json`, 'utf8')));
const runs = { before: await load('before'), after: await load('after') };
for (const run of Object.values(runs))
  if (!run.cleanup || !run.clusterCleanup || !run.cases[0]?.fixtureRestored)
    throw new Error('Unverified fixture cleanup');
const rows = (run) => run.cases[0].media;
const median = (values) => {
  const done = values.filter((v) => typeof v === 'number' && Number.isFinite(v));
  return done.length ? summary(done).p50 : null;
};
const fmt = (n, digits = 0) => (n === null ? '—' : n.toFixed(digits));
const kib = (v, key) => ((v?.thumbnail?.[key] ?? 0) + (v?.display?.[key] ?? 0)) / 1024;
const largest = (set) =>
  Math.max(
    0,
    ...set.map(
      (r) =>
        Math.max(r.variants?.thumbnail?.maxBytes ?? 0, r.variants?.display?.maxBytes ?? 0) / 1024,
    ),
  );
const cell = (values, digits = 0) => {
  const done = values.filter((v) => typeof v === 'number' && Number.isFinite(v));
  if (!done.length) return `— (0/${values.length})`;
  const s = summary(done);
  const n = done.length < values.length ? `, ${done.length}/${values.length}` : '';
  return `${fmt(s.p50, digits)} (${fmt(s.min, digits)}–${fmt(s.max, digits)}${n})`;
};
const meta = (run) =>
  `source \`${run.metadata.sourceSha}\`, build \`${run.metadata.buildId}\`, fingerprint \`${run.metadata.runtimeFingerprint.slice(0, 12)}…\`, measured ${run.metadata.measuredAt}, Chromium ${run.metadata.browser}, ${run.metadata.config.runs} repeats`;
const lines = [
  '# PER-97 protected-photo media audit tables',
  '',
  `Before: ${meta(runs.before)}.`,
  `After: ${meta(runs.after)}.`,
  `Host: ${runs.after.metadata.cpu}, ${runs.after.metadata.logicalCpus} logical CPUs, ${runs.after.metadata.memoryGiB} GiB, ${runs.after.metadata.platform}/${runs.after.metadata.arch}, Node ${runs.after.metadata.node}, ${runs.after.metadata.postgres}.`,
  '',
  'Cells are median (minimum–maximum) over the repeats; a trailing n/5 counts completed observations when some were censored. Every observation is cold (cache disabled) — private `no-store` media refetch on every document load anyway. "Media ready" is navigation start to every visible owner photo complete, bounded at 15 s; "timed out" counts windows that hit that bound. Cover KiB are CDP encoded bytes for completed protected-photo responses (thumbnail + display) in the observation window, including offscreen lazy images the browser chose to fetch. Supply is the selected variant’s declared pixel width ÷ device pixels needed to fill the slot with `object-fit: cover` (1 = exact; <1 = upscaled). Decode is Chromium `ImageDecodeTask` time from an in-memory trace.',
  '',
  '| Profile | View | Density / sidebar | Visible covers thumb/display (before → after) | Media ready ms before | after | Timed out before → after | Cover KiB before | after | Largest cover KiB before → after | Supply after (min–max) | Decode ms before → after | Errors before → after |',
  '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
];
const key = (r) => [r.profile, r.view, r.density ?? '', r.sidebar ?? ''].join('/');
const scenarios = [...new Set(rows(runs.after).map(key))];
for (const scenario of scenarios) {
  const [profile, view, density, sidebar] = scenario.split('/');
  if (view === 'interaction' || view === 'revisit') continue;
  const pick = (run) => rows(run).filter((r) => key(r) === scenario);
  const [b, a] = [pick(runs.before), pick(runs.after)];
  const visible = (set) =>
    `${fmt(median(set.map((r) => r.images?.visibleThumbnail)))}/${fmt(median(set.map((r) => r.images?.visibleDisplay)))}`;
  const supply = a.flatMap((r) => r.images?.visibleSupplyRatio ?? []);
  lines.push(
    `| ${profile} | ${view} | ${density ? `${density} / ${sidebar}` : '—'} | ${visible(b)} → ${visible(a)} | ${cell(b.map((r) => r.visibleMediaMs))} | ${cell(a.map((r) => r.visibleMediaMs))} | ${b.filter((r) => r.mediaTimedOut || r.censored).length} → ${a.filter((r) => r.mediaTimedOut || r.censored).length} | ${cell(b.map((r) => kib(r.variants, 'bytes')))} | ${cell(a.map((r) => kib(r.variants, 'bytes')))} | ${fmt(largest(b))} → ${fmt(largest(a))} | ${supply.length ? `${fmt(Math.min(...supply), 2)}–${fmt(Math.max(...supply), 2)}` : '—'} | ${fmt(median(b.map((r) => r.decodeMs?.imageDecodeTaskMs)), 1)} → ${fmt(median(a.map((r) => r.decodeMs?.imageDecodeTaskMs)), 1)} | ${b.reduce((n, r) => n + (r.errors ?? 0) + (r.failedRequests ?? 0), 0)} → ${a.reduce((n, r) => n + (r.errors ?? 0) + (r.failedRequests ?? 0), 0)} |`,
  );
}
lines.push(
  '',
  '## Client-side return to the Store',
  '',
  'Open the first Store card, wait for item details, then go back in the same document. A censored item open exceeded the 30 s readiness guard and is reported as missing.',
  '',
  '| Profile | Store → item open ms before | after | Protected media requests on return before → after | Requests in flight at open before → after |',
  '| --- | --- | --- | --- | --- |',
);
for (const profile of ['desktop', 'retina', 'mobile']) {
  const pick = (run) => rows(run).filter((r) => r.profile === profile && r.view === 'revisit');
  const [b, a] = [pick(runs.before), pick(runs.after)];
  const requests = (set) =>
    cell(
      set
        .filter((r) => !r.censored)
        .map((r) => (r.variants?.thumbnail?.requests ?? 0) + (r.variants?.display?.requests ?? 0)),
    );
  lines.push(
    `| ${profile} | ${cell(b.map((r) => r.itemOpenMs))} | ${cell(a.map((r) => r.itemOpenMs))} | ${requests(b)} → ${requests(a)} | ${cell(b.map((r) => r.inFlightAtOpen))} → ${cell(a.map((r) => r.inFlightAtOpen))} |`,
  );
}
lines.push(
  '',
  '## PER-94 rank-1 mobile sequence',
  '',
  'Home → Store navigation, Show more items, then a search filter on the throttled mobile profile (390×844, DPR 3, CPU 4×, 150 ms, 1.6 Mbit/s). Scripted lab latency, not field INP.',
  '',
  '| Measure | Before | After |',
  '| --- | --- | --- |',
);
const interaction = (run) => rows(run).filter((r) => r.view === 'interaction');
for (const [label, read] of [
  ['Navigation ms', (r) => r.navigationMs],
  ['Load more ms', (r) => r.loadMoreMs],
  ['Filter after load more ms', (r) => r.filterMs],
  ['Protected photo requests in flight when filtering', (r) => r.inFlightAtFilter],
  ['Cover KiB completed before filtering', (r) => kib(r.variantsBeforeFilter, 'bytes')],
  ['Display-variant requests through filter', (r) => r.variants?.display?.requests ?? 0],
  ['Errors + failed/cancelled requests', (r) => (r.errors ?? 0) + (r.failedRequests ?? 0)],
])
  lines.push(
    `| ${label} | ${cell(interaction(runs.before).map(read))} | ${cell(interaction(runs.after).map(read))} |`,
  );
await writeFile(`${directory}/per-97-media-tables.md`, lines.join('\n') + '\n');
console.log('PASS: PER-97 media tables written from validated artifacts');
