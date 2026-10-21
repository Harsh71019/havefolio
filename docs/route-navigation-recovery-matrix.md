# Route Transitions, History Navigation, and Focus Recovery Matrix

This document defines the audited and intended navigation, history, scroll, and focus recovery contracts for Havefolio under **PER-90**.

## 1. Architectural Principles

1. **New Forward Destinations Start at Top with Accessible Focus**:
   When an owner navigates to a new destination via the primary desktop sidebar, the mobile bottom navigation bar, or internal links:
   - Window scroll position is set to `(0, 0)` immediately. Owners are never stranded mid-page from previous scroll positions.
   - Focus is moved to the page landmark (`#main-content`), which is configured with `tabIndex={-1}` and `outline-none`. This prompts screen readers to announce the new page and ensures keyboard navigation (Tab) enters the new page content rather than continuing through navigation bars.
   - Focus is never forcibly reset on component rerenders or in-page query changes.

2. **History Navigation (Back/Forward) Preserves Browsing Context**:
   When navigating back or forward via browser history (`popstate`) or explicit in-page return links (`returnTo`):
   - Query, search, and filter parameters in the URL are preserved and restored.
   - The owner's prior browsing position in lists (e.g. My Store) is restored: the previously visited item card is scrolled into view and receives focus.
   - History navigation does not force focus back to the top landmark, allowing natural browsing continuation.

3. **Overlay and Dialog Focus Recovery**:
   Every modal dialog, alert dialog, and menu overlay must return focus to its trigger button upon closing (or to a designated semantic fallback if the trigger element was removed from the DOM). Focus must never drop unhandled to `document.body`.

4. **Breakpoint Transitions and Responsive Geometry**:
   When changing viewport width between mobile (< 768 px) and desktop (≥ 768 px):
   - Exactly one primary navigation surface is presented.
   - Any open mobile overlay (such as the mobile "More destinations" menu) closes cleanly so no stale overlay, backdrop, or focus trap remains.
   - If focus was inside the navigation surface being hidden, focus transfers to the equivalent item in the active navigation surface (or `#main-content`), preventing focus from becoming trapped on a `display: none` element or lost to `document.body`.

5. **Persistence, Privacy, and Financial Semantics**:
   - Navigation context preserves owner privacy.
   - State stored in browser storage (`sessionStorage`) is limited to non-sensitive ephemeral layout keys (such as an item ID for focus return), never storing financial or personal data.
   - Presets (theme, density, sidebar state) hydrate before paint without hydration mismatches or shell flash.

---

## 2. Route & History Matrix

| Journey / Trigger | Prior Behavior (Audit Findings) | Expected / Target Behavior (PER-90) | Scroll Contract | Focus Contract |
|---|---|---|---|---|
| **Desktop Sidebar Navigation** (e.g. `/` → `/store`, `/store` → `/wants`) | Focus remained on clicked `<Link>` in the sidebar; scroll position relied on default browser scroll. | Forward navigation scrolls to `(0, 0)`; focus moves to `#main-content`. Exactly one primary nav destination is marked with `aria-current="page"`. | `(0, 0)` (top) | `#main-content` (WCAG 2.4.1) |
| **Mobile Bottom Navigation** (e.g. `/` → `/store`, `/store` → `/insights`) | Focus remained on the clicked tab in the fixed bottom navigation bar at bottom of screen. | Forward navigation scrolls to `(0, 0)`; focus moves to `#main-content`. Mobile bar reflects current active destination. | `(0, 0)` (top) | `#main-content` (leaves bottom bar) |
| **Mobile "More" Menu Navigation** (e.g. selecting "Goals", "Categories", or "Settings" in More) | Dropdown closed; Radix `onCloseAutoFocus` restored focus to the "More" button on the fixed bottom bar on the new page. | When selecting a destination link, `onCloseAutoFocus` is prevented. Forward navigation moves focus to `#main-content` of the new page. More button shows active state if child is current. | `(0, 0)` (top) | `#main-content` of destination page |
| **Mobile "More" Menu Dismissal** (Escape key or click outside) | Dropdown closed; focus returned to "More" button. | Focus is cleanly restored to the "More" button on the mobile bottom bar. | Unchanged | "More" trigger button |
| **List to Details Navigation** (e.g. `/store?q=table` → `/items/[id]?returnTo=...`) | Item ID and return path passed in `returnTo`. Details page rendered at top. | Details page starts at `(0, 0)` with focus on `#main-content` / heading. Item ID recorded in session for return recovery. "My Store" marked as active parent destination. | `(0, 0)` (top) | `#main-content` / item heading |
| **Details to Back Link Navigation** (clicking "Back to My Store" on item details) | Navigated to `returnTo` (`/store?q=table`). Because store loads asynchronously, scroll stayed at top `(0, 0)` and focus was lost to body or skip link. | Returns to `/store?q=table`. Query and filters intact. When store items finish loading, the previously viewed item card is scrolled into view and receives focus. | Restored to item card | Item card link in list |
| **Browser Back Navigation from Details** (browser Back button on `/items/[id]`) | Browser `popstate` fired. Store mounted with loading skeletons. Browser scroll restoration clamped to `0` due to async load. Focus was on `<body>`. | When store items finish loading, the previously viewed item card is scrolled into view and receives focus. | Restored to item card | Item card link in list |
| **In-Page Filter Changes** (typing in search, category/tag selection, sort toggle) | Search and filters updated via `window.history.pushState` and `store-location.ts`. | Scroll does not jump away from active controls. Focus stays in search input or on filter toggle being manipulated. Pathname does not change, so no route focus reset occurs. | Preserved | Active input / filter control |
| **Pagination ("Load more items")** (clicking Load more in My Store) | Next batch loaded and appended to grid. `setAnnouncement` announced count. If no more items, button unmounted, dropping focus to body. | When items append, scroll position is preserved. If more items remain, focus stays on the button. If no more items remain (button unmounts), focus transitions gracefully to the first newly loaded item. | Preserved | Load more button / first new item |
| **Overlay Close: Item Delete Dialog** (`item-lifecycle.tsx`) | Dialog had no `AlertDialogTrigger` and no `onCloseAutoFocus`. Dismissing with Cancel or Escape dropped focus to `<body>`. | `onCloseAutoFocus` returns focus to the "Delete item..." button (or heading fallback if deleted). | Preserved | "Delete item..." button |
| **Overlay Close: Store Filters Sheet** (`my-store.tsx`) | Handled by PER-87 with `filtersButton` ref and `onCloseAutoFocus`. | Focus cleanly restored to Filters button in toolbar. | Preserved | Filters button in toolbar |
| **Overlay Close: Item Edit Dialog** (`item-edit-dialog.tsx`) | Handled via `onClose` callback timeout; Radix default `onCloseAutoFocus` could briefly touch body. | `onCloseAutoFocus` prevents default and directly restores focus to edit section trigger or item heading. | Preserved | Edit section trigger button |
| **Breakpoint Resize: Mobile → Desktop** (viewport resized from 390 px to 1024 px) | Mobile nav became `display: none`. If More menu was open, portal remained visible alongside desktop sidebar. If focus was in mobile nav, focus fell to body. | More dropdown closes immediately. If focus was on a mobile nav link or More menu, focus transfers to the corresponding link in the desktop sidebar. | Unchanged | Equivalent desktop sidebar link |
| **Breakpoint Resize: Desktop → Mobile** (viewport resized from 1024 px to 390 px) | Desktop sidebar became `display: none`. Focus fell to `<body>`. | If focus was inside the desktop sidebar, focus transfers to the corresponding link in the mobile navigation bar (or More button for indices ≥ 4). | Unchanged | Equivalent mobile nav link / More |
| **Skip Link Activation** (Tab → Enter on "Skip to main content") | Focused `#main-content`. | Works consistently across all routes; bypasses navigation bars. | Moves to top of content | `#main-content` |
