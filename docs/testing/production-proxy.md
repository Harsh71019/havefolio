# Production API proxy regression

Run `pnpm test:proxy` after `pnpm install --frozen-lockfile` and installing the
Playwright Chromium browser. The root `pnpm test:smoke` gate also runs this check,
so the existing Repository gates CI job enforces it.

The harness copies the workspace into a temporary directory without environment
files, dependencies, build caches or test artifacts. It installs the locked
packages offline from the populated pnpm store, builds Next with the production
configuration and webpack compiler, and starts `next start` on an allocated
loopback port. A disposable upstream binds to a separate allocated loopback port.
Neither server uses PostgreSQL, Valkey or a deployed API.

Real HTTP requests verify the anonymous `401 AUTH_REQUIRED` JSON response,
onboarding methods, paths, JSON body, cookie, query string, origin rejection and
`no-store` responses. Auth, taxonomy, items and spending remain forwarded, while
an unknown API domain stays a web 404. Browser JavaScript is checked for the
synthetic internal API address. Chromium then uses the existing onboarding client
through the production origin for status, skip/revisit and demo opt-in/removal;
there is no request interception.

Only public route/method metadata and comparison booleans are retained. Session
values are generated at runtime; no browser traces, screenshots, snapshots,
request bodies, cookies, child output or operator environment are saved. Cleanup
closes the browser, process groups and listeners and deletes the temporary tree,
including on failed assertions or termination signals.

To reproduce the original defect without changing the working tree, run:

```sh
pnpm build:packages
node scripts/testing/production-proxy.mjs --without-onboarding
```

This removes onboarding only from the temporary config before building. The
anonymous request assertion must fail with actual 404 versus expected 401. Run
`pnpm test:proxy` again for the green result.

The synthetic upstream tests transport and client wiring, not NestJS business
rules or real sessions. Existing API integration tests remain responsible for
actual authentication, origin enforcement and owner isolation. No live deployment
is performed; the web image must be rebuilt and deployed after merge.
