# PER-97: Protected photo delivery and variant selection

Parent: PER-93. Baseline and harness: [PER-94](per-94-performance-baselines.md). This ticket owns photo source selection, delivery and media-specific tests. PER-95 owns bundle/hydration, PER-96 request orchestration, PER-88 geometry and PER-92 density smoke.

## Mechanism

PER-94 recorded 13 MiB desktop Store media transfers, incomplete mobile media windows and a 21.8 s mobile filter-after-load-more, but did not prove a cause. A new media audit (below) established it on the unchanged application build:

- Only two delivered variants exist: a 320 px thumbnail and a display variant up to 1600 px (the 4096 px original is never served). Store cards are square `object-fit: cover` slots of about 171 CSS px on a 390 px phone and 208–492 CSS px on desktop. Honest `sizes` hints need slightly more than 320 device pixels for almost every card, and Chromium then picks the smallest candidate that covers the slot, which is display.
- Result before the fix: Chromium chose display for every visible Store cover except desktop Compact — including every 171 px phone card at DPR 3. In the synthetic fixture a display file is 719 KiB versus 20 KiB for a thumbnail.
- On the throttled mobile profile (1.6 Mbit/s, 150 ms, local HTTP/1.1), 16 display requests started per Store load and none completed within the 15 s window. Tapping a Store card waited behind them: item details did not become ready within 30 s in any of five runs. The filter-after-load-more ran 21.8 s with 17 display downloads in flight; the search request was queued behind them.
- Not causes: client-side return to the Store refetched **zero** protected media (the in-document image cache is reused even with `no-store`), duplicate URLs within a load were zero, and the large-view thumbnail placeholder adds one 20 KiB request per large view. No cache-header change is therefore needed or made.

Causality was checked by changing only source selection and re-measuring the identical sequence: the filter dropped from 21.9 s to 0.55 s while display requests through the filter dropped from 17 to 0.

## Change

`gridSizes()` in `apps/web/components/photos-client.ts` applies one explicit grid policy: request at most 2× density, and accept up to 1.25× upscaling of the 320 px thumbnail before switching to display. Each slot in `sizes` is reported scaled (×0.8, or ×0.5333 from 2.5 dppx), so the browser's own candidate selection implements the policy and still chooses display for genuinely large slots. `sizes` does not affect layout here: covers are absolutely sized by their container, so PER-88 geometry is unchanged.

Applied to Store cards (all densities, both sidebar states), Home “Recently added” covers and photo-manager gallery tiles. The slot table in `store-density-config.ts` remains the honest source of truth; its e2e check now validates the unscaled slot and the selected variant. Large views (item details cover, gallery cover) keep honest `sizes`, the display variant and the thumbnail placeholder. Lazy/eager rules are unchanged (first four Store cards eager; Chromium already raises visible ones to High priority).

No API, header, cache, storage, provider, schema or migration change. Delivery remains authenticated, same-origin, `private, no-store`, `nosniff`, `no-referrer`, CORP same-origin and sandbox CSP; provider URLs never reach the browser. `PrivatePhoto` still uses a plain `img` and never the Next image optimiser. Upload limits, signature/MIME checks, EXIF stripping, cleanup and processing bounds are untouched (one upload processed at a time per API process in a child process with a 128 MiB heap, `sharp.concurrency(1)`, 10 s deadline; delivery at most eight concurrent provider reads per controller).

## Evidence

[Before/after tables](per-97-media-tables.md) from [before](per-97-media-before.json) and [after](per-97-media-after.json) numerical artifacts. Recipe, in a fresh worktree with no environment files:

```sh
pnpm install --frozen-lockfile
pnpm perf:build                         # at the before commit, then again at the after commit
pnpm perf:baseline --sizes=1000 --browser-only --media-audit
mv docs/testing/per-97-media.json docs/testing/per-97-media-<before|after>.json
node scripts/performance/media-report.mjs
```

The audit reuses the PER-94 isolation: disposable PostgreSQL cluster, synthetic owners and textured images, local storage adapter with real authenticated endpoints, loopback-only browser traffic, production `next build`/`next start`, compiled API, and refusal of environment files. It records variant labels, slot sizes, declared pixel widths, CDP encoded bytes, request priorities, duplicate counts and Chromium `ImageDecodeTask` time; URLs and traces are parsed in memory and never written. Profiles: desktop 1280×720 DPR 1; “retina” 1512×982 DPR 2; mobile 390×844 DPR 3, CPU 4×, 150 ms, 1.6/0.75 Mbit/s. Five cold repeats per scenario; Store at three densities × two sidebar states (mobile has no sidebar), item details, gallery, client-side return and the PER-94 rank-1 mobile sequence.

Builds: before `d0813186` (application identical to `origin/main` `b8d35bc`; only harness files added), after `2094eb3b`. Same host (Apple M4, 16 GiB, Node 24.18.0, PostgreSQL 18.6, Chromium 153.0.8010.12), fixture and recipe. Zero HTTP/runtime errors and zero CDP failures in both collections.

| Scenario (median of 5) | Before | After |
| --- | --- | --- |
| Mobile Store, visible covers complete | timed out in 5/5 (>15 s) | 3,954 ms (3,937–4,008) |
| Mobile Store → item details ready | censored in 5/5 (>30 s) | 1,363 ms (850–1,430) |
| Mobile filter after load-more | 21,855 ms (21,803–22,105) | 548 ms (516–822) |
| Mobile display-variant requests through that sequence | 17 | 0 |
| Desktop Comfortable Store cover bytes per load | 12,943 KiB | 366 KiB |
| Desktop Comfortable largest visible cover | 719 KiB | 20 KiB |
| Desktop Comfortable image decode | 148 ms | 5 ms |
| Desktop Large / retina Store / large views | display | display (unchanged by design or gap, below) |

## Budgets and quantified gaps

PER-94 budgets are proposals; none is claimed as a pass beyond what is measured here.

- **Covers ≤200 KiB each:** met for every grid cover now on the thumbnail (20 KiB in this fixture). Not met where display is still selected: desktop Large, every retina (2×) desktop density and the large views, at 719 KiB in this compression-heavy fixture. The fixture's display file is 1280 px; a real 4:3 upload's display file is 1600 px, so real display bytes depend on content and are not established here.
- **Store LCP ≤2,500 ms on mobile:** before, covers never painted inside the observation window, so the observed ~488 ms candidate was text and could not establish a pass. After, covers paint and become the candidate: mobile Store LCP is ~4,120 ms, a 1,620 ms gap. About 3,370 ms of it is page readiness before any cover request starts (client-rendered Store data on the throttled profile, PER-95/PER-96 scope); visible covers complete ~600 ms later. Nine offscreen lazy thumbnails (Chromium's lazy-load margin) now load in that window too. Fetch-priority or eager-count changes were not tried because no measurement isolated a gain.
- **Mobile media readiness:** mobile Store visible-cover completion is 3.95 s, within the proposed 5 s mobile ready threshold. Mobile gallery remains ~7.5 s because its large cover is intentionally the 719 KiB display variant.
- **Quality trade-off:** “supply” is the selected variant's pixel width ÷ device pixels needed to fill the slot including the square crop. After the change it is 0.47 for phone cards (0.70 at the 2× cap), 0.74–0.86 for desktop Comfortable and 1.15–1.19 for desktop Compact; Large stays at 2.8–3.7 (oversupplied display). Thumbnails are therefore modestly upscaled on phones and desktop Comfortable. This is a deliberate byte/latency trade-off within existing variants.
- **Retina desktop gap:** at DPR 2 every density still exceeds the policy and downloads display (11–21 MiB per Store load in this fixture). Closing this without blurring needs a middle variant (about 640–800 px). That requires a migration (the `media_variant_check` constraint allows only `original`, `display`, `thumbnail`), a processing change and a backfill of existing owner photos, so it is a follow-up needing explicit scope review, not part of this ticket.

## Security and behaviour checks

- New API integration test: foreign-item path, revoked session and deleted photo are denied for both variants (404/401/404); existing tests already cover anonymous 401, unknown photo 404, invalid/original variant 400, tampered bytes 503 without provider details, and the delivery headers.
- Unit test pins the policy outcomes and format; Store e2e checks real Chromium selection on 1× desktop and the 2.625× Pixel 7 profile, Large still choosing display, the unscaled slot still covering the real card, and unchanged image geometry in Compact, Comfortable and Large. Failed-image fallback, retry, lazy/eager counts and PER-92 density coverage are unchanged and still pass.
- Once Chromium has loaded display for an image (for example after switching to Large), it keeps reusing that file for smaller slots rather than refetching; the e2e check accounts for this.

## Not verified / limitations

Local loopback HTTP/1.1 with CDP throttling, not the deployed proxy, TLS, HTTP/2 or real devices; synthetic textured images, not real photographs; Chromium only (Safari/Firefox select from `srcset` with their own rules, and a browser without `min-resolution` support uses the ×0.8 entry, so a DPR 3 phone there still selects display, as before). Under HTTP/2 a Store page could open more than eight concurrent delivery requests and receive `PHOTO_DELIVERY_BUSY` (the limit counts provider reads only); this was not reproduced and is not changed. No production traffic, owner data or deployment was used.
