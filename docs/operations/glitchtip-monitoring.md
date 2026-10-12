# PER-49: optional GlitchTip monitoring

Havefolio uses the Sentry-compatible SDK against the existing GlitchTip service. API and worker initialize before application bootstrap. Next.js initializes browser, Node server and edge runtimes through its instrumentation hooks. Monitoring is optional and never participates in readiness, request authorization, rendering or job completion. No migration or new infrastructure service is required.

## Capture and correlation

The API exception filter reports unexpected 5xx failures and records the returned `monitoringEventId` in the PER-48 HTTP completion event. Validation, authentication, authorization, missing resources, conflicts, throttling and other 4xx responses do not produce incidents. Handled per-file photo storage failures are reported without serializing upload contents. Browser global handlers and React error boundaries report unexpected failures; server-rendered errors use `onRequestError`, and their client digest suppresses a second report. Object identity guards prevent repeated manual capture. Worker retries remain Seq events; only the exhausted attempt creates an incident. Bootstrap and uncaught process failures use the same privacy boundary.

Events carry `service`, `environment` and `release`. API and terminal worker events reuse validated PER-48 `requestId`, `correlationId`, `causationId`, `jobId` and current attempt where available. Next server errors retain valid correlation headers and known route templates. Browser errors deliberately exclude session/user identity and arbitrary application state. To correlate, search GlitchTip and Seq for the same request/correlation ID and release; HTTP Seq completion events additionally contain the monitoring event ID. Use operator read credentials for searches, never elevate an application ingestion key.

## Privacy and capacity

`packages/monitoring` reconstructs each event from an allowlist both before SDK delivery and at the final envelope transport. It drops user/request data, headers, cookies, sessions, bodies, query strings, breadcrumbs, attachments, replay, metrics, SDK logs, private notes, document contents, original filenames, signed URLs, database data and financial values. Exception messages become fixed application codes or a generic failure. Stack frames retain only generated application artifact identifiers and bounded line/column numbers; local path prefixes, functions, variables and source context are removed. Debug IDs are retained solely for source-map resolution. Envelope dynamic-sampling metadata is removed because it can contain raw transaction names.

Error capture is independent of trace sampling. `GLITCHTIP_TRACE_SAMPLE_RATE` and `NEXT_PUBLIC_GLITCHTIP_TRACE_SAMPLE_RATE` default to 0.01 and accept 0 through 0.1. Invalid enabled configuration disables monitoring and emits only a fixed configuration diagnostic on API/worker. Health, static and unknown routes are unsampled. Each API request/job has a fresh sampling decision. Performance events contain normalized route, timing and trace identity, with no child resource spans. Next uses its native server tracing; browser tracing disables fetch/XHR resource capture. Trace propagation is disabled. SDK 11 uses `traceLifecycle: 'static'` so transactions pass through the privacy callback.

Delivery permits only error/transaction envelopes, at most 16 KiB per sanitized event and 24 KiB per request, with a 32-entry buffer, one attempt and a one-second timeout. Application work does not await delivery. A full queue, unavailable collector or SDK error loses optional telemetry while console/Seq logging continues. Controlled shutdown flush is bounded to one second. Retention and alert policy remain PER-51.

## Protected builds and deployment

Runtime API/worker/web monitoring configuration belongs in the existing root-protected deployment env files. The optional web env file is `/opt/havefolio/secrets/shared-services/.env.production.web`; omit it to keep existing deployments working with monitoring disabled. Server DSNs and all credentials stay out of committed files. The browser receives only public ingestion configuration compiled through the explicit `NEXT_PUBLIC_GLITCHTIP_*` fields. A public project ingestion DSN is necessarily present in an enabled browser bundle; it grants no read, administrative or upload access.

Build all targets from a clean committed checkout with:

```sh
HAVEFOLIO_MONITORING_BUILD_SECRET=/protected/release.env sh scripts/monitoring/build-release.sh
```

The script derives `havefolio-<full commit SHA>` and passes the protected env file through a BuildKit secret mount. Build settings include the server/public ingestion configuration, `GLITCHTIP_UPLOAD_SOURCE_MAPS=true`, and `SENTRY_URL`, `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN`. The token needs release/source-map upload permission only and must never enter runtime env files. Docker restores the revision-derived server/browser release after loading the secret, so a file cannot override it. Compose uses the same immutable `RELEASE` for image tags and runtime `LOG_RELEASE`.

Next builds with webpack, uploads browser/server source-map artifacts under that release, and fails the release build if upload fails. Client uploads include shared application chunks, so code from packages such as financial formatting resolves alongside page components. Maps are removed after successful upload; local/CI builds also remove generated maps without needing credentials. Release Docker builds start without local `.next` output or cache; clear generated web output when reproducing a protected release locally. Browser bundles and runtime image metadata must be checked for the upload token before rollout. API/worker retain compiled application frame locations and the same release identity. BuildKit cache is privileged operator data, not a distributable application image.

Do not recreate production containers as part of verification. Use isolated candidates and synthetic data, retain the previous release selector for rollback, and roll out only after review. GlitchTip and Seq outages must be simulated through candidate-only unreachable endpoints, never by stopping shared services.

## Verification

Run `pnpm --filter @havefolio/monitoring test`, API monitoring tests, worker tests and web monitoring component tests, then `pnpm check`, migration history/drift, integration and browser smoke gates. Privacy tests include alternate-case/nested secrets, malformed getters, financial amount/currency fields, final-envelope metadata, rejected payload types and a collector that never answers. The real SDK collector test verifies one correlated exception, deduplication, one normalized sampled transaction and no health transaction.

For live verification, send controlled browser/server/API errors and a terminal synthetic job under a clearly identified verification release. Check counts, safe context, retry exclusion and source-map resolution with protected operator access. Search for runtime-generated privacy canaries without copying raw event data into evidence. Record IDs/counts and dates; distinguish successful ingestion from operator search verification. Remove only the candidate containers and their exact test-owned resources.
