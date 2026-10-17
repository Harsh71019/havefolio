# PER-28: review outcomes and decision history

`GET /api/v1/desires/:id/reviews` reads an owner-private timeline, newest first. `POST` on the same path appends `bought`, `delayed`, `declined`, or `used_owned`. The mobile-first page is `/wants/:id/history`, linked from every Wants card. Existing neutral shadcn Card, Button, RadioGroup, Input, Textarea, Label and Skeleton components compose the page; no new reusable primitive or theme is introduced. Both [shadcn](https://ui.shadcn.com/docs/components/card) and [Kibo UI](https://www.kibo-ui.com/components) were checked before choosing existing components.

## Authority and transactions

PostgreSQL is authoritative. Migration `0013_desire_review_events.sql` adds the event table, owner/desire and same-history corrective foreign keys, unique command and sequence keys, checks, timeline index, owner row-level policy and SQL-only trigger functions. These SQL policies/triggers are intentional reviewed migration logic beyond the Drizzle table snapshot.

The authenticated desire repository sets transaction-local `havefolio.owner_id`. The existing per-owner lock serializes owner commands; the desire row and linked item are also locked. API lookups always include the authenticated owner. The runtime role cannot read events without the matching transaction context; the migration/table-owner role remains privileged. Session authentication remains the trust boundary for the server-set database context. No caller-supplied identity is accepted.

The insert guard validates the next desire revision, corrective target, terminal transition, linked item's current ownership, and exact estimate snapshot. The after-insert trigger projects the event onto the desire and replaces/removes reminder intent within the same transaction. `delayed` projects to `waiting`; other outcomes project to their names. Effective waiting/ready-for-review state still depends on the server clock. Sequence, rather than client time, orders events deterministically. Event sequences use desire revisions and can have gaps after metadata edits.

The projection guard prevents ordinary waiting/status edits from bypassing recorded decisions. Its SECURITY DEFINER function has a migration-captured search path and reads history across RLS solely to enforce integrity, returning only the desire row. It does not expose history. Metadata edits remain possible; after the first review, waiting changes must go through another delayed event or explicit correction. Before the first review, PER-23 waiting configuration is unchanged. Deliberate decisions are permitted even before a waiting period ends; a waiting period is a prompt, not an enforced purchase restriction.

## Retry and correction contract

Each command carries a stable `commandId` UUID and the current desire `revision`. The canonical body hash includes the original revision, outcome, trimmed note, linked item, review time and corrective target. A retry of an existing command returns its original event before stale-revision validation. Changed bodies with the same key return `409 REVIEW_COMMAND_REUSED`. Concurrent retries create one event. A fresh stale revision returns `409 STALE_DESIRE_REVISION`.

Ordinary reviews can follow a delayed review. A resolved desire requires `supersedesEventId` pointing to the latest event; stale targets return `409 REVIEW_CORRECTION_REQUIRED`. Any latest event can be corrected, including a previous correction. A correction is a complete replacement decision and includes its own optional note/link/date. It never edits or erases the earlier event. The UI supports this latest-event correction chain and explains preserved originals. It retains the exact command in memory after an ambiguous network/server failure and disables form edits until retry confirms it. Reloading the browser discards unsent form state; history can be re-read before a fresh command.

UPDATE/DELETE of individual events is rejected at the database layer. Explicit parent-desire deletion still erases the complete private history through cascading deletion, consistent with private-data deletion. No update/delete event endpoints exist.

## Money semantics

Declining snapshots the desire's likely amount and original currency at that event, using PostgreSQL bigint and decimal strings in JSON. Zero remains zero; unknown amount/currency remain null. No floating point or currency conversion is used. Bought does not copy likely price to actual purchase price, create inventory, or change spending reports.

The page's `estimatedNotSpentMinor` and `currency` come **only from the latest event of this desire**. Thus a desire contributes at most one effective declined estimate, even after repeated reconsideration/correction. A bought, delayed or use-owned correction withdraws its current estimate without deleting earlier snapshots. Editing the likely price alone does not rewrite a historical estimate; changing the recorded decision/estimate requires an explicit correction. Never sum historical event snapshots. Future reports must select one latest event per owner/desire and aggregate distinct currency buckets with exact arithmetic. This ticket adds no savings ledger, allocation, authoritative savings claim or cross-desire total.

## Linked items and privacy

Use-owned requires a currently owned item; bought optionally links one. Other outcomes reject links. Owner-scoped API validation plus a database insert guard prevent foreign, missing or non-owned links. The event retains an opaque item UUID, with ownership checked at insertion instead of a lasting FK that would block inventory deletion or mutate history on deletion. Reads join only a currently owned item of the same owner; deleted/transferred/unavailable links return a null name and render “Item unavailable.” No item name or private item contents are snapshotted. Bought-to-item conversion remains PER-29; comparison remains PER-26.

Private notes are bounded to 2,000 characters. Authenticated endpoints return `Cache-Control: no-store`. Logs emit a fixed `desire_review_recorded` event with existing request/correlation context, never command bodies, note text, owner/desire/item IDs or money. Existing final-sink sanitization, safe HTTP errors, Seq and GlitchTip handling apply. No external provider receives decision contents.

## Reminder and queue behavior

A delayed review requires a future date-time with an explicit timezone. Its reminder uses the new desire revision as schedule version, so cancellation followed by reopening never reuses an old notification/job identity. Existing CRUD scheduling now uses at least the current desire revision too. Resolution removes the durable reminder. Previous in-app prompts are marked read but retained. Best-effort queue dispatch happens after commit; unavailable Valkey never rolls back the decision. Existing worker reconciliation restores pending schedules. Old jobs fail the authoritative schedule/version/time check.

Optional ntfy claims and recovery now require a matching current reminder version. Superseded prompts cannot newly claim delivery. A notification already claimed/sending at the instant of resolution can still complete, and an already sent generic external notification cannot be retracted. No queue payload includes notes or desire content. Existing retry, retention and exact namespace cleanup rules apply; no shared service or ACL changes.

## Migration and deployment

Apply forward migration 0013 with the migration role **before** deploying this API/web/worker release. No environment setting, storage/provider configuration, upload path or new service is required. Keep shared PostgreSQL/Valkey and their separate runtime/migration identities. Test with a non-owner runtime role: table owners can bypass ordinary RLS by design. Functions capture the trusted migration search path, so production schemas must remain non-writable by runtime roles as already required.

The expanded desire status constraint is incompatible with older application assumptions once resolved records exist. Roll back to an application version that understands PER-28 statuses/history; do not remove events, reverse migrations or run old waiting edits as a rollback. Production migration/rollout is a separate operation and was not performed by this implementation.

## Verification boundaries

API integration tests use disposable PostgreSQL schemas and distinct migration/runtime roles. They cover outcomes, effective state, exact money/currency/null snapshots, current-estimate corrections, retries/concurrency, immutable history, RLS, indexes, constraints, deletion, validated OpenAPI, unavailable inventory and reminder intent. Worker integration exercises real BullMQ/Redis delivery and old-version rejection after resolving/reopening. Component tests cover loading, empty/error recovery, dates, correction, pagination, private notes and retry identity. Browser smoke covers desktop/mobile, keyboard radio/form access, overflow and neutral light/dark screenshots with synthetic API fixtures. The production proxy harness checks real production Next routing against a controlled loopback upstream; mocked browser routes are not its proxy evidence. Real production data/load, human assistive-technology review and live ntfy delivery remain outside these tests.
