# PER-97 protected-photo media audit tables

Before: source `d0813186f6e138d607483c2184c571d36d789ca5`, build `R8y3jSRuhdiRlc20k4DWG`, fingerprint `a588312a8a4b…`, measured 2026-10-22T16:09:34.688Z, Chromium 153.0.8010.12, 5 repeats.
After: source `2094eb3ba3e6439defda29dc803da1968e67922a`, build `I9o8JO97W6fwBumyeWjDu`, fingerprint `3bf9550d6fec…`, measured 2026-10-22T16:23:00.450Z, Chromium 153.0.8010.12, 5 repeats.
Host: Apple M4, 10 logical CPUs, 16 GiB, darwin/arm64, Node v24.18.0, postgres (PostgreSQL) 18.6 (Homebrew).

Cells are median (minimum–maximum) over the repeats; a trailing n/5 counts completed observations when some were censored. Every observation is cold (cache disabled) — private `no-store` media refetch on every document load anyway. "Media ready" is navigation start to every visible owner photo complete, bounded at 15 s; "timed out" counts windows that hit that bound. Cover KiB are CDP encoded bytes for completed protected-photo responses (thumbnail + display) in the observation window, including offscreen lazy images the browser chose to fetch. Supply is the selected variant’s declared pixel width ÷ device pixels needed to fill the slot with `object-fit: cover` (1 = exact; <1 = upscaled). Decode is Chromium `ImageDecodeTask` time from an in-memory trace.

| Profile | View | Density / sidebar | Visible covers thumb/display (before → after) | Media ready ms before | after | Timed out before → after | Cover KiB before | after | Largest cover KiB before → after | Supply after (min–max) | Decode ms before → after | Errors before → after |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| desktop | store | compact / expanded | 6/0 → 6/0 | 201 (199–244) | 196 (179–244) | 0 → 0 | 528 (528–528) | 528 (528–528) | 20 → 20 | 1.15–1.15 | 8.1 → 8.5 | 0 → 0 |
| desktop | store | compact / collapsed | 8/0 → 8/0 | 203 (197–204) | 202 (165–209) | 0 → 0 | 569 (569–569) | 569 (569–569) | 20 → 20 | 1.19–1.19 | 14.9 → 13.9 | 0 → 0 |
| desktop | store | comfortable / expanded | 0/2 → 2/0 | 202 (176–204) | 199 (171–200) | 0 → 0 | 12943 (12943–12943) | 366 (366–366) | 719 → 20 | 0.74–0.74 | 148.2 → 5.0 | 0 → 0 |
| desktop | store | comfortable / collapsed | 0/6 → 6/0 | 174 (169–206) | 196 (165–219) | 0 → 0 | 18695 (18695–18695) | 528 (528–528) | 719 → 20 | 0.86–0.86 | 219.8 → 7.9 | 0 → 0 |
| desktop | store | large / expanded | 0/2 → 0/2 | 190 (171–210) | 203 (185–224) | 0 → 0 | 12943 (12943–12943) | 12943 (12943–12943) | 719 → 719 | 3.70–3.70 | 148.8 → 151.8 | 0 → 0 |
| desktop | store | large / collapsed | 0/2 → 0/2 | 199 (187–211) | 195 (165–203) | 0 → 0 | 10067 (10067–10067) | 10067 (10067–10067) | 719 → 719 | 2.80–2.80 | 144.8 → 143.7 | 0 → 0 |
| desktop | item | — | 0/1 → 0/1 | 160 (157–203) | 175 (140–203) | 0 → 0 | 739 (739–739) | 739 (739–739) | 719 → 719 | 4.82–4.82 | 36.9 → 36.5 | 0 → 0 |
| desktop | gallery | — | 2/0 → 2/0 | 152 (133–153) | 135 (132–157) | 0 → 0 | 20 (20–20) | 20 (20–20) | 20 → 20 | 1.00–1.07 | 1.4 → 1.4 | 0 → 0 |
| retina | store | compact / expanded | 0/12 → 0/12 | 189 (170–225) | 204 (170–219) | 0 → 0 | 20133 (20133–20133) | 20133 (20133–20133) | 719 → 719 | 2.88–2.88 | 572.2 → 567.9 | 0 → 0 |
| retina | store | compact / collapsed | 0/15 → 0/15 | 191 (169–238) | 203 (168–206) | 0 → 0 | 20852 (20852–20852) | 20852 (20852–20852) | 719 → 719 | 2.95–2.95 | 705.6 → 707.6 | 0 → 0 |
| retina | store | comfortable / expanded | 0/6 → 0/6 | 192 (170–205) | 202 (170–209) | 0 → 0 | 18695 (18695–18695) | 18695 (18695–18695) | 719 → 719 | 2.10–2.10 | 330.1 → 328.5 | 0 → 0 |
| retina | store | comfortable / collapsed | 0/8 → 0/8 | 202 (173–208) | 188 (168–206) | 0 → 0 | 19414 (19414–19414) | 19414 (19414–19414) | 719 → 719 | 2.31–2.31 | 434.1 → 434.6 | 0 → 0 |
| retina | store | large / expanded | 0/4 → 0/4 | 197 (166–238) | 192 (167–204) | 0 → 0 | 11505 (11505–11505) | 11505 (11505–11505) | 719 → 719 | 1.36–1.36 | 150.2 → 145.5 | 0 → 0 |
| retina | store | large / collapsed | 0/6 → 0/6 | 200 (169–209) | 203 (171–225) | 0 → 0 | 17976 (17976–17976) | 17976 (17976–17976) | 719 → 719 | 1.69–1.69 | 323.7 → 324.6 | 0 → 0 |
| retina | item | — | 0/1 → 0/1 | 160 (153–174) | 154 (146–194) | 0 → 0 | 739 (739–739) | 739 (739–739) | 719 → 719 | 2.41–2.41 | 36.8 → 36.4 | 0 → 0 |
| retina | gallery | — | 0/2 → 0/2 | 136 (135–149) | 134 (134–155) | 0 → 0 | 739 (739–739) | 739 (739–739) | 719 → 719 | 2.12–2.50 | 38.1 → 37.2 | 0 → 0 |
| mobile | store | compact / expanded | 0/4 → 4/0 | — (0/5) | 3989 (3937–4090) | 5 → 0 | 0 (0–0) | 264 (244–264) | 0 → 20 | 0.47–0.47 | 0.0 → 6.8 | 0 → 0 |
| mobile | store | comfortable / expanded | 0/4 → 4/0 | — (0/5) | 3954 (3937–4008) | 5 → 0 | 0 (0–0) | 264 (244–264) | 0 → 20 | 0.47–0.47 | 0.0 → 6.7 | 0 → 0 |
| mobile | store | large / expanded | 0/4 → 4/0 | — (0/5) | 3987 (3934–4028) | 5 → 0 | 0 (0–0) | 264 (244–264) | 0 → 20 | 0.47–0.47 | 0.0 → 6.8 | 0 → 0 |
| mobile | item | — | 0/0 → 0/0 | 3439 (3388–3498) | 3435 (3415–3442) | 0 → 0 | 20 (20–20) | 20 (20–20) | 20 → 20 | — | 0.0 → 0.0 | 0 → 0 |
| mobile | gallery | — | 0/2 → 1/1 | 7489 (7476–7503) | 7487 (7485–7519) | 0 → 0 | 739 (739–739) | 739 (739–739) | 719 → 719 | 0.47–1.73 | 36.8 → 36.5 | 0 → 0 |

## Client-side return to the Store

Open the first Store card, wait for item details, then go back in the same document. A censored item open exceeded the 30 s readiness guard and is reported as missing.

| Profile | Store → item open ms before | after | Protected media requests on return before → after | Requests in flight at open before → after |
| --- | --- | --- | --- | --- |
| desktop | 120 (113–865) | 112 (98–828) | 0 (0–0) → 0 (0–0) | 0 (0–0) → 0 (0–1) |
| retina | 118 (107–120) | 110 (103–119) | 0 (0–0) → 0 (0–0) | 0 (0–0) → 0 (0–0) |
| mobile | — (0/5) | 1363 (850–1430) | — (0/0) → 0 (0–0) | 4 (4–4) → 1 (0–1) |

## PER-94 rank-1 mobile sequence

Home → Store navigation, Show more items, then a search filter on the throttled mobile profile (390×844, DPR 3, CPU 4×, 150 ms, 1.6 Mbit/s). Scripted lab latency, not field INP.

| Measure | Before | After |
| --- | --- | --- |
| Navigation ms | 1375 (985–1420) | 1386 (1028–1397) |
| Load more ms | 101 (101–116) | 100 (99–116) |
| Filter after load more ms | 21855 (21803–22105) | 548 (516–822) |
| Protected photo requests in flight when filtering | 17 (17–17) | 18 (18–18) |
| Cover KiB completed before filtering | 0 (0–0) | 0 (0–0) |
| Display-variant requests through filter | 17 (17–17) | 0 (0–0) |
| Errors + failed/cancelled requests | 0 (0–0) | 0 (0–0) |
