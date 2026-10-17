# PER-29: convert a bought desire into an owned item

Converting is optional. Recording `bought` (PER-28) stays complete on its own and never creates inventory. Once a desire's **current effective** review event is `bought`, the owner may create one owned item from it at `/wants/:id/convert`, linked from the decision-history page. The PER-26 comparison screen is untouched; merchant/source tracking stays with PER-56.

## API

All routes are owner-scoped, `Cache-Control: no-store`, under `/api/v1/desires/:id/conversion` and published in OpenAPI.

- `GET` returns eligibility (`eligible`, `converted`, `not_bought`), the current bought event id, copied **suggestions** (name, reason as notes, product link, photo metadata) and any existing conversion. The likely price is returned only as labelled reference data.
- `POST` takes `commandId`, `boughtEventId`, `copyPhoto` and confirmed `item` facts. Required facts: `pricePaid` (`{state:'known',minor}` including `"0"`, or `{state:'unknown'}`), ISO `currency`, `purchaseDate` with explicit precision (`unknown` allowed), `acquisitionType`, `condition`, `useFrequency` and `ownershipStatus`. Optional: name/notes edits, brand, model, category, subcategory, tags. Description, specifications and merchant fields are not accepted. The server never reads `likely_price_minor` while building the item.
- `POST …/photo` resumes an unfinished photo copy.

Foreign and missing desires both return `404 DESIRE_NOT_FOUND`. Foreign and missing taxonomy both return `404 ITEM_TAXONOMY_NOT_FOUND`. Conflicts use fixed tokens: `DESIRE_NOT_BOUGHT`, `STALE_BOUGHT_OUTCOME`, `DESIRE_ALREADY_CONVERTED`, `CONVERSION_COMMAND_REUSED` and `PHOTO_QUOTA_EXCEEDED`.

## Transaction and idempotency

One `DesiresRepository` owner transaction does the following, in order:

1. Takes the per-owner lock, sets the RLS context and locks the desire row.
2. Resolves a replay by `(owner, commandId)`. The canonical request hash must match and the command must belong to the same desire. Otherwise it returns `409 CONVERSION_COMMAND_REUSED`. Replays are resolved before stale checks, so a committed command always returns its original conversion, even after a later correction.
3. Rejects an existing conversion for the desire.
4. Requires the latest review event to be `bought` and equal to `boughtEventId`.
5. Inserts the item through the shared `ItemsService.insert`, the same validation and code path as manual creation. That writes the item, its tags and its append-only `created` lifecycle event with metadata `{source:'desire_conversion', desireId, conversionId}`.
6. Inserts the `desire_conversions` link with `ON CONFLICT DO NOTHING`.
7. When a photo copy is requested, reserves quota and writes durable pending media intent.

Any failure rolls everything back. Database uniqueness is the final guard: `UNIQUE(owner_id, desire_id)`, `UNIQUE(owner_id, command_id)` and `UNIQUE(item_id)`. Concurrent identical retries return one conversion. Concurrent fresh commands produce one `201`; the others get `409 DESIRE_ALREADY_CONVERTED` and the UI re-reads state to show the existing item.

The item keeps `original_source='manual'` (the owner confirmed every fact). `original_entry` stores the confirmed facts plus `provenance` recording which values came from desire suggestions and which the owner edited. PER-20 spending is unaffected: the item is an ordinary row, so unknown prices are excluded, explicit zero stays zero and gifts follow existing rules.

## Migration 0015

`0015_desire_conversions.sql` is forward-only. It adds the table, owner-composite foreign keys to the desire, the item and the exact `(event, desire, owner)` review event, check constraints and an owner/created index. Hand-written SQL then enables row-level security (the PER-28 pattern) and adds the `conversion_guard` trigger:

- **On insert:** the referenced event must be the desire's latest event, its outcome must be `bought`, and the item must be a non-demo item of the same owner.
- **On update:** identity is immutable. Only photo-copy progress may move forward.
- **On delete:** rows are removed only when their desire, item or event is gone.

Review corrections therefore never delete the item or the link. The conversion reports `boughtOutcomeCurrent=false` and the UI says the item was kept. Deleting the desire keeps the item and drops the link. Deleting the item drops the link, and the desire becomes convertible again. No applied migration was edited.

## Media behaviour

Attachment targets are immutable by database trigger, so the photo is **copied**, never transferred. The desire's photo family is never modified.

- **Intent:** inside the conversion transaction, owner (2 GiB) and global (4 GiB, shared advisory lock) quotas are checked. Three pending item-owned rows (original/display/thumbnail) are inserted with deterministic ids and keys derived from `(conversion, attempt, variant)`.
- **Copy:** after commit, each source variant is read through `PrivateMediaStorage`, its checksum is verified, and it is put under the new key. A second transaction marks all three ready atomically, bumps the item revision and sets `photo_state='copied'`.
- **Provider failure:** the conversion still returns `201` with `photo='pending'`. The resume endpoint retries the same keys.
- **Recovery:** pending rows older than 15 minutes are reclaimed by the existing media reconciler, which deletes any provider object by exact key, so nothing is orphaned. A later resume starts a fresh bounded attempt (at most 5).
- **Source gone:** if the desire photo was removed or replaced, the copy becomes `unavailable`. A different image is never substituted.

Responses expose only photo ids, dimensions and alt text. Provider identifiers, object keys and URLs are never exposed; delivery stays on the existing authenticated content routes.

## Security and observability

Ownership comes only from the session. Unknown body fields are rejected. The runtime role sees no conversion rows without the transaction-local owner context. Logs emit the fixed events `desire_converted` and `desire_conversion_photo_pending`, built from allow-listed fields only: no names, notes, URLs, amounts, media keys or owner/desire/item ids. Provider failures go to GlitchTip with the code `MEDIA_STORAGE_UNAVAILABLE`.

## Frontend

The `DesireConversionFlow` component reuses shadcn Card, Badge, Input, Textarea, Checkbox, RadioGroup, Select, Alert and Skeleton. No new primitive or theme is introduced. It has two sections:

- **Suggested from your want:** name, notes, an opt-in product link and the photo copy. Each field carries a badge that reads "Suggested" or "Edited by you".
- **Confirm what actually happened:** price, currency, date precision, acquisition, ownership, condition and use. None of these is prefilled.

Submitting without confirmations focuses an error summary. Inline errors use `aria-invalid` and `aria-describedby`. The flow also covers loading, load-retry, not-bought, stale-conflict ("Reload latest"), already-converted, ambiguous-failure ("Retry same submission" resends the identical command), success and pending-photo retry states. "Keep only the bought decision" is always available.

## Deployment

Apply migration 0015 with the migration role **before** deploying this API/web release. No new environment settings, services or provider configuration are required. Rollback: deploy a previous app version and leave the table in place; older versions ignore it.

## Tests

- **API integration** (`desire-conversions.e2e-spec.ts`, real PostgreSQL with separate migration/runtime roles): auth, foreign/missing parity, identity injection, required facts, money (unknown, `0`, max bigint, overflow, precision), currencies, all date precisions including leap days, gift/second-hand/returned semantics, provenance and history links, corrections, non-bought/corrected-away/stale outcomes, concurrent and replayed commands, rollback at taxonomy, post-insert and media-reservation boundaries, photo copy, provider and read failures, reconciler recovery, source removal, desire/item deletion, database guards/RLS/indexes, OpenAPI and log redaction.
- **Component tests:** suggested versus confirmed fields, validation summary and focus, exact payload without likely price, precision errors, identical retries, conflicts, not-bought/corrected/pending states and load recovery. The decision-history offer is covered too.
- **Playwright** (desktop/mobile): keyboard confirmation, no horizontal overflow, neutral light/dark screenshots.

## Known limits

- Concurrent resumes of the same pending copy can both reach the provider. One completes; the other may return `503` and is safe to retry.
- Item deletion is blocked (`ITEM_MEDIA_PENDING`) while a copy is pending, until it completes or is reclaimed.
- Real Cloudinary copy behaviour, production data volumes and assistive-technology review with real users are not covered by these tests.
