# Separate estimates and confirmed allocations (PER-31)

Declining a desire records a PER-28 estimate, counted once from its current effective review event. No contribution is inferred. The desire-side Allocate page offers matching-currency goals and an explicit confirmation dialog. ₹8,000 may hypothetically cover 20% of a ₹40,000 goal while its confirmed progress stays zero. Percentage calculations use bigint arithmetic, round down to two decimal places and return unavailable for unknown estimates, different currencies or zero targets. A zero target can still receive a positive confirmed allocation; a zero or unknown estimate cannot be allocated.

## Allocation policy

The owner delegated this policy choice during PER-31 and it is recorded in Kan: one allocation chain per desire, initially the full positive estimate into one goal. No partial initial allocation, split, automatic allocation, currency conversion or implicit completion. Subsequent explicit amount corrections/reversals reuse PER-30's confirmed contribution ledger. A correction replaces the effective amount and may differ from the original estimate; it is an owner declaration, not an inferred saving. A reversed allocation can be reinstated by correcting its reversal, never by creating another chain. Moving it between goals is outside this ticket.

Later review corrections flag the source as changed without automatically changing confirmed progress. The authoritative current avoided-spend estimate still comes only from the latest review event, never from the sum of historical reviews or allocation entries. There is no new combined estimate/savings total. Confirming records an owner's allocation; it does not verify or perform a transfer, deposit or investment.

Completed goals accept ledger writes, and archived goals retain readable history but reject all new entries, including corrections/reversals, until restored, preserving PER-30. Target edits retain history and invalidate stale confirmation revisions.

## API and concurrency

All routes use existing session authentication, same-origin mutation checks, no-store responses and versioned Swagger schemas:

- `GET /api/v1/desires/:id/allocation`: current estimate separately from any linked allocation, source-change flag, live goal summary and effective contribution leaf.
- `POST /api/v1/desires/:id/allocation`: `{commandId,reviewEventId,goalId,goalRevision,confirmed:true}`. The server reads the amount/currency from the current authoritative declined event. Clients cannot supply an amount, owner or arbitrary source snapshot.
- `GET /api/v1/desires/:id/allocation/history`: this allocation chain only, newest-first, `limit` 1–100 and exclusive `before` sequence; `nextBefore` or null. Independent contributions to the same goal are excluded by the server.
- Corrections/reversals use existing `POST /api/v1/goals/:id/contributions` with current goal revision and effective `supersedesId` (PER-30 replacement semantics). The desire flow provides both actions and auditable history; broader goal management remains PER-32.

The GoalsRepository transaction locks the authenticated owner, then source and goal. Reviews, goal edits/deletes and contributions use that same owner lock, serializing concurrent commands. Confirmation inserts one ordinary PER-30 contribution and its source link atomically; the existing trigger advances goal revision. A unique source key prevents repeated review outcomes or competing commands across goals from creating another allocation. Command UUID plus canonical hash permits identical retries before stale/archive validation; changed reuse conflicts. A replay returns the current allocation representation, so later corrections and deletion remain honest. The browser retains the exact command after ambiguous transport/server failure and disables editing until it retries successfully or gets a definitive response.

## History and explicit erasure

Forward migration `0019_desire_goal_allocations.sql` adds only a snapshot-free link table, constraints, owner RLS and immutable-link guard. The guard validates source ownership/current declined event and ledger owner, kind, amount, currency and command identity. Goal/ledger references deliberately have no cascading FK: explicit goal deletion must purge all private goal and contribution details while the surviving desire records only that an allocation is unavailable, preventing accidental repeat allocation. No names, targets, notes or amount snapshots are retained in this link. The source-review composite FK cascades on explicit desire/owner erasure.

Explicit desire deletion removes its reviews and allocation link. Independently owner-confirmed ledger amounts remain part of the goal's history; their source names/notes/identifiers are not copied there. Goal deletion removes that ledger under PER-30. Archive is distinct from deletion. There is no backfill or automatic reinterpretation of historical estimates.

## Integration and operations

Shared changes are limited to contracts/schema, GoalsModule registration, one transaction-local goal reader, safe error tokens, monitored route templates and the missing goals web-proxy allowlist. Desire history and a newly recorded decline link to the allocation page. Home, settings and the goal-management placeholder are untouched. Existing shadcn primitives provide dialog, buttons, radio selection and inputs; there is no new reusable component or theme.

Events retain only fixed goal operation/component/category tokens and request correlation. Monitoring normalizes source/goal identifiers; no amounts, private notes, names, source snapshots or command identifiers are emitted. No new queue, alerts, uploads, production services, PostgreSQL/Valkey changes or deployment. Tests use fresh disposable schemas and exact-key cleanup.

Apply the reviewed forward migration before a compatible release. No production migration is executed by this work. Application rollback can leave the additive table intact; never drop owner data for rollback. Browser screenshots contain only synthetic data. Live production and manual screen-reader behavior remain unverified.
