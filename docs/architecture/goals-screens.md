# Goals and money-alternatives screens (PER-32)

PER-32 is web-only. It consumes the merged PER-30 goals API and the PER-31 allocation flow without new endpoints, migrations, ledgers, queues or infrastructure. Shared changes are limited to additive `Goal*` wire types in `@havefolio/contracts`, four fixed error-code messages, a Goals navigation highlight for `/goals/*` and a "Goals" action on the want card.

## Routes

| Route | Purpose |
| --- | --- |
| `/goals` | Bounded list (25 per page, API keyset `after`), All/Active/Completed/Archived filter via the API `status` query, loading/empty/error/retry states. Home's "Open Goals" lands here. |
| `/goals/new` | Create: name, target (0 allowed), currency (owner default preselected), optional date and notes. |
| `/goals/[id]` | Confirmed progress, details, newest-first contribution history (`before` pagination), contribution/correction/reversal/reinstate actions, complete/archive/restore/delete. |
| `/goals/[id]/edit` | Revision-protected edit. Currency is disabled after the first ledger entry and sent only when changed. |
| `/wants/[id]/goals` | Hypothetical comparison of a want's likely price with an owner-chosen goal. |

## Money semantics

- All amounts stay canonical minor-unit strings; parsing uses the shared `amountEntryToMinor` (no rounding) and arithmetic uses `BigInt`. `progressMinor` may exceed the bigint range, so it is formatted from the exact decimal string rather than through `parseMinorUnits`. The only `Number` conversion is a decorative 0–100 progress-bar width.
- Percentages are floored to two decimals. Zero targets show "no target amount set" and no percentage. Currencies are never combined or converted: mismatched goals are disabled in comparison with the reason stated.
- Confirmed progress is only the API's effective-ledger `progressMinor`. Copy states that recording is the owner's confirmation and does not move or verify money.
- The want comparison is text-only (no bar), says "a possibility, not a saving", restates the goal's unchanged confirmed progress, and never writes. Unknown or zero likely prices show no ratio. For a declined want it links to the PER-31 allocation page, which keeps its own explicit confirmation, revision checks, idempotent retries and source-change disclosure; otherwise it explains that progress changes only after a decline plus explicit allocation.

## Ledger, lifecycle and concurrency

- History is newest-first, so an entry's successor always loads before it; an entry is effective when no loaded entry supersedes it. Only effective leaves offer Correct/Reverse (or Reinstate for a reversal). Earlier entries remain visible as Replaced/Reversed.
- Each ledger write uses a fresh command UUID and the current goal revision. On network or 5xx failure the exact command is retained, inputs and Cancel are disabled and Retry resends the identical body (the API replays committed commands). Stale revisions reload the goal and keep the typed amount for a new confirmation. Already-corrected or archived conflicts reload history.
- Goal edits that conflict show the latest saved version while keeping the owner's typed draft, with "Save my edits over it" or "Use the latest saved version". Goal creation is not idempotent in the API, so an ambiguous create failure warns about possible duplicates instead of retrying automatically.
- Archived goals hide ledger actions until restored. Completion is an explicit owner action. Delete requires confirmation, recommends archiving, and discloses that linked want allocations become unavailable; a retried delete that reports not-found is treated as done. Foreign and missing goals render the same unavailable state.

## Privacy and verification

Draft input lives only in React state; nothing is persisted in browser storage. No telemetry was added. Component tests (`apps/web/test/goals.test.tsx`) and the Playwright smoke (`apps/web/e2e/goals.spec.ts`) use synthetic fixtures only and capture `docs/screenshots/per-32-*` for mobile/desktop light/dark. Ownership, RLS, revision and ledger rules remain covered by the PER-30/31 API integration tests.

No migration or deployment is required. Manual screen-reader review and live owner-authenticated behaviour are not verified here.
