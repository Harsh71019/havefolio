# Havefolio UI foundation

Status: **Accepted foundation**

Ticket: **PER-6**

## Current decision

Havefolio uses the default neutral shadcn/ui theme and component styles. The project does not add a custom colour palette, display font, surface treatment or branded component variant at this stage.

The only global additions to the generated shadcn/ui stylesheet are the Tailwind source path required by the monorepo. Product-specific visual theming can be introduced later through a dedicated ticket when real product screens provide enough context to evaluate it.

## Product language

Havefolio is a private personal inventory and decision aid. Interface copy should remain clear and neutral and must not introduce marketplace pressure, cart or checkout language, sale badges, countdowns, streaks or artificial scarcity.

## Component sourcing

Use this order before creating reusable UI:

1. shadcn/ui for accessible primitives and common controls.
2. Kibo UI for higher-level components that are not already supplied by shadcn/ui.
3. Havefolio-specific composition of those approved components.
4. A new reusable primitive only when both registries have been checked and neither meets the requirement.

Generic primitives live in `packages/ui/src/components`; Kibo components remain under `packages/ui/src/components/kibo-ui`; product-specific compositions use `packages/ui/src/components/havefolio` or the consuming application when they depend on application routing.

Both registries use the default shadcn/ui CSS variables configured by `components.json`. Run registry commands from `apps/web` so the monorepo aliases route shared components into `packages/ui`.

Do not restyle imported registry primitives globally. Product layouts may compose them and adjust layout or touch-target dimensions where necessary, but a new colour, font, radius, shadow or component variant requires an explicit product decision.

## Accessibility floor

- Primary navigation keeps at least 44 px touch targets even where the stock component size is smaller.
- Keyboard focus uses the default shadcn/ui focus treatment and is not communicated by colour alone.
- Mobile navigation works at 360 px without horizontal scrolling.
- Status text accompanies every status colour or indicator.
- Reusable components are verified in the live application at narrow and desktop widths.
- Every product journey still receives a manual keyboard and screen-reader review before completion.
