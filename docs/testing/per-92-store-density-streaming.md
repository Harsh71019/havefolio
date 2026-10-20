# PER-92: Store density during streamed loading

## Captured failure and cause

[Verify run 39426428824, attempt 1](https://github.com/Harsh71019/havefolio/actions/runs/39426428824/attempts/1)
failed at `5702d331895e22cac48abcf39a4b6969c8d4e84e` in the desktop
`PER-58 restores before paint and mobile ignores every saved desktop density` case.
The downloaded attempt-1 log records:

```text
Error: strict mode violation: getByTestId('store-skeleton') resolved to 2 elements:
1) <div ... data-testid="store-skeleton"> ... Your items region
2) <div ... data-testid="store-skeleton"> ... streamed main subtree
```

The overall run now reports success because attempt 2 passed; inspect attempt 1
when reviewing the failure. This is test evidence, not a production defect claim.

At baseline `e63f09c454e455c49eb1324a3eaf10e9b38326dc`, `my-store.tsx` is
byte-identical to that failing head. `StoreSkeleton` renders inside the already
named `section aria-label="Your items"`. The route `loading.tsx` does **not** render
`StoreSkeleton`. React's bundled server renderer emits pending HTML segments in
`<div hidden id="S:...">` containers before completion scripts place them into the
visible tree. Such streamed markup can coexist with the current tree. A global
test-ID locator searches both hidden and visible DOM; its visibility assertion
requires a unique match before checking visibility.

The CI log proves duplicate DOM matches but does not include a trace proving the
second element's hidden ancestor. The streamed-container explanation is supported
by the renderer implementation and source, rather than a new timing-dependent
production reproduction.

## Deterministic regression and targeting

`apps/web/e2e/fixtures/streamed-store.ts` clones the real, synthetic loading region
into a hidden container prepended to the document. This models the duplicate DOM
shape without depending on stream chunk scheduling. Its grid deliberately has one
column, so the wrong subtree cannot accidentally satisfy expected geometry. The
fixture contains no owner data and is removed in `finally`, releasing the held
mock items response even if an assertion fails.

For each compact, comfortable and large reload, the smoke proves the old global
selector throws its strict-mode error while the named accessible region and its
skeleton each match exactly once and remain visible. The loading grid is measured
inside that skeleton. After release, that same region must lose its skeleton and
show the synthetic Electric kettle link. Existing semantic markup is sufficient;
no application, shared loading, overlay or styling change is needed.

The animation-frame probe still records the first laid-out grid before paint. It
now ignores zero-width hidden streamed grids inside copies of the region. Both
first-frame density and columns are asserted. Existing desktop geometry, initial
Comfortable preference, invalid/obsolete storage, 360/768px mobile overrides,
light/dark, imagery and resilient-state coverage remains in place. No retries,
skips, timeout increases or sleeps were added.

## Evidence boundaries

Browser checks use the production Next build with Playwright-routed synthetic
API responses, not an authenticated real API. The duplicate subtree is an explicit
DOM fixture, not a claim of reproducing React's exact scheduling. No production,
backend, schema, deployment or manual screen-reader evidence is claimed. Required
CI separately exercises isolated API integration and the real HTTP proxy upstream.

PER-73 PR #69 was already merged when this work began; its required Repository
gates passed at `ee22ae48fd63bacaa0f43baf3c02035658bb515c`. PER-92 did not merge it
or change its Kan completion status.

## Validation

- Focused desktop restoration smoke: five repeats passed (15 saved-density reloads,
  each with an intentionally ambiguous hidden segment and both mobile widths).
- Temporary, uncommitted negative controls failed as intended: forcing the visible
  grid to one column reported expected 3 / received 1; suppressing stored density
  reads reported expected compact / received comfortable. Both controls were removed.
- The first local `pnpm check` passed lint, formatting, types and unit/infra checks,
  then failed nine component cases with unrestricted worker concurrency during
  parallel browser execution. This is recorded rather than treated as a pass.
- Final bounded component, complete smoke/proxy, migration-history, build and
  exact-head CI results are recorded in the PR handoff.
