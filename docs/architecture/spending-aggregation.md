# PER-20: authoritative recorded spending

`GET /api/v1/spending` is the single owner-authenticated analysis endpoint. PER-21 must consume this contract rather than calculate totals from paginated inventory or reimplement refunds. There is no insights UI in this ticket.

## Request and scope

Required `scope=current-owned|all-history`; optional `grouping=overall|category|subcategory|year|month` (default overall), `currency`, `categoryId`, `subcategoryId`, inclusive `purchasedFrom`/`purchasedTo` calendar days. Subcategory requires its parent category. Foreign/missing taxonomy receives the same 400 `INVALID_SPENDING_QUERY`; owned retired taxonomy remains usable. Every query derives owner from the session. Unknown parameters are rejected by the global validation pipe.

The domain's `spendingScopeStatuses` is the centralized scope definition: current-owned includes `owned`; all-history includes owned, sold, donated, disposed, lost and returned. The domain reference contract retains its existing underscore scope tokens internally; the REST/shared client contract uses explicit hyphenated tokens. Lifecycle transitions preserve purchase facts. Explicit privacy deletion removes the record and its refunds from future analyses.

## Amounts and counts

Each bucket has its original ISO `currency`, exact decimal-string `grossMinor`, `refundedMinor`, `netMinor`, and numeric safe-integer counts: `pricedItemCount`, `unknownPriceCount`, `notSpendingCount`, `explicitZeroCount`, `knownDateCount`, `unknownDateCount`, `totalItemCount`.

Gross is the actual recorded price paid, including an explicit zero. Unknown prices do not enter money totals. Gifts with no recorded amount paid are counted in `notSpendingCount`, separately from ordinary unknown-price purchases. Gifts with an explicit paid amount and secondhand purchases use the recorded amount without assumptions. Total count equals priced + unknown-price + not-spending counts; known-date + unknown-date counts also reconcile. Explicit-zero is a subset of priced count.

Confirmed `item_refunds` reduce net in the purchase currency, regardless of ownership status or refund date. Partial refunds leave a positive net; full refunds leave zero. Multiple refunds sum once per item before dimension aggregation. Return without refund retains gross and net; refund without return reduces net without changing ownership. Refund writes and price corrections use PER-22's transaction and database invariants, so refunds cannot exceed gross. Refunds never rewrite the original amount. A correction to that original amount is a separate explicit operation.

PostgreSQL sums bigint values into exact numeric values and serializes them to text before Node receives them. Aggregate sums can exceed one stored Money's PostgreSQL bigint bound; they are never passed through the bounded per-item Money constructor or JavaScript Number. Existing PER-22 value objects remain authoritative for item/refund writes, ISO validation, calendar validation and the independently tested reference calculation. No second Money or ApproximateDate model is introduced. Every dimension uses one SQL calculation pipeline, tested against `summarizeSpending`.

Different currencies are separate buckets; there is no primary currency, exchange rate, comparison or grand total. These figures describe recorded spending, never savings or current/resale value.

## Date relations and periods

Dates always mean purchase dates, never record creation dates. Range containment follows PER-22's `relationToRange`:

- `dated`: every possible purchase day lies within the range, or any known date without bounds.
- `spanningRange`: a month/year interval overlaps a range but is not fully contained. Disclose these amounts separately; do not attribute them to the requested period.
- `unknownDate`: no purchase date; kept explicitly even when a range is requested.
- Entirely outside the range: excluded.

Intervals are calculation bounds, never invented stored purchase components. Leap months and inclusive boundaries use PostgreSQL calendar arithmetic. Year reports group exact, month and year precision into the known year. Month reports group exact and month precision into the known month; if any otherwise applicable year-only purchase is present, return 400 `SPENDING_PRECISION_UNREPRESENTABLE`. Use a yearly report or narrower filters instead. Unknown-date buckets remain explicit with null time key. Partial dates with only a possible range match remain in `spanningRange` in every dimension.

Refund adjustments stay with the original purchase date even if the refund arrives in a later year. This is purchase-basis spending analysis, not a bank-account cash-flow statement.

## Dimensions and reconciliation

Response includes `scope`, `grouping`, `basis: purchase-date`, normalized nullable range bounds and `buckets`. A bucket's `key` is null for overall, a taxonomy UUID for category/subcategory, `YYYY` or `YYYY-MM` for time groups. Null category/subcategory key means unassigned. Taxonomy IDs, rather than current names or active-only joins, preserve retired categories. Resolving private display names uses the existing authenticated taxonomy contract.

Reconcile by currency **and dateBucket**. Summing category, subcategory or representable time groups reproduces overall amounts and every count for the same filters and scope. Never add disclosure buckets to a dated figure. Empty results return `buckets: []`.

At most 1000 buckets are returned, sorted by currency, key (null first), date relation. SQL fetches 1001 aggregate rows to detect overflow; 400 `SPENDING_BUCKET_LIMIT` asks callers to narrow filters. No truncated result is presented as complete. Monthly precision errors and bucket-limit errors are expected validation failures.

## Synthetic example

An owned INR purchase with 10000 minor units paid and 2500 refunded has gross `10000`, refunded `2500`, net `7500`. A returned INR purchase with 20000 paid and a full 20000 refund contributes zero net in all-history and is absent from current-owned. A sold USD purchase with 5000 paid stays in its own USD bucket in all-history. A gift with no paid amount contributes only a not-spending count. An INR purchase with unknown price contributes an unknown-price count. An explicit INR zero contributes one priced and explicit-zero count. No amounts are converted or combined across currencies.

A February 2024 purchase is dated for a full-year 2024 report but spans a range limited to 29 February. A year-only 2024 purchase is dated in the yearly report and makes a monthly request unrepresentable. A purchase with no date remains in unknownDate.

## Query, consistency and privacy

One bounded database aggregate query, plus one bounded taxonomy validation query when filtered. The shared owner transaction lock coordinates with item, taxonomy and refund writers. The aggregate itself is one PostgreSQL statement/snapshot, preventing mixed purchase/refund states. There is no per-item query or application-memory inventory load. Existing repository pool limits and five-second statement timeout bound resource use. A timeout returns a safe unavailable response, never partial totals or SQL errors.

The owner-scoped materialized source feeds one owner/item/currency refund preaggregation. Existing purchase-date, owner/category and refund indexes are reused; no forward migration or new index without measured need. Integration EXPLAIN ANALYZE/BUFFERS tests provide synthetic evidence. Complete owner totals still require scanning that owner's applicable records; the response and query count are bounded, not constant-cost regardless of inventory size.

No server cache, public cache, browser storage or materialized analytics infrastructure. Every response is `Cache-Control: no-store`. PER-48 request/correlation logs and PER-49 exception handling apply; spending routes use one fixed monitoring name. No amounts, item/category names, notes or filters are emitted. Expected 400 errors do not produce GlitchTip incidents. No new telemetry payload is added.

## PER-19 and deployment

PER-19 must add an explicit durable demo discriminator and exclude demo items by default in the shared SQL source (marked extension point), with domain/reference inputs and parity tests updated together. It must prove default exclusion across every dimension and scope, without classifying ordinary records from names, taxonomy defaults or original source. This ticket creates no demo records or heuristic exclusion. PER-21 must display scope, currency and disclosure buckets, handle precision/limit errors, and avoid storing private totals in shared browser storage.

No migrations, new configuration, services, upload changes or production rollout. The deployment needs the existing PER-22 refund migration already applied. Currency conversion, demo inventory, charts, budgets, banking and financial advice remain outside scope.
