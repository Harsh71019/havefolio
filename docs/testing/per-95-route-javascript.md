# PER-95: Route JavaScript and Hydration Optimization

## Outcome Summary

PER-95 optimizes browser route JavaScript, bundle boundaries, and hydration overhead across the core Havefolio routes:
- **Home (`/`)**
- **My Store (`/store`)**
- **Item Details (`/items/[itemId]`)**
- **Add Item (`/items/new`)**
- **Insights (`/insights`)**

Through root-cause bundle analysis, we identified three major sources of bloat:
1. **Radix UI Barrel File Leak:** All UI primitives in `packages/ui` previously imported from the top-level `'radix-ui'` barrel package. Next.js/Webpack bundled every exported Radix primitive (Accordion, HoverCard, Menubar, ContextMenu, Toast, Collapsible, Toggle, NavigationMenu, etc.) into an uncompressed **117.1 KiB (32.6 KiB gzipped)** chunk (`1596-e786236739cf709a.js`) transmitted on **every single page**.
   - *Resolution:* Migrated all 15 `@havefolio/ui` primitives to subpath imports (`radix-ui/dialog`, `radix-ui/dropdown-menu`, `radix-ui/slot`, etc.). Chunk `1596` was completely eliminated across the entire site.
2. **Item Details Heavy Edit and Refund Modals:** `apps/web/components/item-details.tsx` statically imported `ItemEditDialog` (1,089 lines) and `item-refunds.tsx` statically imported `RefundDialog` and `DeleteRefundDialog` (~350 lines). These modals dragged heavy form inputs (`DateInput`, `Select`, `RadioGroup`, `Textarea`, financial date parsers) into the initial wire JS of every item view, even though <5% of visits open them immediately.
   - *Resolution:* Extracted `ItemEditDialog` into `apps/web/components/item-edit-dialog.tsx` and refund dialogs into `apps/web/components/item-refund-dialogs.tsx`. Both are loaded via `next/dynamic` (`ssr: false`) with hover and focus preloading triggers (`preloadItemEditDialog`, `preloadRefundDialogs`).
   - *Result:* Item Details route chunk dropped from **90.0 KiB uncompressed (24.2 KiB gz)** to **61.3 KiB uncompressed (17.6 KiB gz)** — a **31.9% reduction in chunk size**.
3. **Package Tree-Shaking and Sentry Trimming:** Configured `experimental: { optimizePackageImports: ['lucide-react', '@havefolio/ui'] }` in `next.config.ts`, refactored `instrumentation-client.ts` from barrel `* as Sentry` to named imports, and configured Sentry bundle-size optimizations (`excludeDebugStatements`, `excludeReplayIframe`, `excludeReplayShadowDom`, `excludeReplayWorker`).

---

## Route Chunk Size Comparison

| Route | Initial Route Chunk (Main Baseline) | Initial Route Chunk (PER-95) | Reduction (Raw) | Reduction (Gzip) |
| :--- | :--- | :--- | :--- | :--- |
| **Global Radix Barrel Chunk** | 117.1 KiB raw (32.6 KiB gz) | **0 KiB (ELIMINATED)** | **-117.1 KiB (-100%)** | **-32.6 KiB (-100%)** |
| **Item Details (`/items/[id]`)** | 90.0 KiB raw (24.2 KiB gz) | **61.3 KiB raw (17.6 KiB gz)** | **-28.7 KiB (-31.9%)** | **-6.6 KiB (-27.3%)** |
| **Add Item (`/items/new`)** | 41.5 KiB raw (12.9 KiB gz) | **38.1 KiB raw (11.9 KiB gz)** | **-3.4 KiB (-8.2%)** | **-1.0 KiB (-7.8%)** |
| **My Store (`/store`)** | 64.8 KiB raw (20.8 KiB gz) | **61.9 KiB raw (19.9 KiB gz)** | **-2.9 KiB (-4.5%)** | **-0.9 KiB (-4.3%)** |
| **Insights (`/insights`)** | 57.2 KiB raw (17.6 KiB gz) | **54.9 KiB raw (16.9 KiB gz)** | **-2.3 KiB (-4.0%)** | **-0.7 KiB (-4.0%)** |
| **Home (`/`)** | 36.9 KiB raw (10.8 KiB gz) | **34.8 KiB raw (10.2 KiB gz)** | **-2.1 KiB (-5.7%)** | **-0.6 KiB (-5.6%)** |

---

## End-to-End Browser Measurements (PER-94 Harness Comparison)

Measurements were taken using the identical isolated performance harness (`scripts/performance/run.mjs`) across 5 repeated cold and warm runs on 100-item synthesized datasets under both Desktop and Mobile profiles (Mobile: 4x CPU throttling, 150ms round-trip latency, 1.6 Mbps download).

### Mobile Profile (4x CPU Throttling, 150ms Latency)

| Route | Metric | PER-94 Baseline | PER-95 Optimized | Delta |
| :--- | :--- | :--- | :--- | :--- |
| **Home (`/`)** | Cold Readiness | 3,338 ms | **2,842 ms** | **-496 ms (-14.9%)** |
| | Warm Readiness | 641 ms | **592 ms** | **-49 ms (-7.6%)** |
| | Cold JS Transferred | 423.5 KiB | **403.0 KiB** | **-20.5 KiB (-4.8%)** |
| | Cold Long Task Duration | 120 ms | **113 ms** | **-7 ms** |
| **My Store (`/store`)** | Cold Readiness | 3,336 ms | **3,352 ms** | +16 ms (neutral) |
| | Warm Readiness | 1,098 ms | **1,076 ms** | **-22 ms (-2.0%)** |
| | Cold JS Transferred | 365.1 KiB | **334.7 KiB** | **-30.4 KiB (-8.3%)** |
| | Cold Long Task Duration | 262 ms | **236 ms** | **-26 ms (-9.9%)** |
| **Item Details (`/items/[id]`)** | Cold Readiness | 3,420 ms | **3,336 ms** | **-84 ms (-2.5%)** |
| | Warm Readiness | 717 ms | **579 ms** | **-138 ms (-19.2%)** |
| | Cold JS Transferred | 455.1 KiB | **427.6 KiB** | **-27.5 KiB (-6.0%)** |
| | Cold Long Task Duration | 148 ms | **128 ms** | **-20 ms (-13.5%)** |
| **Add Item (`/items/new`)** | Cold Readiness | 3,403 ms | **3,355 ms** | **-48 ms (-1.4%)** |
| | Warm Readiness | 1,083 ms | **1,064 ms** | **-19 ms (-1.8%)** |
| | Cold JS Transferred | 443.0 KiB | **418.1 KiB** | **-24.9 KiB (-5.6%)** |
| | Cold Long Task Duration | 239 ms | **221 ms** | **-18 ms (-7.5%)** |
| **Insights (`/insights`)** | Cold Readiness | 3,337 ms | **3,354 ms** | +17 ms (neutral) |
| | Warm Readiness | 708 ms | **679 ms** | **-29 ms (-4.1%)** |
| | Cold JS Transferred | 416.6 KiB | **391.3 KiB** | **-25.3 KiB (-6.1%)** |
| | Cold Long Task Duration | 288 ms | **279 ms** | **-9 ms (-3.1%)** |

### Desktop Profile (Unthrottled)

| Route | Cold Readiness | Warm Readiness | Cold JS Transferred | Long Tasks (Cold & Warm) |
| :--- | :--- | :--- | :--- | :--- |
| **Home (`/`)** | 156 ms | 122 ms | 434.7 KiB | 0 ms |
| **My Store (`/store`)** | 198 ms | 122 ms | 456.0 KiB | 0 ms |
| **Item Details (`/items/[id]`)** | 170 ms | 109 ms | 471.0 KiB | 0 ms |
| **Add Item (`/items/new`)** | 160 ms | 98 ms | 456.0 KiB | 0 ms |
| **Insights (`/insights`)** | 195 ms | 147 ms | 434.7 KiB | 0 ms |

---

## Action and Deferred Feature Latencies

Preloading triggers (`onPointerEnter`, `onFocus`) ensure that deferred chunks are loaded before the user can click them, avoiding interaction delays:

- **Store Navigation:** Desktop median 183.3 ms; Mobile median 1,432.3 ms.
- **Store Load-More:** Desktop median 67.2 ms; Mobile median 100.7 ms.
- **Store Filter Toggle:** Desktop median 81.9 ms.
- **Feedback / Action Confirmation:** Desktop median 78.4 ms; Mobile median 263.9 ms.

All deferred dialogs (`ItemEditDialog`, `RefundDialog`, `DeleteRefundDialog`) open instantaneously without noticeable latency or layout shift.

---

## Progress Toward Proposed Budgets & Unresolved Gaps

### Proposed Budget
- **Target:** <= 250 KiB wire JS for initial cold route load.

### Progress Achieved
- Eliminated 32.6 KiB gz / 117.1 KiB raw globally via Radix direct imports.
- Split edit and refund modals out of Item Details, saving 6.6 KiB gz / 28.7 KiB raw from the route bundle.
- Total wire JS transferred during page load dropped by 20.5 to 30.4 KiB across all 5 profiled routes.

### Analysis of the Gap to 250 KiB
The cold initial load transfer in Next.js 16 includes mandatory framework infrastructure:
1. **React 19 & Client DOM Runtime (`framework-*`, `fc06affe-*`):** ~120 KiB gz.
2. **Next.js App Router Client Runtime (`6310-*`, `main-*`):** ~140 KiB gz.
3. **Application Root Layout & Shared Navigation Shell:** ~35 KiB gz.
4. **Sentry Client Instrumentation:** ~25 KiB gz.
5. **Modern Browser Polyfills Script:** Next.js unconditionally includes `<script nomodule src="polyfills-*.js">` (38.7 KiB gz) in HTML. Modern browsers do not download it, but headless tools and measurement harnesses tracking all HTML script tags count it towards total transfers.
6. **Prefetch Traffic in Observation Window:** Next.js `<Link>` components prefetch linked routes during the 1-second post-readiness window.

Reaching <= 250 KiB wire JS on Next.js App Router will require upstream Next.js framework optimizations (e.g. partial prefetching, smaller App Router runtime) or moving route pages to Server Components where interactive state permits.

---

## Safety and Invariant Verification

- **Keyboard & Focus Navigation:** All 46/46 tests in `apps/web/test/item-details.test.tsx` pass, verifying keyboard navigation, modal focus traps, and return focus restoration on close.
- **Zero Hydration Errors:** No hydration mismatch warnings or DOM replacement flashes occurred during all 50 browser benchmark loads.
- **No Private Credentials or URLs:** Inspected all generated client chunks in `.next/static/chunks/`; verified no environment variables, API secrets, or protected Cloudinary URLs leaked into client bundles.
- **PER-88 Stable Loading Geometry:** Preserved skeleton dimensions and aspect-ratio styling across item details, store cards, and forms.
- **PER-90 Navigation Recovery:** Retained abort controller handling and session recovery logic.
