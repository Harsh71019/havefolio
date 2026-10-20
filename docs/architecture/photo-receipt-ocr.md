# PER-45: private photo and receipt OCR

Owners can ask Havefolio to read the text on a photo or receipt image already attached to an
item. Reading only ever **suggests** values; each field is applied, edited or rejected by an
explicit owner decision through the PER-43 review boundary. Manual entry never depends on it.

## Processing and provider decision

- **Local only.** Exactly pinned [tesseract.js](https://github.com/naptha/tesseract.js) 7.0.0
  (Apache-2.0, WebAssembly build of Tesseract with Leptonica) with English LSTM data from
  `@tesseract.js-data/eng` 1.0.0 (`4.0.0_best_int`, Apache-2.0 tessdata), plus the already
  pinned sharp 0.35.5 for decoding. tesseract.js otherwise downloads language data from a CDN:
  `langPath` points at the installed package and `cacheMethod: 'none'` prevents cache writes.
- **No external provider.** No image, receipt or recognised text leaves the worker. No new
  service, container, account, model prompt or network fetch other than the worker's
  existing private-storage read of the exact original. Any external OCR would need a separate
  provider-specific privacy decision and owner opt-in; none is configured or implied.
- **Opt-in per image.** Nothing runs at capture time. The owner presses "Read text" for one
  image; the page explains that reading happens on Havefolio's own server.
- **Off by default.** API `ENRICHMENT_OCR_ENABLED` advertises availability; worker
  `OCR_ENABLED` registers the adapter. Without both, the page says reading is not turned on and
  requests resolve as `unconfigured` exactly as in PER-43.

PDF receipts are not rendered or read (no PDF rasteriser is added); requests for them fail with
`ENRICHMENT_ATTACHMENT_UNSUPPORTED` and the page offers no read action. This narrows PER-43,
which accepted PDF receipt references but had no adapter to read them.

## Data flow and isolation

1. `POST /api/v1/items/:id/enrichment` stores `{ kind, attachmentId }` for a ready image
   original owned by the same owner, item and kind. Only that opaque ID is queued; no URL.
2. The worker claims the work (PER-43 locks, revision and attachment checks), then the adapter
   repeats the owner/item/kind/ready-image lookup and builds a 60-second signed download URL in
   memory only. Reads reject redirects, size mismatches and slow responses (10 s), and the
   SHA-256 checksum recorded at upload must match before any processing.
3. Two disposable children run one after another:
   - **prepare**: sharp decodes the sanitized WebP (24 MP input bound), scales to at most
     1600×2400 and 3.2 MP, greyscale, normalises and emits an 8-bit PNG;
   - **recognize**: Tesseract (LSTM, single-block segmentation) returns at most 200 lines of
     at most 300 characters with confidence and line height.
4. A pure domain interpreter (`packages/domain/src/ocr-suggestions.ts`) turns lines into at most
   five candidates; only those suggestions are stored, through PER-43's runtime validation.

Children use Node's permission model: no file writes (so no temporary files can exist), no
child processes, reads limited to their own compiled code, the worker manifest and dependency
store (so not the parent's `/proc/<pid>/environ`), an empty environment, input on stdin only,
bounded stdout and discarded stderr. sharp's native addon is outside the permission model
(`--allow-addons`); its boundary is the empty environment plus memory/time kills. Node 24 has no
network permission flag: the children hold no credentials and no code path fetches, and the
evaluation below ran in a `--network none` container.

| Bound | prepare | recognize |
| --- | --- | --- |
| V8 heap | 64 MiB | 64 MiB |
| RSS kill (sampled every 100 ms) | 112 MiB | 168 MiB |
| Wall-clock kill | 10 s | 15 s |
| Output | 8 MiB | 128 KiB |

The adapter deadline is 25 s including the read, below PER-43's 30 s lease (an optional
per-provider `timeoutMs`, clamped by `enrichmentLimits.maxTimeoutMs`). PER-43 concurrency (one
command per worker), three attempts, backoff and circuit breaker are unchanged. Buffers are
zeroed after use. Any failure leaves the item untouched and the work `failed`; telemetry carries
only the fixed `ENRICHMENT_PROVIDER_FAILED` token.

## Resource evidence (CT102 limits)

Measured in a Linux arm64 `node:24-bookworm-slim` container with the worker's limits
(`--cpus 0.5 --memory 256m`), read-only root and no network, using the deployed worker layout:

- preparation 67–98 MiB peak RSS, 0.1–0.8 s;
- recognition 129–147 MiB on the evaluation set and 139 MiB on a noisy 4096×3072 photo,
  1.0–3.1 s;
- whole container peak 137 MiB during the evaluation run.

The documented production worker uses 57–63 MiB, so worker plus one child at its kill threshold
stays under 256 MiB. Automatic layout analysis (PSM 3) found large logo text but needed
177–184 MiB on noisy photos, so single-block segmentation is used for both kinds. CT102 is amd64;
these arm64 timings are indicative, not a production benchmark. On macOS development machines,
RSS accounting is higher and very large originals may exceed the thresholds (safe failure).

The worker image grows by about 75 MB (WebAssembly core variants 43 MB, language data 13 MB,
sharp/libvips). CT102 disk headroom should be checked before release.

## Honest suggestions

Confidence is the recogniser's line confidence weighted by how direct the evidence is; it is
not a calibrated probability. The page shows *Clearly read* (≥ 0.85), *Check this* (≥ 0.60) or
*Unclear*, the source line and caveats, and the item's current value. Lines below 40 are
ignored. Rules:

- Only receipt work may suggest `pricePaid` or `purchaseDate` (enforced in domain validation
  and again at review); product photos and catalogue links never become a price paid.
- Currency must be printed on the receipt (₹/Rs/INR, USD/US$, EUR/€, GBP/£, AED, SGD). A bare
  `$` or mixed currencies yield no price. Amounts are parsed exactly with the shared money
  parser; extra precision or malformed grouping yields no price rather than rounding.
- With several item lines, each candidate keeps its own line amount (`line-amount`); the order
  total is never assigned to any of them. With one line, the receipt total is offered and
  labelled `order-total`. With none, a total is offered only as *Unclear*
  (`order-total-unmatched`). At most five lines are shown (`more-lines`).
- Dates keep only the precision the receipt proves: `03/04/2026` (either order possible) yields
  year `2026` with `date-order-unclear`; `Aug 2026` yields month precision; impossible or future
  dates are dropped; several unlabelled different dates yield none.
- Photo suggestions are limited to labelled model/brand lines; the largest text is offered as a
  name only as *Unclear*. Serial/IMEI/card/GSTIN/account lines are never used.
- Recognised text is untrusted data: control characters are stripped, it is rendered as plain
  text, never as markup, links or instructions, and no language model is involved.

## Contracts and migration

Additive extension of PER-43: review fields `pricePaid` (`"INR 129900"`: ISO 4217 code and
integer minor units) and `purchaseDate` (`2026`, `2026-08` or `2026-08-14`); work responses add
`inputKind` and the owner's own `attachmentId`; the page response adds `availableKinds` and
`providerStatus: 'available'`. Accepting a price applies the actual price paid and currency with
the same refund rules as manual edits (`CURRENCY_MISMATCH`, `REFUND_EXCEEDS_AMOUNT_PAID`).
Accepting a date sets precision and components; no day is invented. Snapshots now include both
fields. Forward-only migration `0024_receipt_review_fields` only widens
`enrichment_review_field_check`; existing history is unchanged. Unmerged PER-44 widens the same
constraint and allowlist; whichever merges second must regenerate its migration with the union.

## Retention, export and deletion

- Images: the original stays in private storage exactly as uploaded; derived greyscale images
  and recognised text exist only in child memory and are discarded when the child exits.
- Stored: only bounded candidate values with a short evidence snippet (≤ 160 characters) of the
  line that supports each suggestion, inside the existing `enrichment_work.candidates`.
- Decisions: append-only `enrichment_reviews` keeps previous and confirmed values; the item's
  original entry is untouched.
- Export includes these rows (existing column policy); item and account erasure cascade them.
  Nothing is cached in Valkey beyond PER-43's opaque work IDs, or in browser storage.

## Deployment effects (not performed)

Enabling requires a release with this code, migration 0024 via the migration role, and an
explicit operator decision to give the worker read access to private media: add the existing
Cloudinary values (or a dedicated key for the same environment) to the protected worker env file
and set `OCR_ENABLED=true` there and `ENRICHMENT_OCR_ENABLED=true` for the API. Today only the API
holds media credentials; the worker code path only signs downloads. Disable by removing both
flags. No container, limit, network or shared-service change is required.

## Evaluation (synthetic, labelled)

`apps/worker/test/fixtures/ocr/` holds 17 invented images (generator committed) and
`labels.json`. Ground truth records what each image supports at its real precision; a null
means any suggestion is an error. `node apps/worker/test/fixtures/ocr/evaluate.mjs` prints
field-level results; `test/ocr-evaluation.test.mjs` runs real OCR in CI and asserts that no
wrong value is shown as *Clearly read*, totals are never shared across lines, and photos never
yield money or dates.

The first run (13 fixtures) had three errors: a quantity `1` read as `i` leaked into a name; the
prominent-text guess reused a labelled line; and one label wrongly assumed day-first order for
`05/06/2026`, contradicting the stated date rule (label corrected). After the two interpreter
fixes, four held-out fixtures were added and evaluated once without further tuning.

| Field | Correct | Correctly absent | Wrong | Missing |
| --- | ---: | ---: | ---: | ---: |
| name | 23 | 3 | 0 | 0 |
| pricePaid | 22 | 2 | 0 | 0 |
| purchaseDate | 22 | 2 | 0 | 0 |
| brand | 1 | 0 | 0 | 0 |
| model | 1 | 0 | 0 | 1 |

Held-out receipts (Courier `2 x 225.00` line, degraded phone photo, EUR) were fully correct. The
held-out sparse product label yielded no suggestions: single-block recognition produced text at
confidence 0–32, which was discarded rather than shown. Synthetic printed text is far easier than
real thermal receipts, handwriting, creases, glare and non-English text; real-world accuracy is
unmeasured and expected to be lower. Model numbers containing spaces are truncated by design.

## Verification

Domain tests cover canonical values, receipt-only fields, totals, currencies, precision and
untrusted text. Worker tests cover sandbox denial (writes, spawn, parent environ, unrelated
reads), deadline/RSS/output/abort kills, checksum and scope checks, read bounds, telemetry
redaction, and the real-OCR evaluation; worker integration covers owner/item/kind/deleted-media
scoping through PostgreSQL. API integration covers availability, PDF refusal, ownership,
explicit review of money/dates, refund invariants, staleness, history and export. Component and
Playwright tests cover the review page, accessibility in both themes and screenshots
(`docs/screenshots/per-45-*`). No live storage read, production deployment or real receipt was
used.
