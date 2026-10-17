# PER-56: private purchase merchants and source links

Owners can record a seller independently of item brand, price, purchase-date precision,
condition and ownership. Both merchant and purchase URL remain nullable. Existing items
show **Not recorded**. No account connection, remote request, scraping, price lookup,
merchant inference, uploads or spending aggregation is introduced. PER-57 owns merchant
spending insights; PER-58 inventory density is preserved.

## Data and ownership

`merchants` has an opaque UUID, owner, display name, normalized name, optional normalized
website host, active/retired state and timestamps. Names follow the existing taxonomy
normalization: Unicode NFKC, trimmed/collapsed whitespace, preserved display capitalization,
and lowercase uniqueness. PostgreSQL `lower` is authoritative for the stored normalized
name. Names are unique per owner across active and retired rows. Similar names are never
merged. POST reuses an exact normalized duplicate without changing its display name, host
or retirement state, supporting suggestions and retries. To correct an existing merchant,
use PATCH explicitly. A rename changes its current label on all linked items; existing
item details history remains append-only and does not store merchant names or source URLs.

An item references `(merchant_id, owner_id)` through a composite foreign key. Both item and
merchant mutations serialize using the existing owner-row lock, so retirement cannot race
an item assignment. Newly assigned retired merchants are rejected; unchanged historical
assignments remain valid and can be cleared or replaced. Retirement never deletes links.
Cross-owner and missing IDs have the same fixed not-found response. The current single
registered-owner authentication policy is unchanged; isolation is also tested with dormant
synthetic owner records at the service/database boundary.

Forward migration `0016_purchase_merchants.sql` adds the table, constraints, nullable item
columns, unique owner/name and composite owner/identity keys, an owner/state/name search
index and an owner/merchant/item index for later aggregation. Existing migration history
is unchanged. Production needs the forward migration before deploying this API/UI; review
normal DDL lock timing and backups. No production migration or deployment is part of this
change, and no shared service configuration changes are required.

## API and privacy

- `GET /api/v1/merchants`: normalized name-prefix search, active by default, optional
  `state=retired|all`, default 25 and maximum 50 results. Encrypted AES-GCM keyset cursors
  bind owner, search, state and limit and expire after seven days. The key derives from
  the existing authentication secret with a merchant-specific purpose; local development
  without that secret invalidates cursors after restart. Pages are live views: corrections
  during paging may move records. Search never filters only a client-loaded subset.
- `POST /api/v1/merchants`: create or reuse an exact normalized owner merchant.
- `GET /api/v1/merchants/:id`: read active or retired owner merchant.
- `PATCH /api/v1/merchants/:id`: correct display name/website host, retire or restore.
- Existing item POST/PATCH accept optional `merchantId` and `purchaseUrl`; null clears
  each independently. PATCH requires the last-seen item revision, advances it once and
  adds one `details_updated` event naming changed fields. Rejected/stale writes roll back
  without events. Existing separate condition/usage events retain their established meaning.

OpenAPI documents all fields, constraints and endpoints. Detailed item responses include
current merchant metadata and the private URL; lightweight inventory responses and their
OpenAPI schemas omit all source fields. Shared response properties are optional at the
TypeScript source boundary so older fixtures/clients remain compatible; this server
always returns explicit nulls for unrecorded sources. Normalized names/owner IDs and raw
database errors are never public merchant fields.

Purchase URLs are validated using a parsed URL while preserving the exact safe input.
Only absolute HTTP(S), at most 2048 characters, with a host and no embedded credentials,
control/format characters, whitespace or backslashes are accepted. The API never fetches
or previews them, including private-network hosts. The SQL constraint adds a bounded
protocol/authority backstop; parsed application validation is authoritative. Website hosts
are optional host-only values normalized to lowercase ASCII/IDNA, without path, port,
credentials or query. A merchant's host never implies an item's URL or price.

Seq uses existing structured event allowlists and fixed public error codes; merchant/search
fields and URL-bearing keys are explicitly redacted. GlitchTip reconstructs events from
safe fields, strips request bodies and queries, and normalizes merchant route IDs. Tests
assert complete URLs, query values, merchant names and search text cannot reach either
sink. No merchant-choice analytics is added.

## Owner interface and verification

The purchase-source selector is a Havefolio composition of existing shared shadcn Input,
Select, Button and Label primitives. Both approved registries were checked:
[shadcn combobox](https://ui.shadcn.com/docs/components/combobox) and
[Kibo combobox](https://www.kibo-ui.com/components/combobox). No custom reusable primitive,
new dependency or product theme is needed. Separate labelled search and selection controls
provide server search, keyboard selection, bounded load-more, common suggestions, custom
offline/online entry, correction/retirement/restoration, explicit Not recorded and retired
historical states. Errors and loading/results are announced. Merchant failure keeps manual
item entry usable and preserves all in-memory entered data for retry. Private purchase URLs
and merchant search text are not added to browser draft storage. They survive recoverable
requests/session reauthentication in the mounted form, but require reentry after a full
page reload. Existing item draft behavior is unchanged.

Add/edit forms validate source links; detail view displays a neutral **Open purchase page**
link with `target="_blank" rel="noreferrer noopener"` and does not print the full URL.
Details history names merchant/URL edits without printing their values. Missing merchant
information has an optional purchase-edit shortcut. Browser tests use synthetic fixtures
and cover desktop/mobile light/dark detail/edit states, keyboard selection, independent
clearing, failed item-save recovery, merchant outage and custom creation. Screenshots are
API-mocked presentation evidence, not authenticated-live production proof. Manual screen
reader/assistive-technology review remains a release verification step.

PER-55 can change the same schema, item DTO/contracts and forms. Keep separate migration
history and land PER-55 first as requested; rebase and resolve migration numbering and
shared contracts intentionally, then rerun all gates before marking PER-56 ready.
