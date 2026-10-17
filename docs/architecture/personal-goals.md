# Personal goals and confirmed contributions (PER-30)

Goals are an owner-private domain in the existing API modular monolith. PER-31 owns avoided-spend allocation; PER-32 owns screens. There is no UI, transfer, deposit, investment, external finance integration, queue, infrastructure change or deployment here.

## Money and lifecycle

`targetMinor` and contribution `amountMinor` are canonical unsigned decimal **strings** on the wire and PostgreSQL `bigint` in storage, bounded to 9223372036854775807. Targets may be zero; contributions/corrections must be positive; a reversal must be zero. `progressMinor` is a decimal string from PostgreSQL's exact numeric SUM and can exceed both the target and bigint range. No floating point or exchange rates are involved. Clients must handle a zero target without dividing by zero; the API intentionally does not return a floating-point percentage.

Currency is required and validated against the repository ISO 4217 registry. A goal may change currency only before its first contribution; all entries, including reversed entries, lock that currency permanently. Mismatched contributions return 409. Goal name and target are required; absent optional target date and notes return null. Target dates are real Gregorian `YYYY-MM-DD` dates between years 0001 and 9999, without timezone conversion. No date or monetary value is invented.

Goals start `active`. The owner may explicitly choose `active`, `completed` or `archived`. Completion is not inferred from progress. Archived goals remain in list/detail/history queries with intact ledger entries and stable IDs for future decision references. New ledger writes to archived goals are rejected; restore to active before correcting them. Completed goals may receive contributions/corrections. Target, date, note, name and lifecycle edits never rewrite contributions.

Explicit DELETE purges a goal and its private contribution history (also on owner deletion). This is distinct from archiving. Future PER-31 decision links must preserve archive readability and handle an explicitly deleted goal as unavailable without retaining private snapshots.

## Endpoints

All endpoints require the existing owner session and same-origin mutation controls and return `Cache-Control: no-store`. Versioned OpenAPI is published through the existing Swagger document.

| Method | Path | Behavior |
| --- | --- | --- |
| POST | `/api/v1/goals` | Create `{name,targetMinor,currency,targetDate?,notes?}`; 201 |
| GET | `/api/v1/goals` | List; `limit` 1–100 (default 25), optional `after` UUID and status; ascending immutable UUID order; `nextAfter` or null |
| GET | `/api/v1/goals/:id` | Goal detail including revision and exact `progressMinor` |
| PATCH | `/api/v1/goals/:id` | Last-seen `revision`, optional editable fields/status; explicit null clears date/notes |
| DELETE | `/api/v1/goals/:id` | Body `{revision}`; 204 after private data purge |
| GET | `/api/v1/goals/:id/contributions` | Newest-first immutable history; `limit` 1–100 and exclusive `before` sequence; `nextBefore` or null |
| POST | `/api/v1/goals/:id/contributions` | Confirm explicit contribution/correction/reversal; 201 |

Example contribution command:

```json
{
  "revision": 1,
  "commandId": "c86297d7-21f3-4815-a07e-1ef166cf668a",
  "kind": "contribution",
  "amountMinor": "800000",
  "currency": "INR"
}
```

This records owner confirmation only; it does not verify that money moved. A `correction` supplies `supersedesId` of an effective entry and the positive **replacement** amount. A `reversal` supplies `supersedesId` and `amountMinor: "0"`. Correct the latest leaf of that contribution chain; a prior superseded entry returns 409. Reinstating a reversed contribution requires an explicit correction of its reversal. All original amounts/notes/times and corrective references remain readable.

Progress sums only effective ledger leaves: a contribution of 800000 corrected to 500000 contributes 500000, then a reversal contributes zero. Separate contributions add together. Declined desires, estimates, target edits and repeated reviews have no path that inserts contributions.

## Transactions, history and privacy

All queries include authenticated owner predicates. Transaction-local owner context enables row-level security on both tables; owner row/goal row locks serialize mutations. Foreign and missing goal IDs both return `GOAL_NOT_FOUND`; correction IDs outside this owner/goal both return `CONTRIBUTION_NOT_FOUND`. Request bodies cannot choose an owner. Revision conflicts return 409. The ledger trigger increments the goal revision transactionally, so a ledger write also invalidates stale target/lifecycle edits.

A command UUID and canonical request hash make identical retries return the original event before stale revision/archive checks. Changed reuse returns `CONTRIBUTION_COMMAND_REUSED`. Retrying must preserve the original body, including revision. A new command needs the latest revision from GET. Goal creation itself is not command-idempotent.

Migration `0018_personal_goals.sql` adds goals, ledger, checked amounts/kinds/dates/status, owner/currency composite FKs, correction owner/goal FKs, unique command/sequence/successor constraints and owner-order indexes. Database triggers forbid ledger UPDATE/DELETE except parent deletion, reject archived/currency/stale inserts and transactionally advance revisions. The schema snapshot is additive; custom triggers/RLS are reviewed SQL. The existing migration role applies it; the runtime role gets no new administrative privileges.

Events contain only fixed event/component/operation/category tokens, with existing request correlation. Shared HTTP/error monitoring uses route templates and allowlisted error codes. Names, notes, dates, amounts, identifiers, SQL and credentials are excluded from application events. Goal routes normalize to templates in monitoring. Existing Seq/GlitchTip configuration remains unchanged; no new alerts or queues.

## Verification and rollout

Service tests cover transaction/failure boundaries; PostgreSQL/HTTP integration tests cover lifecycle, exact arithmetic, corrections/reversals, target preservation, currency rules, retries, concurrency, ownership/RLS, constraints/indexes, cursor ordering, DTO/date validation, OpenAPI and telemetry privacy. Integration uses the standard disposable schemas with dedicated test roles and bounded exact-key cleanup.

Run the reviewed forward migration before releasing an API build that imports GoalsModule. No backfill is required. Rolling back the application can leave these additive tables in place; do not drop private data as an application rollback. No production migration or deployment is performed by this ticket.
