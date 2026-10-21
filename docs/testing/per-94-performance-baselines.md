# PER-94: Reproducible performance baselines and budgets

Parent: PER-93. This ticket owns measurement, fixtures and documentation. PER-90 owns navigation/history; PER-91 owns responsive fixes. No runtime optimisation or deployment is included.

## Repeatable commands and isolation

Use a fresh sibling worktree with no environment files. Kan credentials belong in the original checkout only. Never copy `.env.local` into the measurement worktree.

```sh
pnpm install --frozen-lockfile
pnpm perf:test
pnpm perf:build
pnpm perf:baseline --sizes=1000
cp docs/testing/per-94-baseline.json /tmp/per94-primary.json
pnpm perf:baseline --sizes=100,10000 --api-only
mv docs/testing/per-94-baseline.json docs/testing/per-94-api-tiers.json
# Optional stress tier, run separately after checking host capacity:
pnpm perf:baseline --sizes=10000
# Instrumentation control: all API cases, plus five Home loads per profile/cache state:
pnpm perf:baseline --sizes=1000 --calibration --no-instrument
mv docs/testing/per-94-baseline.json docs/testing/per-94-control.json
cp /tmp/per94-primary.json docs/testing/per-94-baseline.json
node scripts/performance/report.mjs
node scripts/performance/compare.mjs
# Browser-only repeat, with the same fixture recipe:
pnpm perf:baseline --sizes=100 --browser-only
```

Requirements: Node/pnpm versions from package.json, existing Playwright Chromium (`pnpm --filter @havefolio/web exec playwright install chromium` if absent), local PostgreSQL binaries `initdb`, `pg_ctl`, `postgres`. No new dependency. The harness uses existing pg, Nest testing utilities, sharp and Playwright. It refuses environment files, inherits a small environment allowlist, accepts no URL/credential arguments and binds disposable services only to loopback ports 55494/3194/3195. Each invocation overwrites the latest `per-94-baseline.json`; preserve outputs between stages as shown. Targeted diagnostics contain partial coverage and do not satisfy the full table generator. All three ports are checked by exclusive loopback bind before setup; busy ports fail without contacting the listener. Web readiness also requires the owned child process to emit its startup-ready signal before any HTTP readiness probe. These final setup-only guards were added after collection and passed a fresh production-build/real-API five-pair mobile Home startup smoke. Completed collections already verified the owned web child exited during cleanup. Stop if isolated services cannot start; never substitute CT102 or shared production services.

`perf:build` runs the existing production compilation, saves Next BUILD_ID, source SHA and a SHA-256 fingerprint of tracked runtime inputs. Measurement refuses changed inputs or a mismatched BUILD_ID. `sourceSha` identifies the build; `harnessSha` identifies the measurement checkout. A dirty flag is retained. Reports contain fixed labels and numeric data; credentials, request/response objects, query text/values, media paths, cookies, screenshots, HAR and traces are never serialized. Browser outbound traffic is forced through a dead loopback proxy except the test origin. External telemetry exporters have no credentials or destinations.

Each run creates an entirely new UTF-8 PostgreSQL cluster in a private temporary directory, separate nonprivileged migration/runtime roles, and a database per fixture tier. There is no reset/truncate/drop against an operator-provided target. Migrations are applied unchanged. End-of-tier cleanup closes API/web, clears in-memory media, drops that tier's database/roles and checks absence. Finally the owned PostgreSQL process stops and its marked scratch directory is removed, including on ordinary failures/signals. SIGKILL/host failure cannot run `finally`: inspect `havefolio-per94-*` directories beneath the OS temporary directory, verify their `PER-94-owned` marker and `pg/postmaster.pid`, then stop only that cluster with `pg_ctl -D <owned-directory>/pg -m fast -w stop` before deleting its scratch directory. Never kill an unrelated PostgreSQL process or remove a live cluster.

## Fixture and environment contract

Two synthetic owners have 1,000 items each in the representative full browser/API baseline. Additional 100/10,000-item tiers exercise API scaling only; full browser coverage at those sizes remains unmeasured. The CLI also supports a combined 100/1,000 run and an opt-in full 10,000 tier, bounded to 30 minutes per invocation. The unique single-credentialed-owner database invariant is retained: one owner has a synthetic session, the other is uncredentialed. API load tests exercise the authenticated owner at concurrency 1 and 4; a separate Home service case alternates the two owners at concurrency 4. That service case excludes HTTP/auth overhead and is not mixed-owner API evidence. Cross-owner item access must return 404 and an anonymous Home request must return 401 before sampling.

Stable synthetic item IDs and photo assignment fix first-page composition across runs. Onboarding is completed before measurement and the signed-in session is seeded; unauthenticated/registration timing is unmeasured. Fixtures include INR/USD integer minor-unit prices, unknown amounts, unpaid gifts, all four purchase-date precisions, sold/returned items, lifecycle events and confirmed refunds. Deterministic textured image bytes are generated with sharp; original/display/thumbnail metadata and bytes are synthetic. Local read-only storage replaces only the provider adapter; authenticated media endpoints, ownership checks and database queries remain real. This measures application delivery, not Cloudinary latency or availability. The fixture is not a correctness oracle for financial aggregates; existing financial tests retain that role. Categories/merchants and wider history distributions remain future representativeness work.

Web uses `next build --webpack` / `next start`; API imports compiled Nest modules from `dist` and uses the existing test configuration with real PostgreSQL and a local storage adapter. **No development server is measured.** API production DNS/HTTPS/ACL/exporter configuration is not represented. Synthetic sessions bypass registration/password hashing; auth startup/login and Valkey/queue workloads are outside these baselines. PostgreSQL version and machine/browser characteristics are stored in the numerical artifact, and must accompany comparisons. Native macOS resource availability is not CT102 capacity.

## Measurement definitions

- Browser: five independent repetitions of every Home, Store, item details, Add item and Insights route for both desktop and mobile profiles, each cold and warm. Cold means a fresh browser context with cache disabled; server and database are already warm from API sampling. Warm enables static cache and primes the same route outside the sampled throttle window, drains network traffic, then restores the profile before measuring another document navigation. Private no-store responses still refetch. Cold observation traffic is stopped before priming. Private `no-store` data still refetches. This is not an OS/server/database cold-start benchmark.
- Desktop: 1280×720, DPR 1, CPU 1×, unthrottled loopback. Mobile: 390×844, DPR 3, touch emulation, CPU slowdown 4×, 150 ms latency, 1.6 Mbit/s down and 750 kbit/s up via CDP. Browser identity is recorded; emulation does not establish physical Android/iOS results.
- Ready: navigation invocation to the named useful-content/control locator and two animation frames. DOMContentLoaded is separately recorded. It includes Playwright scheduling/locator overhead. Details readiness does not imply every secondary history/gallery request is complete.
- LCP: final observed buffered candidate after readiness, visible-media completion (bounded to 15 seconds) and a one-second observation window before input. `mediaTimedOut` identifies incomplete windows; these cannot establish an LCP pass. Long-task count/duration cover that same document window. The measurement is a lab observation, not a full field navigation lifetime.
- Transfers/JS bytes: CDP encoded transfer lengths for completed resources, including protocol overhead; request count includes document, API, media and prefetches. Cache hits can have zero wire bytes. Requests still in flight at the end of observation and aborted requests limit interpretation.
- Scripted navigation/filter/load-more/save feedback: action invocation through observed useful result and two animation frames. Save feedback means confirmed success, not merely the first disabled button paint. These include network and automation cost and **are not field INP**. A 200 ms responsiveness target must not be equated with confirmed-save round-trip time.
- API: 20 unmeasured warmups per endpoint, then 1,000 completed requests at each closed-loop concurrency (1 and 4), with response bodies drained, bounded 15-second request timeout and no automatic retries. p50/p95/p99 use nearest rank. At n=1,000, p99 has only about ten observations above it; do not imply high-confidence extreme-tail/SLO estimates. This closed-loop model does not estimate open-loop arrival/overload SLOs. Errors include transport/timeouts (status 0) and non-2xx responses. All samples remain in the artifact; failure prevents publishing a successful baseline.
- Database: test-only pool wrappers measure acquisition and query round trips. The owner-row `FOR UPDATE` round trip includes transport/execution and any lock wait; it is not pure lock duration. A 20 ms `pg_stat_activity` sampler accumulates active/Lock/IO session observations, without query text. It can miss short waits. Representative SELECTs are separately explained on the isolated warm fixture with `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)`; only execution/planning times, root rows/buffers/node type are retained. They are not subtracted from concurrent HTTP timings. The SELECT classifier omits CTE-prefixed domain SQL: spending/merchant plan summaries represent auth lookups only and must not be used as aggregate execution timings. Home capture is capped at ten SELECT shapes. Auth UPDATE locks, exact CTE execution, per-request CPU, exact server lock duration and provider/network time remain instrumentation gaps.

## Collector correction and censored observations

An initial full-matrix collection hit the 30-second mobile Store warm readiness guard. The aborted run was not published as a complete baseline. A focused five-pair reproduction captured warm readiness around 22.8 seconds in four runs and 1.1 seconds in one, with incomplete media windows. The same compiled build after draining previous requests and priming outside the measurement throttle produced five warm readiness observations around 0.6–1.1 seconds. See [before](per-94-harness-before.json) and [after](per-94-harness-after.json). This supports priming/traffic carryover as a source of contaminated warm timings; CDP internal scheduling was not directly traced. The application code was unchanged. Earlier contaminated warm values are excluded from budget evidence.

The corrected collector restores the configured network profile even when priming fails. Unit regressions cover restoration/order and missing-value handling. Priming and readiness retain the original 30-second guard, with no retries. A future timeout is retained as an explicit censored observation (`readyMs: null`): readiness timeout records elapsed lower-bound duration; priming failure cannot establish the intended cache condition and has no readiness bound. Reported complete sample counts exclude missing values; errors and incomplete windows prohibit a pass claim. Source runtime, database and UI regression assertions are unchanged.

## Existing stability evidence

Reuse [PER-88 geometry observations](per-88-stable-loading-geometry.md) and its existing `layout-shifts.spec.ts`/shift tracker. Those synthetic delayed/error API observations have their own baseline SHA and methodology and are not new real-API CLS evidence. PER-94 does not replace that suite or re-label its metrics. Reuse [PER-92 density regressions](per-92-store-density-streaming.md), including its visible-region targeting and hidden-stream negative controls. No retries, skips or layout assertions are changed here.

## Budgets and decisions

All limits below are **proposals**, not achieved results or CI gates. PER-100 must calibrate any timing gates on its actual runner and explicitly resolve open decisions. No speedup is claimed by this measurement ticket.

| Routes (each separately reported) | Proposed budget | Feasibility / open decision |
| --- | --- | --- |
| Home, Store, item details, Add item, Insights | LCP ≤2,500 ms; CLS ≤0.1 | Mobile CPU/network/media cost must be measured; reuse PER-88 CLS evidence with its boundaries. Physical devices and CT102 verification remain open. |
| Same routes, immediate UI acknowledgement | ≤200 ms | Target only; scripted confirmed result latency is different. Field INP requires future authorised field evidence. |
| Same routes, useful ready state | Desktop ≤1,500 ms; mobile ≤5,000 ms | Provisional lab threshold; confirm product acceptance for each route after baseline. |
| Navigation/filter/load-more/confirmed save | Desktop ≤1,000 ms; mobile ≤2,000 ms at p95 | End-to-end lab proposal; five browser repeats give descriptive extrema, not reliable p95 population estimates. |
| Each route's cold initial JS | ≤250 KiB wire | Provisional PER-95 investigation budget. Shared/runtime chunks count. Decide compression/runner model before enforcement. |
| Store visible protected covers | ≤200 KiB each | PER-97 must verify chosen variant and decode cost with realistic private-provider conditions. Textured synthetic fixture is deliberately compression-heavy. |

| API endpoint case (1,000 items/owner) | Proposed p95 / p99, concurrency 1 | Proposed p95 / p99, concurrency 4 | Decision |
| --- | --- | --- | --- |
| Home | 100 / 200 ms | 200 / 400 ms | Pending equivalent CT102-sized runner validation |
| Items page / filtered page / facets / item detail | 50 / 100 ms | 100 / 200 ms | Each case has its own samples; no cross-endpoint pooling |
| Spending all-history / merchant summary | 50 / 100 ms | 100 / 200 ms | Include growing history and merchant/category skew before binding |
| Every case | 0 observed errors | 0 observed errors | Zero observations do not establish zero production failure probability |

Ten-thousand-item budgets, shared-host variability tolerances, request-count caps by route, gallery/provider wire limits and field/deployed targets remain explicitly unresolved. These block turning the corresponding proposals into pass/fail gates. Candidate deterministic request caps should follow measured required endpoint contracts; do not invent one global cap.

## Results and ranked findings

[Full baseline tables](per-94-baseline-tables.md) contain all five repetitions, variability, API tails, waits and representative plans. Raw numerical artifacts: [representative run](per-94-baseline.json), [100/10,000-item API tiers](per-94-api-tiers.json), [instrumentation-off control](per-94-control.json). [Overhead comparison](per-94-overhead.md) documents sequential A/B limitations.

Application build source: `2016fc40445d7d68a677d813b43e6772d3b357d7`, Next build `VR8hjN8mP5qlS93PKJMBV`, fingerprint `6437b9576304162c488a1aa5b9d270635b1b41b6412c21dd4209778fe7a78bbe`. Apple M4 / 10 logical CPUs / 16 GiB, macOS arm64, Node 24.18.0, PostgreSQL 18.6 Homebrew, Chromium 153.0.8010.12. The dirty flag records the added harness/package scripts; application/shared-runtime files are unchanged from the stated SHA. The actual fixture/harness recipe is included in this PR; do not pretend the uncommitted harness was part of the application SHA.

Completed representative coverage: 100 route observations (five routes × two profiles × cold/warm × five repeats), 40 scripted interactions, zero observed browser errors, zero missing readiness observations. Ten mobile Store media windows were incomplete, so their LCP candidates cannot establish a pass. API baseline: 42,000 measured HTTP reads across three fixture sizes, seven endpoint cases and concurrency 1/4, plus 3,000 separate mixed-owner Home service samples; zero observed errors. The overhead control adds 14,000 HTTP reads and five Home repeats per profile/cache state. All disposable fixture counts, database/role removal and scratch-cluster cleanup passed.

| Rank | Measured finding | Child / budget implication |
| --- | --- | --- |
| 1 | Mobile filter after load-more: median 21,801 ms (21,789–21,815), versus 86 ms desktop. Mobile Store visible media did not complete within 15 seconds in all ten cold/warm observation windows. Desktop Store observation transferred about 13,488 KiB cold / 12,983 KiB warm. | PER-96 + PER-97: investigate in-flight media, HTTP request scheduling, cancellation and variant selection together. The 2,000 ms scripted filter proposal has a roughly 19.8-second median gap in this model. No redundant-taxonomy or oversized-variant cause is proven by total counts alone. |
| 2 | Mobile cold readiness medians: Home 3,338; Store 3,336; details 3,420; Add 3,403; Insights 3,337 ms. Cold observation-window JS is 365–455 KiB mobile and 456–494 KiB desktop (includes prefetch). Mobile long-task duration medians span 120–262 ms. Detail LCP median is 3,220 ms. | PER-95: profile bundle/import and hydration boundaries. All observed JS windows exceed the provisional 250 KiB proposal; meeting it requires approximately 32–49% less wire JS in these windows, without a promised speedup. Detail cold LCP has a measured 720 ms gap to the 2,500 ms proposal. Immediate acknowledgement/field INP remains unmeasured. |
| 3 | Broad filtered search p95 grows from 5.081 ms at 1,000 items/c1 to 27.673 ms at 10,000/c1; 10,000/c4 p95/p99 is 116.929/136.155 ms. Largest captured filtered SELECT execution grows from 2.453 to 25.231 ms. | PER-99: prioritise broad search/query-plan investigation over speculative index changes. A 10,000-item API budget remains unresolved. Complete spending/merchant CTE execution plans are still missing. |
| 4 | At 10,000 items/c4 Home p95 is 59.295 ms, pool acquisition p95 27.864 ms. Filtered owner-lock round-trip p95 is 52.106 ms; sampled lock observations exist. At 1,000 items/c4 Home p95 is 14.591 ms, pool p95 6.440 ms. | PER-98: real local acquisition/lock-round-trip amplification is observed, but exact lock duration and auth-session contention remain unresolved. Preserve serialisation; these results do not authorise changing pool size or removing locks. Local 1,000-item read budgets appear feasible; CT102 feasibility remains open. |
| 5 | Sequential instrumentation control has c1 API median deltas of roughly 0–8%; c4 and browser deltas include negative/noisy results. Desktop Home cold readiness delta is about +19%, mobile cold about +0.1%. | PER-100: calibrate stable-runner tolerances and deterministic JS/request definitions before enforcing gates. This A/B check does not isolate every CDP/proxy/driver cost or establish a causal overhead percentage. |

The local browser transport is loopback HTTP/1.1, without a deployed TLS/reverse-proxy/multiplexing path. CDP throttling and connection/request scheduling can materially affect the photo-heavy filter result. Validate its mechanism on a representative isolated transport before changing runtime behaviour. It is not evidence of a deployed 21.8-second defect.

The 1,000-item native API observations meet the proposed local read limits, but those limits are not binding production SLOs. Native warm-buffer plans, a single credentialed owner/session, uniform data and no real provider/queue pressure cannot establish CT102 capacity. Auth/taxonomy/settings and create-item HTTP tails are not independently sampled at n=1,000; save confirmation has five browser samples per profile. Browser tiers at 100/10,000 items, physical devices, HTTP/2/TLS behaviour, realistic category/merchant/history skew, field INP, complete Store LCP, exact CTE/lock attribution and authorised deployed acceptance remain open.

## Validation and effects

- Local lint, formatting, types, unit/infrastructure, all 490 components (two workers), migration-history/schema drift and production compilation passed. Seven focused protocol tests cover tail estimates, capacity/target rejection, bounded load/error redaction, artifact validation, warm-profile restoration, censored observations and rejecting occupied ports without contacting the listener.
- End-to-end representative/API/control collections and per-run fixture restoration/cleanup passed. An interrupted collection also verified scratch-cluster cleanup. Raw artifacts passed the numerical/text allowlist; no request/response bodies, credentials, cookies, query text/values, media URLs or private fixtures are staged.
- Required exact-head CI must additionally validate all repository gates, isolated API/worker integration and full production browser/proxy smoke. The PR records its current run and outcome; earlier heads do not validate a replacement commit.
- No application-runtime optimisation, schema/migration, dependency/lockfile, deployment, restart of an existing service, infrastructure tuning or owner-data mutation. Only disposable local fixtures were changed. Existing PER-88 geometry and PER-92 density regressions remain intact. PER-42 retains deployed/field acceptance.

