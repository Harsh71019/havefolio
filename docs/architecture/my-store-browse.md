# PER-16: My Store browse experience

`/store` (inside the `(inventory)` route group) presents the owner's possessions as a private storefront: a responsive card grid grouped by category and subcategory, with no buy, cart, checkout, resale, sharing or recommendation controls.

## Data and the PER-17 seam

The page shell is server-rendered. Owner data loads client-side through the existing same-origin `/api/v1` rewrite and HttpOnly session, exactly like the other inventory screens. Server-side fetching would require the Next server to forward session cookies to the API, which is a new trust path and is deferred.

All browse data goes through `InventorySource` (`apps/web/components/inventory-source.ts`):

- `loadPage({ cursor })` calls the existing bounded `GET /api/v1/items?limit=60&after=…` (UUID keyset, at most 100 per request).
- `loadTaxonomy()` reuses the taxonomy client for group names and owner-wide counts.

PER-17 extends `InventoryQuery` with search, filters and sort, maps it to URL state, and swaps or extends the source. Grouping (`store-grouping.ts`) and presentation (`item-presentation.ts`) are pure functions independent of the query.

"Show more items" follows `nextCursor`, de-duplicates live keyset pages and announces the result. Groups show "x of y shown" from taxonomy counts only while more pages exist. No URL query state is added; that is PER-17's.

## Covers without per-card requests

`GET /api/v1/items` list entries now include `cover: { photoId, width, height, altText, decorative } | null`. It is resolved by one bounded `DISTINCT ON (item_id)` query per page over ready photo originals ordered by `(position, id)`, the same rule as PER-15's gallery, so receipts, warranties, pending and deleting media never appear. It returns no provider identifiers or URLs. Single-item responses are unchanged. Cards render the PER-15 `ItemCover`/`PrivatePhoto` with same-origin `content/{thumbnail|display}` URLs, real-width `srcset`, `sizes`, explicit dimensions, lazy loading after the first four cards, and quiet failure text (`announceFailure={false}`) so a grid of failures does not flood assistive technology.

## Card correctness

- **Paid** is the historical amount actually paid, formatted from the integer-minor-unit decimal string without floating point. `null` is "Not recorded", `"0"` is "₹0", and a gift with no amount reads "Gift, no amount" rather than implying spending.
- **Acquired** keeps exact ("12 Mar 2024 · 2 years ago"), month ("Apr 2026 · about 6 months ago"), year ("2019 · about 7 years ago") and unknown ("Date not recorded") distinct, and never invents a day or month.
- **Use** shows the recorded frequency, or "Not recorded".
- Lifecycle status is an icon plus text in the Kibo pill. Inactive items add screen-reader text (", no longer owned"), a muted cover and "No longer in your home"; all statuses stay visible.

## Grouping and ordering

Categories and subcategories follow taxonomy position, then name, then id; items within a group sort by name (case-insensitive, numeric) then id. Items without a category, or with a category missing from the snapshot, appear in a final "Not yet categorised" group. Items with no subcategory beside subcategorised siblings appear under "No subcategory". Active categories with no items are listed once at the end. If taxonomy fails, every item stays visible in one "All items" group.

## Navigation and accessibility

Each card is a single link (no nested controls), named by item name and status and described by its facts. It is keyboard reachable with a visible focus ring. PER-18 owns `/items/[id]`, so `itemHref()` currently opens `/items/[id]/photos?from=store`, whose back link returns to My Store. Only the fixed `from=store` value is honoured. PER-18 should retarget `itemHref()`.

Headings run h1 page, h2 category, h3 subcategory. Loading is one polite status message with an `aria-hidden` skeleton. Failures expose Try again, or Sign in on 401, and an offline notice disables continuation. Motion respects `prefers-reduced-motion`.
