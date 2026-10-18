# PER-36: accessibility, responsive and resilient-state verification

`apps/web/e2e/accessibility.spec.ts` runs inside `pnpm test:smoke` (desktop and Pixel 7
projects). It uses synthetic fixtures from `apps/web/e2e/support/core-journeys.ts` through
Playwright request interception. It needs no owner data, credentials, database or deployed API.

## Automated coverage

Routes: Home, My Store, add item, item details, item photos, add photos, Insights, Wants, add/edit
want, matches, compare, decision history, allocation, conversion, want-to-goal comparison, Goals,
add/edit/detail goal, Settings, taxonomy and sign-in.

- **axe-core 4.13.0** (`wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22aa`, `best-practice`) in
  light and dark themes at 360 px and desktop. The run must report zero violations.
- **Layout:** each route has exactly one `h1` and a skip link. Nothing may extend past the
  viewport at 360, 412, 768, 1024 or 1440 px. This also catches content clipped by
  `overflow-hidden` cards, which document scroll width misses.
- **Touch targets:** every visible control at 360 px is at least 44 × 44 px. Radios and checkboxes
  count their label. Inline prose links, unfocused visually hidden elements and Radix's
  `aria-hidden` mirror inputs are excluded.
- **Failed and offline reads (503 and network drop):** each route keeps an `h1`, stays axe-clean
  and does not overflow. Goal pages never mention the desires service. Goal detail and decision
  history offer **Try again**, and goal detail recovers in place.
- **Keyboard and motion:** the skip link is the first Tab stop and moves focus to
  `#main-content`. Controlled alert dialogs keep focus inside, close on Escape and return focus to
  their trigger. `prefers-reduced-motion: reduce` collapses dialog animation.
- **Kept input after a failed request:** a goal that gets a 503 on save, a want whose save cannot
  reach the network, and an item that gets a 503 on save all keep the entered text. A photo upload
  whose connection drops keeps its preview and a retry control. Partial upload failure and
  idempotent retry remain covered by `photo-capture.spec.ts` (PER-13).

## Keyboard walk (scripted, 2026-10-18)

At 360 px, each page below was walked with Tab, recording every focus stop and whether it had a
visible focus indicator (outline, ring shadow or underline). The pages were Home, My Store, item
details, add item, Wants, compare, decision history, Goals, goal detail, Settings, taxonomy,
Insights and sign-in. On every page the order was skip link → primary navigation → theme toggle →
page content in reading order, and every stop had a visible indicator. The three Home summary
links draw their ring on the `::after` overlay that covers the card. The probe cannot read
pseudo-element styles, so it listed those links, and they were confirmed in the source.

## Not verified — needs a human

- **Screen reader:** no manual pass with a real screen reader (VoiceOver, TalkBack or NVDA) was
  done. The automated checks above cover accessible names, roles, heading structure and live
  regions as axe and the DOM expose them. They do not cover the spoken experience.
- **Real devices:** layouts were checked in emulated Chromium viewports only, not on physical
  phones or in other browser engines.
- **PER-35 export and account deletion:** these screens do not exist yet, pending the
  deletion-finality policy decision. When they land, add them to `coreRoutes` and repeat the
  manual review before claiming every core journey is covered.
