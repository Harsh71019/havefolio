# Inventory querying (PER-17)

`GET /api/v1/items` remains authenticated and owner scoped. All filters run against the complete server result set before the page limit. The list returns card fields and ready original cover metadata (the first photo by position/UUID, matching PER-15). Notes, descriptions, specifications and original input are detail-only. Receipt/warranty attachments and provider URLs/keys are never list fields. Covers resolve through the existing authenticated photo thumbnail endpoint. Three batched queries hydrate items, tag IDs and covers, independent of card count, plus one optional taxonomy validation query and the existing owner-lock transaction.

## Search and filters

- `q`: at most 200 normalized characters; Unicode NFKC, trim/collapse whitespace, lowercase. PostgreSQL simple full text search matches whole words without stemming. All words must occur in the combined name/brand/model document **or** in one selected search-result tag document. Search does not match arbitrary substrings, private notes or descriptions. Punctuation is a separator. Tags are searched regardless of whether `tagId` is also set; every filter still intersects. Indexed stored documents use NFKC too.
- `categoryId`, `subcategoryId`, `tagId`: owner-only UUIDs. Subcategory requires its matching category. Foreign, missing and mismatched choices return the same controlled 400. Retired taxonomy may be queried to find existing items.
- `ownershipStatus` and `useFrequency`: contract enums. Unknown frequency is selectable explicitly.
- `priceKnown` / `dateKnown`: `include` (default), `exclude`, `only`. Zero is known. Price ranges include unknown values only when `include` is selected. Unknown-only plus a range is rejected. Date precision (`exact`, `month`, `year`, `unknown`) further intersects these choices; contradictory combinations are rejected.
- `priceMin` / `priceMax`: inclusive decimal strings of nonnegative integer minor units within signed bigint. A currency is required for price comparisons, and filters unknown prices to that currency as well. No conversion or cross-currency comparison.
- `purchasedFrom` / `purchasedTo`: inclusive real Gregorian `YYYY-MM-DD` dates, year 1–9999. An exact date represents a point; month and year precision represent possible intervals. A known item matches when its possible interval overlaps the requested range. Unknown dates follow `dateKnown`. This is an honest **possible age** filter: UI age presets must translate to fixed purchase-date bounds and explain that approximate dates may overlap. For exact-only age results use `datePrecision=exact`. Stored precision/components never change. Dates are fixed in copied URLs, not recomputed on refresh.

Ranges are ordered and unsupported combinations return 400 `INVALID_ITEM_QUERY` (DTO format failures return `INVALID_REQUEST`). SQL is composed only from static column/operator allowlists; every external value is bound through pg parameters. No extension or external search service.

## Sorts and cursors

| Sort | Direction | Tuple |
| --- | --- | --- |
| `id` (backwards default) | asc only | UUID |
| `name` | asc (default) / desc | PostgreSQL lower(name), C collation, UUID asc |
| `newest` | desc only | created_at desc, UUID asc |
| `oldest` | asc only | created_at asc, UUID asc |
| `updated` | desc only | updated_at desc, UUID asc |
| `price` | asc (default) / desc | minor units, UUID asc; explicit currency required |

Unknown prices sort last in both directions. The stable UUID tie-breaker always ascends. Page size is 1–100, default 25. The response exposes `hasMore` and `nextCursor`; pass the cursor as `after`. History retains its own UUID pagination. Inventory cursor strings begin `v1.` and use AES-256-GCM authenticated encryption with a random nonce and a domain-separated key derived from the existing required production `AUTH_RATE_KEY_SECRET`. No new deployed credential is required. Rotation invalidates cursors; development/test without the secret uses a process-lifetime key.

The encrypted payload includes version, exact sort value (including six-digit timestamp precision), UUID, seven-day expiry and a digest binding owner, normalized query, sort, direction and page size. Malformed, expired, tampered or mismatched cursors return 400 `INVALID_ITEM_CURSOR`; reset pagination and retry the retained controls. A deleted anchor remains usable because its tuple is carried in the cursor. Unchanged datasets traverse without duplicates or omissions. This is a live view, not a snapshot: moving/updating records between requests can repeat or omit them; newly inserted records before the anchor are not revisited. Reset pagination to refresh the view.

## Indexes and verification

Forward Drizzle migration `0008_inventory_query_indexes.sql` adds owner/name/UUID, owner/updated/UUID, owner/currency/price/UUID and GIN simple full text item/tag documents. Existing owner/created/UUID, owner/status/created/UUID, owner/category/subcategory and owner/tag/item indexes remain. Search uses a union of indexed item and tag matches, not a correlated scan of every item. No speculative index for every filter combination.

`inventory-query.e2e-spec.ts` migrates an empty disposable schema, tests contracts, isolation, filters, bounds, cursor expiry/tampering and every sort. It seeds a 30,000-item baseline across 30 owners, then adds 19,000 items for one owner (49,000 total) with price/status variation, a rare search token and tied timestamps in traversal fixtures. After VACUUM/ANALYZE settles GIN pending lists and statistics, it runs `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)`. Checks assert index access and no sequential scan of `items` for common name/newest/updated/price/status/search queries; no exact costs or timing thresholds. Small tables may correctly use sequential scans. Existing ascending created/status indexes may need a small tie-break sort for descending dates. Search GIN is global, with owner constraints applied on every union branch. Very common words can still match much of one owner's inventory; write/storage overhead and planner statistics require monitoring as real distributions grow.

Production migration deployment remains an operator step: generated CREATE INDEX takes locks on the existing table. Review inventory size, backup and lock window before applying; no production plan analysis was run.

## Contracts and integration boundary

This repository uses handwritten `@havefolio/contracts` types plus Nest Swagger decorators and integration contract checks; it has no client-generation script. `InventoryQuery`, `ItemCard` and `InventoryPage` mirror the endpoint and retain bigint strings and date precision. API OpenAPI describes every query enum, bound, cursor and response/error. `inventory-query-state.ts` provides bounded URL parsing/canonical serialization and cursor reset for changed filters, sorts and page size. URLs contain query intent and encrypted pagination, never credentials or full item records. Search terms themselves are visible in browser history; do not add notes or other private record content to URLs.

PER-16 owns the My Store route/cards. This draft does not create a competing page. After PER-16 merges, rebase onto main and integrate controls, debounce, mobile filters, back/forward restoration, accessible result announcements and recoverable failures. Final page smoke checks/screenshots and readiness are pending that dependency. No card redesign, spending aggregation, detail editing, currency conversion, AI search or public inventory access.

Measured PostgreSQL 18.4 plans on the final 49,000-item synthetic dataset:

| Query | Indexes observed |
| --- | --- |
| Name | `item_owner_name_idx` |
| Newest | `item_owner_created_idx` |
| Recently updated | `item_owner_updated_idx` |
| INR price ascending | `item_owner_currency_price_idx` |
| Owned + newest | `item_owner_status_created_idx` |
| Rare whole-word search | `item_search_document_idx`, `tag_search_document_idx`, `items_pkey` |

Only nullable price requires an explicit NULLS LAST clause. Adding it to nonnullable descending timestamp/name order prevents PostgreSQL from matching existing ordered indexes, despite identical result semantics. The final query preserves deterministic price null placement and allows existing created/updated indexes to serve descending pages with the ascending UUID tie-breaker. Reverse price ordering may still sort the scoped owner/currency result; a second price index is intentionally deferred until real workload evidence warrants its write cost.
