# PER-75 — Shared left-rail page shell

Status: **Implemented**
Parent: PER-70 · Blueprint: [design system §3](../design-system.md#3-layout-architecture-the-unified-left-rail),
[route audit](ui-route-audit.md), [wireframes](ui-wireframes.md)

Every inventory page renders one `PageShell` (`apps/web/components/page-shell.tsx`) and, for its
title, `PageHeading` (`page-heading.tsx`) or the shared `pageTitleClassName`. The shell owns the
page's `<main>` landmark; the layout's `#main-content` wrapper remains the skip-link target and
applies the PER-85 mobile clearance once.

## Geometry contract

The rail starts at one gutter from the content column (`#main-content`) and is never centred.

| Viewport | Gutter | Rail x within the content column | Header search |
| --- | --- | --- | --- |
| `< 640px` | `px-4` (16px) | 16px | starts on the rail |
| `640–1023px` | `sm:px-6` (24px) | 24px | starts on the rail |
| `≥ 1024px` | `lg:px-8` (32px) | 32px | starts on the rail |

Absolute x = sidebar width + gutter, where the sidebar is hidden below 768px and otherwise 272px
expanded or 64px collapsed (the owner's saved PER-66 preference, at any desktop width).

| Width | Cap | Routes |
| --- | --- | --- |
| `form` | 672px (`max-w-2xl`) | add/edit item, want and goal; allocate; convert; add photos; item load failure; inventory error boundary |
| `content` | 896px (`max-w-4xl`) | want matches, history and goal comparison; goal detail; text suggestions; Settings, categories & tags, merchants |
| `wide` | 1280px (`max-w-7xl`) | Home, Insights, Wants, Goals, compare, item details and its skeleton, item photos, demo item, route loading |
| `full` | 1792px (`max-w-[112rem]`) | My Store |

Pages keep a single `space-y-6` vertical rhythm inside the rail and `py-6 sm:py-8` page padding.
Headings use `text-2xl sm:text-3xl font-semibold tracking-tight`; actions sit beside a short
title and wrap below a long one, so My Store keeps its compact one-line header on phones.

## Source decisions and blueprint discrepancies

- **Sidebar state is a preference, not a breakpoint.** The blueprint's table pairs tablet with a
  collapsed rail and desktop with an expanded one. The shipped navigation (PER-66) shows from 768px
  and either state can occur at any desktop width, so tests assert positions relative to the
  content column for both states instead of fixed page coordinates such as `x = 88px`.
- **Mobile clearance follows the merged PER-85 CSS, not the provisional blueprint prose.** The
  blueprint's `pb-28`/70px figure is superseded by `--mobile-nav-clearance` in
  `apps/web/app/globals.css` (`4.375rem + max(0.75rem, safe-area-inset-bottom) + 0.75rem`), applied
  once by the inventory layout. `PageShell` adds no bottom padding; pages must not add their own.
- **My Store keeps its 112rem cap** instead of the blueprint's `max-w-7xl`, so collapsing the sidebar
  or widening the window still adds grid columns (PER-58/PER-66). Its gutter is unchanged at ≥1024px.
- **Forms stay 576px inside the 672px rail.** Existing forms constrain themselves to `max-w-xl`;
  widening them is capture-flow work (PER-77/PER-80). Add item, Add want and Edit want centre each of
  their states internally, so the route wraps them in `*:mx-0` to pin every state to the rail without
  editing the form components (Add item is owned by PER-73 during this wave). The wrapper can be
  removed once those components stop self-centring.
- **Per-route widths are consolidated** into the four variants above rather than the audit's mix
  of 3xl/4xl/5xl suggestions; the rail x is identical on every route regardless of width.
- **Heading weight stays semibold (600).** The blueprint lists bold for page h1; existing headings
  and the neutral shadcn baseline are semibold, so only the size scale was adopted. Control and
  typography standardisation remains with PER-89.
- **Headings moved out of cards** on Add photos and the item load-failure state, so the h1 starts on
  the rail. The failure keeps its text, `role="alert"` message and actions.
- **Empty states** still use the registry `Empty` primitive (centred content inside a card that
  starts on the rail). Left-aligned empty content is left to the page revamps (PER-81/PER-88).
- **Outside the app shell** there is no rail to align to: the root not-found and global error pages
  stay centred. Login keeps its approved split layout and adopts the 16px phone gutter.

## Verification

- `apps/web/e2e/page-shell.spec.ts` covers 24 routes at 320/360/390px (phones) and 768/1280/1512/1920px
  in expanded and collapsed states: one shell and `<main>`, rail at the gutter, h1 and header search
  on the rail, no centred direct children, forms pinned left, rail width
  `min(cap, content − 2 × gutter)`, no horizontal overflow; plus failed, offline and empty states,
  the item skeleton and skip-link focus.
- `apps/web/test/page-shell.test.tsx` covers the shell and heading structure.
- Synthetic mocked-API before/after screenshots are in `docs/screenshots/per-75-*`.
