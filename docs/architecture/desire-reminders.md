# PER-27: waiting-period reminders

Waiting-period reminders prompt the owner to reconsider a desire when its wait ends. They do not classify the decision, send private desire content to external services, or make Valkey the source of truth.

## Durable lifecycle

Creating or editing a desire with a waiting period writes the desire and one `desire_reminders` row in the same PostgreSQL transaction. The row is keyed by desire, scoped to its owner, and contains a monotonically increasing schedule version, review time, delivery state and enqueue/delivery timestamps. Editing the review time replaces the durable schedule and increments its version. Cancelling the wait or deleting the desire removes the intent transactionally.

After commit, the API makes a best-effort BullMQ update on the shared Valkey service. The job ID is deterministic: `desire-reminder-<desire UUID>-<schedule version>`. Rescheduling removes the prior version when Valkey is reachable and creates one delayed job for the new version. Cancellation removes the prior job when reachable. Queue errors are logged as a bounded dependency event and never change the already committed desire response.

The worker re-reads the locked PostgreSQL intent before delivery. A missing, cancelled or version-mismatched job is stale and exits without a notification. A job that fires before the persisted review time exits without delivery and is recreated with the correct delay by reconciliation. A due current job inserts one `desire_wait_ended` notification and marks the intent delivered in one transaction. The unique `(desire_id, reminder_version, type)` constraint makes duplicate jobs and retries harmless.

## Reconciliation and failure handling

The worker reconciles on startup and at the configured bounded interval. It scans at most 500 pending/scheduled intents ordered by due time, preserves live waiting/delayed/active jobs, retries terminal jobs after a short cooling period, and recreates missing jobs. Jobs have five exponential-backoff attempts. Failed jobs are retained for at most seven days and 1,000 entries so they can be diagnosed without unbounded Valkey growth.

Reconciliation emits a structured `worker_health` event with pending, waiting, delayed, active and failed counts. Job lifecycle logs contain only allowlisted operational fields and correlation metadata. Neither job payloads nor logs contain desire names, reasons, product URLs or owner identifiers. PostgreSQL/Valkey outages are operational failures: desire writes remain valid when Valkey is down, and reconciliation repairs queue state after recovery.

## In-app and optional external delivery

The authenticated notification API exposes owner-scoped keyset pagination and an idempotent mark-read operation under `/api/v1/notifications`. Responses are private and use `Cache-Control: no-store`. The API never accepts caller-supplied owner identity and foreign notification IDs return the same not-found response as missing IDs.

In-app delivery is always the primary result. Optional ntfy delivery is worker-only and disabled by default. When enabled, it sends the fixed title `Havefolio reminder` and fixed body `A waiting period is ready for review in Havefolio.` to one protected configured endpoint. A database claim state prevents concurrent sends; failed and abandoned claims are retried with a bounded attempt count. The token remains server-side and the endpoint may not embed credentials, a query or a fragment.

## Deployment and rollback

Apply additive migration `0012_desire_reminders.sql` before enabling producers or consumers. The API uses its existing environment-specific API ACL identity; the worker uses the distinct worker ACL identity. Both share the same `havefolio:<environment>` queue prefix and database zero. The worker also receives the existing least-privilege PostgreSQL runtime role. No PostgreSQL, Valkey or notification container is added.

Disable `REMINDER_QUEUE_ENABLED` to stop direct dispatch while preserving durable intent, or disable `WORKER_QUEUE_ENABLED` to stop processing. Re-enabling the worker reconciles missed schedules. Application rollback must remain compatible with the additive schema; do not reverse the migration or delete reminder/notification data as an operational rollback.
