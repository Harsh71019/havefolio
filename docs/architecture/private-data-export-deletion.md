# PER-35: private export and account deletion proposal

Status: implemented; verification and PR handoff are tracked in PER-35. The owner approved keeping deletion pending until
provider finality is established, retaining exact retry keys meanwhile (2026-10-18).
No production operations are authorised.

## Verified starting point

Prepared from origin/main `19ef51fdeb850138be6392d6f5c92d9dc29dd502` on 2026-10-18.
PER-34 settings, PER-30 goals, PER-31 allocations, PER-56 merchants,
PER-60 explicit LAN authentication and PER-37 security hardening are merged.
PER-32 goals screens are now merged through PR #47; the implementation includes current
main `cc6f076`. PER-39 contract/failure-boundary coverage is also reconciled from
main `438becd`, followed by PER-36 accessibility/resilience from main `4623047`.
The new privacy controls retain keyboard focus and meet the merged 44-pixel touch-target
contract. Recheck main before final handoff.
Existing authentication origin/cookie policies must remain intact.

## Proposed export contract

Use a versioned JSON export, generated on demand inside an owner-scoped repeatable-read
transaction with a shared owner lock that serialises deletion admission and delivered through an authenticated, no-store download. Do not persist an
export artifact: there is no stored download URL, artifact expiry job or residual export
file to erase. Bound concurrent generation, database execution time and output memory;
report an explicit recoverable limit error rather than silently truncating a dataset.
Money uses decimal strings for integer minor units. Nested original/suggested JSON is
serialised directly from validated PostgreSQL JSON text to preserve large original numeric values. Preserve currencies, nulls, original
purchase precision/components, date-only values, provenance and all correction chains.

Explicit attachment treatment: include attachment metadata only, excluding provider
object keys, asset identifiers and delivery URLs. Binary attachment packaging is out of
scope. The settings screen must explain this before download; owners can download
attachments through their existing authenticated routes before deleting their account.

The current schema inventory requires these export decisions:

| Tables | Treatment |
| --- | --- |
| users | Allowlist identity, display name and noncredential timestamps only |
| auth_sessions | Exclude session records and all authentication material |
| application_metadata | Exclude application infrastructure metadata |
| categories, subcategories, tags, item_tags, merchants | Include owner-scoped records |
| owner_onboarding, demo_datasets, owner_settings | Include progress, demo provenance and preferences |
| items, item_refunds, item_suggestions, item_warranties, lifecycle_events | Include owner-scoped records, original entries and histories |
| desires, desire_reminders, notifications | Include private content and schedule/read state; exclude internal delivery claims |
| media_attachments | Allowlist private attachment metadata; exclude operational storage identity and URLs |
| desire_review_events, desire_item_matches, desire_conversions | Include owner-scoped histories, explanations and links; exclude internal request hashes |
| goals, goal_contributions, desire_goal_allocations | Include owner-scoped amounts, currencies, corrections and allocation links; exclude internal request hashes |

A schema coverage test fails whenever a new table or column lacks an explicit export policy.
Review nested user-entered JSON separately from service-generated credentials; do not
strip original user content merely because its field name resembles a secret.

## Proposed deletion admission and status

Require password verification at deletion admission through the existing password service
and a rate-limited reauthentication path. Require exact explicit confirmation in the UI
and DTO; never infer consent from visiting a page or signing in. A password proof must
be scoped to deletion, the current owner/session, short-lived and single-use if admission
uses a separate reauthentication step. Recheck the credential/session under the deletion
transaction lock to reject revocation, credential changes and stale proofs.

Persist deletion intent and exact cleanup resources before revoking all normal sessions.
Block new login, export, uploads and all other owner actions while deletion is pending.
Reject in-flight writes at the database boundary as well as the HTTP guard; existing
repositories holding an owner row lock must recheck deletion state. Account for uploads
whose external provider write occurs outside the metadata transaction.

Use a separate restricted deletion receipt, stored only as a hash, to inspect status after
normal sessions are revoked. It must grant no inventory/export/account access and must
not be accepted as a normal session. Keep it out of URLs and telemetry. Status describes
pending cleanup, retryable provider failure, relational erasure and the approved completion
state. Pending receipts remain valid while deletion is unresolved; completed receipts expire after 30 days.

PostgreSQL remains authoritative for intent, retries and progress; a lost queue notification
must not strand cleanup. Use bounded reconciliation and exact-resource retries. No provider
prefix listing/deletion, shared database cleanup or Valkey discovery/flush is permitted.
Suppress reminder scheduling/delivery after admission and remove exact pending job IDs.
Already delivered or already transmitting generic external notifications cannot be recalled;
state that limitation explicitly rather than claiming they are erased.

## History and relational erasure

Existing review/contribution/allocation guards already allow erasure by deleting their
parent desire/goal. Preserve those guards for ordinary history edits. No broad trigger
disabling or audit-history bypass is necessary.

After provider cleanup is safely settled, remove media variants before originals to respect
the parent FK. Remove desires (cascading reviews, allocations, conversions, matches and
reminders), goals (cascading contribution history), then items and dependent records,
demo datasets, taxonomy and owner identity, with the authenticated owner context applied
for RLS. Verify actual FK and trigger behavior in isolated integration tests before treating
this order as executable. Keep only the approved minimal receipt/cleanup state outside the
owner FK so normal sessions do not survive identity erasure.

## Approved completion and retention policy

The owner selected on 2026-10-18: keep deletion pending until provider finality is
established; retain exact retry keys meanwhile. A local upload timeout and a provider
"not found" response do not establish that an ambiguous write cannot finish later.

Admission snapshots every attachment, including detached tombstones. Only a `ready`
record supplies positive evidence that its immutable-key upload finished and was
acknowledged before admission. All pending, deleting or deleted records conservatively
require additional finality evidence, including records from previous ambiguous writes.
Admission blocks further uploads and ready transitions at the database boundary.

One elected request row is reconciled per API tick, at most one exact resource per tick.
The API hosts this durable PostgreSQL-backed reconciler alongside the existing photo
recovery reconciler; Cloudinary credentials remain in the API instead of being added to
the worker. Multiple API processes use `FOR UPDATE SKIP LOCKED` to lease requests.
No transient queue event is needed for eventual cleanup. Pending requests survive restart;
provider failures leave `retrying` status and retain intent. Successful exact deletion of
an uncertain resource still leaves `awaiting_finality` and repeats cleanup. There is no
automatic finality timeout and no public override or cancellation endpoint.

Additional finality for uncertain resources requires a separately reviewed operator
repair based on provider evidence and exact resource identity. This PR does not provide
or run a production attestation procedure. Until evidence exists, deletion can remain
pending indefinitely, identity and private rows remain inaccessible, and retry keys remain
linked to the pending owner. The UI explicitly explains this possibility. Do not change
`finality_established` merely because retries returned "not found". In particular, a newly
arrived late asset must be destroyed before finality can be established.

Once every resource has established finality and successful cleanup, relational erasure
removes media, histories and owner identity in one transaction. The completed receipt
contains only a hash and status/timestamps, has no remaining owner link, and expires after
30 days; the reconciler purges expired completion receipts. Pending receipts have no
expiry so status access does not disappear during an extended provider incident.

Current reminder jobs are removed by exact ID on admission using the existing queue
adapter. A Valkey outage can defer physical queue removal; PostgreSQL reminder intent is
removed atomically, making stale and racing jobs no-ops at delivery time. Existing bounded
queue retention still applies. External notifications already being sent cannot be recalled.

Backup/provider retention and restore behavior are explicitly disclosed: active application
deletion does not claim erasure of historical backups or previously downloaded copies.
This feature changes no backup policy or provider setting. Deployment must retain the
approved pending-deletion semantics when restoring old database/provider snapshots;
never restore an erased account into service without reconciling its deletion records.

## Required verification

Use synthetic owners and disposable loopback PostgreSQL/Valkey only. Cover full schema
export, cross-owner access, exact money/date/history preservation, credentials/URL exclusion,
reauthentication/confirmation, session revocation, queued work, upload/deletion races,
idempotent exact-resource retries, partial provider failure, worker restart, RLS, relational
ordering, receipt scope/expiry and no cross-owner cleanup. Verify accessible mobile/desktop
settings and confirmation states with sanitized screenshots. Reconcile current main and
migration numbering, then run `pnpm check`, `pnpm test:integration`, `pnpm test:smoke` and
`MIGRATION_BASE_REF=origin/main pnpm db:check`. Required CI must pass before Code Review.

## Migration and rollout effects

Forward migration `0021_private_export_account_deletion.sql` adds nullable owner deletion
admission time, durable request/resource tables and owner-write/finality guards. Prior
migrations, snapshots and journal entries are unchanged. The guard takes a shared owner
row lock to serialize admission against writes. Monotonic media cleanup updates are
allowed without reacquiring that lock because existing media services persist cleanup
through separate connections while an enclosing item transaction owns the user lock.
Immutable media ownership/target guards still apply.

Review trigger/row-lock overhead and apply the migration with the migration role before
rolling out compatible API code. No production migration, deployment, account deletion or
provider smoke is part of this work. Do not roll back to an API binary that ignores
pending deletion: its reads/login paths would not enforce the new admission state.
During recovery, keep admission closed and deploy a compatible binary or roll forward.

No new services, production databases, queues, Cloudinary permissions or environment
settings are introduced. Structured events include only named outcomes and safe codes;
no receipt, owner identifier, object key, provider error or exported contents is logged.
Existing rate-limit source/account keys remain HMAC protected and expire normally.

No real provider finality, backup restore behavior or manual assistive-technology pass
is claimed by automated synthetic tests. Exports above 16 MiB fail explicitly without
returning a partial dataset; operator-assisted large exports remain a limitation.
