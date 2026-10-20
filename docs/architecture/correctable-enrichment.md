# PER-43: correctable enrichment boundary

Enrichment is an explicit owner action after a valid manual item has been saved. Manual
creation never calls a provider, touches an enrichment queue or depends on enrichment
availability. There is **no production provider configured**. The production registry is
empty, and GET reports `providerStatus: unconfigured`. A worker resolves requests without
an adapter to `unconfigured` with `PROVIDER_UNCONFIGURED`, never invented candidates.
This ticket contains deterministic test adapters only. PER-44 owns actual link/barcode
integrations; PER-45 owns opt-in OCR. Registering an adapter requires a separate approved
provider/configuration and privacy decision, including an accurate availability contract.

## Private API and review

All routes inherit session authentication, origin protection, strict validation, no-store
responses and safe errors. Resources absent for the owner return 404. No new UI is added.
The existing same-origin `/api/v1/items/:path*` allowlist covers these routes.

- `POST /api/v1/items/:id/enrichment`: `commandId` UUID, current `revision`, `kind`.
  Name and URL are snapshotted from the item; barcode additionally requires `barcode`.
  Photo/receipt additionally require a ready original `attachmentId` on this same item.
  Inputs are a discriminated union at the adapter boundary. Irrelevant input fields fail.
- `GET /api/v1/items/:id/enrichment`: bounded candidate sets and worker state. Fields have
  numeric confidence in [0,1] and source provider, input kind and reference. Multiple
  candidates remain separate and require explicit candidate selection. Confidence is
  evidence supplied by an adapter, not a claim of calibrated probability or confirmed fact.
- `POST /api/v1/items/:id/enrichment/:workId/reviews`: command UUID, current revision,
  candidate ID, supported field, and `accept`, `reject` or `correct` (with explicit value).
- `GET /api/v1/items/:id/enrichment/reviews`: immutable decision history, including previous
  and confirmed values. Both lists use `limit` 1–20 (default 10) and descending UUID
  `before` cursors. UUID ordering is stable, not chronological; timestamps remain visible.

Only name, brand, model and description are reviewable (PER-45 later adds receipt-only `pricePaid` and `purchaseDate`; see [photo-receipt-ocr.md](photo-receipt-ocr.md)). No provider command can change
actual price paid, currency, purchase date or precision, taxonomy, media, lifecycle or
notes. Specifications/image review awaits its own supported contract; no remote image is
imported here. Name/brand/model are bounded to 300 characters; description to 5,000.

A work record preserves input and confirmed-field snapshots; `items.original_entry` and
`original_source` are untouched. Workers never update an item. Every explicit decision,
including rejection, advances item revision and appends previous/confirmed values. Later
correction of the same candidate field appends another event. The highest resulting
revision is the head of that work's review chain. Any ordinary intervening item edit, or
a decision on a different work, invalidates the chain; request fresh enrichment instead
of silently rebasing stale evidence. Identical command retries return the original event;
reusing a command ID with a different payload conflicts. Request retries return the same
work (with its current asynchronous state). Original accepted/rejected decisions remain
in the history. Snapshots and terminal results cannot be rewritten; history deletion is
permitted only by parent item/account erasure.

## Durable work and bounds

Migration `0023_correctable_enrichment` adds `enrichment_work` and `enrichment_reviews`,
owner/item composite foreign keys, payload/state constraints, command uniqueness, due and
owner indexes, immutable-history guards and the existing deletion-admission write guard.
Existing migration history is unchanged. Reconcile numbering with parallel work before
integration; apply with the migration role before compatible API/worker code. Rollback
can leave these additive tables in place; do not down-migrate or erase private history.

An API transaction commits the intent independently of Redis. The existing worker polls
PostgreSQL every five seconds, at most ten rows per pass. Optional BullMQ hints on the
existing prefixed shared Valkey connection carry only opaque work IDs. A missing, failed
or indefinitely unavailable queue does not prevent database reconciliation. One pending
hint promise per worker bounds outage memory. No API queue connection is added.

Owner -> item -> work locking serializes claim/review/edit/deletion. A random lease token
fences completion, and a 30-second lease allows crash recovery. Item revision and ready
attachment binding are checked before execution; revision and deletion admission are
checked again before publishing results. Late or duplicate completions cannot replace a
new claim or resurrect deleted data. Stale outputs are discarded with `stale` status.

Providers have a five-second deadline and AbortSignal; adapters must honour cancellation.
Even a non-cooperative adapter retains its one outstanding slot after timeout, so repeated
claims cannot accumulate provider calls in that process. At most one enrichment command
runs at once per worker. Adapter results are runtime-validated and projected onto a strict
allowlist: at most five candidates, four distinct fields each, 32 KiB JSON and bounded
source references. Malformed outputs fail without storing a raw provider response.

Up to three claims are allowed, with 30/60-second failure backoff. Exhausted expired leases
become failed. Each process has a per-provider circuit: three failures open it for 60 seconds;
success resets it. Open/busy circuits defer for 60 seconds and count toward the three-claim
budget. Circuits reset on worker restart; durable attempt limits do not. Work ending failed
or unconfigured needs a new explicit request after conditions change. At most three active
and 100 lifetime work records per item bound persisted input/candidate growth. These limits
fail explicitly with 429; history is never silently pruned. Review events are append-only,
read through bounded pages and subject to the existing request body limits.

## Privacy, export and deletion

A purchase URL is private provenance. It is not fetch permission, even for localhost or
internal URLs. The boundary performs no network fetching, OCR, media read or external file
transfer. Media inputs contain owner-authorized attachment IDs only. No new provider,
broker, external account, production service or credential is introduced.

Exports include typed inputs, confirmed snapshots, candidate provenance/confidence and all
review events. Operational request hashes and lease/retry mechanics are excluded. JSONB
exports preserve exact nested JSON using the existing lossless serializer. Item deletion
cascades work and events; account deletion uses the existing parent erasure flow. Admission
blocks new work/reviews and discards in-flight results. No enrichment payload lives in
Valkey. Queued opaque hints become harmless no-ops after relational deletion.

Worker telemetry contains fixed event/category/code tokens only; exceptions, URLs, private
input, provider output, prompts and credentials are never passed to logging/monitoring.
HTTP logging retains only existing registered route templates and sanitized error codes.
There are no new upload endpoints, public media URLs or upload-provider cleanup resources.
Operational backups and copies of exports retain the existing documented limitations.

## Verification

Domain tests exercise result bounds, disallowed fields, ambiguity/provenance, timeout and
circuit reset. NestJS unit and real HTTP/PostgreSQL integration cover manual independence,
input binding, ownership, command idempotency, review/correction history, concurrency,
staleness, immutability and item erasure. Worker integration covers durable scheduling,
queue outage recovery, lease fencing/crashes, retry exhaustion, batching and deletion
admission. Worker unit tests cover a hung adapter/queue and telemetry redaction. Existing
privacy integration now proves inclusion and account cascade erasure of both new tables.

No real external provider, production migration, authenticated production journey or
external media transfer is exercised or claimed. No product review screens are introduced.
