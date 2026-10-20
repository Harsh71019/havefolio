# Havefolio UI Route & Capture Audit Matrix

Status: **Sprint Blueprint & Design Contract**  
Ticket: **PER-74**  
Parent: **PER-70**  
Implementation Children: **PER-75, PER-77, PER-78, PER-80, PER-81, PER-82, PER-83, PER-84**  

---

## 1. Executive Summary & Audit Methodology

As mandated by **PER-74**, this audit inspects all active client-facing routes in Havefolio (`apps/web/app/(inventory)/**` and `apps/web/app/login`) on `origin/main` (commit `832985e`). Every route has been audited for:

1. **Current Container Geometry:** Width limits (`max-w-*`), centering classes (`mx-auto`), and horizontal padding.
2. **Left-Rail Alignment Defects:** Margin jumps, floating centered content islands, and header-to-content horizontal drift.
3. **Capture Journeys & Contextual Navigation:** Entry point origins, return paths, and parameter preservation.
4. **State Coverage:** Loading skeletons, empty states, error fallbacks, and offline network drop resilience.
5. **Sprint Bug Verification:** Confirmed source-derived evidence for **PER-71** (missing edit route), **PER-72** (broken error links), and **PER-73** (collapsed disclosure data loss).

---

## 2. Complete Route Inventory Matrix

| # | Route | Purpose | Current Container Classes | Key Identified Defects & Pain Points | Proposed Remedy (Left Rail & State Structure) |
|---|---|---|---|---|---|
| 1 | `/` (Home) | Household inventory dashboard, quick stats, active wants, recent items, and primary capture shortcut. | `<main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-8 sm:py-12 lg:px-12">` | Centered island (`max-w-6xl mx-auto`). On 1512px wide displays, left edge sits at x = 452px while header search sits at x = 304px. | Remove `mx-auto`. Align to left rail (`px-4 sm:px-6 lg:px-8 w-full max-w-7xl`). Left-aligned greeting and stats grid. |
| 2 | `/store` (My Store) | Visual catalog of owned items with filter sidebar, density toggle, search, and category grouping. | `<main className="mx-auto w-full max-w-[112rem] px-4 py-4 sm:px-8 sm:py-6">` | Uses `max-w-[112rem]` while other pages use `max-w-3xl` or `max-w-6xl`. Navigating between Store and other pages causes a jarring 200–400px horizontal content shift. Contextual add button links to `/items/new` without category. | Remove `mx-auto`. Align left margin with shell left rail. Forward active category/filter as query params to Add Item (`/items/new?categoryId=...&returnTo=/store`). |
| 3 | `/items/new` (Add Item) | Primary possession capture flow. Name, price, date, category, source, condition, usage, and notes. | Outer: `max-w-6xl mx-auto`<br>Inner Form: `max-w-xl mx-auto mb-6` | Nested double-centering creates a tiny floating card in the center of wide viewports. Success screen links to non-existent `/items/[id]/edit` (PER-71). Error links fail on date/category/brand (PER-72). Collapsing details drops metadata (PER-73). | Remove `mx-auto`. Pin form to left content rail (`w-full max-w-2xl text-left`). Fix PER-71/72/73. Add contextual return link to `returnTo` journey. |
| 4 | `/items/[itemId]` (Item Details) | Single item overview, specs, acquisition history, lifecycle changes (sold, donated, lost), and refund entry. | Outer: `max-w-6xl mx-auto`<br>Inner: `max-w-3xl mx-auto` | Floating centered island. Inconsistent container widths between read view (`max-w-6xl`) and edit dialog. Edit action lives in modal dialog while Add Item success expects `/items/[id]/edit`. | Left-rail two-column desktop layout (`max-w-6xl`): main specs on left (`max-w-2xl`), media & lifecycle actions on right. Support `?edit=true` query param to open edit dialog directly. |
| 5 | `/items/[itemId]/photos` (Photo Gallery) | Photo gallery for a specific item, reordering, primary photo selection, and photo deletion. | `<main className="mx-auto w-full max-w-5xl space-y-6 p-4 sm:p-6">` | `max-w-5xl mx-auto` shifts content left edge compared to both `/items/[itemId]` (`max-w-6xl`) and `/items/new` (`max-w-xl`). Back link is hardcoded or missing contextual `returnTo`. | Left-rail responsive grid (`max-w-6xl px-4 sm:px-6 lg:px-8`). Preserves `returnTo` parameter to return owner to catalog or item view. |
| 6 | `/items/[itemId]/photos/new` (Add Photo/Receipt) | Camera capture, file picker, cropping, HEIC conversion, and receipt attachment. | `<main className="mx-auto w-full max-w-2xl space-y-6 p-4 sm:p-6">` | Form is centered with `max-w-2xl mx-auto`. When landing from Add Item success, transition jumps horizontally. Touch target on file input needs mobile review. | Pin upload dropzone and camera controls to left rail (`max-w-2xl`). Standardize page title and explicit back/cancel return path. |
| 7 | `/insights` (Spending Insights) | Historical spending analysis, category breakdown, merchant spend, month-by-month trends, and refund totals. | `<main className="mx-auto w-full max-w-6xl space-y-8 px-4 py-8 sm:px-8 sm:py-12 lg:px-12">` | Centered island. Spending charts and filter pills jump horizontally on navigation. Dense financial tables lack left alignment with top filters. | Left-rail aligned dashboard (`max-w-7xl`). Filter toolbar pins to left rail; chart cards and merchant tables expand responsively. |
| 8 | `/wants` (Wants List) | Impulsive desire cooling queue. Waiting period countdown, urge ratings, and outcome actions (Bought, Dismissed). | `<main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-8 sm:py-12 lg:px-12">` | Centered island (`max-w-6xl mx-auto`). Empty state "Add your first want" is centered and disconnected from the left-rail search. | Left-rail card list (`max-w-4xl` or `max-w-5xl`). Filter tabs and countdown cards align to left gutter. |
| 9 | `/wants/new` (Add Want) | Captures prospective purchase, price, merchant, waiting period, and cooling-off reason. | Outer: `max-w-6xl mx-auto`<br>Inner: `max-w-xl mx-auto mb-6` | Same nested double-centering defect as `/items/new`. Unbounded form floating in the middle of wide desktop screens. | Pin form to left content rail (`w-full max-w-2xl text-left`). Standardize input heights (min 44px) and clear save/cancel actions. |
| 10 | `/wants/[id]/edit` (Edit Want) | Edit desire attributes, waiting period duration, notes, or merchant link. | Outer: `max-w-6xl mx-auto`<br>Inner: `max-w-xl mx-auto mb-6` | Centered island. Inconsistent back link behavior (sometimes resets filter state). | Left-pinned form (`max-w-2xl`). Explicit return link to `/wants/[id]` or `/wants`. |
| 11 | `/wants/[id]/matches` (Similar Owned Items) | Displays potential duplicates already owned before buying, with explainable match reasons. | `<main className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-8 sm:py-12 lg:px-12">` | Container uses `max-w-4xl mx-auto` (different from `/wants` and `/wants/[id]/compare`). Match cards center-float. | Left-rail aligned list of comparison cards (`max-w-5xl`). Clear visual contrast between "Already owned" and "Desire". |
| 12 | `/wants/[id]/compare` (Side-by-Side Comparison) | Direct comparison between a prospective purchase and an existing owned possession. | `<main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-8 sm:py-12 lg:px-12">` | `max-w-5xl mx-auto`. On wide displays, the two-column compare card sits stranded in the center. | Left-rail two-column side-by-side comparison (`max-w-5xl`). Left card: Owned item; Right card: Want. Sticky action footer on mobile. |
| 13 | `/wants/[id]/history` (Decision History) | Chronological outcome history of a want (Bought, Passed, Wait expired, Goal allocated). | `<main className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-8">` | Narrow `max-w-3xl mx-auto` container creates huge lateral shift when navigating from `/wants` (`max-w-6xl`). | Left-rail timeline (`max-w-3xl`). Align timeline markers to left rail with consistent padding. |
| 14 | `/wants/[id]/allocate` (Goal Allocation) | Allocate money avoided by not buying a want toward a personal financial goal. | `<main className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-8">` | Narrow centered container (`max-w-3xl mx-auto`). Slider and number input alignment feels fragile on tablet viewports. | Left-pinned allocation card (`max-w-2xl`). Explicit integer minor-unit money calculations; back link returns to decision history. |
| 15 | `/wants/[id]/convert` (Convert Bought Want) | Turns a fulfilled desire into an owned item record. Pre-fills name, estimated price, and merchant. | `<main className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-8">` | Narrow centered container. Disconnects from the Add Item visual hierarchy. Missing direct photo continuation prompt. | Align form layout with `/items/new` (`max-w-2xl` left-pinned). On save, provide immediate photo handoff or return to Wants. |
| 16 | `/wants/[id]/goals` (Want vs Goals Tradeoff) | Compares the price of a desire against progress on all active personal savings goals. | `<main className="mx-auto w-full max-w-3xl px-5 py-8 sm:px-8 sm:py-12">` | Narrow centered container (`max-w-3xl mx-auto`). Progress bars stretch unevenly across different screen widths. | Left-rail trade-off summary (`max-w-4xl`). Goal cards align in a structured left-rail grid. |
| 17 | `/goals` (Goals List) | Overview of active personal goals, target amounts, confirmed allocations, and remaining balances. | `<main className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-8 sm:py-12 lg:px-12">` | `max-w-6xl mx-auto`. Goal progress cards center-float with wide margins on large monitors. | Left-rail grid (`max-w-6xl`). Goal cards use unified progress tokens and left-aligned metric numbers. |
| 18 | `/goals/new` (Add Goal) | Create a new financial goal (title, target amount in INR/currency, optional target date). | `<main className="mx-auto w-full max-w-3xl px-5 py-8 sm:px-8 sm:py-12">` | Narrow centered container (`max-w-3xl mx-auto`). Header search doesn't line up with form title. | Left-pinned form (`max-w-2xl`). Standardize money entry with integer minor unit precision. |
| 19 | `/goals/[id]` (Goal Detail) | Goal status, target progress, breakdown of confirmed desire savings, and manual contributions. | `<main className="mx-auto w-full max-w-3xl px-5 py-8 sm:px-8 sm:py-12">` | Narrow centered container (`max-w-3xl mx-auto`). Inconsistent with `/insights` and `/store`. | Left-rail two-column layout on desktop (`max-w-5xl`): progress overview on left, contribution history on right. |
| 20 | `/goals/[id]/edit` (Edit Goal) | Update goal title, target amount, or target completion date. | `<main className="mx-auto w-full max-w-3xl px-5 py-8 sm:px-8 sm:py-12">` | Narrow centered container (`max-w-3xl mx-auto`). Form width doesn't match Goal Detail. | Left-pinned form (`max-w-2xl`). Clear back link returning to `/goals/[id]`. |
| 21 | `/settings` (Settings Overview) | Owner preferences: display currency, theme toggle, session management, export, and account deletion. | `<main className="mx-auto max-w-4xl space-y-6 px-4 py-8 sm:px-6">` | `max-w-4xl mx-auto`. Long list of diverse settings sections without clear progressive visual hierarchy. | Left-rail structured section cards (`max-w-3xl`). Clear segmentation: Appearance, Localization, Categories/Merchants, Privacy. |
| 22 | `/settings/taxonomy` (Categories & Tags) | Category tree management, subcategories, tags, item counts, and retire/delete actions. | `<main className="mx-auto max-w-5xl space-y-6 px-4 py-8 sm:px-6">` | `max-w-5xl mx-auto`. Tree indentation and edit buttons shift when switching from `/settings` (`max-w-4xl`). | Left-rail hierarchical tree editor (`max-w-4xl`). Direct keyboard shortcuts and inline create triggers. |
| 23 | `/settings/merchants` (Purchase Merchants) | Merchant management, normalization rules, website domains, and merchant-level spend summaries. | `<main className="mx-auto max-w-4xl space-y-6 px-4 py-8 sm:px-6">` | `max-w-4xl mx-auto`. Merchant rows stretch or center awkwardly depending on sidebar state. | Left-rail merchant directory (`max-w-4xl`). Standard table rows with left-aligned names and right-aligned spend totals. |
| 24 | `/login` (Owner Authentication) | Private single-owner credentials sign-in with password or email link. | `<main className="min-h-svh lg:grid lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">` | Split-screen presentation on desktop. Form container on mobile is centered without explicit left-rail alignment. | Keep branded split layout on desktop (approved in PER-52). On mobile (< 1024px), ensure input controls adhere to left-rail 16px gutter. |

---

## 3. Product-Add Entry Points Inventory

Havefolio features six distinct entry points into item capture. Each entry point must follow a predictable contract:

### Journey A: Global Primary Add (`Header / Nav -> /items/new`)
- **Trigger:** Top header "+ Add item" button (desktop) or floating bottom nav "+" button (mobile).
- **Parameters:** None (`/items/new`).
- **Default Return Route:** `/store` or `/`.
- **Current Defect:** Success screen links to non-existent `/items/[id]/edit` (PER-71). Form is double-centered.
- **Remedy:** Left-pinned form (`max-w-2xl`). On success, offer "Add another item", "Add photos or receipt", or "Go to My Store".

### Journey B: Category / Store Contextual Add (`/store -> /items/new?categoryId=...`)
- **Trigger:** My Store category toolbar ("+ Add in [Category]"), or empty category placeholder ("Add your first item in Kitchen").
- **Parameters:** `?categoryId=<uuid>&returnTo=/store?category=<uuid>`.
- **Default Return Route:** `/store?category=<uuid>`.
- **Current Defect:** My Store currently hardcodes `<Link href="/items/new">` without passing `categoryId` or `returnTo`. Owner must re-select the category they were already browsing!
- **Remedy:** Automatically pre-populate category selector in Add Item form from `categoryId` query parameter. Provide a prominent "Cancel / Return to [Category]" link that returns to `returnTo`.

### Journey C: Merchant Contextual Add (`/settings/merchants -> /items/new?merchantId=...`)
- **Trigger:** Merchant spend drilldown or merchant detail action ("Add item bought from IKEA").
- **Parameters:** `?merchantId=<uuid>&returnTo=/settings/merchants`.
- **Default Return Route:** `/settings/merchants`.
- **Remedy:** Pre-populate merchant selector and default currency. Return owner directly to the merchant management screen upon save.

### Journey D: Wants Cooling-Off Conversion (`/wants/[id] -> /wants/[id]/convert`)
- **Trigger:** Owner marks a desire as "Bought" after the waiting period expires.
- **Parameters:** `desireId=<uuid>`.
- **Default Return Route:** `/wants`.
- **Current Defect:** Form structure diverges from `/items/new`; does not prompt for immediate photo/receipt continuation.
- **Remedy:** Use identical left-pinned form layout. Pre-fill name, estimated price, and merchant. On submit, save the item, update desire outcome to `bought`, and offer direct photo continuation.

### Journey E: First-Run Onboarding (`/ -> Demo / Fresh Capture`)
- **Trigger:** New owner lands on empty home dashboard.
- **Options:** "Explore sample household items" or "Add your first possession".
- **Parameters:** `?from=onboarding`.
- **Default Return Route:** `/` (with newly saved item featured in recent additions).
- **Remedy:** Streamlined progressive form with friendly helper text explaining Havefolio's private, non-commercial purpose.

### Journey F: Media Continuation Handoff (`/items/[id]/photos/new`)
- **Trigger:** Optional post-save continuation from Add Item (Journeys A, B, C, D) or "Add photo" button on Item Details.
- **Parameters:** `itemId=<uuid>&returnTo=/items/<uuid>`.
- **Default Return Route:** `/items/<uuid>`.
- **Current Defect:** If connection drops during photo upload, owner loses context of which item they were enriching.
- **Remedy:** Resilient photo capture with local preview retention, retry controls, and explicit "Skip / Done" action returning to `returnTo`.

---

## 4. Source-Confirmed Capture Defects (PER-71, PER-72, PER-73)

The audit verified three critical bugs in `apps/web/components/add-item-form.tsx` directly from current source code:

### Defect 1: Add Item Success Action Links to 404 Route (PER-71)
- **Source Location:** `apps/web/components/add-item-form.tsx`, lines 681–686.
- **Code Inspection:**
  ```tsx
  <Button asChild variant="outline" className="min-h-11">
    <Link href={`/items/${createdItem.id}/edit`}>
      <FileEdit className="mr-2 size-4" aria-hidden="true" />
      Add details
    </Link>
  </Button>
  ```
- **Finding:** No route exists at `apps/web/app/(inventory)/items/[itemId]/edit/page.tsx`. Item editing is implemented as a client dialog (`ItemEditDialog`) within `/items/[itemId]/page.tsx`. Clicking "Add details" immediately lands the owner on a Next.js 404 page!
- **Remedy:** Direct the link to `/items/${createdItem.id}?edit=true` or change the action to "View item details" (`/items/${createdItem.id}`), opening the edit dialog seamlessly if requested.

### Defect 2: Validation Summary Links Target Non-Existent or Hidden Elements (PER-72)
- **Source Location:** `apps/web/components/add-item-form.tsx`, lines 765–779 & 440–500.
- **Code Inspection:**
  ```tsx
  {Object.entries(validationErrors).map(([key, err]) => (
    <li key={key}>
      <a href={`#${formId}-${key}`} onClick={(e) => {
        e.preventDefault();
        const el = document.getElementById(`${formId}-${key}`);
        el?.focus();
        el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }}>
        {err}
      </a>
    </li>
  ))}
  ```
- **Finding:**
  1. `errors.date` generates target ID `${formId}-date`. But the actual date inputs use `${formId}-exact-date`, `${formId}-year`, or `${formId}-month`. No element with ID `${formId}-date` exists in the DOM. Focus fails silently.
  2. `errors.category` generates target ID `${formId}-category`. The selector component does not assign `${formId}-category` to its trigger button. Focus fails silently.
  3. `errors.brand`, `errors.model`, `errors.description`, `errors.notes` generate target IDs that live inside `{showOptionalDetails ? (...) : null}`. If `showOptionalDetails` is `false`, the inputs are unmounted from the DOM! Clicking the validation link targets a null element.
- **Remedy:**
  - Map error keys to actual focusable element IDs:
    - `date` -> `${formId}-exact-date` (or active precision control).
    - `category` -> `${formId}-category-trigger`.
  - In `onClick`, if target element is not in DOM and key belongs to optional details, set `setShowOptionalDetails(true)` before focusing.

### Defect 3: Collapsing "Additional Details" Discards Selected Metadata (PER-73)
- **Source Location:** `apps/web/components/add-item-form.tsx`, lines 521–523.
- **Code Inspection:**
  ```tsx
  const payload: CreateItemRequest = {
    // ...
    acquisitionType: showOptionalDetails ? acquisitionType : undefined,
    condition: showOptionalDetails ? condition : undefined,
    useFrequency: showOptionalDetails ? useFrequency : undefined,
  };
  ```
- **Finding:** If an owner fills out Acquisition ("Gift"), Condition ("Working well"), and Use Frequency ("Often"), but then collapses the "Additional details (optional)" visual disclosure before clicking Save, all three fields are silently wiped (`undefined`)! Notice that `brand`, `model`, and `notes` are preserved, making the behavior inconsistent and unexpected.
- **Remedy:** Remove the ternary check `showOptionalDetails ? ... : undefined`. As long as the owner selected a valid value, serialize it into the creation payload regardless of visual accordion open/close state.

---

## 5. Standardized State Handling Contract

Every inventory route must implement four standard states without layout shifts:

1. **Loading State:**
   - Display a semantic `<main aria-busy="true">` skeleton that reserves the identical geometry of the loaded page.
   - Skeletons must match the unified left-rail padding (`px-4 sm:px-6 lg:px-8`).
   - Title skeleton (`h-8 w-48`), subtitle skeleton (`h-4 w-72`), and content card/table skeleton.
   - Prevent content jumps when data finishes loading (PER-88).

2. **Empty State:**
   - Use `@havefolio/ui/components/empty` or `@havefolio/ui/components/card`.
   - Never show a bare blank screen. Include an accessible icon, clear neutral explanation (e.g., "No items in this category yet"), and a primary action button ("Add an item").
   - Empty state card pins to the left rail (`max-w-xl text-left`), avoiding detached center alignment.

3. **Error State (500 / 503):**
   - Caught by Next.js `error.tsx` or route-level catch boundary.
   - Render an alert card with clear, non-technical explanation.
   - Must provide two explicit actions: **Try again** (refreshes state/query) and **Return to [Parent Route]**.
   - Input forms must retain entered text upon server error (PER-36 / PER-47).

4. **Offline Resilience:**
   - Use `useOnlineStatus()` hook.
   - When offline, display an accessible banner: "You are currently offline. Changes will not be saved to the cloud."
   - Disable submission buttons to prevent loss of in-flight data, but retain all entered draft content in local storage.
