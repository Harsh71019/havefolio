# PER-50: Health Endpoints and Gatus Monitoring

Havefolio exposes lightweight, bounded liveness and readiness signals for the API and a dedicated availability endpoint for the web frontend, integrated with homelab Gatus monitoring.

## 1. Endpoints and Contracts

### API Liveness (`GET /api/v1/health/live`)
- **Purpose**: Verifies that the NestJS process is running and able to handle HTTP requests.
- **Dependencies**: Zero external dependencies. It never queries PostgreSQL, Valkey, Cloudinary, Seq, or GlitchTip.
- **Authentication**: Unauthenticated (`@Public()`).
- **Headers**: `Cache-Control: no-store, no-cache, must-revalidate`, `Pragma: no-cache`.
- **Response**: `200 OK`
  ```json
  {
    "service": "havefolio-api",
    "status": "ok"
  }
  ```

### API Readiness (`GET /api/v1/health/ready`)
- **Purpose**: Evaluates operational readiness of critical and optional backing dependencies.
- **Dependencies Checked**:
  - `postgres`: Checks runtime database connection and schema readiness via `SELECT 1 FROM users LIMIT 1`. Strict 2000ms timeout.
  - `valkey`: Checks authenticated Redis/Valkey connectivity via `PING`. Strict 2000ms timeout.
  - `storage`: Checks private Cloudinary storage ping when enabled (`MEDIA_STORAGE_ENABLED=true`), or reports `disabled`. Strict 2000ms timeout.
- **Execution & Single-Flight**: Independent checks run concurrently via `Promise.all` with a 2500ms total bounding deadline. Concurrent probes join a single-flight promise. Results are cached in-memory for 2 seconds (2000ms) to prevent probe storms from exhausting connection pools or provider quotas.
- **Headers**: `Cache-Control: no-store, no-cache, must-revalidate`, `Pragma: no-cache`.
- **Response Semantics**:
  - `200 OK` when status is `ok` (all dependencies healthy).
  - `200 OK` when status is `degraded` (critical dependencies healthy, optional upload storage unavailable). Core inventory operations remain usable.
  - `503 Service Unavailable` when status is `unavailable` (critical dependency `postgres` or `valkey` failed or timed out).
- **Response Format**:
  ```json
  {
    "service": "havefolio-api",
    "status": "ok",
    "dependencies": {
      "postgres": { "status": "ok" },
      "valkey": { "status": "ok" },
      "storage": { "status": "ok" }
    },
    "durationMs": 4
  }
  ```

### Critical versus Optional Dependencies
| Dependency | Classification | Status on Failure | Overall Impact | HTTP Status |
| --- | --- | --- | --- | --- |
| PostgreSQL | Critical | `unavailable` | API cannot serve authenticated requests or store inventory | `503` |
| Valkey | Critical | `unavailable` | Rate-limiting and worker job queues are offline | `503` |
| Cloudinary Storage | Optional | `degraded` / `disabled` | Manual inventory entry and viewing remain fully operational; media upload/download fails gracefully | `200` |

### Safe Error Codes
Fixed, high-level error codes only; no driver errors, database names, network hosts, connection strings, or stack traces are ever exposed:
- `DATABASE_UNAVAILABLE`
- `VALKEY_UNAVAILABLE`
- `STORAGE_UNAVAILABLE`
- `TIMEOUT`

### Web Availability (`GET /healthz`)
- **Purpose**: Verifies that the Next.js App Router Node server is running and responding.
- **Dependencies**: Zero external dependencies. Zero React component or page rendering.
- **Authentication**: Unauthenticated.
- **Headers**: `Cache-Control: no-store, no-cache, must-revalidate`, `Pragma: no-cache`.
- **Response**: `200 OK`
  ```json
  {
    "status": "ok",
    "service": "havefolio-web"
  }
  ```

## 2. Docker Health Checks

In `deployment/compose.yaml`:
- **API Container**: Probes its own liveness endpoint (`http://127.0.0.1:3001/api/v1/health/live`). Process liveness is separated from dependency readiness to prevent Docker restart loops during backing service maintenance.
- **Web Container**: Probes its lightweight availability route (`http://127.0.0.1:3000/healthz`).
- Both checks use the Node.js runtime's built-in `fetch` without installing external diagnostic utilities.

## 3. Gatus Monitoring

Homelab Gatus on CT102 monitors Havefolio via private Tailscale HTTPS (`https://<tailscale-fqdn>`).

### Configured Endpoints
1. **Havefolio Web**
   - URL: `https://<tailscale-fqdn>/healthz`
   - Interval: `1m`, timeout: `5s`
   - Conditions: `[STATUS] == 200`, `[BODY].status == ok`, `[RESPONSE_TIME] < 5000`
2. **Havefolio API Liveness**
   - URL: `https://<tailscale-fqdn>/api/v1/health/live`
   - Interval: `1m`, timeout: `5s`
   - Conditions: `[STATUS] == 200`, `[BODY].status == ok`, `[RESPONSE_TIME] < 5000`
3. **Havefolio API Readiness**
   - URL: `https://<tailscale-fqdn>/api/v1/health/ready`
   - Interval: `1m`, timeout: `10s`
   - Conditions:
     - `[STATUS] == 200`
     - `[BODY].status == ok`
     - `[BODY].dependencies.postgres.status == ok`
     - `[BODY].dependencies.valkey.status == ok`
     - `[RESPONSE_TIME] < 5000`

### Incident & Alert Differentiation
- **Web container down**: `Havefolio Web` check fails.
- **API container down**: `Havefolio API Liveness` and `Readiness` checks fail, while `Web` remains healthy.
- **Backing dependency down**: `Havefolio API Liveness` remains healthy, but `Havefolio API Readiness` fails. The Gatus dashboard highlights the specific failing dependency condition (`postgres` or `valkey`).
- **Alert Deduplication**: Alerts route to the homelab ntfy topic with `failure-threshold: 3` and `send-on-resolved: true`. A sustained outage produces one actionable alert and one recovery alert upon resolution.

## 4. Controlled Outage & Rollback

### Simulation
- Simulate web outage: stop only the Havefolio web container (`docker compose stop web`).
- Simulate API liveness outage: stop only the Havefolio API container (`docker compose stop api`).
- Simulate dependency readiness failure: adjust API candidate configuration or simulate network isolation for the Havefolio container. **Never stop shared PostgreSQL or Valkey instances**, which serve other homelab workloads.
- Confirm alert fires after 3 probe failures and resolves after 2 successful probes.

### Rollback
If a health check regression occurs, revert `deployment/compose.yaml` to the prior release tag and restore previous endpoints.

## 5. Live Verification Evidence

Live candidate verification was conducted against deployed Havefolio on CT102 via Tailscale HTTPS (`https://<tailscale-fqdn>`):
1. **Candidate Build and Deployment**:
   - Built candidate images (`havefolio-api:per50-candidate` and `havefolio-web:per50-candidate` for linux/amd64).
   - Deployed on CT102 with updated Docker compose healthchecks.
   - Container healthchecks passed: both `havefolio-api-1` and `havefolio-web-1` reported `Healthy`.
2. **Endpoint Verification**:
   - `GET /healthz`: Returned HTTP 200 `{"status":"ok","service":"havefolio-web"}` with `no-store, no-cache, must-revalidate` cache controls.
   - `GET /api/v1/health/live`: Returned HTTP 200 `{"service":"havefolio-api","status":"ok"}` with safe headers and request ID correlation.
   - `GET /api/v1/health/ready`: Returned HTTP 200 with all dependencies (`postgres`, `valkey`, `storage`) reporting `ok` and total execution duration within 800ms. In-memory single-flight and 2-second caching verified under rapid re-query.
3. **Gatus Integration**:
   - Appended `Havefolio Web`, `Havefolio API Liveness`, and `Havefolio API Readiness` to Gatus configuration on CT102.
   - Validated Gatus configuration (all 22 endpoints passed validation).
   - Verified that all three Havefolio endpoints reported green with zero errors (`success: true, errors: null`).
4. **Controlled Outage Simulation**:
   - Executed a controlled web container outage (`docker compose stop web`) without touching shared PostgreSQL or Valkey instances.
   - Gatus recorded 3 consecutive failures (HTTP 502) and triggered exactly one actionable alert to ntfy (`title: Gatus: Applications/Havefolio Web`).
   - Restarted `havefolio-web-1`. After 2 consecutive successes, Gatus dispatched exactly one recovery alert (`An alert has been resolved after passing successfully 2 time(s) in a row`).
   - Re-verified all 22 Gatus endpoints across Infrastructure, Core services, and Applications—all confirmed healthy.

