// Reports are constructed from numerical samples and fixed labels, never request objects.
export function summary(values) {
  if (!values.length || values.some((n) => !Number.isFinite(n) || n < 0))
    throw new Error('Invalid numerical sample');
  const sorted = [...values].sort((a, b) => a - b);
  const q = (p) => Number(sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)].toFixed(3));
  return { n: values.length, min: q(0), p50: q(0.5), p95: q(0.95), p99: q(0.99), max: q(1) };
}

export function options(args) {
  const result = {
    sizes: [100, 1000],
    runs: 5,
    samples: 1000,
    browser: true,
    api: true,
    instrument: true,
  };
  for (const arg of args) {
    if (arg === '--route=store') result.route = 'store';
    else if (arg === '--profile=mobile') result.profile = 'mobile';
    else if (arg === '--calibration') result.calibration = true;
    else if (arg === '--media-audit') result.mediaAudit = true;
    else if (arg === '--browser-only') result.api = false;
    else if (arg === '--api-only') result.browser = false;
    else if (arg === '--no-instrument') result.instrument = false;
    else if (arg.startsWith('--sizes=')) result.sizes = arg.slice(8).split(',').map(Number);
    else throw new Error('Unknown option');
  }
  if (!result.api && !result.browser) throw new Error('No measurement selected');
  if (!result.sizes.length || result.sizes.some((n) => ![100, 1000, 10000].includes(n)))
    throw new Error('Unsupported fixture size');
  if (new Set(result.sizes).size !== result.sizes.length) throw new Error('Duplicate fixture size');
  return result;
}

export async function sample(count, concurrency, operation) {
  const timings = [],
    statuses = {};
  let next = 0;
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (next < count) {
        const index = next++;
        const start = performance.now();
        let status = 0;
        try {
          status = await operation(index);
        } catch {
          /* Numeric transport error only. */
        }
        timings[index] = performance.now() - start;
        statuses[status] = (statuses[status] ?? 0) + 1;
      }
    }),
  );
  return {
    latencyMs: summary(timings),
    statuses,
    errors: Object.entries(statuses)
      .filter(([status]) => Number(status) < 200 || Number(status) >= 300)
      .reduce((total, [, n]) => total + n, 0),
    samplesMs: timings.map((n) => Number(n.toFixed(3))),
  };
}

const strings = {
  sourceSha: /^[a-f0-9]{40}$/,
  harnessSha: /^[a-f0-9]{40}$/,
  runtimeFingerprint: /^[a-f0-9]{64}$/,
  buildId: /^[A-Za-z0-9_-]{1,80}$/,
  mode: /^production-build$/,
  apiConfiguration: /^test-with-local-storage-adapter$/,
  node: /^(v[0-9.]+|Aggregate|Sort|Limit|Result|Unique|Hash Join|Nested Loop|Gather|Gather Merge|Seq Scan|Index Scan|Index Only Scan|Bitmap Heap Scan|Bitmap Index Scan|Append|Merge Append|Recursive Union|BitmapAnd|BitmapOr|Tid Scan|Tid Range Scan|Subquery Scan|Function Scan|Table Function Scan|Values Scan|CTE Scan|Named Tuplestore Scan|WorkTable Scan|Foreign Scan|Custom Scan|Materialize|Memoize|Incremental Sort|Group|WindowAgg|SetOp|LockRows|ModifyTable|Merge Join|Hash|ProjectSet)$/,
  postgres: /^postgres \(PostgreSQL\) [0-9.]+(?: \([A-Za-z0-9 ._-]+\))?$/,
  platform: /^(darwin|linux|win32)$/,
  arch: /^(arm64|x64)$/,
  cpu: /^[A-Za-z0-9()@ ._+-]{1,100}$/,
  browser: /^[0-9.]{1,32}$/,
  measuredAt: /^[0-9TZ:.+-]{20,32}$/,
  name: /^(desktop|retina|mobile)$/,
  profile: /^(desktop|retina|mobile)$/,
  view: /^(store|revisit|item|gallery|interaction)$/,
  density: /^(compact|comfortable|large)$/,
  sidebar: /^(expanded|collapsed)$/,
  route: /^(home|store|item|add|insights)$/,
  condition: /^(cold|warm)$/,
  endpoint: /^(home|items|filtered|facets|item|spending|merchants)$/,
  failureKind: /^(priming-timeout|ready-timeout)$/,
  interaction: /^(navigation|load-more|filter|save-feedback)$/,
};
export function validateReport(report) {
  const inspect = (value, key) => {
    if (typeof value === 'string') {
      if (!strings[key]?.test(value)) throw new Error('Unexpected text in numerical report');
    } else if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw new Error('Invalid numerical report');
    } else if (Array.isArray(value)) {
      for (const item of value) inspect(item, key);
    } else if (value && typeof value === 'object') {
      for (const [name, item] of Object.entries(value)) {
        if (/cookie|token|secret|headers|url|path|body|queryText|queryValues|stack/i.test(name))
          throw new Error('Private report field rejected');
        inspect(item, name);
      }
    } else if (value !== null && typeof value !== 'boolean')
      throw new Error('Invalid report value');
  };
  inspect(report, 'report');
  if (JSON.stringify(report).length > 4 * 1024 * 1024)
    throw new Error('Report exceeds artifact budget');
  return report;
}

// Prime static assets outside the sampled network window and drain prior traffic.
// Private no-store data/media must still refetch during the measured navigation.
export async function primeWarm(cdp, profile, prepare) {
  await cdp.send('Page.stopLoading');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: false });
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: -1,
  });
  try {
    await prepare();
  } finally {
    await cdp.send('Page.stopLoading');
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: profile.latency,
      downloadThroughput: profile.download,
      uploadThroughput: profile.upload,
    });
  }
}
// PER-97: classify an authenticated photo request by variant label only; the URL is discarded.
export function mediaVariant(url) {
  let pathname;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return null;
  }
  return (
    pathname.match(/^\/api\/v1\/items\/[^/]+\/photos\/[^/]+\/content\/(thumbnail|display)$/)?.[1] ??
    null
  );
}

// Sum complete-event durations (microseconds) for image decoding; other trace data is ignored.
export function decodeMs(trace) {
  const totals = { decodeImageMs: 0, imageDecodeTaskMs: 0 };
  for (const event of trace.traceEvents ?? []) {
    if (event.ph !== 'X' || typeof event.dur !== 'number') continue;
    if (event.name === 'Decode Image') totals.decodeImageMs += event.dur / 1000;
    if (event.name === 'ImageDecodeTask') totals.imageDecodeTaskMs += event.dur / 1000;
  }
  return {
    decodeImageMs: Number(totals.decodeImageMs.toFixed(3)),
    imageDecodeTaskMs: Number(totals.imageDecodeTaskMs.toFixed(3)),
  };
}

export function observed(values) {
  const completed = values.filter((value) => typeof value === 'number' && Number.isFinite(value));
  return {
    attempts: values.length,
    missing: values.length - completed.length,
    summary: completed.length ? summary(completed) : null,
  };
}

export async function assertFreePorts(ports) {
  const { createServer } = await import('node:net');
  const servers = [];
  try {
    for (const port of ports) {
      const server = createServer();
      servers.push(server);
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen({ host: '127.0.0.1', port, exclusive: true }, resolve);
      });
    }
  } finally {
    await Promise.all(
      servers.filter((s) => s.listening).map((s) => new Promise((r) => s.close(r))),
    );
  }
}

export function censorObservation(identity, kind, elapsed, stats) {
  if (!['priming-timeout', 'ready-timeout'].includes(kind))
    throw new Error('Unknown censoring reason');
  const priming = kind === 'priming-timeout';
  return {
    profile: identity.profile,
    repeat: identity.repeat,
    route: identity.route,
    condition: identity.condition,
    readyMs: null,
    readyLowerBoundMs: priming ? null : elapsed,
    lcpMs: null,
    longTasks: null,
    longTaskMs: null,
    domContentLoadedMs: null,
    mediaTimedOut: true,
    requests: priming ? null : stats.requests,
    transferBytes: priming ? null : stats.transferBytes,
    jsBytes: priming ? null : stats.jsBytes,
    errors: priming ? null : stats.errors,
    failedRequests: priming ? null : stats.failedRequests,
    failureKind: kind,
  };
}
