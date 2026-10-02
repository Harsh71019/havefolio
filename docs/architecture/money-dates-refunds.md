# PER-22: money, date precision and refund correctness

`@havefolio/domain` is the single authority for financial and date primitives. It is pure TypeScript with no I/O, used by the API, the web app and (for its currency list) the database schema. Earlier duplicate helpers in `@havefolio/contracts` and inline web/API checks now delegate to it.

## Money

- A `Money` is `{ currency, minor }`: an ISO 4217 code from the checked-in current/historical list and a non-negative `bigint` of minor units, frozen. Unknown money is `null`, never zero; `"0"` is an explicit zero.
- Wire/JSON/OpenAPI form is unchanged: a decimal string of minor units (`"129950"`) beside an explicit `currency`. JSON numbers are rejected because values above 2^53 have already lost precision. Strings are exact up to PostgreSQL's bigint maximum `9223372036854775807`; above it returns `UNSAFE_MONEY_VALUE`.
- User entry (`parseDecimalAmount`) uses string arithmetic only. It accepts plain digits or consistent western (`1,234,567`) / Indian (`12,34,567`) grouping and rejects anything else (`1,2,3`, `.5`, `1e3`, signs, symbols). Digits beyond the currency's minor units are rejected (`MONEY_PRECISION_EXCEEDED`) unless they are trailing zeros; nothing is rounded.
- Minor-unit digits keep the table already used for stored data (0: JPY, KRW, VND…; 3: BHD, KWD, OMR…; 4: CLF, UYW; otherwise 2). MGA stays at 0 to match previously stored amounts and CLDR, although ISO lists 2; changing it would silently rescale existing records.
- Arithmetic (`addMoney`, `subtractMoney`, `compareMoney`, `sumMoney`) requires the same currency (`CURRENCY_MISMATCH`) and never produces negative or out-of-range values. There is no conversion anywhere.
- `formatMoney` is presentation-only: it passes the exact decimal string to `Intl.NumberFormat` (no float), keeps the value's own currency, and uses `en-IN` as the initial display locale. INR is the entry default only (`defaultEntryCurrency`); storage always carries the explicit currency. Catalogue prices are never used as amounts paid.

## ApproximateDate

| Precision | Components | Interval | Display |
| --- | --- | --- | --- |
| `exact` | year, month, day | that day | 29 February 2024 |
| `month` | year, month | first–last day of month | February 2024 |
| `year` | year | 1 Jan–31 Dec | 2024 |
| `unknown` | none | none | caller-supplied “not recorded” label |

- Components must match precision exactly (`INVALID_DATE_PRECISION`); impossible values, including 29 February outside leap years and years outside 1–9999, are `INVALID_CALENDAR_DATE`. Missing components are never filled and unknown never becomes today or a record-created time.
- Database (`*_date_precision` + nullable smallints with a shared CHECK), API (`{ precision, year, month, day }`) and web use the same components, so values round-trip unchanged. Calendar days are `YYYY-MM-DD` strings parsed without `Date`; display uses UTC, so no timezone shifts a day.
- `relationToRange(date, range)` is the explicit semantics: `within` (every possible day inside), `overlaps` (a partial date straddling a bound), `outside`, or `unknown`.
- Inventory filtering (`purchasedFrom`/`purchasedTo`) matches dates that could fall in range (`within` or `overlaps`) and always uses purchase date, never `created_at`; unknown dates follow `dateKnown`. Spending totals (PER-20) must instead count only `within` and report `overlaps` and `unknown` separately.
- Ordering (`compareApproximateDates`): earliest possible day, then the narrower span, unknown last.

Item endpoints keep their established public codes (`INVALID_ITEM`, `INVALID_ITEM_DATE`, `INVALID_ITEM_QUERY`) for client compatibility while delegating the decision to these value objects. Refund endpoints return the precise domain codes.

## Returns and refunds

Ownership status `returned` records that the item went back; a refund records money received back. They are independent: returning never creates a refund, and recording a refund never changes ownership. A refund may be recorded for an item that is still owned (for example a partial refund for a missing part).

`item_refunds` holds confirmed refunds: owner, item, currency, positive `amount_minor`, an approximate refund date (unknown allowed) and an optional private neutral note (1–1000 characters). Rules, enforced in the domain, the API transaction and the database:

- The original purchase amount and currency are never mutated by refunds. The owner can still correct the original record through `PATCH /items/:id`, but only to values consistent with recorded refunds: currency cannot change under them (`CURRENCY_MISMATCH`), the amount paid cannot drop below their total (`REFUND_EXCEEDS_AMOUNT_PAID`) or become unknown (`REFUND_REQUIRES_AMOUNT_PAID`, or `INVALID_ACQUISITION_COMBINATION` for a gift).
- Refund currency equals the purchase currency. The composite foreign key `(item_id, owner_id, currency) → items(id, owner_id, currency)` makes cross-owner or cross-currency refunds impossible, and `ON UPDATE RESTRICT` blocks an item currency change while refunds exist.
- Total refunds never exceed the recorded amount paid. A trigger (`refund_total_check`) re-sums under an item row lock after every refund insert/update and every price change, as a backstop to the application check.
- A refund needs a recorded amount paid. A gift with nothing paid recorded has nothing to refund (`INVALID_ACQUISITION_COMBINATION`). Explicit zero accepts no refund.
- At most 50 refunds per item. Owner and item of a refund are immutable.
- Item deletion cascades refunds and notes (privacy erasure). Owners can also delete a single refund.

### API

All endpoints are owner-scoped through the session, `no-store`, and use the item `revision` as the concurrency token: every write requires the last-seen revision, holds the owner lock and item row lock, advances the revision and appends history. Another owner's item returns `404 ITEM_NOT_FOUND`; another owner's refund on your item returns `404 REFUND_NOT_FOUND`.

| Endpoint | Result |
| --- | --- |
| `GET /api/v1/items/:id/refunds` | 200 snapshot |
| `POST /api/v1/items/:id/refunds` | 201 snapshot; body `{ revision, amountMinor, currency, refundDate?, note? }` |
| `PATCH /api/v1/items/:id/refunds/:refundId` | 200 snapshot; any of `amountMinor`, `currency` (confirmation), `refundDate`, `note` |
| `DELETE /api/v1/items/:id/refunds/:refundId` | 200 snapshot; body `{ revision }` |

The snapshot carries `revision`, `ownershipStatus`, `acquisitionType`, `totals { currency, amountPaidMinor, refundedMinor, netMinor }` and up to 50 refunds oldest first. `netMinor` is derived on read (no stored total that could drift) and is `null` when the amount paid is unknown.

History events `refund_recorded`, `refund_corrected` and `refund_deleted` (migration 0009 extends the event-type check) record refund ID, revision, currency, amount and, for corrections, changed fields and previous amount. The note is never copied into history, logs or telemetry, so deleting a refund removes its note.

Error codes are fixed tokens from `financialErrorCodes`: 400 `INVALID_MONEY_AMOUNT`, `MONEY_PRECISION_EXCEEDED`, `UNSAFE_MONEY_VALUE`, `INVALID_CURRENCY`, `INVALID_DATE_PRECISION`, `INVALID_CALENDAR_DATE`, `INVALID_REFUND`; 404 `REFUND_NOT_FOUND`; 409 `CURRENCY_MISMATCH`, `REFUND_EXCEEDS_AMOUNT_PAID`, `REFUND_REQUIRES_AMOUNT_PAID`, `INVALID_ACQUISITION_COMBINATION`, `REFUND_LIMIT_EXCEEDED`, plus the existing `STALE_ITEM_REVISION`. They are on the safe-message allowlist, so responses and structured logs carry only the code — never amounts, notes, dates or identifiers.

## Gifts and acquisitions

`acquisitionSpending(acquisitionType, pricePaidMinor)` classifies spending: a gift with no amount is `not_spending` (distinct from an unknown price); a gift with an amount the owner paid, a secondhand purchase, and an explicit zero are `priced` and keep their value and currency. Secondhand implies no discount, free item or condition. Unknown prices are `unknown_price`.

## PER-20 calculation contract

`spending.ts` is the reference contract an aggregation query must match; it is not the endpoint.

- Gross recorded amount paid: the purchase amount in its original currency.
- Confirmed refunded amount: the sum of `item_refunds` rows (never inferred from status or free text).
- Net recorded spend: gross − refunded. An input where refunds exceed gross throws rather than going negative.
- Unknown-price count and not-spending (gift) count are reported per currency; unknown prices never enter totals.
- Currency grouping: one result per currency, sorted by code; never summed together or converted.
- Scope: `current_owned` includes only `owned` items; `all_history` includes every status, so selling or returning keeps historical spending.
- Time: purchase date only. `dated` (within range), `spanningRange` (partial dates straddling a bound) and `unknownDate` buckets.

Indexes for these queries: `item_owner_purchase_date_idx (owner_id, purchase_year, purchase_month, purchase_day, id)`, `refund_item_owner_currency_idx`, `refund_owner_currency_idx` and `refund_owner_item_created_idx`.

## Web

Item details shows a “Returns and refunds” card with Purchase amount (unchanged), Refunded to you and Net recorded spend — never labelled as current value, resale value or savings — plus a keyboard- and screen-reader-accessible dialog to record or correct a refund (amount in the purchase currency, exact/month/year/unknown date, optional private note) and a confirmed delete. Unknown prices and gifts with nothing paid explain why no refund can be recorded. My Store, item details, add-item and edit flows use the shared formatter and parser, so zero and unknown stay distinct. No spending dashboard is introduced (PER-21).

## Migration and deployment

Forward migration `0009_money_date_refund_correctness` creates `item_refunds`, adds the `items (id, owner_id, currency)` unique key before the refund foreign key that references it, extends the event-type check, adds indexes and creates the refund triggers. Existing migrations are unchanged. It is additive; apply it with the migration role before rolling out the API. Index creation and the new unique constraint take brief locks on `items`; review for existing table size. The migration image now includes `@havefolio/domain` as a workspace dependency of `@havefolio/db`. No new services, environment variables or credentials.

Non-goals: PER-20 aggregation endpoint, PER-21 spending screens, currency conversion or exchange-rate history, bank sync, receipt OCR, resale estimates and financial advice. Pending (not yet received) refunds are not modelled; every refund record is a confirmed receipt.
