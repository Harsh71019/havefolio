# Havefolio design system

Status: **Accepted foundation**

Ticket: **PER-6**

## Product language

Havefolio is a personal collection catalogue with the clarity of a household ledger. It should feel satisfying to browse without borrowing the pressure patterns of a marketplace.

The interface uses the language of shelves, collections, condition, age and use. It does not use carts, sale badges, countdowns, streaks or artificial scarcity. Need, Want and Greed remain user-selected classifications and are presented without judgement.

## Visual direction

- **Canvas:** mineral grey-green rather than retail white or a generic cream editorial theme.
- **Surfaces:** quiet near-white cards with visible structure and restrained elevation.
- **Primary colour:** collection green for navigation, focus and constructive actions.
- **Display type:** Newsreader Variable for item names and reflective headings.
- **Utility type:** Manrope Variable for controls, labels, prices and factual content.
- **Signature:** the responsive household index—desktop catalogue rail, mobile shelf navigation and item cards that read like collection records rather than products for sale.

The canonical tokens live in `packages/ui/src/styles/globals.css`. Components use semantic tokens such as `background`, `foreground`, `primary`, `muted` and `destructive`; application code must not reproduce the palette as one-off values.

## Component sourcing

Use this order before creating reusable UI:

1. shadcn/ui for accessible primitives and common controls.
2. Kibo UI for higher-level components that are not already supplied by shadcn/ui.
3. Havefolio-specific composition of those approved components.
4. A new reusable primitive only when both registries have been checked and neither meets the requirement.

shadcn/ui and Kibo UI distribute source into this repository. Imported files are reviewed and may be themed for Havefolio, but their provenance remains visible in the file structure. Generic primitives live in `packages/ui/src/components`; Kibo components remain under `packages/ui/src/components/kibo-ui`; product-specific compositions use `packages/ui/src/components/havefolio` or the consuming application when they depend on application routing.

Both registries use the CSS-variable theme configured by `components.json`. Run registry commands from `apps/web` so the monorepo aliases route shared components into `packages/ui`.

## Accessibility floor

- Primary navigation and core controls have at least 44 px touch targets.
- Keyboard focus is visible and is not communicated by colour alone.
- Mobile navigation works at 360 px without horizontal scrolling.
- Status text accompanies every status colour or indicator.
- Reduced-motion preferences disable non-essential animation.
- Reusable components are verified in the live application at narrow and desktop widths.
- Every product journey must still receive a manual keyboard and screen-reader review before completion.
