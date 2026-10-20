# PER-89 — Shared control standardisation, sizing, labels and interaction states

Status: **Implemented**  
Parent: PER-70 (Sprint Parent) · Blueprint: [Design System §4.3](../design-system.md#control-sizing--accessibility-floor), [Layout Architecture §3](../design-system.md#3-layout-architecture-the-unified-left-rail)

Standardises inventory buttons, inputs, selects, date controls, labels, help/error text, icon-only actions, radio items, badges, separators, empty states and action rows across Havefolio without altering domain behaviour, money/date precision rules, or replacing core libraries (`shadcn/ui`, `Kibo UI`, `Radix`, `Tailwind v4`).

## Component usage matrix

| Control | Previous state / Anti-pattern | Standardised replacement | Locations updated |
| --- | --- | --- | --- |
| **Button** (`packages/ui/src/components/button.tsx`) | `default: h-9` (36px), `sm: h-8` (32px), `icon: size-9` (36px). Sub-44px touch targets on primary controls. | `default: min-h-11 h-11 px-4 py-2 text-sm font-medium` (44px touch floor). `icon: size-11 min-h-11 min-w-11` (44px touch target). `sm: min-h-9 h-9`, `icon-sm: size-9 min-h-9 min-w-9` (compact action row exception). | Shared primitive in `packages/ui` + consumer views. |
| **Input** (`packages/ui/src/components/input.tsx`) | `h-9` (36px) default height; inconsistent padding and vertical centering. | `min-h-11 h-11 w-full min-w-0 rounded-md border border-input px-3 py-2 text-base md:text-sm` (44px touch target, 16px mobile text prevents iOS auto-zoom). | Shared primitive in `packages/ui` + all forms. |
| **Select** (`packages/ui/src/components/select.tsx`) | `data-[size=default]: h-9` (36px); raw unstyled `<select>` elements in consumer views. | `SelectTrigger` with `data-[size=default]:min-h-11 data-[size=default]:h-11`, `data-[size=sm]:min-h-9 data-[size=sm]:h-9`. Replaced raw `<select>` with Radix `@havefolio/ui/components/select`. | `desire-compare.tsx` (all-items dropdown), `packages/ui`. |
| **DateInput** (`packages/ui/src/components/havefolio/date-input.tsx`) | Container lacked fixed height; inner input inherited variable min-height; calendar trigger was 36px (`w-9 h-9`). | Outer container `min-h-11`; inner input `h-full min-h-11 pr-11 text-base md:text-sm`; calendar toggle button `w-11 h-full min-h-11` (44px touch target). | Shared primitive in `packages/ui/src/components/havefolio/date-input.tsx`. |
| **RadioGroup** (`packages/ui/src/components/radio-group.tsx`) | Raw unstyled `<input type="radio">` with custom layout and inconsistent touch targets in product candidate matchers. | Standardized `@havefolio/ui/components/radio-group` (`RadioGroup`, `RadioGroupItem`, `Label`) with `min-h-11`, bordered card containers, and pointer hover feedback. | `product-enrichment.tsx`. |
| **Empty states** (`packages/ui/src/components/empty.tsx`, `card.tsx`) | Unstyled bare text paragraphs (`<p>No matching merchants...</p>`). | Structured `Card className="border-dashed py-0"` wrapping `Empty` with `EmptyHeader`, `EmptyMedia` (icon), `EmptyTitle`, and `EmptyDescription`. | `merchant-management.tsx`. |
| **Icon-only actions** | Raw `<button type="button">` without proper 44px hit areas or accessible styling. | `<Button variant="ghost" size="icon" className="size-11 ...">` with explicit `aria-label`. | `header-search.tsx` (clear search query button). |
| **Labels & Field descriptions** (`packages/ui/src/components/field.tsx`) | Inconsistent font sizes across forms (some `text-xs font-normal`, some `text-xs font-medium`, inconsistent spacing). | Form field labels standardised to `text-sm font-medium`; helper text / descriptions standardised to `text-xs leading-normal font-normal text-muted-foreground`; consistent `space-y-2` layout. | `field.tsx`, `add-item-form.tsx` (disclosure fields: brand, model, acquisition, condition, frequency, notes). |
| **Error text & alerts** | Unstyled or inconsistent error messages missing `role="alert"` or `text-destructive`. | Linked `role="alert"` and `text-destructive text-xs` or `text-sm` associated via `aria-describedby` and `aria-invalid`. | `spending-filters.tsx` (date filter error), `add-desire-form.tsx`, `edit-desire-form.tsx`. |
| **Pending states & submit guards** | Susceptible to rapid repeated clicks before React re-render; missing live container state. | Synchronous `useRef` submission locks (`submittingRef.current = true`), `aria-busy={isSubmitting}` on `<form>`, and disabled action buttons during flight. | `add-desire-form.tsx`, `edit-desire-form.tsx`, `desire-compare.tsx`, `goal-form.tsx`, `item-edit-dialog.tsx`, `merchant-management.tsx`. |

## Touch target and sizing contract

1. **44 × 44 px touch floor:** All primary interactable elements (default buttons, text inputs, select triggers, date picker buttons, and standalone icon actions) must measure at least `min-h-11` (44px) and satisfy a 44px tap target on mobile and touch viewports.
2. **Compact secondary actions:** In compact desktop toolbars, data tables, or card header rows, secondary actions may use `size="sm"` (`min-h-9 h-9`, 36px) or `size="icon-sm"` (`size-9`, 36px) only when isolated with at least 8px surrounding clearance (`gap-2` or greater) to prevent mis-taps.
3. **Form controls height alignment:** When inputs, selects, and action buttons sit side-by-side in horizontal action rows, they share the identical 44px height (`min-h-11 h-11`), preventing baseline and border misalignments.
4. **Mobile text sizing:** Text inputs use `text-base md:text-sm` so iOS Safari does not trigger disruptive automatic page zooming on input focus.

## Interaction states contract

### 1. Focus Visible
- All interactive controls render consistent, accessible focus rings:
  `focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 outline-none`
- Never suppress or remove focus outlines on keyboard navigation (`:focus-visible`).

### 2. Disabled State
- Disabled controls use `disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50`.
- Native disabled attributes (`disabled`) are set on HTML inputs and buttons to ensure screen readers announce disabled state.

### 3. Pending & In-Flight State
- While an asynchronous action or submission is in flight:
  - The enclosing `<form>` or interactive container exposes `aria-busy="true"`.
  - The submit trigger displays a loading spinner and is disabled.
  - A synchronous ref guard (`submittingRef.current`) immediately drops concurrent execution attempts, guaranteeing zero double-submission races even during high-frequency tap events before re-rendering.
  - Controls never announce premature success before the server response is validated.

### 4. Validation & Errors
- Invalid controls receive `aria-invalid="true"` and an `aria-describedby` pointer matching the error message ID.
- Standalone error paragraphs feature `role="alert"` (or are summarized in the dialog/page alert banner) and `text-destructive`.

## Ownership boundaries & non-interference

- **PER-87 (Claude):** Claude owns overlay positioning, scroll locking, and focus restoration for `Dialog`, `Sheet`, `DropdownMenu`, and `Select` behavioral internals. PER-89 strictly consumes primitives and applies tokenized classes without altering Radix behavioral lifecycle, scroll-lock logic, or portal mounting.
- **PER-92 (Codex):** Codex owns density smoke tests (`apps/web/e2e/my-store.spec.ts`). PER-89 preserves all layout geometry and density assertions.
- **PER-73:** Add-item collapsed disclosure state and metadata retention (`add-item-form.tsx`) were audited and updated only for label typography consistency (`text-sm font-medium`), preserving all dirty/collapse retention logic.
