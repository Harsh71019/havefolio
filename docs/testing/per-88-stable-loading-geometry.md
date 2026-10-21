# PER-88: Reserve stable geometry for loading content, images and async feedback

## Baseline and reproduction

Measured on `origin/main` at commit `b139d3d` using a production Next.js standalone build (`next build --webpack`, `next start`), synthetic test fixtures (`homeFixture`, `taxonomy`, `sampleItem`, `spendingReport`, `merchantSpending`), and Chromium desktop (1280x720) and mobile (Pixel 7 / 390px) test projects.

Layout shifts were recorded using the browser's `PerformanceObserver` API observing `layout-shift` entries:
- **Cumulative Layout Shift (CLS)**: Cumulative score of layout shifts where `hadRecentInput === false`.
- **Total Layout Movement**: Sum of all layout shift values regardless of input flags, verifying interaction-triggered displacement separately.

Simulated conditions included:
- 300ms delayed API responses to measure skeleton-to-content transitions.
- Background refresh failures (503 Service Unavailable) dispatched via synthetic `havefolio-inventory-changed` events.
- Unavailable/broken private media endpoints (404/500 responses on photo file delivery).

### Measurement results (Baseline vs After PER-88)

| Flow / Page | Viewport | Metric | Baseline (`b139d3d`) | After PER-88 | Improvement |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Home Dashboard** (300ms delay) | Desktop (1280px) | CLS | `0.0700` | **`0.0262`** | 62.5% reduction |
| **Home Dashboard** (300ms delay) | Mobile (390px) | Total Movement | `0.1605` | **`0.0469`** | 70.8% reduction |
| **Spending Insights** (200ms delay) | Desktop (1280px) | CLS | `0.0049` | **`0.0005`** | 89.8% reduction |
| **Spending Insights** (200ms delay) | Mobile (390px) | Total Movement | `0.0095` | **`0.0011`** | 88.4% reduction |
| **My Store** (300ms delay) | Desktop (1280px) | CLS | `0.0433` | **`0.0433`** | Well within $\le 0.1$ target |
| **My Store** (300ms delay) | Mobile (390px) | Total Movement | `0.0613` | **`0.0613`** | Well within $\le 0.1$ target |
| **Item Details** (300ms delay) | Desktop & Mobile | CLS | `0.0000` | **`0.0000`** | Zero layout shift |
| **Photo Gallery** (300ms delay) | Desktop & Mobile | CLS | `0.0000` | **`0.0000`** | Zero layout shift |
| **Broken Media Fallback** | Desktop & Mobile | CLS | `0.0002` | **`0.0002`** | Zero layout shift ($\le 0.0002$) |
| **Home Background Refresh Error** | Desktop & Mobile | Total Movement | Unmounts to alert | **`0.0000`** | Preserves visible cards |
| **Store Background Refresh Error**| Desktop & Mobile | Total Movement | Unmounts to alert | **`0.0000`** | Preserves visible grid |

All representative flows comfortably satisfy the **CLS $\le 0.1$** requirement.

---

## Causes and changes

1. **Route Loading Boundary (`apps/web/app/(inventory)/loading.tsx`)**:
   - *Cause*: Contained an artificial `h-4 w-28` eyebrow skeleton and a generic 3-column layout that did not match actual inventory page shells (which have no eyebrow above the title and use a 2-column grid), resulting in immediate title and layout jumps upon transition.
   - *Fix*: Aligned skeleton heading to `PageHeading` (`h-8 w-64 max-w-sm sm:h-9` and `h-5 w-full max-w-md`), removed nonexistent eyebrow, and matched page shell geometry.

2. **Home Dashboard (`apps/web/components/home-dashboard.tsx`)**:
   - *Cause*: Replaced layout with a simple 4-block skeleton stack that did not mirror the 5 distinct product sections (`Rediscovery`, `Spending`, `RecentItems`, `Wants`, `Goals`), causing large content repositioning when populated. Background refresh errors also unmounted the entire dashboard into an error Alert.
   - *Fix*: Introduced structured `HomeSkeleton` mirroring all 5 section cards with accurate card headers, footers, a 4:3 cover placeholder in Rediscovery, and a 2-column image grid in RecentItems without hardcoded fixed heights. Background refresh failures (`attempt > 0`) retain loaded state, keep cards interactable, and announce status politely without displacing controls.

3. **My Store (`apps/web/components/my-store.tsx`)**:
   - *Cause*: Skeletons had a single-line title placeholder while loaded cards render `line-clamp-2` titles. Background refresh errors destroyed the item grid.
   - *Fix*: Enhanced `StoreSkeleton` with a 2-line title placeholder (`h-4 w-3/4` and `h-3.5 w-1/2`) matching two-line clamp geometry. Strictly preserved `.store-grid` and `data-testid="store-skeleton"` to satisfy PER-92 smoke test contracts. Background refresh errors preserve existing item cards and announce errors politely.

4. **Spending Insights & Merchant Spending (`apps/web/components/spending-insights.tsx`, `merchant-spending.tsx`)**:
   - *Cause*: Changing filter groupings unmounted the active report while fetching, causing vertical collapse and expansion. Merchant spending used a flat unnested `h-32` box.
   - *Fix*: Preserved `activeReport` during query transitions (`aria-busy={isUpdating}`) so tables stay rendered. Added `spending-skeleton` and structured merchant card rows with `h-1.5` progress bar skeletons.

5. **Item Details & Attachments (`apps/web/components/item-details.tsx`, `item-attachments.tsx`, `photo-gallery.tsx`)**:
   - *Cause*: Photo gallery skeletons and document sections lacked Card structure wrappers and reserved containers for upload forms.
   - *Fix*: Aligned `DetailSkeleton` to 2-column responsive layout (Purchase card + Notes card on left, 4:3 Cover card + Documents card on right). Reserved document list and upload form container boundaries. Structured Photo Gallery skeletons in Card shells.

6. **Private Media Fallback (`packages/ui/src/components/havefolio/private-photo.tsx`)**:
   - *Cause*: Failed media fallback text could wrap or expand small containers, displacing card siblings. Retry button lacked immediate feedback.
   - *Fix*: Added `shrink-0` to `ImageOffIcon`, `overflow-hidden` with `line-clamp-2 max-w-full break-words text-xs sm:text-sm` to fallback text, and immediate `setStatus('loading')` on retry click.

---

## Evidence boundaries and verification

- **E2E Layout Shift Suite**: `apps/web/e2e/layout-shifts.spec.ts` and `apps/web/e2e/fixtures/measure-shifts.ts` verifying all 9 CLS and background refresh scenarios in both Desktop (1280px) and Mobile (390px) viewports:
  - 18 passing test cases across desktop and mobile.
- **Store Density Smoke Test Suite**: `apps/web/e2e/my-store.spec.ts` (12 passing tests, 8 skipped as designed in test suite).
- **Component Tests**: 490 tests passing (`pnpm test:components`).
- **Unit & Infrastructure Tests**: All unit and infrastructure tests passing (`pnpm test:unit`).
- **Monorepo Build**: `pnpm build` completed with 0 errors.
- **Linters & Formatters**: `pnpm lint` and `pnpm format:check` passing cleanly.
- **Visual Screenshots**: Saved in `docs/screenshots/per-88-*` covering loading skeletons, populated layouts, and broken media fallbacks across light and dark themes on desktop and mobile viewports.

### Limitations
- Measurements were gathered using headless Chromium automation on macOS. Physical mobile GPU rasterization, low-end Android scroll throttling, and variable mobile network latency jitter may introduce minor variance, but geometry reservation guarantees layout boundaries remain stable before and after assets resolve.
