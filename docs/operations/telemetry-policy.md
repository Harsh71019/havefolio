# PER-51: telemetry capacity and actionable alerts

The policy is in `deployment/telemetry/policy.json`. It extends PER-48 logging,
PER-49 monitoring and PER-50 health checks. Application telemetry is optional;
collector failures never block manual inventory operations. No new data service,
public listener, application migration or owner-data access is needed.

## Privacy and release identity

Keep the two existing boundaries: `safeEvent` before Pino and at each console/Seq
sink, and `scrubEvent` before SDK delivery and again at the final envelope.
Allowed log fields are application/service/environment/release, time/level,
event/component/operation/category/code, method, registered route template,
status/duration, validated request/correlation/causation/job IDs, attempt and a
sanitized error type/code/frame location. Do not add request objects, free-form
messages, identities, headers, cookies, passwords, tokens, notes, SQL, financial
values, receipt contents or local paths. GlitchTip additionally permits immutable
artifact/debug IDs for source-map resolution; breadcrumbs and resource spans are
removed. See the package privacy tests for alternate-case/nested canaries.

Production releases use `havefolio-<full 40-character Git SHA>`. Environment is
`production`; use `development` and `test` for other environments. API/worker
`LOG_RELEASE`, server/browser monitoring release and image provenance must name
the actual service revision. During a partial rollout, record each service's
image/revision separately in `release.json`; do not overwrite the global Compose
selector merely to change web. Browser configuration contains only public
project ingestion identity; upload/read credentials remain server-side.

## Retention, ingestion and sampling

| Layer | Limit | Deployment effect |
| --- | --- | --- |
| Docker console | 3 rotating 10 MiB files per app service | Existing Compose logging policy |
| Seq stream | 30 days | Existing shared retention policy, inspected in Seq; do not shorten unrelated history |
| Seq regular delivery | 100 events and 24 KiB/minute per API/worker process | Continuous local budgets, equal initial burst capacity |
| Seq error/fatal reserve | 20 events and 8 KiB/minute per process | Separate from routine events; console remains complete within Docker rotation |
| Seq transport | 4 KiB/event, 256 queued events/1 MiB, 16 events/batch, one in-flight batch, two 1-second attempts | Existing bounded transport; retries can double transmitted bytes, not unique stored events |
| GlitchTip errors | 100% capture within a 20-event/minute transport budget | Errors remain independent of trace sampling |
| GlitchTip traces | Default 1%; configurable 0–10%; health/static/unknown routes excluded | Existing trace selection, plus 60 transactions/minute transport budget |
| GlitchTip envelopes | 256 KiB/minute, 16 KiB sanitized event, 24 KiB envelope, 32 pending, one 1-second attempt | Per SDK instance; measured in UTF-8 bytes |
| GlitchTip project ingestion key | 60 events per 60 seconds | Dedicated Havefolio project key; server protection across clients |
| GlitchTip errors/transactions/files | 90 days | Existing server retention settings; preserve source maps through their supported retention |
| GlitchTip releases | 365 days | Existing server setting |

Budgets refill continuously and cannot accumulate unlimited idle credit. They
bound each process/SDK instance, not a whole deployment or all browsers. Console
output is preserved when remote telemetry is dropped. Seq's two normal app
processes produce at most about 2.64 GiB of unique CLEF payload over 30 days at
sustained saturation, plus initial bursts and storage/index overhead. This is a
capacity bound, not a storage guarantee; disk alerts still matter. More replicas
require reviewing the aggregate allowance. Keep runtime `LOG_LEVEL=info` unless
performing a time-bounded investigation.

GlitchTip retention is global in the installed version. Reuse the existing
90-day policy rather than restarting shared GlitchTip or shortening other
projects' history. Project-key rate limits are separate from retention and from
application error/trace budgets. Never turn on global private-webhook access to
make an internal ntfy destination work.

## Alert routes

### Seq → existing ntfy

Use Datalust's `Seq.App.HttpRequest` 1.0.0, manually triggered by the Havefolio
alert only. Keep **Stream incoming events**, **Body is a template** and
**Extended Error Diagnostics** off. POST `text/plain` to the existing protected
ntfy destination. No event properties, queries, messages, URLs or error bodies
are interpolated into the notification. Use this fixed body:

> Havefolio production worker failures exceeded the threshold. Inspect Seq and the worker health before retrying jobs.

The alert query is:

```sql
select count(*) as count
from stream
where application = 'havefolio'
  and environment = 'production'
  and service = 'worker'
  and event in ['job_failed', 'worker_error']
group by time(5m)
having count >= 3
limit 100
```

Set a 15-minute suppression window. Routine `job_retry`, expected HTTP 4xx,
health probes, test/candidate releases with a different environment and unrelated
applications cannot satisfy this filter. Seq groups fixed five-minute buckets;
this is not a sliding-window guarantee. Only the alert aggregate goes to the
output app. Disable this alert/output instance to roll back its routing; do not
restart Seq or remove unrelated settings.

### GlitchTip → bounded local check → existing ntfy

The installed GlitchTip blocks private-IP webhook targets. Preserve that SSRF
protection. `glitchtip-errors.py` runs inside the existing GlitchTip container,
selects at most three event IDs for the **Havefolio** project/organization and
production environment received in five minutes, and returns only a threshold
boolean. The read-only transaction has a 2-second statement timeout; the caller
has a 5-second process timeout. It creates no API key and fetches no event
contents. It depends on the inspected GlitchTip model version; revalidate after
upgrades. Failure is unknown, not healthy, and produces a distinct probe alert
after three failed checks. Error bursts produce one `GLITCHTIP_ERRORS` alert,
then one recovery after two successful below-threshold checks. Continuous errors
stay one active incident; repeated individual issue notifications are avoided.

### Gatus → existing ntfy

Use the existing ntfy backend and three failures/two recoveries with
`send-on-resolved: true`. Reuse `deployment/gatus/havefolio-endpoints.yaml` for the
web/liveness/readiness targets. Updating the existing live login/auth checks to
these definitions needs an explicit Gatus configuration rollout; do not claim a
readiness monitor exists merely because the API endpoint is healthy.

### Disk, memory, CPU and restarts → existing ntfy

`check-resources.py` inspects only the three Havefolio Compose services. At
one-minute intervals, disk >=85% for three checks and CPU/memory >=80% of each
configured limit for five checks become actionable. Three restarts in five
minutes, or three unhealthy checks, create a service incident. A container
replacement resets its restart baseline. Two healthy measurements resolve an
incident; missing measurements cannot resolve it. Gaps over two minutes reset
sustained-pressure counters. No repeat notification is sent while active.
Delivery failure is retried on the next poll and never marked delivered early.

The fixed allowlisted codes and firing/resolved state are the entire ntfy
message context. Never attach Docker inspect output, event content, credentials
or private paths. State is local, atomic and mode 0600; an exclusive lock prevents
overlapping timer runs. Polls less than 55 seconds apart cannot accelerate
thresholds. Corrupt state fails safely rather than forgetting active incidents.

## Inspect, install and roll back

Run a read-only resource/probe inspection on CT102 with:

```sh
python3 scripts/monitoring/check-resources.py \
  --policy deployment/telemetry/policy.json \
  --glitchtip-probe scripts/monitoring/glitchtip-errors.py
```

For a reviewed operations rollout, install the two scripts and policy under
`/opt/havefolio/operations/`, retain their previous versions, and put
`HAVEFOLIO_NTFY_URL` (and optional `HAVEFOLIO_NTFY_TOKEN`) in the existing protected
monitoring directory's `resources.env` (0600). These are operator settings, never
application/browser variables. Install the supplied oneshot service/timer in
`/etc/systemd/system/`, run `systemd-analyze verify`, reload units and enable only
`havefolio-resources.timer`. The timer has a 45-second runtime ceiling, 96 MiB
memory limit and 10% CPU quota. It introduces no listener and does not restart
Docker, application containers or any shared service. The Docker socket is
privileged operator access; do not expose this script through an API.

Rollback: disable/stop only `havefolio-resources.timer`, leave its private state
for incident continuity, and restore prior scripts/units. Do not delete volumes,
prune rollback images, reverse migrations or restart shared services. Redeploy
application budgets through the normal immutable-image release workflow.

## Beszel verification and evidence

Beszel is the existing independent dashboard for CT102 host CPU, memory and disk
and the three Havefolio containers' CPU/memory. Compare current Beszel samples
with Docker's effective limits (API 1 CPU/768 MiB; worker 0.5 CPU/256 MiB; web
1 CPU/512 MiB), health and restart counts. Beszel 0.18.7 container samples expose
CPU/memory/bandwidth, so Docker supplies restart counts; do not claim Beszel alone
verified restarts or configured limits. Read-only database inspection of the hub
is acceptable for bounded aggregate evidence; never export users, auth or tokens.

Record deployment revision, timestamp, provider settings, delivered notification
counts, suppressed repeats and recovery counts. Distinguish mocked automated
checks, read-only live inspection, applied collector settings and the application
budget release. Source-code success alone does not prove production delivery.

References: [Seq HTTP app](https://datalust.co/docs/calling-webhooks),
[Seq API keys](https://datalust.co/docs/api-keys),
[GlitchTip retention](https://glitchtip.com/documentation/install/),
[Beszel notifications](https://beszel.dev/guide/notifications/).

## PER-51 delivery evidence, 2026-10-16

- Live Seq 2026.1.17114 already has a 30-day stream retention policy. Preserved it.
  Created `Havefolio production worker failures` (`alert-71`), 3 failures per
  five-minute bucket with 15-minute suppression, attached to the fixed-body
  `Havefolio ntfy operational alerts` instance (`appinstance-73`). The vendor
  HTTP app is pinned to 1.0.0. Query simulation returned zero matching historical
  incidents; no production failure events were fabricated to trigger it.
- Existing GlitchTip retention was 90 days for events/transactions/files and 365
  for releases. Applied 60 events/60 seconds to its one dedicated active Havefolio
  key; retained the previous limits in protected operator state. Private webhook
  destinations remain blocked (unchanged). The local
  production-only aggregate probe ran successfully; existing Havefolio events
  have the expected environment field. No event content was exported.
- Installed the resource/probe oneshot timer with private state on CT102. A real
  sustained disk-pressure condition (~85.7% used) delivered exactly one fixed
  `HOST_DISK_PRESSURE firing` notification through existing ntfy. Subsequent
  checks retained one active incident without repeated notifications. No disk
  cleanup, synthetic production failures, or live-owner fixtures were used.
  Recovery and failed-delivery retries are covered by automated synthetic tests;
  live recovery remains unverified while disk pressure persists.
- Beszel 0.18.7 reports CT102 up and current Havefolio container samples around
  107 MiB API, 63 MiB worker and 88 MiB web (point-in-time observations, not a load
  benchmark). Docker confirms configured CPU/memory limits, all three restart
  counts zero, API/web healthy and worker running. No existing container identity
  changed during the operations rollout.
- Existing Gatus login/auth checks remain green; their routes were preserved.
  The dedicated readiness monitor is still a separate configuration rollout.
- Local `pnpm check` passed; logging 11, monitoring 12, API unit 180 and web
  components 207 passed. Migration drift/history passed without schema changes.
  Disposable loopback integration passed all 196 API tests plus real BullMQ
  retry/outage coverage. Browser smoke passed 59 with 7 existing skips, followed
  by the real production-proxy regression. The initial integration invocation
  lacked test settings and was rerun successfully using disposable resources.
- Application delivery budgets remain source changes pending PR review, merge
  and immutable application-image rollout. Do not describe them as live solely
  because the separate collector settings and operations timer are applied.

Operations rollback state is retained under the deployment's
`rollback-per51-telemetry` directory; project-key previous settings are in the
protected monitoring state. Disabling only the timer and Seq alert stops these
notification routes. Restoring previous project-key limits does not change its
identity or credentials. No application/schema migration, owner login, shared
service restart, Tailscale change or unrelated container recreation occurred.
