# PER-72: validation-summary focus recovery

## Reproduction

Source baseline: `origin/main` at `e91ca45` (including merged PER-73 and PER-92). The same 14-case rendered-form set reports 13 failures and one pass on the unchanged baseline: date and purchase-URL links have no matching control; collapsed optional fields are unmounted; waiting-date and photo keys have no control; category uses a different generated ID. Date/optional fields also lack matching accessible error associations. The description validator can reject restored text, although the form has no description editor.

The baseline Chromium harness explicitly confirmed a missing date target and a still-collapsed waiting panel in desktop/mobile projects (4 expected-defect passes). These are synthetic HTTP fixtures against a real production Next build, not production owner sessions. Before screenshots capture that failed recovery; after screenshots capture the visible invalid control after activation.

## Target contract

| Form | Validation key | Focus target / disclosure |
| --- | --- | --- |
| Add item | name, price | Corresponding input |
| Add item | date, exact precision | DD/MM/YYYY text input, not the native hidden picker |
| Add item | date, month precision | Year input when year is invalid; otherwise month select trigger |
| Add item | date, year precision | Year-only input |
| Add item | category | Category select trigger, including an unmatched restored subcategory when taxonomy is unavailable |
| Add item | purchaseUrl | PurchaseSourceFields URL input, sharing the form ID prefix and inline error ID |
| Add item | brand, model, description, notes | Reveal Additional details, then the corresponding input/textarea |
| Add want | name | Name input |
| Add want | price, productUrl, reason | Reveal the matching panel, then its input/textarea |
| Add want | waiting | Reveal Waiting period, then the custom local date/time input |
| Add want | photo | Reveal Private photo, then the visible Choose photo button that opens the existing private file picker |

Form-specific mapping remains beside the form. Existing registry components are reused. The description textarea exposes the existing draft/payload field so its validation error can be corrected; no domain rule or data representation changes. An unmatched restored category retains a focusable correction control and the existing taxonomy retry button during an outage.

Disclosures commit synchronously before focus. Validation itself commits the summary before immediately focusing it: the former 50 ms timeout could steal focus back after fast link activation, reproduced during the full component suite. Links retain native Enter activation and pointer click semantics. The helper focuses with `preventScroll` and performs one centred scroll; reduced motion uses `instant`. Existing PER-85 mobile scroll padding and navigation geometry are unchanged.

Inline errors use unique form-prefixed IDs, `aria-invalid` and `aria-describedby`; the summary retains its alert/live-region semantics. URL help remains associated alongside its error. Want link/reason controls now have accessible names. The photo chooser is a registry Button connected to the existing hidden input, avoiding focus on an invisible file control.

PER-73's metadata state, payload, dirty detection, drafts and retry/command behavior are unchanged. No backend, schema, migration, upload pipeline, navbar policy, enrichment or deployment changes. PER-71 is excluded. Ownership coordination is recorded on Kan: PER-86 owns keyboard/viewport policy and PER-88 owns loading/media geometry; this change owns validation targets and associations only.

## Verification and boundaries

- `apps/web/test/validation-summary.test.tsx`: 14 focused rendered-form cases cover every error key, exact/month/year precision, invalid restored month, expanded/collapsed panels, pointer and Enter activation, actual active element, visible controls, accessible error text, unique IDs, retained text/metadata, zero POST saves during validation, reduced motion and taxonomy outage recovery. Overlong-field fixtures bypass HTML length restrictions deliberately to exercise existing defensive validators and restored drafts.
- `apps/web/e2e/validation-summary.spec.ts`: 6 Chromium cases across desktop/mobile projects. Exercises real pointer/keyboard events, production form rendering, collapsed panels, active element, visible errors, retained text/Gift metadata, no POST on invalid forms, unique IDs and control bounds above the fixed mobile navigation. Responsive matrix: 360/390/768/1280/1512/1920 px; all three shipped palette CSS states, light/dark, desktop sidebar states and reduced/normal motion. Palette CSS states are applied synthetically; appearance persistence remains covered by the existing appearance suite.
- Existing PER-73 component/browser regressions continue to cover confirmed save/retry with selected metadata and duplicate-save prevention. Existing broader accessibility, capture, theme and reflow tests remain in the required suite.
- Local gates passed: lint, formatting, types, unit/infra, migration-history check, production build, 489/489 components with `--maxWorkers=2`, 349 browser cases (69 existing skips), and all real-HTTP proxy checks. All 6 dedicated browser cases passed again after the final production rebuild. An unrestricted local component rerun during concurrent compilers had 14 failures in 4 existing suites; the complete bounded run passed without changing tests, retries or timeouts. Exact-head CI must also pass isolated API/worker integration before Code Review. Local dedicated integration credentials are unavailable; no shared or production service is used as a substitute.

Manual screen-reader announcements, physical iOS/Android software-keyboard behavior, authenticated live acceptance and production are unverified. Automated focus/ARIA evidence does not establish those manual results. No deployment or Done claim.

## Synthetic screenshots

All images use mocked owner-scoped APIs, never private owner data:

- [Before item, desktop](../screenshots/per-72-before-item-desktop-mock-api.png) / [after](../screenshots/per-72-after-item-desktop-mock-api.png)
- [Before item, mobile](../screenshots/per-72-before-item-mobile-mock-api.png) / [after](../screenshots/per-72-after-item-mobile-mock-api.png)
- [Before want, desktop](../screenshots/per-72-before-want-desktop-mock-api.png) / [after](../screenshots/per-72-after-want-desktop-mock-api.png)
- [Before want, mobile](../screenshots/per-72-before-want-mobile-mock-api.png) / [after](../screenshots/per-72-after-want-mobile-mock-api.png)
