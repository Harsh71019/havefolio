# PER-73: metadata survives collapsed Additional details

## Reproduction and decision

Reproduced on `origin/main` at `36080adb699627fb0fc31bc8d3e444a413d64545` before changing the form. The component regression expands Additional details, chooses Gift, Worn out and Rarely, collapses with Space and submits. Main omits all three selected fields. A second regression shows that opening untouched details changes the request to Bought/Working/Often.

The capture blueprint's unconditional-send example would infer the displayed defaults for untouched fields. PER-73's acceptance criteria require preserving existing omission/unknown semantics. The form therefore stores `undefined` until an owner selects a value, independently for each field. The existing labels remain placeholders; explicitly choosing even the displayed default records it. Opening/closing the disclosure changes visibility only. The API continues to persist omitted metadata as `unknown`.

Selected metadata counts as a consented draft edit even without a name. Draft restore, retry, discard and add-another use the same selection semantics. Existing command IDs, draft consent, price/date handling and enrichment behavior are retained. No schema, API implementation, page wrapper, theme, upload or deployment change.

## Evidence boundaries

- `apps/web/test/add-item.test.tsx`: rendered React form with mocked fetch. Asserts collapsed requests, identical lost-response retry payload/command, unchanged selections on reopen, untouched omission with zero/one/two disclosure toggles, explicit default selection, reset and metadata-only consented draft restore.
- `apps/api/test/items.e2e-spec.ts`: real Nest HTTP and disposable PostgreSQL/Valkey through `IntegrationRun`. Asserts POST/replay identity, GET values, database row values, untouched unknown semantics and no inferred price for a gift.
- `apps/web/e2e/collapsed-metadata.spec.ts`: production web build in Chromium desktop/mobile projects. Exercises Enter/Space and focus, hidden controls, expand/select/collapse/save, a response lost after creation, reopen, retry and exactly one item per command. Default smoke runs use a mocked HTTP fixture. Optional `PER73_TEST_API` (loopback only) and `PER73_TEST_COOKIE` connect the same flow to an isolated real test API; they must never target production or an owner's session.

Browser checks cover 360/390/768/1280/1512/1920 px without horizontal overflow. Screenshots show synthetic selections retained after the deliberately lost save response, in desktop/mobile light/dark. Filename suffixes distinguish `mock-api` from `real-api`. Keyboard evidence is automated Chromium evidence; manual screen-reader, physical-device and authenticated production journeys are unverified.

PR #65 (PER-44) was open at `1fc52c943348143fe1e13f2326a1f21722f20f2f` during implementation. Its changed-file list did not include `add-item-form.tsx`; no enrichment code was copied. Recheck merge status before integration.

## Re-running the real browser bridge

Build with `pnpm build` and provide the same dedicated `TEST_*` settings used by the integration suite (separate runtime/migration roles, a disposable `*_test` database, and test-only Valkey ACLs). Then run:

```sh
pnpm --filter @havefolio/api exec node test/collapsed-metadata-browser.mjs
```

The harness starts a real Nest API in a fresh `IntegrationRun` schema, inserts a synthetic owner/session, passes that session only to the child browser process, runs both browser projects and checks the database contains exactly two gifts. The browser asserts request bodies, identical retries, POST replay and a fresh GET result. The schema and session are removed in `finally`. HTTP routing bridges the production web build to the local test API; it does not replace item persistence. Preference reads are unavailable in this minimal harness and safely use the existing INR fallback. Screenshots from this run use the `real-api` suffix.
