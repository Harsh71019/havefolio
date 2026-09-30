# PER-9: private taxonomy management

The authenticated owner can manage categories, optional subcategories and reusable tags at `/settings/taxonomy`. PER-8 sessions protect every `/api/v1/taxonomy` endpoint; the owner comes exclusively from `CurrentOwner`. The settings screen offers sign-in with the existing owner account; it does not enable registration or add inventory CRUD.

## Contracts and limits

`GET /api/v1/taxonomy` returns a private, no-store snapshot with `categories`, `subcategories`, `tags` and `defaultsSeeded`. Responses include usage counts, category positions, demo markers and retirement timestamps. Collections are capped at 500 entries **per kind per owner**, including retired entries; reads fetch at most 501 rows to detect legacy overflow. Creating beyond this cap returns 409 rather than silently truncating. Roots and siblings sort by position then UUID; tags sort by folded name then UUID. SQL usage counts aggregate through existing owner/classification indexes.

| Method and suffix | Command |
| --- | --- |
| POST `/categories` | Create a custom root with `name` |
| POST `/subcategories` | Create with `name` and active owner `categoryId` |
| POST `/tags` | Create a reusable tag with `name` |
| PATCH `/categories/:id`, `/subcategories/:id` | Rename using `name`, retire/restore using `retired` |
| PATCH `/tags/:id` | Rename only |
| PATCH `/categories/order` | Complete ordered `ids`, including retired roots |
| PATCH `/subcategories/order` | Complete sibling `ids` plus `categoryId` |
| DELETE `/categories/:id`, `/subcategories/:id` | Optional `replacementId`; root children additionally require `removeSubcategories: true` |
| DELETE `/tags/:id` | Explicit `removeRelationships` boolean |
| POST `/defaults` | One-time, explicit demo-category admission |

Swagger at the existing configured `/api/docs` route publishes all DTOs, cookie authentication, success snapshots and 400/401/404/409/503 outcomes. Unknown fields and invalid UUIDs are rejected. No caller can choose an owner. Foreign and missing IDs return the same 404; invalid full ordering returns 409 and changes nothing.

Names use NFKC Unicode normalization, trim and whitespace collapse while retaining capitalization; comparison additionally folds case. Invisible control/format-only values are rejected. Categories/subcategories allow 120 characters and tags 80. Existing PER-7 database uniqueness remains in force: **retired entries reserve their names** and can be restored or renamed rather than duplicated. Owners retain legacy names until an explicit edit. The root/subcategory schema prevents self-parenting, cycles and arbitrary depth; there is no reparent command.

## Retirement, deletion and concurrency

Retiring a root preserves it, its children and all current assignments. Selectors exclude both retired roots and their children from new choices, show an existing retired assignment explicitly, and clear the subcategory when the user changes root. A child cannot be created or restored under a retired root. Restoring a root preserves the children's individual retirement states.

An unused category can be explicitly deleted. A root with children requires explicit child-removal consent. An in-use root additionally requires an active same-owner replacement. All affected items move to that root and their subcategories are cleared; then the old children and root are deleted. The dialog explains those consequences before sending consent. An in-use subcategory requires an active sibling replacement in the same active root. Cross-root subcategory merges are intentionally unsupported; choose a root reassignment instead. A tag in use requires explicit relationship-removal consent; deletion removes joins, never items.

Every taxonomy transaction locks the owner's user row. This serializes duplicate checks, seed admission, list snapshots and complete sibling reordering across API processes. Item reassignment, revision increments, append-only `details_updated` lifecycle events and deletion share one transaction. SQL CTEs process affected items without loading all IDs into application memory. Original item input and previous events are untouched. Foreign-owner records are excluded in all SQL and remain protected by PER-7 composite foreign keys. Storage errors are redacted into stable messages. No private taxonomy names or request bodies are logged.

PER-10 writers must take this same owner row lock before checking active category/subcategory choices and committing item assignments. They must validate active roots/children and owner ownership; database foreign keys alone deliberately allow existing retired assignments to remain readable. They must compare item revisions because taxonomy reassignment advances them.

## Explicit defaults

The optional **Add example categories** action adds six practical roots: Clothing & accessories, Electronics, Kitchen & dining, Home & furniture, Books & stationery, Sports & hobbies. Created roots have `is_demo=true`; equivalent custom roots remain custom. No inventory records or demo subcategories are seeded. Seeding and the owner marker are atomic, idempotent and safe under concurrent requests.

Forward migration `0004_taxonomy_defaults.sql` adds only nullable `users.taxonomy_defaults_seeded_at`; existing owners and classifications are unchanged. It records that admission has happened even after a demo record is deleted. Startup, login and repeated seed requests never recreate removed categories. Migration reruns leave the marker intact. Deleting an owner in later privacy work naturally removes its marker with the user row. Removing all demo inventory/onboarding remains PER-19.

## UI and deployment

The stock neutral shadcn theme is retained. Existing primitives plus registry Dialog and Checkbox live behind `packages/ui`; both shadcn and Kibo registries were checked before creating application-specific compositions. `CategorySelector` and `TagSelector` in `apps/web/components/taxonomy-selectors.tsx` are reusable by PER-10/11. Category controls use labelled Radix Select; multi-tag assignment uses labelled checkboxes. Management uses keyboard-operable up/down buttons, labelled dialogs, trapped focus, cancellation, status announcements and focus restoration after mutations. Touch controls are at least 44px; names wrap at narrow widths. Loading, empty, name/conflict, server/offline and expired-session states are explicit.

Next.js rewrites **only auth and taxonomy** under same-origin `/api/v1` to the configured `NEXT_PUBLIC_API_BASE_URL` (including its `/api/v1` prefix). Configure this trusted API upstream at build time and rebuild when it changes. Browser requests use same-origin cookies and no-store; credentials and database URLs never reach browser bundles. Keep `API_CORS_ORIGIN` equal to the external web origin for PER-8 origin checks, and retain HTTPS host-only Secure cookies in production. Review existing reverse-proxy routing so `/api/v1/auth` and `/api/v1/taxonomy` reach the same authenticated API. API dependency failure does not admit an owner. This ticket does not deploy or migrate production, alter shared services, add uploads, change authentication bootstrap, or replace PER-37's comprehensive CSRF work.

Apply migration 0004 with the migration role before deploying the compatible API. It is additive and needs the ordinary reviewed backup/lock-capacity release checks. Production continues to reuse shared PostgreSQL/Valkey. No new data services or runtime DDL privileges are required.

## Verification

Focused unit tests cover name rules, caps, owner scoping, hierarchy admission, retirement, ordering and explicit deletion decisions. Real isolated PostgreSQL/HTTP tests cover authentication, foreign-owner rejection, concurrent duplicates, ordering, retirement, active replacements, child deletion, rollback including history, tag joins, once-only seeding, repeat migration application and Swagger contracts. Component tests cover loading/sign-in, states, conflicts, confirmation consent, selector choices, keyboard operation and focus. Browser tests exercise responsive light/dark layouts, keyboard dialogs and failure states using synthetic fixtures; local live verification additionally uses the real API and disposable database only.
