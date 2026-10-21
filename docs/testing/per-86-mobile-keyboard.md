# PER-86: mobile forms stay usable with the software keyboard

## Keyboard and navigation policy

- **Viewport.** The browser default is kept: no `interactive-widget`, `maximum-scale` or `user-scalable` override. The keyboard overlays the page instead of resizing it, so the PER-85 bar contract (fixed to the layout-viewport bottom, `--mobile-nav-clearance` padding and `scroll-padding-bottom`) is unchanged. Pinch zoom stays available.
- **Bottom bar while typing.** Below 768px on a coarse (touch) pointer, the bar is hidden (`display: none`) while a text-entry `input`, `textarea` or `select` has focus. It returns as soon as focus leaves. Checkboxes, radios, buttons and Radix Selects don't open a keyboard and leave it in place. This is plain CSS (`:has(:focus)` in `apps/web/app/globals.css`); nothing tracks `visualViewport`. The bar is fixed-position, so hiding it shifts no layout. `display` is used rather than `visibility` because the bar's buttons use `transition-all`, which kept their inherited visibility long enough to paint the icons over the form.
- **No focus zoom.** On coarse pointers every text-entry field is at least 16px, the size below which iOS Safari zooms in on focus. Fine pointers (desktop) keep their compact 14px fields. The rule is unlayered, so call-site `text-sm`, `sm:text-sm` and `md:text-sm` utilities can't bring the bug back.
- **Dialogs.** Every dialog that contains form fields is capped (`max-h-[…svh]`) and scrolls internally, so its fields, errors and actions can be reached on short or keyboard-reduced viewports. The page behind stays scroll-locked (PER-87).

## Reproduction

Measured on `origin/main` at `b139d3d` with a production build, synthetic `mockCoreJourneys` data and the Pixel 7 project (touch, coarse pointer). A probe focused every text field, select and action in Add item, Add want, Settings, Taxonomy, header search, the item basics and purchase editors and the goal-contribution confirmation. It ran at 360×780 and 390×844, at 844×390 landscape, and at 360×420 and 780×200, which stand in for the space left above a portrait and a landscape keyboard. For each control it recorded font size, the rectangle after focus-scrolling, the bar rectangle, horizontal overflow and dialog bounds.

| Finding                                                                                 | Viewports              | Effect on a phone                                 |
| --------------------------------------------------------------------------------------- | ---------------------- | ------------------------------------------------- |
| Header search and the My Store brand-filter search are `text-sm` (14px)                           | all, including portrait | iOS Safari zooms the page on focus               |
| Shared `Input`/`Textarea` and ~20 call sites use `md:text-sm`                           | landscape ≥768px       | every field zooms on focus in iPhone landscape    |
| Goal-contribution and want-allocation confirmations have no height cap or overflow      | 360×420, 780×200       | title and Confirm/Cancel clipped, can't be scrolled to |
| Bar stays painted while a field is focused                                              | all                    | relies on each browser hiding it behind the keyboard |

No horizontal overflow, nested-scroll trap or lost value was found. Other form dialogs were already capped and scrollable, and with the bar visible, focused page fields already scrolled clear of it (PER-85 `scroll-padding-bottom`). Hidden controls (collapsed disclosures, Radix's `aria-hidden` native select) were excluded.

## Changes

- `apps/web/app/globals.css`: the bar-hiding and 16px touch rules described above.
- `apps/web/components/app-navigation.tsx`: a `mobile-navigation` class on the bottom bar for that rule. Geometry is unchanged.
- `apps/web/components/goal-detail.tsx`, `desire-allocation.tsx`: `max-h-[92svh] overflow-y-auto` on the confirmations with fields, matching the other form dialogs.

No `packages/ui` primitive, Add item/Add want form, validation-summary mapping (PER-72), loading geometry (PER-88), draft retention or save semantics changed. On touch landscape and touch tablets, fields render at 16px instead of 14px. That is the only visual change.

## Evidence boundaries

- `apps/web/e2e/mobile-keyboard.spec.ts` (Pixel 7 and desktop projects) checks the following:
  - The 16px minimum across Add item, Add want, Settings, My Store and the purchase editor, at 360×780 and 844×390.
  - The bar hides for a focused text field, including its icons and labels, returns on blur and stays for a radio.
  - Typed values, focus and text selection survive keyboard-sized and rotated viewports across the md breakpoint, with no horizontal overflow.
  - The goal-contribution confirmation fits a 360×420 viewport, and its Confirm can be scrolled to inside it.
  - Desktop keeps 14px fields.
- Run against `origin/main`, the 16px tests (both sizes), the bar test and the confirmation test fail. The rotation and desktop tests pass both before and after and guard existing behaviour.
- Related suites still pass: mobile navigation, overlays, goals, allocation, add item, item details, accessibility, mobile capture, settings, wants and page shell.
- Screenshots `docs/screenshots/per-86-{before,after}-*` use synthetic data:
  - Add item with a field focused at 360px.
  - The goal-contribution confirmation at 360×420.
  - My Store at 844×390.

All of this is Chromium emulation. It doesn't open a software keyboard, model mobile browser toolbars, home indicators or visual-viewport panning, or reproduce iOS focus zoom. A short viewport stands in for the space above the keyboard. **Not verified:** iOS Safari or Android Chrome on real devices (the bar behind or over the keyboard, focus zoom, scrolling a dialog's actions above the keyboard, orientation changes with the keyboard open) and real screen-reader announcements. No device was available in this session.
