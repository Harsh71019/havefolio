# PER-37 Threat Model & Security Hardening

This document defines the threat model, verified controls, resolved gaps, and residual operational risks for Havefolio's private API, authentication, uploads, and telemetry boundaries.

---

## 1. Scope and Protected Assets

Havefolio is a private, single-household application designed to help owners shop their own home, curb impulsive consumption, track warranties, receipts, spending, and intentional purchase goals. The application holds sensitive household data:

- **Private Inventory & Valuables:** Personal items, serial numbers, descriptions, conditions, physical locations, and valuation.
- **Private Financial Data:** Exact purchase prices, currencies, refund totals, avoided spending, and goal allocations.
- **Private Receipts & Warranties:** PDF and image documents that may contain billing addresses, payment methods, transaction timestamps, or store locations.
- **Private Household Images:** High-resolution photos of household goods and possessions.
- **Owner Credentials & Sessions:** Argon2id password hashes, session tokens, and active session metadata.

---

## 2. Threat Vectors and Security Boundaries

```
[ Untrusted Internet / LAN Clients ]
             │
             ▼
[ Reverse Proxy / Ingress (CT102 / Nginx) ]
             │ (Strict trust proxy; only configured CIDRs)
             ▼
[ Havefolio NestJS API (:3001) ]
  ├── 1. Global Security Headers Middleware
  ├── 2. Safe Exception Filter (Redaction & Status Mapping)
  ├── 3. AuthGuard (Origin, Referer, Sec-Fetch-*, Cookie Session)
  ├── 4. UploadRateService & AuthRateService (Valkey Atomic Sliding Windows)
  ├── 5. Domain Controllers & ParseUUIDPipe Boundaries
  └── 6. Media Isolation (Child process Sharp & libpdf guards)
             │
             ▼
[ Shared PostgreSQL & Valkey Storage ]
  (Per-environment databases, dedicated least-privilege roles, isolated key prefixes)
```

### Threat Vectors Evaluated:

1. **Cross-Site Request Forgery (CSRF):**
   - *Threat:* Malicious third-party websites triggering state-changing actions (creating items, deleting desires, revoking sessions) via ambient session cookies.
   - *Mitigation:* Multi-layer defense combining `SameSite=Strict` cookies, `Sec-Fetch-Site: cross-site` rejection, `Sec-Fetch-Mode: navigate / nested-navigate` rejection, strict `Origin` header whitelisting, and strict `Referer` validation when `Origin` is omitted. Both canonical production HTTPS (`API_CORS_ORIGIN`) and explicit trusted private LAN HTTP (`AUTH_LAN_HTTP_ORIGIN`) origins are verified without wildcard allowances.

2. **Insecure Direct Object Reference (IDOR) & Cross-Owner Enumeration:**
   - *Threat:* An authenticated attacker guessing or fuzzing UUIDs of items, receipts, photos, desires, goals, notifications, or sessions belonging to another household.
   - *Mitigation:* Object-level authorization enforced across all database queries (`WHERE owner_id = $1 AND id = $2`). Unmatched or foreign IDs return an identical `404 NOT_FOUND` status code and error message (`ITEM_NOT_FOUND`, `DESIRE_NOT_FOUND`, `GOAL_NOT_FOUND`, `NOTIFICATION_NOT_FOUND`, `MERCHANT_NOT_FOUND`, `TAXONOMY_NOT_FOUND`, `SESSION_NOT_FOUND`, `MEDIA_NOT_FOUND`) with zero timing or structural distinction.

3. **Malformed Parameter & Type Mismatch Denial of Service:**
   - *Threat:* Attackers passing malformed parameters (e.g. non-UUID strings to UUID route parameters) triggering unhandled database driver type errors and unhandled 500 crashes.
   - *Mitigation:* NestJS global `ValidationPipe` with `whitelist: true`, `forbidNonWhitelisted: true`, and controller-level `ParseUUIDPipe` validation on every route ID parameter (including `DELETE /api/v1/settings/sessions/:id`).

4. **Upload Abuse, Decompression Bombs & Malicious Payloads:**
   - *Threat:* High-frequency upload flooding, corrupted or oversized files, animated PNGs, HEIC formats, XML/JavaScript-bearing PDFs, or malicious memory exhaustion.
   - *Mitigation:*
     - Multi-tier file bounds: 10 MiB per photo, 20 MiB per PDF, 21 MiB per request.
     - Magic-byte verification and format-matching (JPEG SOI/EOI, PNG 8-byte magic + chunk scan without `acTL`, WEBP RIFF + length check, strict `%PDF-` header + `startxref %%EOF`).
     - Heavy media parsing in sandboxed child processes (`--max-old-space-size=128`, 256 MiB VmRSS / rssKiB limits, 10s deadlines, prohibited PDF actions/JavaScript/launch AST constructs).
     - Valkey-backed atomic `UploadRateService` (20 uploads/minute per owner, 30 uploads/minute per IP) using HMAC-SHA256 hashed keys.
     - Safe zero-filling of memory buffers on upload failure or completion.

5. **Telemetry & Log Redaction (Data Leaks):**
   - *Threat:* Leaking authorization tokens, session cookies, passwords, private note contents, or internal server paths in application logs or Sentry/GlitchTip envelopes.
   - *Mitigation:*
     - Safe exception boundary (`SafeExceptionFilter`) maps unknown errors to generic tokens; never echoes unparsed JSON or request bodies.
     - Strict route normalizer (`normalizeRoute`) maps dynamic URL path parameters and queries to safe static route templates (`/api/v1/items/:itemId`, `/api/v1/settings/sessions/:id`, etc.) preventing URL-based data leaks.
     - Sentry event scrubber discards breadcrumbs, raw SQL, user IDs, headers, and request bodies.

---

## 3. Verified Gaps and Remediations Implemented

| Gap ID | Area | Verified Weakness | Remediation Implemented | Verification Test |
|---|---|---|---|---|
| **GAP-01** | CSRF | State-changing methods did not reject `Sec-Fetch-Mode: navigate` or validate `Referer` origin when `Origin` was missing. | Added `Sec-Fetch-Mode` checks and `Referer` origin parser to `AuthGuard`. | `apps/api/src/auth/api-security.spec.ts`, `lan-auth.spec.ts` |
| **GAP-02** | Secure Headers | API lacked global security headers on non-media routes. | Added global middleware setting `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `X-DNS-Prefetch-Control: off`, `Referrer-Policy: strict-origin-when-cross-origin`, `Cross-Origin-Resource-Policy: same-origin`, and `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'` (with `/api/docs` allowance). | `apps/api/src/auth/api-security.spec.ts` |
| **GAP-03** | Upload Abuse | Concurrency guards existed, but upload endpoints lacked rate limits against rapid flood attacks. | Created `UploadRateService` backed by Valkey Lua script (`UPLOAD_RATE_SCRIPT`) with HMAC-isolated keys for owner and source IP. Integrated into photo and document upload controllers. | `apps/api/src/media/upload-rate.service.spec.ts` |
| **GAP-04** | Route Validation | `DELETE /api/v1/settings/sessions/:id` accepted arbitrary string IDs without `ParseUUIDPipe`. | Added `ParseUUIDPipe` to ensure malformed UUIDs fail fast with `400 INVALID_REQUEST`. | `apps/api/src/auth/api-security.spec.ts` |
| **GAP-05** | Telemetry Redaction | `normalizeRoute` in `@havefolio/monitoring` dropped `/settings`, `/notifications`, `/desires`, and `/items/:id/refunds` as `/unmatched`. | Added parameterized route patterns for all active subroutes in `packages/monitoring/src/index.ts`. | `packages/monitoring/test/monitoring.test.mjs` |

---

## 4. Verification Evidence Summary

- **Repository Unit & Infra Gates:** 28 test suites, 276 tests passed in API; infra, domain, logging, db, and monitoring tests 100% passing.
- **CSRF & Security Headers:** Verified in `api-security.spec.ts` (10 passing tests) and `lan-auth.spec.ts` (5 passing tests).
- **Object-Level Authorization:** Verified in `authorization.spec.ts` (9 domain suites covering Items, Merchants, Taxonomy, Desires, Goals, Allocations, Notifications, Settings, and Media).
- **Upload Rate Limiter:** Verified in `upload-rate.service.spec.ts` (4 passing tests).
- **Secret Scanning:** `gitleaks git` scanned all recent commits: 0 leaks found.
- **Dependency Scan:** Evaluated `pnpm audit`.

---

## 5. Residual Risks & Operational Considerations

1. **Local Development without Valkey:**
   In development or test environments where Valkey is unconfigured, `UploadRateService` gracefully passes to prevent blocking local development workflows. In production (`NODE_ENV === 'production'`), it strictly fails closed (`MEDIA_STORAGE_UNAVAILABLE`) if Valkey credentials are missing or unreachable.

2. **Trusted Proxy Configuration:**
   Client IP resolution relies on `API_TRUST_PROXY`. In production on Proxmox CT102, ensure `API_TRUST_PROXY` is configured with the exact CIDR of the upstream reverse proxy (e.g. `127.0.0.1` or the Docker bridge gateway) to prevent spoofed `X-Forwarded-For` headers from bypassing IP-based rate limiting.

3. **Storage Quota & Orphan Cleanup:**
   While file size limits and per-item photo counts are strictly enforced, background orphan cleanup of uncommitted upload intents remains managed by periodic reconciliation jobs.
