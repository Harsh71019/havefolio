# PER-21: recorded spending screens

`/insights` has a server-rendered PageHeading/introduction and a bounded client experience. Private data is requested through the authenticated same-origin `GET /api/v1/spending`; the web proxy includes the spending domain. The public shell contains no owner totals. Interactive Radix form controls mount after hydration with the actual URL, preventing their server-default values from overwriting incoming filters.

## Reports and presentation

The page requests the authoritative overall report and the selected category, subcategory or year report in parallel. Summary-only uses one request. It never reconstructs totals from inventory pages, groups or disclosure buckets. Each original currency and each `dated`, `spanningRange` and `unknownDate` relationship has a separate labelled summary and exact table. There is no conversion, grand total, current/resale value, savings claim or advice. Gross purchases, confirmed refunds and net spending remain distinct. Unknown-price, gift/non-spending, explicit-zero and unknown-date counts stay visible, including reports whose monetary values are zero.

`formatAggregate` uses unbounded BigInt and string arithmetic, the existing ISO currency precision contract, and `Intl.NumberFormat` only on the integral BigInt. It never uses the bounded per-item Money constructor or converts aggregate amounts to Number. The currency code appears in every amount; scope and date relationship label its enclosing section/table. Tables are the primary presentation, including the yearly trend, so no chart, approximate plotted values, new chart dependency or Storybook is needed.

Both approved registries were reviewed: [shadcn Table](https://ui.shadcn.com/docs/components/radix/table) provides the primitive; [Kibo UI](https://www.kibo-ui.com/components) offers no needed higher-level behavior for these exact reports. The shadcn new-york-v4 Table source lives under `packages/ui`, with a container-props extension to make the actual horizontal scrolling surface keyboard focusable and named. Existing Select, Input, Alert, Empty, Skeleton, Dialog and DropdownMenu primitives are reused. The page keeps the neutral themes and system typography. Mobile navigation exposes Home, My Store, Insights, Wants and More; Goals and Settings remain keyboard-accessible menu items with current-route indication.

## Filters and resilience

Only scope, supported grouping, currency, category/subcategory IDs and inclusive calendar bounds enter the URL. Values are allowlisted and normalized, repeated values are discarded, unsupported keys are removed, and a child needs its parent. Taxonomy validates parent/child relationships before a child-filtered report is requested when its snapshot is available. Changing the parent clears the child. Date entry rejects a reversed range. Reset restores current-owned/category with no optional filters. Browser back/forward and refresh restore filters; totals never enter URLs or history state.

Taxonomy names are authenticated and include retired entries. Null assignments have explicit labels. Failure leaves spending visible without exposing identifiers; category names can be retried. Subcategory drill-down waits for a resolvable parent rather than sending an incomplete filter. Network, unavailable API, session expiry, invalid query, bucket overflow and precision errors use fixed messages. Bucket overflow recommends narrowing; precision failure recommends the yearly view without inventing a date. API/server prose is never displayed or thrown through to telemetry.

Requests use `credentials: same-origin` and `cache: no-store`. Abort plus an active-request guard prevents stale results replacing newer filters; result rendering is keyed to the current query. Report data lives only in component memory. There are no analytics calls, storage writes, new telemetry payloads or shared caches. Existing monitoring sanitization removes queries and unrecognized page paths; monitoring files are unchanged.

## Exact, bounded item drill-down

Existing My Store does not consume its URL-query helpers. Existing inventory filters also use date overlap and have no null-taxonomy selector; linking report rows to that flow would be misleading. Instead, the insights Dialog requests server-filtered inventory pages, 25 records at a time, with opaque continuation cursors and a first-page action. It does not scan/fetch all inventory or filter it in browser memory, and never derives report money from these pages. Closing restores focus to the initiating row.

The inventory contract has four additive optional parameters:

| Parameter | Meaning |
| --- | --- |
| `spendingScope` | `current-owned` or `all-history`, including the report's durable demo exclusion |
| `spendingDateBucket` | Exact `dated`, `spanningRange` or `unknownDate` membership, requiring spendingScope |
| `spendingUnassigned` | Null `category` or `subcategory` assignment, requiring spendingScope |
| `spendingYear` | Four-digit recorded purchase year, requiring spendingScope |

The existing currency/category/subcategory/date-range parameters complete the query. Scope-incompatible ownership/date-known/precision filters and conflicting null assignments are rejected. Normal inventory requests preserve their previous behavior. Owner validation, retired taxonomy support, same-owner transactions, statement timeout, query bounds and cursor binding apply unchanged. No migration or index is added.

`spending-membership.ts` extracts the existing authoritative owner, demo, ownership and date-relation SQL into a shared CTE builder. Spending aggregation retains its refund preaggregation and all amounts/counts; inventory uses the membership IDs without refund aggregation. This is a reuse of the existing report rules, not a second browser/domain calculation. PostgreSQL HTTP tests compare every category/subcategory/year bucket's bounded drill-down count and disclosures for both scopes, with and without a one-day partial-date range, while rejecting demo and foreign-owner records. Existing independent domain-oracle aggregation parity remains green.

## Release considerations

Deploy the additive API before the web so new drill-down parameters are understood. Existing PER-19/PER-22 database prerequisites still apply; this ticket adds no migration, environment key, upload behavior, service, Docker or infrastructure change. Refresh older browser tabs after rollout. Reports and subsequent item pages are independent snapshots; edits between requests can change membership, which the empty-drill-down state explains. No production rollout, real-owner spending capture, live provider operation or live screen-reader session is part of this change. Exact unassigned/date membership is provided inside Insights; My Store's broader filter-control work remains separate. Monthly charts, conversion, budgets and financial advice remain outside scope. PER-50 health/Gatus/deployment/monitoring files are untouched.
