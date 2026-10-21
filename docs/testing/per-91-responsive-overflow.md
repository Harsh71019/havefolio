# PER-91: Long content, text zoom and responsive overflow

Source: `origin/main` at `2016fc4`. Browser: Playwright 1.63 Chromium (Desktop Chrome and Pixel 7
emulation). All data is synthetic and comes from `apps/web/e2e/fixtures/adversarial-content.ts`,
which sits on top of the PER-36 core-journey mocks. No owner data, credentials or API calls are used.

## Adversarial fixture

- One 68-character unbroken word and a realistic 120-character spaced name, used for items, wants,
  goals, categories, subcategories, tags, brands and merchants.
- A 250-character product URL and a long merchant host.
- `999999999999999` minor units (₹99,99,99,99,99,999.99) for prices, targets, spending buckets
  and merchant totals, plus a USD row and six-digit item counts.
- Private media returns 404, so every cover and gallery uses its accessible fallback.

## Policy

- **Reflow (WCAG 1.4.10).** At 320, 360 and 390 CSS px, no route scrolls in two dimensions, and
  every visible focusable control starts and ends inside the viewport. A control inside a
  horizontal scroll region is checked against that region instead.
- **Text resize (WCAG 1.4.4).** The root font size is set to 200%. This is checked at 640 px,
  which matches 200% page zoom on a 1280 px window, and at 1280 px with the sidebar collapsed.
- **Breakpoint edges.** 767/768, 1024, 1279/1280 and 1512 px, with the sidebar expanded and
  collapsed. Store is also checked in all three densities. Phone landscape is 740×360.
- **Long values** wrap with `overflow-wrap: anywhere`. Truncation is used only where the full value
  is still available: Store card names are clamped to two lines but keep the full name as the
  link's accessible name and on the details page; active filter chips keep the full value in their
  accessible name, a `title`, and the selected filter option; Select triggers show the full value
  in their open list.
- **Amounts** must keep their currency symbol and grouped digits on one line. The suite checks
  this with text ranges on Goal and Item details at 320 px.
- PER-85's phone-only `overflow-x-clip` on the content column stays as a guard. Every PER-91
  measurement switches it off first, so the suite fails on overflow the guard would otherwise hide.

## Causes found

| Cause | Where | Fix |
| --- | --- | --- |
| `break-words` (`overflow-wrap: break-word`) doesn't lower an element's min-content width. Inside a flex or grid item, one long word still widens the column and then the page. | 54 call sites: Home, Wants cards, Goals, Goal/Want details, history, refunds, merchants, owned-item card | Switched to `wrap-anywhere`. Line wrapping is unchanged, but the track can now shrink. |
| Page titles are often user content (item names) and had no wrap rule | `pageTitleClassName` | Added `wrap-anywhere` |
| Text with no wrap rule: goal progress text, the matches heading, the "Also in …" heading | home-dashboard, desire-matches, item-details | Added `wrap-anywhere` / `min-w-0` |
| Tag pills use Badge, which is `whitespace-nowrap overflow-hidden`, so long tags were clipped | item-details tags | Call-site `max-w-full whitespace-normal wrap-anywhere`. The shared Badge is unchanged. |
| Store filter options used `truncate`, which painted a long brand or category as an ellipsis | store-filters | Options now wrap, and the count stays beside them |
| The price slider thumbs centre on the track ends, so at either end half a thumb and its focus ring were clipped by the scrolling filter rail | store-filters | 8 px inline inset on the slider |
| Store grid `minmax(15rem, 1fr)` was wider than the column at 200% text | globals.css | `minmax(min(15rem, 100%), 1fr)`. Geometry is unchanged at 100%. |
| Rows that couldn't wrap: the density radios, the matches breadcrumb, the edit-want footer, the Sort trigger | my-store, desire-matches, edit-desire-form, store-toolbar | `flex-wrap` / `max-w-full` |
| Fixed-height `whitespace-nowrap` buttons in narrow cards at 200% text | Home section actions, Compare "Search and connect possessions" | `h-auto min-h-11 whitespace-normal` at those call sites only |
| Merchant spending names were truncated with no other way to see them | merchant-spending | Names now wrap |

## Results

`apps/web/e2e/responsive-overflow.spec.ts`:

- On `origin/main` with the same fixture: **27 failed**, 28 passed (Home, Store, item details, Wants,
  want matches/compare/allocate/goals, edit want, Goals, Goal details, all three Store densities,
  the filter label and chip check, and phone landscape).
- With this change: **55 passed**, 0 failed, 15 skipped (project-specific).

The full `pnpm test:smoke` suite passed with 449 Playwright tests, 0 failed and 99 project
skips, plus the production proxy checks. `pnpm check` (lint, format, typecheck, unit and 490
component tests, build) also passed.

To refresh the PR screenshots, run
`PER91_SCREENSHOTS=1 pnpm --filter @havefolio/web exec playwright test e2e/responsive-overflow.spec.ts -g evidence --project desktop`.
The "before" images were captured the same way from a detached `origin/main` worktree. The clip is
switched off in both, so the "before" images show overflow that phones would otherwise hide.

## Limitations

- **Text-only 200% at 1280 px with the sidebar expanded on My Store** is not met. The 17rem
  sidebar and 15rem filter rail both scale with text, leaving about 130 px for the catalogue.
  Collapsing the sidebar (checked) or using page zoom (which reflows to the tablet layout, also
  checked) avoids it. Changing sidebar sizing belongs to PER-66/PER-85, so it's out of scope here.
- **320 px combined with 200% text** (about 800% zoom, beyond WCAG) still overflows. The cause is
  the shared Button and Badge primitives being `whitespace-nowrap` with fixed heights, which PER-89
  owns. A follow-up should decide whether those primitives may wrap.
- Everything here is Chromium emulation. Root font-size scaling stands in for browser text-only
  zoom (Firefox "Zoom text only", Chrome font-size settings), but they aren't identical. No
  real-device or manual screen-reader pass was done.
