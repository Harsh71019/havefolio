# PER-94 numerical baseline tables

Build source: `2016fc40445d7d68a677d813b43e6772d3b357d7`; fingerprint: `6437b9576304162c488a1aa5b9d270635b1b41b6412c21dd4209778fe7a78bbe`.
Measured at 2026-10-21T13:51:13.791Z; Apple M4, 10 logical CPUs, 16 GiB; darwin/arm64; Node v24.18.0; postgres (PostgreSQL) 18.6 (Homebrew); Chromium 153.0.8010.12.
Build ID: `VR8hjN8mP5qlS93PKJMBV`. Source dirty: true; see recipe for added harness files and source boundaries. Fixture cleanup: true; cluster cleanup: true.

Browser values are median (minimum–maximum), five repeats per cell. These extrema are descriptive variability, not confidence intervals. Censored readiness is excluded and its completed n/5 is shown. LCP with an incomplete-media count is only an observed candidate and cannot establish a pass. Transfers include completed resources only.

| Items/owner | Profile | Route | Cache | Ready ms | LCP ms | JS KiB | Total KiB | Requests | Long task ms | HTTP/JS errors / CDP failures-cancellations / incomplete media windows |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1000 | desktop | home | cold | 173 (172–254) n=5/5 | 116 (116–212) | 455.6 | 534.1 | 66 (66–66) | 0 (0–0) | 0 / 30 / 0 |
| 1000 | desktop | home | warm | 104 (103–106) n=5/5 | 76 (72–88) | 0.0 | 52.1 | 66 (66–66) | 0 (0–0) | 0 / 30 / 0 |
| 1000 | desktop | store | cold | 172 (157–190) n=5/5 | 312 (276–344) | 477.1 | 13487.9 | 92 (92–92) | 0 (0–0) | 0 / 38 / 0 |
| 1000 | desktop | store | warm | 119 (109–125) n=5/5 | 252 (228–292) | 0.0 | 12982.9 | 92 (92–92) | 0 (0–0) | 0 / 37 / 0 |
| 1000 | desktop | item | cold | 149 (147–193) n=5/5 | 320 (300–364) | 494.1 | 1296.2 | 73 (73–73) | 0 (0–0) | 0 / 14 / 0 |
| 1000 | desktop | item | warm | 114 (108–116) n=5/5 | 248 (92–268) | 0.0 | 783.7 | 73 (73–73) | 0 (0–0) | 0 / 17 / 0 |
| 1000 | desktop | add | cold | 157 (140–174) n=5/5 | 24 (24–28) | 477.1 | 534.8 | 65 (65–65) | 0 (0–0) | 0 / 0 / 0 |
| 1000 | desktop | add | warm | 105 (104–107) n=5/5 | 36 (36–40) | 0.0 | 32.3 | 65 (65–65) | 0 (0–0) | 0 / 0 / 0 |
| 1000 | desktop | insights | cold | 188 (173–191) n=5/5 | 28 (28–28) | 455.6 | 515.2 | 62 (62–62) | 0 (0–0) | 0 / 0 / 0 |
| 1000 | desktop | insights | warm | 128 (112–130) n=5/5 | 24 (20–28) | 0.0 | 33.8 | 62 (62–62) | 0 (0–0) | 0 / 0 / 0 |
| 1000 | mobile | home | cold | 3338 (3336–3346) n=5/5 | 480 (480–516) | 423.5 | 476.7 | 53 (53–53) | 120 (111–124) | 0 / 0 / 0 |
| 1000 | mobile | home | warm | 584 (575–586) n=5/5 | 240 (204–244) | 0.0 | 26.8 | 53 (53–53) | 0 (0–0) | 0 / 0 / 0 |
| 1000 | mobile | store | cold | 3336 (3335–3339) n=5/5 | 476 (476–480) | 365.1 | 413.9 | 67 (67–67) | 205 (201–210) | 0 / 0 / 5 |
| 1000 | mobile | store | warm | 1067 (585–1077) n=5/5 | 192 (192–200) | 0.0 | 21.0 | 67 (63–67) | 60 (58–63) | 0 / 0 / 5 |
| 1000 | mobile | item | cold | 3420 (3418–3437) n=5/5 | 3220 (3208–3228) | 455.1 | 527.3 | 58 (58–58) | 126 (123–129) | 0 / 0 / 0 |
| 1000 | mobile | item | warm | 578 (574–590) n=5/5 | 508 (500–512) | 0.0 | 55.1 | 58 (58–58) | 0 (0–0) | 0 / 0 / 0 |
| 1000 | mobile | add | cold | 3403 (3385–3413) n=5/5 | 472 (468–492) | 443.0 | 489.4 | 53 (53–53) | 203 (199–206) | 0 / 0 / 0 |
| 1000 | mobile | add | warm | 1058 (1058–1071) n=5/5 | 196 (196–244) | 0.0 | 20.9 | 53 (53–53) | 0 (0–0) | 0 / 0 / 0 |
| 1000 | mobile | insights | cold | 3337 (3302–3346) n=5/5 | 476 (476–496) | 416.6 | 464.7 | 49 (49–49) | 262 (258–264) | 0 / 0 / 0 |
| 1000 | mobile | insights | warm | 658 (574–1124) n=5/5 | 200 (196–248) | 0.0 | 22.4 | 49 (49–49) | 92 (87–95) | 0 / 0 / 0 |

## Scripted interactions

Confirmed results include network, Playwright actionability, scrolling and two-frame observation overhead. They are not field INP or immediate-acknowledgement latency.

| Items/owner | Profile | Action | n | Latency ms median (range) |
| --- | --- | --- | --- | --- |
| 1000 | desktop | navigation | 5 | 183 (166–184) |
| 1000 | desktop | load-more | 5 | 67 (66–67) |
| 1000 | desktop | filter | 5 | 86 (72–91) |
| 1000 | desktop | save-feedback | 5 | 78 (78–79) |
| 1000 | mobile | navigation | 5 | 1400 (1399–1401) |
| 1000 | mobile | load-more | 5 | 100 (98–100) |
| 1000 | mobile | filter | 5 | 21801 (21789–21815) |
| 1000 | mobile | save-feedback | 5 | 264 (248–268) |

## Warm API samples

API-only tiers began 2026-10-21T14:02:52.287Z; the representative full run began 2026-10-21T13:51:13.791Z. The same compiled build is verified.
Every row: 20 warmups then 1,000 completed requests. Raw numerical samples, errors, root plan summaries and sampled waits remain in the JSON artifact. Pool/lock values are statement/connection distributions, not request-level exclusive durations.

| Items/owner | Endpoint | Concurrency | p50 ms | p95 ms | p99 ms | Errors | Pool p95 ms | Owner-lock round trip p95 ms | Sampled Lock sessions / snapshots |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 100 | home | 1 | 3.953 | 4.217 | 4.69 | 0 | 0.013 | 1.792 | 205 / 196 |
| 100 | home | 4 | 8.543 | 9.175 | 10.783 | 0 | 4.024 | 2.209 | 508 / 107 |
| 100 | items | 1 | 2.858 | 3.199 | 3.552 | 0 | 0.009 | 0.112 | 0 / 141 |
| 100 | items | 4 | 2.284 | 3.196 | 4.475 | 0 | 0.005 | 0.951 | 61 / 29 |
| 100 | filtered | 1 | 3.141 | 3.578 | 5.333 | 0 | 0.009 | 0.095 | 0 / 156 |
| 100 | filtered | 4 | 4.448 | 5.332 | 6.262 | 0 | 0.005 | 2.119 | 142 / 56 |
| 100 | facets | 1 | 3.077 | 3.306 | 3.551 | 0 | 0.007 | 0.101 | 0 / 151 |
| 100 | facets | 4 | 2.837 | 3.577 | 4.457 | 0 | 0.004 | 1.3 | 77 / 36 |
| 100 | item | 1 | 2.728 | 3.603 | 4.417 | 0 | 0.013 | 0.149 | 0 / 132 |
| 100 | item | 4 | 1.903 | 2.737 | 3.574 | 0 | 0.124 | 0.498 | 15 / 23 |
| 100 | spending | 1 | 2.824 | 3.119 | 4.133 | 0 | 0.008 | 0.121 | 0 / 138 |
| 100 | spending | 4 | 2.5 | 3.006 | 4.068 | 0 | 0.005 | 1.027 | 53 / 32 |
| 100 | merchants | 1 | 2.907 | 3.263 | 3.627 | 0 | 0.009 | 0.13 | 0 / 143 |
| 100 | merchants | 4 | 2.457 | 2.932 | 4.043 | 0 | 0.005 | 1.014 | 51 / 31 |
| 1000 | home | 1 | 5.252 | 5.839 | 6.506 | 0 | 0.016 | 2.959 | 357 / 263 |
| 1000 | home | 4 | 13.354 | 14.591 | 16.484 | 0 | 6.44 | 3.409 | 778 / 169 |
| 1000 | items | 1 | 3.001 | 3.37 | 3.867 | 0 | 0.01 | 0.109 | 0 / 148 |
| 1000 | items | 4 | 2.407 | 3.366 | 5.132 | 0 | 0.006 | 1.03 | 54 / 31 |
| 1000 | filtered | 1 | 4.812 | 5.081 | 5.378 | 0 | 0.006 | 0.08 | 0 / 238 |
| 1000 | filtered | 4 | 13.145 | 14.796 | 24.106 | 0 | 0.007 | 6.589 | 451 / 166 |
| 1000 | facets | 1 | 3.761 | 3.922 | 4.049 | 0 | 0.006 | 0.083 | 0 / 185 |
| 1000 | facets | 4 | 7.213 | 8.712 | 18.496 | 0 | 0.007 | 3.565 | 230 / 94 |
| 1000 | item | 1 | 2.744 | 3.375 | 4.504 | 0 | 0.013 | 0.144 | 0 / 136 |
| 1000 | item | 4 | 1.584 | 2.909 | 3.585 | 0 | 0.116 | 0.49 | 15 / 23 |
| 1000 | spending | 1 | 3.384 | 3.602 | 3.77 | 0 | 0.007 | 0.093 | 0 / 164 |
| 1000 | spending | 4 | 4.802 | 5.229 | 5.987 | 0 | 0.006 | 2.244 | 89 / 60 |
| 1000 | merchants | 1 | 3.398 | 3.71 | 4.15 | 0 | 0.008 | 0.099 | 0 / 167 |
| 1000 | merchants | 4 | 4.538 | 4.945 | 6.394 | 0 | 0.005 | 2.14 | 73 / 57 |
| 10000 | home | 1 | 15.628 | 16.631 | 20.52 | 0 | 0.012 | 13.653 | 1770 / 779 |
| 10000 | home | 4 | 56.273 | 59.295 | 64.075 | 0 | 27.864 | 14.185 | 3314 / 700 |
| 10000 | items | 1 | 2.965 | 3.244 | 3.579 | 0 | 0.009 | 0.113 | 0 / 144 |
| 10000 | items | 4 | 2.31 | 3.382 | 4.609 | 0 | 0.005 | 0.984 | 65 / 30 |
| 10000 | filtered | 1 | 26.463 | 27.673 | 29.193 | 0 | 0.01 | 0.092 | 0 / 1280 |
| 10000 | filtered | 4 | 104.681 | 116.929 | 136.155 | 0 | 0.014 | 52.106 | 3735 / 1280 |
| 10000 | facets | 1 | 9.035 | 9.643 | 10.061 | 0 | 0.008 | 0.084 | 0 / 452 |
| 10000 | facets | 4 | 29.686 | 31.253 | 35.733 | 0 | 0.007 | 14.885 | 1044 / 370 |
| 10000 | item | 1 | 2.513 | 3.956 | 4.92 | 0 | 0.013 | 0.155 | 0 / 127 |
| 10000 | item | 4 | 2.161 | 2.762 | 3.985 | 0 | 0.109 | 0.474 | 24 / 24 |
| 10000 | spending | 1 | 9.419 | 10.643 | 11.206 | 0 | 0.009 | 0.091 | 0 / 468 |
| 10000 | spending | 4 | 31.42 | 33.075 | 38.905 | 0 | 0.007 | 15.825 | 1028 / 388 |
| 10000 | merchants | 1 | 8.735 | 9.415 | 10.278 | 0 | 0.007 | 0.087 | 0 / 432 |
| 10000 | merchants | 4 | 28.622 | 30.642 | 42.368 | 0 | 0.007 | 14.433 | 935 / 357 |

## Separate warm server plans and mixed-owner service samples

Execution attribution gap: the collector captures SELECT-prefixed statements only. CTE-prefixed domain aggregates are excluded. Spending/merchant plan rows below cover the auth lookup only; they do not measure the aggregate SQL execution. HTTP timings include the complete endpoint. Home plans are bounded to ten representative SELECTs. Complete domain CTE plans remain open under PER-99.

| Items/owner | Endpoint (concurrency 1) | Representative SELECT plans | Largest execution ms | Largest root shared hits / reads |
| --- | --- | --- | --- | --- |
| 100 | home | 10 | 1.423 | 12 / 0 |
| 100 | items | 4 | 0.069 | 13 / 0 |
| 100 | filtered | 4 | 0.454 | 13 / 0 |
| 100 | facets | 8 | 0.101 | 12 / 0 |
| 100 | item | 3 | 0.035 | 3 / 0 |
| 100 | spending | 1 | 0.032 | 1 / 0 |
| 100 | merchants | 1 | 0.034 | 1 / 0 |
| 1000 | home | 10 | 1.344 | 56 / 0 |
| 1000 | items | 4 | 0.05 | 12 / 0 |
| 1000 | filtered | 4 | 2.453 | 33 / 0 |
| 1000 | facets | 8 | 0.507 | 56 / 0 |
| 1000 | item | 3 | 0.032 | 3 / 0 |
| 1000 | spending | 1 | 0.022 | 1 / 0 |
| 1000 | merchants | 1 | 0.023 | 1 / 0 |
| 10000 | home | 10 | 1.446 | 287 / 0 |
| 10000 | items | 4 | 0.044 | 12 / 0 |
| 10000 | filtered | 4 | 25.231 | 290 / 0 |
| 10000 | facets | 8 | 4.374 | 293 / 0 |
| 10000 | item | 3 | 0.04 | 3 / 0 |
| 10000 | spending | 1 | 0.018 | 1 / 0 |
| 10000 | merchants | 1 | 0.019 | 1 / 0 |

100 items/owner, Home service alternating owners, c4, n=1000: p50/p95/p99 3.223/4.384/7.438 ms, 0 errors. Excludes HTTP/authentication.

1000 items/owner, Home service alternating owners, c4, n=1000: p50/p95/p99 6.858/7.2/7.99 ms, 0 errors. Excludes HTTP/authentication.

10000 items/owner, Home service alternating owners, c4, n=1000: p50/p95/p99 28.644/30.128/31.22 ms, 0 errors. Excludes HTTP/authentication.
