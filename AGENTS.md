# Havefolio Agent Instructions

These rules apply to every AI agent and human contributor working in this repository. `AGENTS.md` is the canonical source; tool-specific files should point here instead of copying and drifting from it.

## 1. Project identity and sources of truth

- Repository: `https://github.com/Harsh71019/havefolio`
- Product: Havefolio — a private, mobile-first “shop your own home” application.
- Product brief: `anti-consumerism-app-build-prompt.md`
- Kan board: `http://192.168.0.11:3001/boards/fucdo0zuj4bm`
- Kan OpenAPI document: `${KAN_BASE_URL}/api/v1/openapi.json`
- Ticket keys use the `PER-<number>` format.

Use this precedence when requirements conflict:

1. The user’s current explicit request.
2. The selected Kan ticket and its acceptance criteria.
3. The product brief.
4. Existing architecture decisions and repository documentation.
5. Existing implementation patterns.
6. This file.

Do not silently resolve a conflict that changes product behaviour, data meaning, privacy, or scope. Record the assumption in the ticket or ask the user.

## 2. Mandatory ticket-first workflow

Every implementation branch and commit must belong to a Kan ticket.

### A. When a ticket number is provided

1. Load `.env.local` without printing its contents.
2. Read the ticket through the Kan API before changing code.
3. Confirm its outcome, scope, acceptance criteria, dependencies, list, and labels.
4. Inspect related tickets and existing code before choosing an implementation.
5. Use the exact ticket key in the branch, commits, and pull request.

Do not implement from the ticket title alone.

### B. When no ticket number is provided

1. Query the board and search titles and descriptions for a matching ticket.
2. Prefer an existing ticket when its scope and acceptance criteria cover the request.
3. If no ticket matches, create one in **Backlog** before coding.
4. Do not create a duplicate merely because wording differs.
5. If the feature is too large for one independently reviewable change, create an umbrella ticket plus separated implementation tickets.

A new implementation ticket must include:

- Outcome and user value.
- Scope.
- Explicit non-goals where ambiguity is likely.
- Acceptance criteria using checkable statements.
- Backend, frontend, data, upload, security, observability, and deployment effects as applicable.
- Test expectations.
- Dependencies or blockers.
- Parent ticket when it belongs to a larger workstream.

Use **Backlog** for newly identified work. Move a ticket to **To Do** only when it is ready and prioritised. Move it to **In Progress** when implementation starts, **Code Review** when the pull request is ready, and **Done** only after the agreed completion gate is met. Do not mark blocked or incomplete work as Done.

### C. Kan API usage

The API base is `${KAN_API_BASE_URL}` and its schema is the live OpenAPI document. Inspect that document instead of guessing endpoints or payloads.

Load credentials quietly:

```sh
set -a
. ./.env.local
set +a
```

Example authenticated read:

```sh
curl -fsS \
  -H "Authorization: Bearer ${KAN_API_KEY}" \
  "${KAN_API_BASE_URL}/boards/${KAN_BOARD_PUBLIC_ID}"
```

Read a ticket by its visible key:

```sh
TICKET_KEY=PER-48
ticket_number=${TICKET_KEY#PER-}

curl -fsS \
  -H "Authorization: Bearer ${KAN_API_KEY}" \
  "${KAN_API_BASE_URL}/boards/${KAN_BOARD_PUBLIC_ID}" |
  jq --argjson ticket_number "${ticket_number}" '
    .lists[] as $list
    | $list.cards[]
    | select(.cardNumber == $ticket_number)
    | {
        key: ("PER-" + (.cardNumber | tostring)),
        publicId,
        list: $list.name,
        title,
        description,
        labels
      }
  '
```

The board response nests cards under `.lists[].cards[]`; the visible key is `PER-` plus `cardNumber`. Search that live response by title and description before concluding that a ticket is missing.

For a new feature, resolve the Backlog list ID from the board response, prepare the complete description, and then create the card:

```sh
board_file=$(mktemp)
payload_file=$(mktemp)
trap 'rm -f "${board_file}" "${payload_file}"' EXIT

curl -fsS \
  -H "Authorization: Bearer ${KAN_API_KEY}" \
  "${KAN_API_BASE_URL}/boards/${KAN_BOARD_PUBLIC_ID}" >"${board_file}"

backlog_id=$(jq -r '.lists[] | select(.name == "Backlog") | .publicId' "${board_file}")

jq -n \
  --arg title "Feature title" \
  --arg description "<h2>Outcome</h2><p>...</p><h2>Scope</h2><ul><li><p>...</p></li></ul><h2>Acceptance criteria</h2><ul><li><p>[ ] ...</p></li></ul>" \
  --arg listPublicId "${backlog_id}" \
  '{
    title: $title,
    description: $description,
    listPublicId: $listPublicId,
    labelPublicIds: [],
    memberPublicIds: [],
    position: "end"
  }' >"${payload_file}"

curl -fsS -X POST \
  -H "Authorization: Bearer ${KAN_API_KEY}" \
  -H 'Content-Type: application/json' \
  --data-binary "@${payload_file}" \
  "${KAN_API_BASE_URL}/cards"
```

Use the board’s existing labels when they apply instead of creating near-duplicates. Descriptions are stored as HTML, so use simple semantic headings, paragraphs, and lists. Do not send a write until the title, scope, and acceptance criteria are complete.

For card creation, resolve the target list and label public IDs from the live board first. The API expects fields such as `title`, `description`, `listPublicId`, `labelPublicIds`, `memberPublicIds`, and `position`; confirm the current OpenAPI schema before sending a write.

Never print, commit, log, paste into a ticket, or include the API key in a pull request. Never invent a ticket number or public ID. Do not create another API key while a working key is available.

## 3. Git workflow

### Start clean and current

Before creating a branch:

```sh
git status --short
git fetch origin
git switch main
git pull --ff-only origin main
```

Preserve unrelated user changes. Never discard or overwrite them to obtain a clean tree.

### Branch names

Use one ticket per branch unless the user explicitly approves tightly coupled tickets.

```text
<type>/PER-<number>-<short-kebab-description>
```

Allowed types: `feat`, `fix`, `chore`, `docs`, `test`, `refactor`, `perf`, `build`, `ci`.

Examples:

```text
feat/PER-10-owned-item-crud
fix/PER-22-refund-totals
chore/PER-48-seq-logging
```

Do not use personal names, agent names, or `codex` in branch names.

### Commits

Every commit subject must contain the ticket key:

```text
<type>(PER-<number>): <imperative summary>
```

Examples:

```text
feat(PER-10): add owned-item creation endpoint
test(PER-10): cover approximate purchase dates
fix(PER-22): exclude refunded purchases from totals
```

Keep commits focused and reviewable. Do not mix formatting churn, unrelated refactors, generated files, or another ticket’s work into the commit. Never bypass hooks with `--no-verify` unless the user explicitly authorises it and the reason is documented.

### Pull requests

Pull-request titles should start with the ticket key:

```text
PER-10: Add owned-item CRUD
```

The description must include:

- Ticket and goal.
- What changed.
- Important design decisions.
- Tests run and their results.
- Migration, deployment, security, upload, and observability effects.
- Screenshots or recordings for visible UI changes.
- Remaining risks, follow-ups, or intentional non-goals.

Do not claim a pull request is ready while a required test or CI job is failing or pending.

## 4. Planned technical architecture

Unless an approved ticket changes the architecture:

- Package manager and workspace: `pnpm` monorepo.
- Web: Next.js with App Router and TypeScript.
- API: NestJS modular monolith with TypeScript and versioned REST endpoints.
- Database: PostgreSQL with Drizzle ORM and reviewed migrations.
- Queue/cache: BullMQ on the existing shared Valkey/Redis-compatible service.
- Deployment: Docker on Proxmox CT102.
- Production PostgreSQL and Valkey must reuse the existing `shared-services` Docker network and shared instances with isolated databases, roles, ACLs, and key prefixes.
- Do not add new production PostgreSQL or Redis/Valkey containers without an explicit architecture decision.
- Private uploads must use protected storage and authenticated access; never expose receipts or inventory media by default.
- Observability uses the existing Seq, GlitchTip, Gatus, ntfy, and Beszel services.

Prefer a modular monolith until measured scaling or isolation requirements justify another service. Do not introduce a microservice, broker, search engine, object store, AI provider, or third-party catalogue merely because it may be useful later.

## 5. Product invariants

These rules are not optional implementation details:

- Manual item entry must always work; enrichment may assist but must never block it.
- The app is a private personal inventory and decision aid, not a marketplace or checkout.
- Use a warm, neutral tone. Do not shame users for purchases or classify their choices for them.
- Store actual price paid and currency. Never treat a catalogue price as the user’s purchase price.
- Keep exact, month-only, year-only, and unknown purchase-date precision distinct.
- Historical spending and spending on currently owned items are different metrics.
- Gifts do not count as spending unless the user records an amount they paid.
- Returns and refunds must be represented explicitly and calculated correctly.
- Unknown prices are excluded from monetary totals while their item count remains visible.
- “Avoided spend” is an estimate; it becomes savings only after an explicit allocation or confirmation.
- Similar-item matches must be explainable, correctable, and dismissible.
- Original user-entered data must remain distinguishable from suggested enrichment.
- Users must be able to edit and delete their items, desires, and private data.
- INR is the initial display currency, but money storage must retain ISO currency and integer minor units rather than floating-point amounts.

## 6. Engineering rules

### API and backend

- Use NestJS modules aligned to product domains, not technical-layer grab bags.
- Validate all external input with DTOs and a global validation pipe.
- Keep controllers thin; place business rules in application/domain services.
- Version public endpoints under `/api/v1`.
- Publish and validate OpenAPI for externally consumed endpoints.
- Use transactions for multi-write invariants and make queue jobs idempotent.
- Enforce ownership and authorisation in the API, not only in the UI.
- Use pagination and bounded queries for collections.

### Database and money

- Add forward migrations for schema changes; never edit an already-applied migration.
- Use dedicated runtime and migration roles with least privilege.
- Test constraints and indexes supporting lifecycle, filters, and aggregation.
- Use integer minor units for money and explicit ISO 4217 currency codes.
- Do not silently recalculate historical values with current exchange rates.
- Preserve date precision rather than inventing a day.

### Frontend

- Design mobile-first and verify keyboard, screen-reader, contrast, loading, empty, error, and offline/resilient states where relevant.
- Use shadcn/ui as the first source for reusable primitives and Kibo UI for higher-level components. Check both approved registries before creating a reusable component; custom UI is limited to Havefolio-specific compositions or genuinely missing behaviour.
- Keep the default neutral shadcn/ui light and dark themes, component variants and system typography until an approved ticket explicitly introduces product theming. Keep shared registry components behind `packages/ui` and verify important responsive/accessibility states in the live application.
- Use server-side filtering, sorting, and pagination for complete result sets.
- Keep server and client component boundaries intentional.
- Never expose service credentials or private storage URLs to browser bundles.
- Include realistic but removable Indian demo data only where a ticket calls for it.

### Uploads and privacy

- Validate size, MIME type, file signature, and image-processing limits.
- Generate safe filenames and store metadata separately from user-visible names.
- Strip unnecessary metadata such as EXIF when appropriate.
- Serve private content through authenticated, authorised endpoints or short-lived signed access.
- Include deletion, orphan cleanup, backup/recovery, and quota behaviour in upload work.
- Redact credentials, cookies, authorisation headers, receipt contents, private notes, and local file paths from telemetry.

### Observability

- Emit structured JSON logs with request/job correlation IDs.
- Send searchable application events to Seq while preserving container-console logs.
- Report actionable web, API, and worker failures to GlitchTip with release/environment context.
- Keep liveness separate from dependency-aware readiness and monitor both with Gatus.
- Route actionable alerts through ntfy and avoid alert storms through deduplication.
- Keep retention and sampling bounded for CT102 capacity.

## 7. Testing and completion gates

Read `package.json` and workspace scripts before running commands; do not invent a script that does not exist. As the monorepo is scaffolded, the expected baseline gates are:

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Run the narrowest relevant tests during development, then all repository-required gates before handoff. Add or update tests for changed behaviour, especially:

- Money, currency, date precision, gifts, returns, and refunds.
- Ownership and access-control boundaries.
- Upload validation and private delivery.
- Queue retries and idempotency.
- API contracts and migrations.
- Responsive and accessible critical journeys.
- Telemetry redaction.

An implementation is complete only when:

- The selected ticket’s acceptance criteria are met.
- Relevant tests pass.
- Documentation and environment examples are current.
- No secret or private fixture is staged.
- `git diff` contains no unrelated changes.
- Deployment or migration risks are explained.
- The Kan ticket and pull request reflect the real state of the work.

## 8. Agent handoff checklist

Before ending a task, report:

1. Ticket key and branch name.
2. Outcome delivered.
3. Files and migrations changed.
4. Tests run with pass/fail results.
5. Any unverified behaviour or environmental limitation.
6. Pull-request URL when one was requested or created.
7. The Kan status change performed, if any.

Do not expose `.env.local` values in the handoff.
