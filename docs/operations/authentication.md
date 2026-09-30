# PER-8: private owner authentication

The API owns authentication. `AuthModule` registers an application-wide NestJS guard: every controller route is private unless `@Public()` explicitly marks it public. Only registration, login and operations health are currently public. Future inventory/media controllers inherit the guard. `@CurrentOwner()` supplies the authenticated owner's ID to domain services; PER-10 owns item-level authorization and PER-13/14 own media routes. Next.js middleware cannot replace this boundary. No frontend authentication UI is added.

## Account and registration lifecycle

`POST /api/v1/auth/register` accepts `{ email, password }` only when `AUTH_REGISTRATION_ENABLED=true`. It creates the initial owner and a session atomically, returning only `{ id, email, displayName }`. Registration defaults to **false in all environments**, including production. Set it explicitly during controlled bootstrap, keep the endpoint reachable only by the intended owner during that window, then disable it and restart the API. There is no invitation or bootstrap code: the first valid request while enabled wins. Do not leave an empty instance publicly reachable with registration enabled.

A transaction advisory lock and a partial unique index permit only one credentialed owner across concurrent API instances. Once that owner exists, all registration attempts return `403 REGISTRATION_UNAVAILABLE` regardless of email, even if the flag remains enabled. The flag also rejects registration before an owner exists. Additional owners/public signup are outside this ticket.

PER-7 users that own inventory or provider records remain credential-free identity shells. Migration 0003 adds nullable credential fields without rewriting those IDs or claiming their records. Bootstrap creates a new login identity. Existing private data must not be auto-assigned to someone who knows an email; an operator must verify ownership and plan any legacy identity binding separately before releasing an instance with existing records.

Emails are trimmed and lowercased for both creation and lookup, with a unique database index and normalized-value constraint. This deliberately treats the complete address case-insensitively. Passwords are never trimmed or normalized; DTOs require a string of 15–128 characters with no composition rules. Unknown accounts execute verification against a startup-generated dummy Argon2id hash. Unknown-account and incorrect-password responses are both `401 INVALID_CREDENTIALS`; response bodies never disclose account existence. Validation failures use generic `400 INVALID_REQUEST` and contain no input values. A global safe exception filter also removes request fragments from JSON parser failures and prevents stack/database errors from reaching response bodies or logs.

Argon2id defaults are 65536 KiB (64 MiB), time cost 3, parallelism 1, with random salts and a 32-byte digest. Config permits memory 19456–262144 KiB, time cost 2–10, lanes 1–4. The floor follows [OWASP's Argon2id guidance](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html); defaults exceed that floor. Benchmark latency and total concurrent memory on the deployment host before changing them. The pinned [node-argon2 implementation](https://github.com/ranisalt/node-argon2) performs password verification. Parameter parsing accepts PHC parameter ordering. Successful login upgrades insufficient memory/time while preserving any stronger existing memory/time parameter. A row lock plus constant-time comparison of the verified hash prevents a stale credential check from overwriting a concurrent password change. No password reset, recovery, MFA, OAuth or email delivery exists here.

## Session lifecycle and cookies

| Endpoint | Access | Result |
| --- | --- | --- |
| `POST /api/v1/auth/register` | Explicitly public, bootstrap enabled | 201 owner DTO and Set-Cookie |
| `POST /api/v1/auth/login` | Explicitly public | 200 owner DTO and new Set-Cookie |
| `GET /api/v1/auth/me` | Session required | 200 owner DTO; session idle lifetime touched |
| `POST /api/v1/auth/logout` | Session required | 204; current session revoked; cookie cleared |
| `POST /api/v1/auth/logout-all` | Session required | 204; all owner sessions, including current, revoked; cookie cleared |

OpenAPI response annotations describe 400/401/403/429/503 and the cookie security scheme. Successful owner responses use `Cache-Control: no-store`. Swagger remains controlled by `API_DOCS_ENABLED`; set it false for private production deployments unless deliberately needed.

Every session token is 32 cryptographically random bytes encoded as 43 base64url characters. PostgreSQL stores only its SHA-256 hash, owner ID and created/last-used/idle-expiry/absolute-expiry/revoked timestamps. Raw tokens exist only transiently in server memory and the HttpOnly cookie, never in response JSON, URLs or browser storage. Missing, malformed, duplicated, noncanonical or oversized tokens are rejected with 401 before a database lookup. Database lookup and idle renewal use the hashed token and a conditional update; expiration and revocation cannot be undone by a concurrent request.

Default idle lifetime is 86400 seconds (one day); absolute lifetime is 604800 seconds (seven days). Each authenticated request extends idle expiry, capped at the immutable absolute expiry. Cookie Max-Age follows the absolute lifetime and is not refreshed on reads; an idle-expired cookie can still exist in the browser but is rejected by the server. Login always issues a new token and removes the presented owner's prior session, preventing fixation. Independently signed-in devices remain active until revoked or pruned. No JWT or refresh token is used.

Logout/current and logout-all take the owner row lock and revalidate the calling session inside the transaction. Login uses that same lock for rotation and insertion. Concurrent operations follow that serial order: logout-all revokes all sessions created before it commits; a fresh password-authenticated login ordered afterward can establish a new session. A stale touch or rotation never reactivates an old session. An already authorized request may finish after logout; PER-10 must enforce transactional domain invariants for sensitive writes.

| Attribute | Development/test | HTTPS production (`NODE_ENV=production`) |
| --- | --- | --- |
| Name | `havefolio_session` | `__Host-havefolio_session` |
| HttpOnly | true | true |
| Secure | false, local HTTP permitted | true, browser requires HTTPS |
| SameSite | Strict | Strict |
| Path | `/` | `/` |
| Domain | omitted, host-only | omitted, host-only |
| Max-Age | configured absolute seconds | configured absolute seconds |

Cookie removal uses matching name, Path, host-only scope, SameSite, Secure and HttpOnly attributes, with an expired date. Dev frontend/API may use different ports on localhost with `credentials: 'include'`; production frontend/API must be same-site over HTTPS and CORS must name the exact approved origin. SameSite Strict intentionally does not support cross-site embeds or third-party login callbacks.

## CSRF and request boundary

SameSite Strict and the global guard's Origin/Sec-Fetch-Site checks provide the current baseline. Unsafe methods reject an Origin other than the configured frontend origin and reject `Sec-Fetch-Site: cross-site`, including public login/bootstrap (login CSRF). Requests without these headers remain usable by nonbrowser clients. There is no synchronizer/double-submit token yet. Comprehensive CSRF, same-site sibling-domain threats, secure headers, abuse controls and object-level access tests belong to PER-37 and remain release hardening work. JSON login/bootstrap bodies are limited to 16 KiB at API startup; there is no multipart upload route yet.

## Configuration and rate limiting

Use separate protected API/worker/migration files. API processes receive only the environment's runtime database role and API Valkey ACL identity. The shared `.env.example` supplies placeholders and development defaults; its API ACL is `havefolio_dev_api`, whereas the worker must use `havefolio_dev_worker`. Production validation requires an HTTPS frontend origin, runtime database URL, dedicated `havefolio_production_api` identity, shared-service Valkey DNS, password, and a minimum 32-character HMAC secret. Never copy migration/admin credentials into API configuration.

| Setting | Default / effect |
| --- | --- |
| `AUTH_REGISTRATION_ENABLED` | false; explicit bootstrap lock |
| `AUTH_ARGON_MEMORY_KIB`, `AUTH_ARGON_TIME_COST`, `AUTH_ARGON_PARALLELISM` | 65536 / 3 / 1 |
| `AUTH_SESSION_IDLE_SECONDS`, `AUTH_SESSION_ABSOLUTE_SECONDS` | 86400 / 604800; idle cannot exceed absolute |
| `AUTH_SESSION_MAX_RETAINED` | 10; range 1–50, includes inactive records |
| `AUTH_RATE_WINDOW_SECONDS` | 300; range 1–300 |
| `AUTH_RATE_SOURCE_LIMIT` | 30 attempts per source/action/window |
| `AUTH_RATE_ACCOUNT_SOURCE_LIMIT` | 5 attempts per source+normalized-email/action/window |
| `AUTH_RATE_KEY_SECRET` | Required for authentication; independent random protected secret, at least 32 characters |
| `VALKEY_PREFIX` | `havefolio:dev`, `havefolio:test` or `havefolio:production`, matching NODE_ENV; safe suffixes allowed |
| `VALKEY_HOST`, `VALKEY_PORT`, `VALKEY_DATABASE` | shared-redis / 6379 / 0; production requires shared DNS |
| `VALKEY_USERNAME`, `VALKEY_PASSWORD` | Dedicated environment API ACL and protected password |
| `API_TRUST_PROXY` | Empty; comma-separated exact trusted proxy IP addresses, maximum 16 |
| `API_CORS_ORIGIN` | Exact frontend origin; HTTPS in production |

Keys are `${VALKEY_PREFIX}:auth:<login|register>:source:<HMAC>` and `${VALKEY_PREFIX}:auth:<login|register>:account-source:<HMAC>`. HMAC-SHA256 protects raw source/email identifiers from disclosure and offline address guessing without the key secret. The account dimension includes the source, so an attacker choosing the owner's email cannot exhaust a global owner budget from an unrelated source. Source counters also bound attempts that rotate emails. Limits are fixed windows, separately counted per action; both successful and failed attempts consume budget. Atomic Lua INCR/EXPIRE sets each key's TTL on first creation and never extends it for later attempts. No global discovery or flush is used. PER-3's existing API ACL already allows EVAL/INCR/EXPIRE in the environment prefix; no shared ACL mutation is required. CI's disposable test ACL includes these exact commands and TTL for assertions.

Missing/unreachable Valkey returns bounded `503 AUTH_UNAVAILABLE` for login/bootstrap before credential hashing or writes, rather than allowing unlimited attempts. Limit exceeded returns generic 429. Existing PostgreSQL sessions remain usable during a Valkey outage. Offline command queues and unbounded retries are disabled; after a transport failure, restore the service and restart API instances to reconnect. Redis errors and PostgreSQL errors are redacted. Test limiter keys use a per-run prefix, are removed by exact name, and expire within five minutes even on interruption.

Express trusts no forwarded address by default. Rate limiting uses `request.ip`, which then falls back to the direct socket. Behind NPMplus, set `API_TRUST_PROXY` to the exact verified proxy IP(s), restrict direct API network access and ensure the proxy replaces untrusted forwarding headers. Never trust `true`, a hop count or all networks. If unset behind a proxy, clients share that proxy's source budget; verify real client-source separation before deployment. Shared NAT clients can still share a source limit; distributed abuse controls remain PER-37.

## Cleanup, migration and incident response

Migration `0003_private_owner_auth.sql` adds only nullable user credential fields, unique/check constraints and the sessions table/indexes/FK. Review it and the new snapshot/journal; prior migration history is unchanged. It uses an unqualified users reference so the same migrations apply inside isolated test schemas. Apply it explicitly with the migration role before compatible API code, never at API startup. Back up first and assess lock time on the users table. No production migration is performed by this implementation. Integration tests apply all four migrations from empty isolated schemas and repeat them safely.

Every successful login removes that owner's revoked/expired rows and prunes oldest active sessions before insertion, so the retained total never exceeds the configured maximum after login. There is only one credentialed owner. Logout leaves a revocation tombstone until the next login; even an inactive deployment retains at most the configured session cap. No background sweep, global keys scan or shared database cleanup is needed for the current model. If the cap is lowered, the next login enforces the new cap and older devices must sign in again.

For routine device compromise, call logout-all from an authenticated owner session. For owner password or all-session compromise, an authorized operator should disable registration, restrict API access, lock that specific user row and revoke its sessions in one reviewed database transaction. Rotate the owner's Argon2id password hash through a protected operator procedure before restoring access; no public recovery endpoint is provided. Never put a password, hash or token in shell history, SQL logs, tickets or PRs. If cookie policy or environment changes, revoke old sessions and clear the old cookie scope deliberately. HMAC-secret rotation resets rate-limit identifiers; old keys naturally expire. Review auth event counts and dependency availability without collecting identifiers.

Security events contain only named outcomes (`owner_registered`, `login_rejected`, `login_succeeded`, `login_hash_upgraded`, `session_revoked`, `all_sessions_revoked`) and a domain. No emails, request bodies, password material, cookie/header values, session IDs/hashes or database errors are logged. Seq/GlitchTip integration and broader correlation/redaction belong to the observability tickets; configure reverse-proxy and monitoring tooling not to capture credential bodies or Cookie/Set-Cookie headers.

Local verification uses only disposable loopback services and PER-4's random schema/namespace fixtures. Real HTTPS deployment/proxy routing, CT resource benchmarks and frontend journeys remain unverified until deployment work. Provider media operations, object ownership, password recovery and comprehensive CSRF stay in their existing tickets.
