# PER-58 — My Store desktop density

My Store alone uses a canvas capped at 112rem, with 2rem desktop gutters and the existing
17rem sidebar. Headings retain their readable maximum text width. Default shadcn neutral
light/dark tokens and shared primitive styles are unchanged.

| Viewport | Space for grid | Compact | Comfortable (default) | Large |
| --- | --- | --- | --- | --- |
| 1024px | 688px | 3 columns | 2 columns | 1 column |
| 1280px | 944px | 4 columns | 3 columns | 2 columns |
| 1440px | 1104px | 4 columns | 3 columns | 2 columns |
| 1920px | 1584px | 6 columns | 4 columns | 3 columns |

The 1rem grid gap keeps Compact cards at least about 219px wide in this matrix.
Below 1024px, the original one-column / two-column-at-520px layout, 4:3 media and card
spacing apply regardless of the preference. The density control is hidden there.

## Components and accessibility

The existing shared shadcn Radio Group sits beside the loaded-item summary. It has text
labels, a group name, checked state, standard roving tab focus and horizontal arrow keys.
The whole label is a 44px-high target. No new shared primitive or dependency is introduced.
Both approved registries were checked: [shadcn](https://ui.shadcn.com/docs/components/toggle-group)
and [Kibo Choicebox](https://www.kibo-ui.com/components/choicebox). Existing Radio Group is
a smaller composition for this mutually exclusive preference.

`OwnedItemCard` and `ItemCover` are reused. Additive data slots let My Store scope geometry
without changing unrelated cards. All modes retain name, ownership/inactive wording, price
(including unknown versus zero), honest date precision and use frequency. Compact uses 16:9
media, 12px padding and stacked label/value facts; Comfortable keeps 4:3 media and the existing
hierarchy; Large keeps 4:3 media with larger titles, padding and fact spacing. Facts wrap,
without line clamping. Accessible card names/descriptions and full-card links stay intact.
Loading uses the same grid/media geometry with six placeholders and density-aware padding.

## Preference, hydration and image delivery

Only `compact`, `comfortable` or `large` is written to localStorage under the versioned key
`havefolio:store-density:v1`. Everything else falls back to Comfortable. No inventory data,
owner identifier or query is stored or transmitted. Read/write exceptions are caught; the
current document still supports selection if persistence is unavailable. Other-tab changes
and clearing storage update the control and layout. Normal navigation preserves the choice.

A small fixed script in the document head validates the enum before the skeleton can paint.
Scoped CSS reads the root attribute, so hydration never first paints the wrong skeleton grid.
`useSyncExternalStore` supplies the Comfortable server snapshot and restores the control after
hydration. The root already suppresses the expected theme/attribute hydration difference.
No inventory is server-rendered or hidden while preferences load. The script has no dynamic
user input. If scripts or storage are blocked, the default grid remains usable.

Density-specific `sizes` account for the sidebar, gutters, gaps, breakpoints and canvas cap.
They retain the existing same-origin thumbnail/display `srcset`, actual variant width
descriptors and protected byte delivery. Source images are never upscaled by the server;
quality remains limited by original resolution and the existing two available variants.
The first four covers in display order stay eager; subsequent covers stay lazy. A density
change does not request inventory or taxonomy again. Large can select the existing display
variant; Compact can select the thumbnail when its slot and device pixel ratio allow it.

## Boundaries and verification

No API, database, migration, OpenAPI, upload, telemetry, service or environment change.
Deploy the web image through the normal release process; this task does not deploy.
Grouping, empty categories, counts, cursor continuation, offline/retry/authentication,
deleted-item notices and sanitized return URLs continue through the existing code.

Baseline inspection found a pre-existing limitation: although PER-17 is merged, the current
`apiInventorySource` forwards only page size and cursor, not URL search/filter/sort fields.
PER-58 leaves that query contract and behaviour unchanged. It does not claim to implement or
validate missing browse controls, or absorb PER-36's application-wide accessibility audit.

Tests cover corrupted/obsolete preferences and storage exceptions; selections and keyboard
state; facts/grouping/paging and resilient states per density; production geometry at all four
desktop widths, mobile/tablet regression, both themes, private images and eager/lazy budget;
refresh/navigation/back/forward; overflow and browser errors. Screenshots use synthetic
inventory and illustrations under `docs/screenshots/per-58-*.png`. Automated accessibility
assertions do not replace a manual screen-reader audit.

Verified on the PER-58 branch: `pnpm check` (format, lint, typecheck, unit/infrastructure,
264 component tests and production builds); `MIGRATION_BASE_REF=origin/main pnpm db:check`;
`pnpm test:integration` (216 API tests plus two worker integration tests against disposable
loopback PostgreSQL/Redis with separate roles/ACLs); `pnpm test:smoke` (74 browser passes,
12 intentional project-specific skips, plus the real production-proxy check). Five focused
PER-58 production-browser journeys additionally verify density geometry, first-visible-frame
restoration, candidate image selection and unchanged card bounds after delayed images load.
The screenshots cover all three desktop densities in both themes, 360/768px in both themes,
loading per mode, empty results per mode and taxonomy fallback. Real inventory/provider
content and manual assistive-technology operation are not claimed as verified.

After current main's PER-29 merge (`f93b21b`) was merged into this branch, `pnpm check`
passed again with 273 component tests. Migration validation and the full production smoke
suite passed again (76 browser passes, 12 intentional skips, plus real production-proxy checks).
The image-error component assertion now awaits React's asynchronous event commit rather than
reading the DOM immediately; CI exposed the timing assumption in the original synchronous test.
