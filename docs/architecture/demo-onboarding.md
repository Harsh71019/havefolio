# PER-19: optional demo inventory and welcome help

A new owner can add a genuine item immediately, opt into samples, or skip. The welcome card on Home/My Store is inline and dismissible; it never blocks navigation. Skipping or dismissing persists across refreshes. “Revisit welcome help” deliberately reopens it. The manual-add flow remains PER-11; a photo, date or price is optional.

## Durable identity and migration

Forward migration `0010_demo_onboarding.sql` adds `demo_datasets`, `owner_onboarding` and nullable `items.demo_dataset_id`. An active dataset is unique per owner, has the fixed version `indian-household-v1`, and has a composite `(id, owner_id)` identity referenced by each sample. An owner/dataset index supports counting and removal. Existing records receive NULL and remain genuine. Neither create/update DTO accepts demo identity. `ItemDto` / shared `ItemResponse` / paginated card responses expose only required boolean `isDemo`, never internal dataset IDs. The existing handwritten contracts/Swagger workflow has no generated client command.

No classification by names, taxonomy `is_demo`, dates, prices, IDs or import provenance. PER-9's taxonomy default marker remains a separate concept: genuine possessions using default categories remain genuine. Demos reuse active same-owner categories/subcategories; missing classifications are created on this explicit opt-in, retired entries stay retired, and the existing 500-entry limits apply transactionally. Taxonomy values are reusable and are intentionally retained on removal, including values subsequently referenced by genuine items. No demo tags are created; any relationships later added internally cascade safely with their marked item.

Apply the additive migration with the protected migration role before deploying API/web. Existing data does not need a backfill. No owner inventory is inserted by a migration, startup or login. No configuration, infrastructure, health/Gatus, production services or observability bootstrap changes.

## Dataset and read-only policy

Six generic fictional Indian household examples: a steel kettle, cotton kurta, short story collection, table lamp, cast iron tawa and donated spare backpack. Four example INR amounts and two unknown prices; exact, month, year and unknown purchase dates; working/needs-repair conditions and often/sometimes/rarely/never usage. Amounts are explicitly examples, never market prices or the owner's purchase history. The small dataset uses existing no-cover presentation; there are no remote images, Cloudinary uploads, receipts, warranties or personal details.

Normal edits, lifecycle actions, refunds and individual item deletion reject samples with 409 `DEMO_ITEM_READ_ONLY`; owner checks precede this error. Upload admission and media mutations enforce the same identity. Item details use a dedicated read-only presentation with honest empty media copy and example amount/date labels. No template-copy operation is included. “Add my own item” opens the unchanged manual-entry form and carries no sample data or marker. Taxonomy maintenance may still reassign classifications, as it does for all referenced inventory; it does not convert sample identity.

## Spending source

PER-20's shared `source` SQL includes `i.demo_dataset_id IS NULL` before lifecycle/date filtering, refund preaggregation, precision validation or dimension aggregation. Every scope, currency, category/subcategory, year/month group, unknown-price/date count and refund calculation uses that source. Nothing is subtracted afterward. The domain oracle skips explicit `isDemo` inputs. There is no public demo-preview mode; spending remains genuine by default.

The existing spending integration suite mirrors its heterogeneous genuine fixtures as marked samples, including all ownership states, date precisions, currencies, gifts, zeros and refunds. Existing oracle parity and reconciliation expectations must remain unchanged. Focused onboarding integration additionally proves that demo year-only dates cannot break an otherwise valid genuine monthly report, and checks every ownership state and dimension against genuine-only totals.

## API and transactions

All endpoints require the PER-8 session, derive owner on the server and return `Cache-Control: no-store`:

| Method and path | Result |
| --- | --- |
| `GET /api/v1/onboarding` | State, genuine/demo counts and checklist milestones only |
| `POST /api/v1/onboarding/actions` | Validated `action`: start, skip, complete, revisit, browse_store, review_item |
| `POST /api/v1/onboarding/demo` | Explicit opt-in; create or return the existing dataset |
| `DELETE /api/v1/onboarding/demo` | Idempotent sample removal and safe remaining counts |

State is `not_started`, `active`, `skipped` or `completed`. Starting a dismissed checklist returns 409 `INVALID_ONBOARDING_TRANSITION`; explicit revisit reopens it. Skip and complete are idempotent dismissals. Demo opt-in starts only a not-started checklist and never reopens one already dismissed. Reading never seeds. Browsing records a surface visit, while the genuine details client records a review only for a genuine record; the server also requires a genuine item to exist. These are private help milestones, not trusted audit assertions. Adding a genuine item is independently computed from NULL demo identity, so demos never complete that step or suppress the genuine-first-item invitation. Checklist operations never mutate inventory.

Every operation uses the existing owner-row transaction lock. Concurrent seeds across API instances serialize; the unique owner constraint adds database protection. Creation, taxonomy, items, initial sample history and state commit together. Repeated activation returns the existing dataset, including after onboarding dismissal. Removal deletes only same-owner marked items, their cascading children and that owner's dataset, preserving genuine items and all taxonomy. Repeated removal does nothing; GET/login cannot recreate a removed dataset. Adding again requires another deliberate demo POST.

No sample assets are created. Defensive removal uses the established exact-key private-media deletion lifecycle if an internal/older tool attached assets. Pending/oversized asset cleanup returns retryable `ITEM_MEDIA_PENDING`; provider failure keeps inventory and dataset, with durable cleanup progress/tombstones for reconciliation. Confirmed-deleted tombstones detach before item deletion. Unit probes cover pending/provider failures; normal no-provider removal and cascades are verified against PostgreSQL. No live provider operation is required or performed for this feature.

## Privacy and UI verification

Existing PER-48 request/correlation logs and PER-49 safe exception handling apply. Only fixed onboarding route templates were added to the monitoring allowlist; no bootstrap changes. Expected validation, read-only and transition failures remain handled 4xx responses. No payload logging, names, amounts, notes, inventory, dataset/owner IDs, browser persistence or third-party analytics are added.

My Store retains the existing server query/cursor contract and adds an unmistakable Demo status on each sample card, including pagination/refresh, with “Example amount” in its facts. Removal refreshes the list from the API. Existing category grouping is retained. The welcome card uses existing shared shadcn Card/Button/Dialog primitives; no new reusable primitive, custom theme or full-store redesign. Kibo's existing Pill remains the card status composition.

Browser tests use synthetic intercepted API responses, distinct from PostgreSQL HTTP integration evidence. They check explicit keyboard opt-in and removal, skip persistence, genuine-card preservation, useful post-removal empty state, honest details, 360px/768px/1440px layouts and horizontal overflow in light/dark themes. Sanitized screenshots are `docs/screenshots/per-19-{welcome,demo,details,removed}-{mobile,desktop}-{light,dark}.png`. Automated role/label/focus checks support accessibility; no claim of a live assistive-technology session or production rollout.

Spending screens (PER-21), currency conversion, enrichment/OCR, public demo accounts and blocking tours remain outside scope.
