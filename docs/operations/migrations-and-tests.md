# PER-4: migrations and test gates

Drizzle TypeScript schema in `packages/db/src/schema.ts` is the source of truth. Reviewed SQL, snapshots and the append-only journal live in `packages/db/migrations`. The initial migration creates an infrastructure metadata table with a primary key and required value; no inventory, money or user schema is introduced. NestJS code can import `createDatabase` from `@havefolio/db` with its runtime client. Applying migrations is an explicit deployment step, never API/worker startup or schema push.

## Commands and layers

| Command | Purpose |
| --- | --- |
| `pnpm install --frozen-lockfile` | Validate declared dependencies against lockfile |
| `pnpm format:check` | Formatting (generator-owned snapshots/SQL are excluded) |
| `pnpm lint` / `pnpm typecheck` | Shared package compilation and source checks |
| `pnpm test:unit` | Infrastructure policy, isolation boundary and NestJS application rule tests |
| `pnpm test:components` | React accessible navigation/current-page contract |
| `pnpm test` | Unit and component layers; no shared credentials needed |
| `pnpm test:integration` | Real PostgreSQL/Valkey isolation and NestJS HTTP integration |
| `pnpm build` | Production packages, API, worker and Next.js builds |
| `pnpm test:smoke` | Playwright desktop/mobile production startup and all collection routes; build first |
| `pnpm check` | Format, lint, types, credential-free tests and production builds |
| `pnpm db:generate --name descriptive_name` | Offline generation; alternatively run filtered package command with `--name` |
| `pnpm db:check` | Offline generation into temporary storage, compare snapshots, require committed artifacts, check history |
| `pnpm db:migrate` | Apply forward migrations using only `MIGRATION_DATABASE_URL` |

Unit tests live beside API application code (`*.spec.ts`) and in test-utils for safety policy. API integration tests live in `apps/api/test`; component tests in `apps/web/test`; Playwright tests in `apps/web/e2e`. Add domain tests alongside implemented domain rules when their tickets land; do not invent business rules to raise coverage. No coverage percentage gate. Assertions cover contracts, constraints, privilege and cleanup behaviour.

## Safe migration workflow

1. Install dependencies, edit the TypeScript schema, then run `pnpm --filter @havefolio/db db:generate --name descriptive_name` without loading any connection credentials.
2. Review generated SQL, snapshots and journal. Add only forward migrations. Never edit applied SQL, old snapshots or old journal entries. Stage and commit generated artifacts with the ticket; `db:check` intentionally fails on uncommitted artifacts.
3. Run `pnpm db:check`; set `MIGRATION_BASE_REF=origin/main` to also enforce immutable existing history. CI sets the exact PR base or previous push SHA. Generation checks use temporary storage and cannot modify committed files. `drizzle-kit check` checks history collisions, while disposable generation detects TypeScript schema/snapshot drift.
4. Run the integration gate with dedicated test settings. On CI the entire database starts empty; each run also applies all migrations to a new empty schema with its own journal. Runtime INSERT/SELECT, primary-key/non-null constraints and denied CREATE/ALTER prove separate role privileges. Repeat migration application must preserve the journal and data.
5. For development/deployment, load only the protected migration environment and run `pnpm db:migrate` before rolling out compatible application code. Review backup/recovery and expand/contract changes before future destructive migrations. There is no reset/push/down command. Production application processes receive only runtime credentials.

The tracked environment example contains placeholders. Do not put real connection URLs into command arguments, tickets, CI settings for pull requests, browser bundles or reports. Migration failures redact transport/SQL details. Operator-only troubleshooting may inspect protected service logs locally without uploading them.

## Local shared-service integration

Use the PER-3 test database, its separate migration/runtime roles and test API Valkey ACL identity. Test variables are deliberately separate from application variables: `TEST_DATABASE_URL`, `TEST_MIGRATION_DATABASE_URL`, `TEST_VALKEY_HOST`, `TEST_VALKEY_PORT`, `TEST_VALKEY_USERNAME`, `TEST_VALKEY_PASSWORD`, and `TEST_VALKEY_ACL_ENFORCED=true`. Both URLs must target the same host and database ending in `_test`, with distinct users and no URL options. There is no default/fallback connection. Do not grant administrator or migration access to runtime processes.

From a trusted machine already on `shared-services`, load the protected test-only file with `set -a; . /protected/test-only.env; set +a`, then run `pnpm test:integration`. Service DNS names are intentionally unavailable outside that network. Do not publish shared-service ports to work around that restriction.

For the existing operator host, deploy the test API dependencies and sources into a disposable directory:

```sh
pnpm build:packages
pnpm --filter @havefolio/api deploy --os linux --cpu x64 --libc musl --ignore-scripts "$DISPOSABLE_API_DIR"
node scripts/testing/prepare-probe.mjs "$DISPOSABLE_API_DIR"
```

When archiving on macOS, use `COPYFILE_DISABLE=1 tar --no-xattrs -czf ...` to exclude AppleDouble/xattr files, which otherwise match Jest source patterns. Inspect the archive for environment files before sending it. Copy the deployment and `scripts/testing/verify-shared.py` to the operator host without root environment files. Check capacity first. Use an already available, digest-pinned Node 24 Alpine image:

```sh
python3 "$TOOL_DIR/verify-shared.py" --state-dir "$STATE_DIR" \
  --api-dir "$DISPOSABLE_API_DIR" --image "$PINNED_NODE_IMAGE"
```

This reads only the protected PER-3 **test** credentials, sends them through captured stdin, and runs the same NestJS integration suite in a temporary non-root/read-only container on the existing network. No new production data-service containers, provisioning, service restart or administrator connection. Test/cache scratch space is bounded in `/tmp`. Output is a redacted pass/fail summary. Delete the disposable deployment/archive after verification.

## Isolation and cleanup boundaries

Each `IntegrationRun` creates a cryptographically random `hf_test_<32 hex digits>` schema and `havefolio:test:<schema>:` prefix. The generated schema name cannot come from input; the connection search path and migration journal both use it. PER-3 default grants cover public only. The fixture adds migration-role default DML/sequence grants within its own schema and grants runtime schema USAGE; it changes no shared/global defaults. Tests create three independent runs concurrently, write the same record/key names, simulate a failed run, and assert the other runs' rows/keys survive. The third namespace represents unrelated test work. Authenticated ACL checks reject a key outside Havefolio's test namespace.

All teardown steps are attempted with `finally`/`allSettled`. Only the owned schema is dropped. Keys are registered **before** writing, deleted by exact name, and expire after five minutes. There is no SCAN/KEYS/FLUSH/TRUNCATE/database drop in application testing. Application ACLs cannot discover unrelated keys. Teardown failures fail the suite. SIGKILL/host loss cannot execute JavaScript finally: keys expire, but an operator must inspect a residual exact test schema and its owner before explicitly approving removal. Never sweep schemas by prefix or reuse a run identifier. Do not terminate other sessions or reset shared services.

## CI and merge gate

`Repository gates` uses GitHub-hosted runners, loopback-only ephemeral PostgreSQL 18.4 and Valkey 8.1.8 services compatible with PER-3. These containers have no connection to the private network and need no repository infrastructure secrets. PostgreSQL trust authentication is limited to disposable CI loopback; test roles/ACL use random per-job credentials masked before writing GitHub's ephemeral environment file. Runtime has no CREATE/TEMP/database administration; migration owns only its generated test database. CI Valkey ACL permits ping/get/set/del/client metadata plus eval/incr/expire/ttl for PER-8 atomic authentication counters under `havefolio:test:*`. Ephemeral service destruction belongs to the runner, not test cleanup.

CI runs frozen install, formatting, lint, types, unit/infrastructure, components, migration drift/history, real API/service integration, production builds and Playwright. Every step propagates failure; `Repository gates` must be required on main with strict up-to-date checks. pnpm caches dependencies only. No environment, private logs or operator state are cached/uploaded. Browser reports remain console-only; screenshots/video/traces are disabled because the current smoke only needs public synthetic shell data. Revisit sanitized failure artifacts when useful for real journeys.

For local ephemeral reproduction, create disposable loopback services yourself and run `packages/test-utils/scripts/provision-ci.mjs` with `CI=true`, `GITHUB_ENV` pointing to a mode-0600 temporary file and optional `CI_POSTGRES_PORT`/`CI_VALKEY_PORT`; load it quietly. This script must never target shared services and only connects to loopback. Destroy only those disposable containers and remove the private temporary file afterwards.

## Troubleshooting

- Missing test settings: load the protected test-only file; never substitute production URLs.
- Connection failure: check network/DNS and the PER-3 identities without printing URLs or passwords. Raw integration setup errors are withheld.
- Permission error: confirm migration ownership/default table grants and runtime schema USAGE. Do not elevate runtime privileges.
- Drift failure: generate, review and commit a new migration. Do not use schema push or delete history.
- Smoke failure: run `pnpm build`, install Chromium with `pnpm --filter @havefolio/web exec playwright install chromium`, and ensure port 3100 is free. The runner refuses to reuse another server.
- Existing legacy unauthenticated Valkey default access remains the separately documented PER-3 infrastructure limitation. This ticket changes no existing shared ACLs.
