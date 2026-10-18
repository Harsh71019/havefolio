# Production API proxy regression

Run `pnpm test:proxy` after `pnpm install --frozen-lockfile` and installing the
Playwright Chromium browser. The root `pnpm test:smoke` gate also runs this check,
so the existing Repository gates CI job enforces it.

The harness copies the installed workspace into a temporary directory without
environment files, build caches or test artifacts. It preserves relative pnpm
links and hard-links immutable installed dependency files on the same filesystem.
Application source/configuration files are copied separately, using copy-on-write
when available; cross-filesystem dependency copies fall back to copying files. No additional install, network access or package-store cache is needed.
It builds Next with the production configuration and webpack compiler, and starts
`next start` on an allocated loopback port. A disposable upstream binds to a
separate allocated loopback port. Neither server uses PostgreSQL, Valkey or a
deployed API.

Real HTTP requests verify the anonymous `401 AUTH_REQUIRED` JSON response,
onboarding, desires and notifications methods, paths, JSON body, multipart photo uploads, cookie, query string, origin rejection and
`no-store` responses. Notification collection checks preserve limit, unreadOnly and an
encoded synthetic cursor; mark-read PATCH checks preserve the exact JSON body (`{}`),
cookie, origin and content type. The API mark-read endpoint consumes no body; this
assertion covers transport only and creates no notification data.
Auth, taxonomy, items, spending, health, onboarding, desires, notifications and home remain forwarded, while
an unknown API domain stays a web 404. Browser JavaScript is checked for the
synthetic internal API address and runtime-generated server credential sentinels
(auth rate key, media secret, Kan key and source-map upload token). Chromium then uses the existing onboarding client
through the production origin for status, skip/revisit and demo opt-in/removal;
there is no request interception.

Only public route/method metadata and comparison booleans are retained. Session
values are generated at runtime; no browser traces, screenshots, snapshots,
request bodies, cookies, child output or operator environment are saved. Cleanup
closes the browser, process groups and listeners and deletes the temporary tree,
including on failed assertions or termination signals.

To reproduce omission defects without changing the working tree, run:

```sh
pnpm build:packages
node scripts/testing/production-proxy.mjs --without-onboarding
# or
node scripts/testing/production-proxy.mjs --without-desires
# or
node scripts/testing/production-proxy.mjs --without-notifications
# or
node scripts/testing/production-proxy.mjs --without-home
```

This removes the selected domain only from the temporary config before building. The
anonymous request assertion must fail with actual 404 versus expected 401. Run
`pnpm test:proxy` again for the green result.

The synthetic upstream tests transport and client wiring, not NestJS business
rules or real sessions. Existing API integration tests remain responsible for
actual authentication, origin enforcement and owner isolation. No live deployment
is performed; the web image must be rebuilt and deployed after merge.

PER-54 remains pending live deployment verification after review and merge. A new
explicit deployment instruction is required before CT102 rollout. Rebuild the web
image with the reviewed rewrite and verify private HTTPS anonymous notifications
returns JSON `401 AUTH_REQUIRED` with `Cache-Control: no-store`; also recheck existing
explicit domains and the unknown-domain web 404. Local/CI synthetic transport
evidence alone does not satisfy the ticket’s Done gate.
