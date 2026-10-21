import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { summary, validateReport, observed } from './core.mjs';
const directory = resolve(import.meta.dirname, '../../docs/testing');
const result = validateReport(
  JSON.parse(await readFile(`${directory}/per-94-baseline.json`, 'utf8')),
);
const tiers = validateReport(
  JSON.parse(await readFile(`${directory}/per-94-api-tiers.json`, 'utf8')),
);
if (
  tiers.metadata.runtimeFingerprint !== result.metadata.runtimeFingerprint ||
  tiers.metadata.buildId !== result.metadata.buildId
)
  throw new Error('Incomparable API tiers');
const apiCases = [...result.cases, ...tiers.cases].sort((a, b) => a.sizePerOwner - b.sizePerOwner);
const ms = (n) => Math.round(n),
  range = (s) => (s ? `${ms(s.p50)} (${ms(s.min)}–${ms(s.max)})` : 'unavailable');
const lines = [
  '# PER-94 numerical baseline tables',
  '',
  `Build source: \`${result.metadata.sourceSha}\`; fingerprint: \`${result.metadata.runtimeFingerprint}\`.`,
  `Measured at ${result.metadata.measuredAt}; ${result.metadata.cpu}, ${result.metadata.logicalCpus} logical CPUs, ${result.metadata.memoryGiB} GiB; ${result.metadata.platform}/${result.metadata.arch}; Node ${result.metadata.node}; ${result.metadata.postgres}; Chromium ${result.metadata.browser}.`,
  `Build ID: \`${result.metadata.buildId}\`. Source dirty: ${result.metadata.sourceDirty}; see recipe for added harness files and source boundaries. Fixture cleanup: ${result.cleanup}; cluster cleanup: ${result.clusterCleanup}.`,
  '',
  'Browser values are median (minimum–maximum), five repeats per cell. These extrema are descriptive variability, not confidence intervals. Censored readiness is excluded and its completed n/5 is shown. LCP with an incomplete-media count is only an observed candidate and cannot establish a pass. Transfers include completed resources only.',
  '',
  '| Items/owner | Profile | Route | Cache | Ready ms | LCP ms | JS KiB | Total KiB | Requests | Long task ms | Errors / incomplete media windows |',
  '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
];
for (const row of result.cases) {
  if (!row.fixtureRestored) throw new Error('Unverified fixture cleanup');
  for (const profile of ['desktop', 'mobile'])
    for (const route of ['home', 'store', 'item', 'add', 'insights'])
      for (const condition of ['cold', 'warm']) {
        const values = row.browser.filter(
          (b) => b.profile === profile && b.route === route && b.condition === condition,
        );
        if (values.length !== 5) throw new Error('Five repetitions required');
        const summarize = (key) => observed(values.map((b) => b[key])).summary;
        const lcps = values.map((b) => b.lcpMs).filter((v) => v !== null);
        lines.push(
          `| ${row.sizePerOwner} | ${profile} | ${route} | ${condition} | ${range(summarize('readyMs')) + ' n=' + (summarize('readyMs')?.n ?? 0) + '/5'} | ${lcps.length === 5 ? range(summary(lcps)) : 'incomplete'} | ${summarize('jsBytes') ? (summarize('jsBytes').p50 / 1024).toFixed(1) : 'unavailable'} | ${summarize('transferBytes') ? (summarize('transferBytes').p50 / 1024).toFixed(1) : 'unavailable'} | ${range(summarize('requests'))} | ${range(summarize('longTaskMs'))} | ${values.reduce((n, b) => n + b.errors, 0)} / ${values.filter((b) => b.mediaTimedOut).length} |`,
        );
      }
}
lines.push(
  '',
  '## Scripted interactions',
  '',
  'Confirmed results include network, Playwright actionability, scrolling and two-frame observation overhead. They are not field INP or immediate-acknowledgement latency.',
  '',
  '| Items/owner | Profile | Action | n | Latency ms median (range) |',
  '| --- | --- | --- | --- | --- |',
);
for (const row of result.cases)
  for (const profile of ['desktop', 'mobile'])
    for (const interaction of ['navigation', 'load-more', 'filter', 'save-feedback']) {
      const values = row.browser.filter(
        (b) => b.profile === profile && b.interaction === interaction,
      );
      if (values.length !== 5) throw new Error('Five interaction repeats required');
      lines.push(
        `| ${row.sizePerOwner} | ${profile} | ${interaction} | ${values.length} | ${range(summary(values.map((b) => b.latencyMs)))} |`,
      );
    }
lines.push(
  '',
  '## Warm API samples',
  '',
  `API-only tiers began ${tiers.metadata.measuredAt}; the representative full run began ${result.metadata.measuredAt}. The same compiled build is verified.`,
  'Every row: 20 warmups then 1,000 completed requests. Raw numerical samples, errors, root plan summaries and sampled waits remain in the JSON artifact. Pool/lock values are statement/connection distributions, not request-level exclusive durations.',
  '',
  '| Items/owner | Endpoint | Concurrency | p50 ms | p95 ms | p99 ms | Errors | Pool p95 ms | Owner-lock round trip p95 ms | Sampled Lock sessions / snapshots |',
  '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
);
for (const row of apiCases)
  for (const a of row.api)
    lines.push(
      `| ${row.sizePerOwner} | ${a.endpoint} | ${a.concurrency} | ${a.latencyMs.p50} | ${a.latencyMs.p95} | ${a.latencyMs.p99} | ${a.errors} | ${a.db.poolMs?.p95 ?? 'off'} | ${a.db.lockRoundTripMs?.p95 ?? 'n/a'} | ${a.waits.lockSessions} / ${a.waits.samples} |`,
    );
lines.push(
  '',
  '## Separate warm server plans and mixed-owner service samples',
  '',
  'Execution attribution gap: the collector captures SELECT-prefixed statements only. CTE-prefixed domain aggregates are excluded. Spending/merchant plan rows below cover the auth lookup only; they do not measure the aggregate SQL execution. HTTP timings include the complete endpoint. Home plans are bounded to ten representative SELECTs. Complete domain CTE plans remain open under PER-99.',
  '',
  '| Items/owner | Endpoint (concurrency 1) | Representative SELECT plans | Largest execution ms | Largest root shared hits / reads |',
  '| --- | --- | --- | --- | --- |',
);
for (const row of apiCases)
  for (const a of row.api.filter((a) => a.concurrency === 1))
    lines.push(
      `| ${row.sizePerOwner} | ${a.endpoint} | ${a.plans.length} | ${Math.max(...a.plans.map((p) => p.executionMs))} | ${Math.max(...a.plans.map((p) => p.sharedHitBlocks))} / ${Math.max(...a.plans.map((p) => p.sharedReadBlocks))} |`,
    );
for (const row of apiCases)
  lines.push(
    '',
    `${row.sizePerOwner} items/owner, Home service alternating owners, c4, n=${row.mixedOwnerService.latencyMs.n}: p50/p95/p99 ${row.mixedOwnerService.latencyMs.p50}/${row.mixedOwnerService.latencyMs.p95}/${row.mixedOwnerService.latencyMs.p99} ms, ${row.mixedOwnerService.errors} errors. Excludes HTTP/authentication.`,
  );
await writeFile(`${directory}/per-94-baseline-tables.md`, lines.join('\n') + '\n');
console.log('PASS: five-repeat baseline tables generated');
