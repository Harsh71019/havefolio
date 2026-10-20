# PER-87: overlays keep the page still and return focus

## Reproduction

Measured on `origin/main` at `e63f09c` with a production build, synthetic `mockCoreJourneys` data and Chromium desktop (1280px, and 390px for phone-width) and Pixel 7 projects. Each overlay was opened by keyboard, mouse click and (mobile) tap, with the opener at the top of the page and mid-page. Before, during and after each overlay the probe recorded `scrollY`, the scrollbar gutter, body overflow/margin/pointer events, the page heading, header and fixed bottom-bar rectangles, the focused element, and whether a wheel gesture moved the window.

| Overlay                                 | Page movement | Background scroll | Focus after close                      |
| --------------------------------------- | ------------- | ----------------- | -------------------------------------- |
| Store filters dialog                    | none          | locked            | **`<body>`** (keyboard, click and tap) |
| Item "Add details" dialog               | none          | locked            | **`<body>`**                           |
| Document "Remove" confirmation          | none          | locked            | **`<body>`** (Escape and "Keep it")    |
| Onboarding "Remove all demo data"       | none          | locked            | **`<body>`** (Escape and "Keep demos") |
| Item editor, then a Select inside it    | none          | locked            | Select, then the editor's opener       |
| Lifecycle menu, then its confirmation   | none          | locked            | the menu button                        |
| Store sort Select, mobile More menu     | none          | locked            | their triggers                         |
| Any modal overlay, 15px classic scrollbar | **bottom bar widens 351 → 366px** | locked | as above                     |

No unexplained scroll-position jump, stuck lock or invisible overlay was found. Two early "jumps" were Playwright scrolling an off-screen opener into view before clicking; the probe was corrected to place openers in view first. The Store filters dialog is already bounded (`max-h-[85svh]`) and scrolls internally.

## Causes and changes

- **Focus.** Radix's modal `DialogContent` cancels its default close-focus and focuses `context.triggerRef`, which is only set by a `DialogTrigger`. The four dialogs above are opened by ordinary buttons, so focus fell to `<body>`. Each consumer now passes `onCloseAutoFocus` to return to its opener, following the existing `item-lifecycle`/`taxonomy-management` pattern. When the opener has gone (the removed document's row, the demo control after removal) focus moves to the documents heading or the main content. Choosing a detail in "Add details" leaves focus with the editor it opens.
- **Scrollbar compensation.** The scroll lock Radix uses (`react-remove-scroll-bar`) hides a classic scrollbar and adds its width back as body margin, which keeps in-flow content still but not fixed elements. The bottom bar now opts in with that library's `width-before-scroll-bar` class, which applies the same margin to it only while a lock is active. With overlay scrollbars (phones, macOS defaults) the gap is 0 and nothing changes. The sidebar, header and content were already still and were not changed.

No shared `packages/ui` primitive, global overflow rule, theme token or dependency changed.

## Evidence boundaries

- `apps/web/e2e/overlay-stability.spec.ts`: production build, Chromium desktop and Pixel 7 projects, light/Neutral with normal motion and dark/Ocean with reduced motion. Keyboard opening at mid-page; asserts scroll position, locked background (wheel gestures in both projects), release afterwards and focus return. Also covers internal scrolling of the bounded filters dialog, the Add details hand-off, nested Select-in-Dialog and menu-then-confirmation sequences, and the More menu.
- `apps/web/e2e/overlay-scrollbar.spec.ts`: desktop Chromium with scrollbars re-enabled and styled as classic 15px bars. Asserts the body gets exactly one scrollbar width of margin, and the heading, header and bottom bar keep their rectangles, for the filters dialog, sort Select and More menu at 390px and the item editor at 1280px.
- With the component changes reverted, 19 of these tests fail (all focus-return cases, the filters "Show N items" button and the 390px scrollbar case); the nested, menu-confirmation, More menu and desktop-editor tests pass both before and after and guard existing behaviour.
- Screenshots `docs/screenshots/per-87-*`: synthetic data; filters focus after Escape at 360px light/dark, and the bottom bar with a Select open over a classic scrollbar, before and after.

All evidence is Chromium automation. A synthesized CDP `touch` scroll gesture showed the same locking and release locally (macOS Chromium), but the Linux CI runner did not apply it, so the committed tests use the wheel and touch scrolling is not regression-tested. Physical touch devices, mobile browser toolbars, software keyboards, iOS Safari scroll locking and real screen-reader announcements were not verified.
