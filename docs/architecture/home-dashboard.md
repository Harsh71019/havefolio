# Home dashboard and rediscovery (PER-33)

Home is an owner-private summary composed from existing domain rules. It adds no table, migration, queue, cache, usage tracking or infrastructure.

## Endpoint

`GET /api/v1/home` requires the owner session, returns `Cache-Control: no-store` and is published in OpenAPI as `HomeSummaryDto` (contract: `HomeSummary` in `@havefolio/contracts`). One browser request replaces the six-plus calls and client-side filtering the existing collection APIs would need for counts, multi-state desires and condition-filtered rediscovery.

| Section | Source | Bound |
| --- | --- | --- |
| `inventory` | One count over owned items; samples counted separately, never added | 1 statement |
| `spending` | `SpendingService.report({ scope: 'current-owned' })`, returned unchanged | ≤ 2 buckets per currency |
| `recentItems` | `InventoryQueryService.list({ sort: 'newest', ownershipStatus: 'owned' })` with batched covers | 4 |
| `desires` | `DesiresService.activeSnapshot`: considering/waiting counts plus newest active | 3 |
| `goals` | `GoalsService.activeSnapshot`: same confirmed-progress SQL as goal detail; nearest target date first | 3 |
| `rediscovery` | One ranked statement with a lateral cover lookup | 1 item |

The statement count is constant regardless of inventory size (integration-tested). Every query has an owner predicate; goal reads keep the transaction-local RLS owner context.

## Money and dates

Spending parity is exact: the Home `spending` object equals `GET /api/v1/spending?scope=current-owned`. The UI shows each currency separately, shows the dated net amount and discloses unknown-date spending separately (never added), and states how many items have no recorded price. Goal progress is exact BigInt arithmetic over confirmed contributions only; a zero target shows text without a bar. No conversion, savings estimate, resale value or judgment is shown.

## Rediscovery policy

Only owner-recorded facts are used (recorded on PER-33 in Kan):

- Eligible: genuine (non-sample) items with ownership status `owned`, condition not `broken` or `worn_out`, and declared use frequency `rarely` or `never`. Sold, donated, disposed, lost and returned items are excluded by ownership status. `needs_repair` and unknown conditions remain eligible and are shown. Unknown frequency is never treated as rarely used.
- Order: oldest explicit "Used it again" lifecycle event first, items with no recorded use first, then oldest record, then ID. Recording a use moves the suggestion on.
- When nothing is eligible, Home explains why and links to My Store or adding an item.

## Web, privacy and observability

The client component fetches through the same-origin `/api/v1/home` rewrite (added to the production proxy allowlist and smoke test) and refreshes after demo changes or reconnecting. Covers use the existing authenticated item-photo routes. Loading, offline/error with retry, expired-session and per-section empty states each offer a first action. Monitoring normalizes the route to `/api/v1/home`; no names, amounts or identifiers are logged.
