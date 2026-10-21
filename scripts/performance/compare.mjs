import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { summary, validateReport } from './core.mjs';
const directory = resolve(import.meta.dirname, '../../docs/testing');
const read = async (name) =>
  validateReport(JSON.parse(await readFile(`${directory}/${name}`, 'utf8')));
const primary = await read('per-94-baseline.json'),
  control = await read('per-94-control.json');
if (
  primary.metadata.runtimeFingerprint !== control.metadata.runtimeFingerprint ||
  primary.metadata.buildId !== control.metadata.buildId ||
  control.metadata.config.instrument !== false
)
  throw new Error('Incomparable overhead control');
const a = primary.cases.find((r) => r.sizePerOwner === 1000),
  b = control.cases.find((r) => r.sizePerOwner === 1000);
const ratio = (on, off) => ((on / off - 1) * 100).toFixed(1) + '%';
const lines = [
  '# PER-94 instrumentation control',
  '',
  `Same build \`${primary.metadata.sourceSha}\`, fingerprint \`${primary.metadata.runtimeFingerprint}\`.`,
  `Primary began ${primary.metadata.measuredAt}; separate instrumentation-off control began ${control.metadata.measuredAt}.`,
  '',
  'This is a sequential A/B noise/overhead check, not proof of a causal speed difference. The control disables pool/query wrappers, wait sampling, EXPLAIN capture and browser PerformanceObservers. CDP network accounting/throttling, the dead outbound proxy, application logging, fixture shape and Playwright actionability remain common to both runs. Their absolute overhead is unquantified. Host/JIT/thermal drift and sample-order effects remain possible; negative deltas are not optimisations.',
  '',
  '| Endpoint | Concurrency | n each | Instrumented p50 / p95 ms | Control p50 / p95 ms | p50 relative delta |',
  '| --- | --- | --- | --- | --- | --- |',
];
for (const on of a.api) {
  const off = b.api.find((r) => r.endpoint === on.endpoint && r.concurrency === on.concurrency);
  if (!off || off.latencyMs.n !== 1000 || on.latencyMs.n !== 1000 || off.errors || on.errors)
    throw new Error('Incomplete overhead API case');
  lines.push(
    `| ${on.endpoint} | ${on.concurrency} | 1000 | ${on.latencyMs.p50} / ${on.latencyMs.p95} | ${off.latencyMs.p50} / ${off.latencyMs.p95} | ${ratio(on.latencyMs.p50, off.latencyMs.p50)} |`,
  );
}
lines.push(
  '',
  '| Home profile/cache | n each | Instrumented median ready ms | Control median ready ms | Relative delta |',
  '| --- | --- | --- | --- | --- |',
);
for (const profile of ['desktop', 'mobile'])
  for (const condition of ['cold', 'warm']) {
    const values = (row) =>
      row.browser
        .filter((r) => r.profile === profile && r.route === 'home' && r.condition === condition)
        .map((r) => r.readyMs);
    const on = summary(values(a)),
      off = summary(values(b));
    if (on.n !== 5 || off.n !== 5) throw new Error('Incomplete browser control');
    lines.push(
      `| ${profile}/${condition} | 5 | ${on.p50.toFixed(1)} | ${off.p50.toFixed(1)} | ${ratio(on.p50, off.p50)} |`,
    );
  }
await writeFile(`${directory}/per-94-overhead.md`, lines.join('\n') + '\n');
console.log('PASS: same-build instrumentation control compared');
