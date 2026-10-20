# Havefolio Proxmox CT102 Deployment & Release Runbook

This guide contains the authoritative, repeatable operator procedures for deploying and maintaining Havefolio on **Proxmox VE LXC Container CT102**.

Havefolio is a mobile-first, private personal inventory application built with Next.js (App Router), NestJS, PostgreSQL with Drizzle ORM, and BullMQ on Valkey. This runbook details first-time installation, routine releases, image verification, database migrations, security and network boundaries, health verification, observability integration, and application rollback.

---

## 1. System Architecture & Host Topology

Havefolio runs inside an unprivileged LXC container (`CT102`) hosted on a physical Proxmox VE server (Acer Aspire A514-54).

```
                      +------------------------------------------------+
                      |         Physical Proxmox VE Host               |
                      |            root@192.168.0.10                   |
                      |   (Adaptive fan control: PROXMOX_FAN_CONTROL)  |
                      +-----------------------+------------------------+
                                              |
                                     pct enter 102
                                              v
+-----------------------------------------------------------------------------------------+
|                                    LXC Container CT102                                  |
|                                    (IP: 192.168.0.226)                                  |
|                                                                                         |
|  +-----------------------------------------------------------------------------------+  |
|  | Tailscale Serve (HTTPS)                                                           |  |
|  | https://apps.taild40172.ts.net  ---(proxy)--->  http://127.0.0.1:3020             |  |
|  +-----------------------------------------------------------------------------------+  |
|                                            |                                            |
|                                            v                                            |
|  +-----------------------------------------------------------------------------------+  |
|  | Docker Compose Stack (`havefolio`)                                                |  |
|  |                                                                                   |  |
|  |  +---------------------+   +---------------------+   +--------------------------+ |  |
|  |  |   havefolio-web     |   |   havefolio-api     |   |    havefolio-worker      | |  |
|  |  |   (Next.js App)     |-->|   (NestJS API)      |   |    (BullMQ Reminders)    | |  |
|  |  |   127.0.0.1:3020    |   |   3001/tcp (int)    |   |    (no published ports)  | |  |
|  |  |  [192.168.0.226:3020|   +----------+----------+   +------------+-------------+ |  |
|  |  |   LAN HTTP opt-in]  |              |                           |               |  |
|  |  +----------+----------+              |                           |               |  |
|  |             |                         |                           |               |  |
|  |             +------------+------------+                           |               |  |
|  |                          | network: app                           |               |  |
|  |                          v                                        |               |  |
|  |             +------------+----------------------------------------+               |  |
|  |             | network: shared-services (external)                                 |  |
|  |             v                                                     v               |  |
|  |  +--------------------------+                  +-------------------------------+  |  |
|  |  |   shared-postgres        |                  |   shared-redis (Valkey)       |  |  |
|  |  |   db: havefolio          |                  |   prefix: havefolio:production|  |  |
|  |  |   roles: havefolio_runtime                  |   acls: havefolio_production_api |  |  |
|  |  |          havefolio_migrate                  |         havefolio_production_    |  |  |
|  |  +--------------------------+                  |         worker                |  |  |
|  |                                                +-------------------------------+  |  |
|  |                                                                                   |  |
|  |  Observability & Telemetry (Shared Stack):                                        |  |
|  |  - Gatus (Health Probing: port 8080)                                              |  |
|  |  - Seq (Structured Logging: port 5341)                                            |  |
|  |  - GlitchTip (Error/Performance Tracking: Sentry SDK)                             |  |
|  |  - Beszel (Host/Container Resource Telemetry)                                    |  |
|  +-----------------------------------------------------------------------------------+  |
+-----------------------------------------------------------------------------------------+
```

### Architectural & Security Invariants

1. **Shared Services**: PostgreSQL (`shared-postgres`) and Valkey (`shared-redis`) are pre-existing shared containers on the external Docker network `shared-services`. Never create new database or Valkey containers for Havefolio.
2. **Immutable Release Tags**: Every image is tagged with the full 40-character commit SHA: `havefolio-<full-sha>`.
3. **Four Target Images**: Each release builds four images from `deployment/Dockerfile`: `havefolio-web`, `havefolio-api`, `havefolio-worker`, and `havefolio-migration`.
4. **Secret Isolation & Exclusions**: Container images contain **zero** credentials, secrets, or `.env` files (`.dockerignore` strictly excludes `.env*`, `.git`, and `node_modules`). BuildKit secrets (`HAVEFOLIO_MONITORING_BUILD_SECRET`) are mounted exclusively during the build stage for GlitchTip source-map uploads and are stripped from exported layers.
5. **Least-Privilege Roles**:
   - `havefolio_migrate`: Dedicated schema-migration role owning the database. Used exclusively by the ephemeral `havefolio-migration` service.
   - `havefolio_runtime`: Least-privilege application role (CONNECT, USAGE, table SELECT/INSERT/UPDATE/DELETE, sequence USAGE). Used by `havefolio-api` and `havefolio-worker`. Has no schema-altering permissions.
6. **Forward-Only Migrations**: Database migrations are strictly additive. Never revert migrations, run schema downgrades, or drop tables.
7. **Canonical HTTPS vs. LAN HTTP**:
   - Default: Canonical HTTPS via Tailscale Serve (`https://apps.taild40172.ts.net`) proxying to loopback `127.0.0.1:3020`.
   - Optional: Trusted LAN HTTP sign-in (`AUTH_LAN_HTTP_ORIGIN=http://192.168.0.226:3020`) binding explicitly to `192.168.0.226:3020`.

---

## 2. Command Execution Environments

Every command block in this guide explicitly identifies where it runs:

| Location Label | Context & Machine | How to Access |
| --- | --- | --- |
| `[Dev Machine]` | Operator workstation (Mac) | Terminal in repository clone |
| `[Proxmox Host]` | Physical server (`192.168.0.10`) | `ssh root@192.168.0.10` |
| `[CT102 Container]` | Debian LXC Container (`102`) | On Proxmox host: `pct enter 102` |

---

## 3. Directory Layout & File Permissions on CT102

Inside CT102, all Havefolio assets reside under `/opt/havefolio`:

```text
/opt/havefolio/
├── builds/                             # Clean Git checkouts for release builds (mode 0700)
│   └── <full-commit-sha>/             # e.g., /opt/havefolio/builds/02712d05564e01aba7acc6954a4e2f76ec140fbd
├── deployment/                         # Active deployment directory (mode 0755)
│   ├── compose.yaml                    # Docker Compose stack definition
│   ├── .env                            # Active release pointer: RELEASE=havefolio-<full-sha>
│   ├── release.json                    # Deployed metadata, timestamps, and image IDs
│   ├── bootstrap-owner.mjs             # Owner bootstrap script (read-only mount)
│   ├── check-dependencies.mjs          # API dependency preflight probe
│   └── rollback-<timestamp>/          # Backup snapshots of previous deployment configs
└── secrets/                            # Root-only directory (mode 0700)
    ├── shared-services/                # Protected runtime environment files (mode 0600)
    │   ├── .env.production.api         # API runtime config (runtime DB, API Valkey ACL)
    │   ├── .env.production.worker      # Worker runtime config (runtime DB, Worker Valkey ACL)
    │   ├── .env.production.migration   # Migration config (migration DB role)
    │   └── .env.production.web         # Optional web runtime config (GlitchTip DSN)
    ├── monitoring/
    │   └── release.env                 # BuildKit secret for source maps (mode 0600)
    └── owner-bootstrap.json            # Argon2id owner credentials for initial setup (mode 0600)
```

### Permission Enforcement

Run inside `[CT102 Container]`:

```sh
# [CT102 Container]
mkdir -p /opt/havefolio/builds /opt/havefolio/deployment
mkdir -p /opt/havefolio/secrets/shared-services /opt/havefolio/secrets/monitoring

# Enforce strict permission boundaries
chmod 0700 /opt/havefolio/secrets /opt/havefolio/builds
chmod 0600 /opt/havefolio/secrets/shared-services/.env.production.* 2>/dev/null || true
chmod 0600 /opt/havefolio/secrets/monitoring/release.env 2>/dev/null || true
chmod 0600 /opt/havefolio/secrets/owner-bootstrap.json 2>/dev/null || true
```

---

## 4. Protected Runtime Configuration Reference

Protected environment files reside in `/opt/havefolio/secrets/`. They are never checked into Git or copied into Docker images.

### A. API Runtime (`/opt/havefolio/secrets/shared-services/.env.production.api`)

```ini
NODE_ENV=production
# Least-privilege runtime database role
DATABASE_URL=postgresql://havefolio_runtime:<DB_PASSWORD>@shared-postgres:5432/havefolio
# Authenticated Valkey API ACL and environment-specific key prefix
VALKEY_HOST=shared-redis
VALKEY_PORT=6379
VALKEY_USERNAME=havefolio_production_api
VALKEY_PASSWORD=<VALKEY_API_PASSWORD>
VALKEY_PREFIX=havefolio:production

# Allowed origin for CORS and session cookies
API_CORS_ORIGIN=https://apps.taild40172.ts.net
AUTH_REGISTRATION_ENABLED=false
API_DOCS_ENABLED=false
MEDIA_STORAGE_ENABLED=true
REMINDER_QUEUE_ENABLED=true

# Observability: Seq structured JSON logging
SEQ_ENABLED=true
SEQ_ENDPOINT=http://seq:5341
SEQ_API_KEY=<SEQ_INGEST_API_KEY>

# Observability: GlitchTip error tracking
GLITCHTIP_DSN=http://<PUBLIC_KEY>@glitchtip-web-1:8000/<PROJECT_ID>
GLITCHTIP_TRACE_SAMPLE_RATE=0.01

# Optional Trusted LAN HTTP sign-in (PER-60) - leave unset for HTTPS-only
# AUTH_LAN_HTTP_ORIGIN=http://192.168.0.226:3020
```

### B. Worker Runtime (`/opt/havefolio/secrets/shared-services/.env.production.worker`)

```ini
NODE_ENV=production
DATABASE_URL=postgresql://havefolio_runtime:<DB_PASSWORD>@shared-postgres:5432/havefolio
VALKEY_HOST=shared-redis
VALKEY_PORT=6379
VALKEY_USERNAME=havefolio_production_worker
VALKEY_PASSWORD=<VALKEY_WORKER_PASSWORD>
VALKEY_PREFIX=havefolio:production

WORKER_QUEUE_ENABLED=true
REMINDER_RECONCILE_INTERVAL_SECONDS=60

SEQ_ENABLED=true
SEQ_ENDPOINT=http://seq:5341
SEQ_API_KEY=<SEQ_INGEST_API_KEY>

GLITCHTIP_DSN=http://<PUBLIC_KEY>@glitchtip-web-1:8000/<PROJECT_ID>
GLITCHTIP_TRACE_SAMPLE_RATE=0.01

# Optional Generic ntfy delivery (disabled by default)
# NTFY_ENDPOINT=http://ntfy:80
# NTFY_TOKEN=<OPTIONAL_NTFY_TOKEN>
```

### C. Migration Runtime (`/opt/havefolio/secrets/shared-services/.env.production.migration`)

```ini
# Dedicated database owner role; runtime credentials are never accepted
MIGRATION_DATABASE_URL=postgresql://havefolio_migrate:<MIGRATE_PASSWORD>@shared-postgres:5432/havefolio
```

### D. Web Runtime (Optional: `/opt/havefolio/secrets/shared-services/.env.production.web`)

```ini
# Optional runtime override for web error capture
GLITCHTIP_DSN=http://<PUBLIC_KEY>@glitchtip-web-1:8000/<PROJECT_ID>
```

### E. Monitoring Build Secret (`/opt/havefolio/secrets/monitoring/release.env`)

This file is mounted via BuildKit secret during `scripts/monitoring/build-release.sh`. It is **never** present in final images or runtime containers:

```ini
GLITCHTIP_UPLOAD_SOURCE_MAPS=true
SENTRY_URL=http://glitchtip-web-1:8000
SENTRY_ORG=havefolio
SENTRY_PROJECT=havefolio
SENTRY_AUTH_TOKEN=<SOURCE_MAP_UPLOAD_TOKEN>
NEXT_PUBLIC_GLITCHTIP_DSN=https://<PUBLIC_KEY>@glitchtip.example.com/<PROJECT_ID>
NEXT_PUBLIC_GLITCHTIP_TRACE_SAMPLE_RATE=0.01
```

### F. Owner Bootstrap (`/opt/havefolio/secrets/owner-bootstrap.json`)

Used once during initial setup or reviewed owner credential rotation:

```json
{
  "email": "owner@example.com",
  "passwordHash": "$argon2id$v=19$m=65536,t=3,p=4$..."
}
```

---

## 5. First-Time Installation Procedure

Follow this section only when setting up Havefolio on CT102 for the first time.

### Step 1: Connect to Proxmox and Enter CT102

From your developer machine:

```sh
# [Dev Machine]
ssh root@192.168.0.10
```

On the Proxmox host:

```sh
# [Proxmox Host]
pct status 102
pct enter 102
```

### Step 2: Create Directory Structure

```sh
# [CT102 Container]
mkdir -p /opt/havefolio/builds /opt/havefolio/deployment
mkdir -p /opt/havefolio/secrets/shared-services /opt/havefolio/secrets/monitoring
chmod 0700 /opt/havefolio/secrets /opt/havefolio/builds
```

### Step 3: Verify Shared Services and Network

Verify that the external `shared-services` network and shared database/cache containers exist:

```sh
# [CT102 Container]
docker network inspect shared-services >/dev/null 2>&1 || docker network create shared-services
docker ps --filter "name=shared-postgres" --filter "name=shared-redis" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
```

### Step 4: Provision Havefolio Databases and Valkey ACLs

Run the shared-services provisioning script from the repository checkout to configure the `havefolio` database, roles, and Valkey ACLs. See [shared-services.md](docs/operations/shared-services.md) for full details:

```sh
# [CT102 Container]
# Run shared services inspect and provision
python3 scripts/shared-services/provision.py inspect --state-dir /opt/havefolio/secrets/shared-services
python3 scripts/shared-services/provision.py provision --state-dir /opt/havefolio/secrets/shared-services
```

### Step 5: Stage Protected Secrets

Populate the configuration files described in Section 4 with mode `0600`:

```sh
# [CT102 Container]
chmod 0600 /opt/havefolio/secrets/shared-services/.env.production.*
chmod 0600 /opt/havefolio/secrets/monitoring/release.env
chmod 0600 /opt/havefolio/secrets/owner-bootstrap.json
```

### Step 6: Clone and Build Initial Release

```sh
# [CT102 Container]
# Replace with the reviewed full 40-character commit SHA
INITIAL_SHA="<full-commit-sha>"

git clone https://github.com/Harsh71019/havefolio.git "/opt/havefolio/builds/${INITIAL_SHA}"
cd "/opt/havefolio/builds/${INITIAL_SHA}"
git checkout "${INITIAL_SHA}"

# Build all four images using the monitoring BuildKit secret
test -r /opt/havefolio/secrets/monitoring/release.env
export HAVEFOLIO_MONITORING_BUILD_SECRET=/opt/havefolio/secrets/monitoring/release.env
sh scripts/monitoring/build-release.sh
```

### Step 7: Stage Deployment Assets

```sh
# [CT102 Container]
cd /opt/havefolio/deployment
cp "/opt/havefolio/builds/${INITIAL_SHA}/deployment/compose.yaml" ./
cp "/opt/havefolio/builds/${INITIAL_SHA}/deployment/bootstrap-owner.mjs" ./
cp "/opt/havefolio/builds/${INITIAL_SHA}/deployment/check-dependencies.mjs" ./

# Pin the active release
echo "RELEASE=havefolio-${INITIAL_SHA}" > .env
```

### Step 8: Run Initial Database Migration

Execute the one-shot migration service using the dedicated migration role:

```sh
# [CT102 Container]
cd /opt/havefolio/deployment
export RELEASE="havefolio-${INITIAL_SHA}"
docker compose run --rm migrate
```

Verify the output ends with: `Migrations applied successfully.`

### Step 9: Bootstrap the Owner Account

Bootstrap the single owner account from the protected Argon2id hash file. The script uses an advisory lock and refuses to overwrite an existing owner:

```sh
# [CT102 Container]
cd /opt/havefolio/deployment
cat /opt/havefolio/secrets/owner-bootstrap.json | docker compose run --rm -T --no-deps \
  -v /opt/havefolio/deployment/bootstrap-owner.mjs:/app/bootstrap-owner.mjs:ro \
  api node bootstrap-owner.mjs
```

Verify output: `Configured owner created from protected Argon2id hash.`

### Step 10: Start Application Stack

```sh
# [CT102 Container]
cd /opt/havefolio/deployment
docker compose up -d --wait api worker web
```

### Step 11: Configure Tailscale Serve

Check for existing Serve routes. Only configure when the root path `/` is unallocated:

```sh
# [CT102 Container]
tailscale serve status

# Proxy HTTPS port 443 to Havefolio web loopback port 3020
tailscale serve --bg --https=443 http://127.0.0.1:3020
```

### Step 12: Merge Gatus Monitoring Config

Merge the endpoint definitions from `deployment/gatus/havefolio-endpoints.yaml` into your homelab Gatus configuration (e.g., `/opt/stacks/gatus/config/config.yaml`). See [health-monitoring.md](docs/operations/health-monitoring.md).

### Step 13: Record Release Metadata

```sh
# [CT102 Container]
cat <<EOF > /opt/havefolio/deployment/release.json
{
  "release": "havefolio-${INITIAL_SHA}",
  "deployedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "gitRevision": "${INITIAL_SHA}",
  "images": {
    "api": "havefolio-api:havefolio-${INITIAL_SHA}",
    "worker": "havefolio-worker:havefolio-${INITIAL_SHA}",
    "web": "havefolio-web:havefolio-${INITIAL_SHA}",
    "migration": "havefolio-migration:havefolio-${INITIAL_SHA}"
  }
}
EOF
```

---

## 6. Routine Release Workflow (Repeatable Updates)

Perform this procedure for every standard production release.

```
+-----------------------------------------------------------------------------------------+
|                               Routine Release Sequence                                  |
|                                                                                         |
|  1. [Dev Machine] Verify Git main & CI checks pass                                      |
|  2. [CT102]       Pre-release capacity and resource checks                              |
|  3. [CT102]       Fetch & checkout clean revision at /opt/havefolio/builds/<SHA>        |
|  4. [CT102]       Build immutable release images with build-release.sh                  |
|  5. [CT102]       Scan images before rollout (no secrets, no .map files)                |
|  6. [CT102]       Snapshot previous deployment config to rollback-<timestamp>/          |
|  7. [CT102]       Sync compose assets & update RELEASE in deployment/.env               |
|  8. [CT102]       Run one-shot migration: docker compose run --rm migrate               |
|  9. [CT102]       Recreate application containers: docker compose up -d --wait          |
|  10. [CT102]      Perform post-deployment verification (Health, Auth, Observability)   |
|  11. [CT102]      Atomically update /opt/havefolio/deployment/release.json              |
+-----------------------------------------------------------------------------------------+
```

### Phase 1: Pre-Release Verification on Operator Machine

Before touching the server, verify that the release commit is merged to `main` and all required CI checks have passed:

```sh
# [Dev Machine]
git fetch origin
git switch main
git pull --ff-only origin main

# Confirm the exact 40-character commit SHA
RELEASE_SHA=$(git rev-parse HEAD)
echo "Target Release SHA: ${RELEASE_SHA}"

# Verify required GitHub Actions CI status
gh run list --commit "${RELEASE_SHA}"
```

> [!IMPORTANT]
> Never deploy unmerged branches, dirty worktrees, or commits with failing CI gates. Required CI checks include `Formatting`, `Lint`, `TypeScript`, `Unit and infrastructure tests`, `React component tests`, `Migration generation and history drift`, `API integration`, and `Production startup and navigation smoke`.

### Phase 2: Capacity & Resource Checks on CT102

Access CT102:

```sh
# [Dev Machine]
ssh root@192.168.0.10

# [Proxmox Host]
pct enter 102
```

Check available disk space and system memory inside CT102:

```sh
# [CT102 Container]
df -h /
free -h
docker system df
```

> [!NOTE]
> Each release's four images total roughly 2 GB (api ~690 MB, worker ~555 MB, web ~420 MB, migration ~360 MB) with shared base layers. A CT102 build temporarily consumes ~2.5 GB of build cache. Ensure CT102 has at least **5 GB** of free disk space before starting a build.

### Phase 3: Build Immutable Images on CT102

Fetch and checkout the release commit in `/opt/havefolio/builds`:

```sh
# [CT102 Container]
RELEASE_SHA="<REPLACE_WITH_FULL_40_CHAR_COMMIT_SHA>"
export REVISION="${RELEASE_SHA}"
export RELEASE="havefolio-${RELEASE_SHA}"

BUILD_DIR="/opt/havefolio/builds/${RELEASE_SHA}"
if [ ! -d "${BUILD_DIR}" ]; then
  git clone https://github.com/Harsh71019/havefolio.git "${BUILD_DIR}"
fi

cd "${BUILD_DIR}"
git fetch origin
git switch --detach "${RELEASE_SHA}"
test "$(git rev-parse HEAD)" = "${RELEASE_SHA}"

# Verify the checkout is clean
if [ -n "$(git status --porcelain)" ]; then
  echo "ERROR: Build directory is dirty!" >&2
  exit 1
fi

# Build images using BuildKit secret mount for source maps
test -r /opt/havefolio/secrets/monitoring/release.env
export HAVEFOLIO_MONITORING_BUILD_SECRET=/opt/havefolio/secrets/monitoring/release.env
sh scripts/monitoring/build-release.sh
```

Verify that all four images were created for `linux/amd64`:

```sh
# [CT102 Container]
for target in api worker web migration; do
  docker image inspect "havefolio-${target}:${RELEASE}" \
    --format '{{.RepoTags}} {{.Id}} {{.Os}}/{{.Architecture}}'
done
```

### Phase 4: Scan Images Before Rollout

Before deploying, audit the exported image contents to ensure zero environment files, zero browser source maps, and no leaked credentials:

```sh
# [CT102 Container]
umask 077
SCAN_TMP=$(mktemp -d /root/scan.XXXXXX)
trap 'rm -rf "$SCAN_TMP"' EXIT

# Extract non-public credential values from protected configuration into a 0600 temp file
grep -E '^[A-Z0-9_]+=' /opt/havefolio/secrets/monitoring/release.env \
  | grep -v -E '^(NEXT_PUBLIC_|GLITCHTIP_UPLOAD_SOURCE_MAPS|SENTRY_URL|SENTRY_ORG|SENTRY_PROJECT)' \
  | while IFS= read -r line; do
      k=${line%%=*}; v=${line#*=}; v=${v#[\"\']}; v=${v%[\"\']}
      [ ${#v} -ge 12 ] && printf '%s\n' "$v" > "$SCAN_TMP/p.$k"
    done

for t in api worker web migration; do
  img="havefolio-$t:$RELEASE"
  c=$(docker create "$img"); mkdir "$SCAN_TMP/fs"
  docker export "$c" | tar -x -C "$SCAN_TMP/fs" app 2>/dev/null || true
  docker rm "$c" >/dev/null

  echo "$t $(docker image inspect "$img" --format '{{.Os}}/{{.Architecture}}')" \
    "envFiles=$(find "$SCAN_TMP/fs" -type f -name '.env*' ! -name '*.example' | wc -l)" \
    "browserMaps=$(find "$SCAN_TMP/fs" -path '*/.next/static/*' -name '*.map' | wc -l)"

  for p in "$SCAN_TMP"/p.*; do
    [ -f "$p" ] && echo "  ${p##*/p.} matches=$(grep -r -l -F -f "$p" "$SCAN_TMP/fs/app" 2>/dev/null | wc -l)"
  done
  rm -rf "$SCAN_TMP/fs"
done
```

**Expected Audit Output**:
- Every image is `linux/amd64`.
- `envFiles=0` across all images.
- `browserMaps=0` across all images (source maps were uploaded and stripped).
- `SENTRY_AUTH_TOKEN matches=0` everywhere.
- `GLITCHTIP_DSN matches=3` in `web` is **expected** (one server chunk plus `main` and `main-app` browser chunks carrying the public client ingestion DSN). Any other credential match blocks rollout.

### Phase 5: Rollout & Forward Migration on CT102

1. **Snapshot Current State for Rollback**:

```sh
# [CT102 Container]
cd /opt/havefolio/deployment
umask 077
export ROLLBACK_DIR="$PWD/rollback-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "${ROLLBACK_DIR}"
cp -p compose.yaml .env release.json "${ROLLBACK_DIR}/" 2>/dev/null || true
for file in compose.override.yaml compose.override.yml; do
  if [ -f "$file" ]; then cp -p "$file" "${ROLLBACK_DIR}/"; fi
done
docker compose ps --format json > "${ROLLBACK_DIR}/containers.before.json"
docker compose images --format json > "${ROLLBACK_DIR}/images.before.json"
echo "Backed up previous deployment state to ${ROLLBACK_DIR}"
```

2. **Sync Deployment Files**:

Review any changes in `deployment/compose.yaml` from the release commit. Preserve live settings (such as LAN HTTP bindings) before proceeding:

```sh
# [CT102 Container]
cd /opt/havefolio/deployment
cp "/opt/havefolio/builds/${RELEASE_SHA}/deployment/compose.yaml" ./
cp "/opt/havefolio/builds/${RELEASE_SHA}/deployment/bootstrap-owner.mjs" ./
cp "/opt/havefolio/builds/${RELEASE_SHA}/deployment/check-dependencies.mjs" ./

# If LAN HTTP sign-in is enabled, verify web ports retain the LAN IP binding:
# ports: ['127.0.0.1:3020:3000', '192.168.0.226:3020:3000']
```

3. **Run Additive Database Migrations**:

Always run the one-shot migration container before restarting application services:

```sh
# [CT102 Container]
cd /opt/havefolio/deployment
export RELEASE="havefolio-${RELEASE_SHA}"

# Note: < /dev/null prevents docker compose from swallowing stdin when executing inside piped scripts
docker compose run --rm --no-deps migrate < /dev/null
```

Verify output confirms success: `Migrations applied successfully.`

4. **Recreate Application Containers**:

Recreate `api`, `worker`, and `web`. The `--wait` flag ensures Compose waits for all service healthchecks to pass:

```sh
# [CT102 Container]
cd /opt/havefolio/deployment
docker compose up -d --no-deps --wait api worker web < /dev/null
```

5. **Atomically Update Release Metadata**:

Run the atomic Python updater inside CT102 to persist the active release and record image identifiers:

```sh
# [CT102 Container]
cd /opt/havefolio/deployment
python3 - <<'PY'
import datetime, json, os, pathlib, subprocess

release = os.environ['RELEASE']
revision = os.environ['REVISION']
env = pathlib.Path('.env')
lines = [line for line in env.read_text().splitlines() if not line.startswith('RELEASE=')]
temporary_env = pathlib.Path('.env.next')
temporary_env.write_text('\n'.join(lines + ['RELEASE=' + release]) + '\n')
temporary_env.chmod(0o600)
temporary_env.replace(env)

path = pathlib.Path('release.json')
metadata = json.loads(path.read_text()) if path.exists() else {}
metadata.update(
    release=release,
    revision=revision,
    deployedAt=datetime.datetime.now(datetime.timezone.utc).isoformat(),
    rollbackDirectory=os.environ.get('ROLLBACK_DIR', '')
)
metadata['images'] = {
    target: subprocess.check_output(
        ['docker', 'image', 'inspect', f'havefolio-{target}:{release}', '--format', '{{.Id}}'],
        text=True
    ).strip()
    for target in ['api', 'worker', 'web', 'migration']
}
temporary_json = pathlib.Path('release.json.next')
temporary_json.write_text(json.dumps(metadata, indent=2) + '\n')
temporary_json.chmod(0o600)
temporary_json.replace(path)
print("Atomically updated .env and release.json.")
PY
```

---

## 7. Optional Trusted LAN HTTP Sign-In (PER-60)

The default Havefolio deployment is **HTTPS-only** via Tailscale Serve. An operator may explicitly opt in to enable sign-in over a trusted local network IP.

### Security Implications

> [!WARNING]
> LAN HTTP transmits credentials and session tokens in cleartext across the local network. Only enable this on a private, trusted home network when explicitly required.
>
> - **Cookies**: Over HTTP, the browser receives a host-only `havefolio_lan_session` cookie (HttpOnly, SameSite=Strict). It cannot use the `__Host-` Secure prefix. HTTPS sessions retain their Secure `__Host-havefolio_session` cookie.
> - **Origin Restriction**: Only the exact origin configured in `AUTH_LAN_HTTP_ORIGIN` is admitted. Wildcards, paths, or external origins are rejected.

### Enabling Trusted LAN HTTP Sign-In

1. **Add `AUTH_LAN_HTTP_ORIGIN` to API Environment**:

Edit `/opt/havefolio/secrets/shared-services/.env.production.api`:

```ini
AUTH_LAN_HTTP_ORIGIN=http://192.168.0.226:3020
```

2. **Verify Compose Port Bindings**:

In `/opt/havefolio/deployment/compose.yaml`, the `web` service binds both loopback (for Tailscale) and the specific LAN IP:

```yaml
    ports:
      - '127.0.0.1:3020:3000'
      - '192.168.0.226:3020:3000'
```

3. **Recreate Affected Containers**:

```sh
# [CT102 Container]
cd /opt/havefolio/deployment
docker compose up -d --wait api web
```

### Disabling Trusted LAN HTTP Sign-In

To return to HTTPS-only:

1. Remove `AUTH_LAN_HTTP_ORIGIN` from `/opt/havefolio/secrets/shared-services/.env.production.api`.
2. Remove the LAN IP binding from `compose.yaml` (keep `127.0.0.1:3020:3000`).
3. Recreate the containers:

```sh
# [CT102 Container]
cd /opt/havefolio/deployment
docker compose up -d --wait api web
```

Existing LAN sessions immediately cease to authenticate. HTTPS sessions continue uninterrupted.

---

## 8. Post-Deployment Verification & Observability

Run these verification steps after every rollout to prove operational health.

### A. Health and Readiness Endpoints

Execute inside `[CT102 Container]`:

```sh
# [CT102 Container]
# 1. Web availability probe (returns 200 OK)
curl -fsS http://127.0.0.1:3020/healthz

# 2. API process liveness probe (zero external dependencies, returns 200 OK)
curl -fsS http://127.0.0.1:3020/api/v1/health/live

# 3. API dependency readiness probe (checks PostgreSQL, Valkey, Cloudinary)
curl -fsS http://127.0.0.1:3020/api/v1/health/ready
```

Expected output for API readiness:

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

Verify over both LAN HTTP and Tailscale HTTPS:

```sh
# [Dev Machine]
for origin in http://192.168.0.226:3020 https://apps.taild40172.ts.net; do
  echo "Checking origin: $origin"
  curl -fsS -o /dev/null "$origin/login"
  curl -fsS "$origin/healthz"
  curl -fsS "$origin/api/v1/health/live"
  curl -fsS "$origin/api/v1/health/ready"
done
```

### B. Anonymous vs. Authenticated Route Verification

Ensure that unauthenticated requests cannot access private endpoints and public registration is blocked:

```sh
# [CT102 Container]
# 1. Private inventory access without cookie must return 401 Unauthorized
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3020/api/v1/items
# Expected: 401

# 2. Public registration must be disabled (returns 404 Not Found or 403 Forbidden)
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://127.0.0.1:3020/api/v1/auth/register
# Expected: 404 or 403
```

> [!NOTE]
> Anonymous 401 checks verify boundary enforcement but do not prove authenticated owner journeys. Authenticated journeys should be verified with authorized synthetic fixtures or by the owner logging into the web interface. Never reset or overwrite owner credentials for a smoke test.

### C. Container Status & Health Check

```sh
# [CT102 Container]
cd /opt/havefolio/deployment
docker compose ps
docker inspect $(docker compose ps -q api worker web) \
  --format '{{.Name}} image={{.Image}} restarts={{.RestartCount}} status={{.State.Status}}'
```

Verify all running services report `healthy` and `restarts=0`.

### D. Observability Verification

1. **Gatus Dashboard**:
   - Access: `http://192.168.0.226:8080` (or configured Gatus host).
   - Verify `Havefolio Web`, `Havefolio API Liveness`, and `Havefolio API Readiness` show green (100% uptime).
2. **Seq Structured Logging**:
   - Access: `http://192.168.0.226:5341`.
   - Filter query: `release = 'havefolio-<full-sha>'`.
   - Verify structured JSON logs are received with valid `requestId`, `correlationId`, and `service` fields. Confirm no sensitive cookies, tokens, or inventory data appear.
3. **GlitchTip**:
   - Access your GlitchTip project UI.
   - Verify the release `havefolio-<full-sha>` appears in the Releases tab with associated source maps.

---

## 9. Application Rollback Procedure

Havefolio uses an **application-only** rollback model.

> [!CAUTION]
> **Database Rollback Invariants**:
> - Drizzle schema migrations are strictly forward-only. **NEVER** run reverse SQL scripts or attempt to downgrade the database schema.
> - **NEVER** run `docker compose down -v`. This destroys local temporary volumes.
> - **NEVER** restore an old PostgreSQL backup over a live database during routine release rollback; doing so causes irreversible loss of owner inventory data added during the release.
> - Previous release containers are compatible with forward-only additive schema changes.

### Rollback Execution Steps

If the new release exhibits critical application defects:

1. **Identify Previous Working Release**:

Check the rollback snapshots in `/opt/havefolio/deployment/`:

```sh
# [CT102 Container]
cd /opt/havefolio/deployment
ls -ld rollback-*

# Inspect previous release from release.json backup
cat rollback-*/release.json | grep -E '(release|revision)'
```

Let `PREVIOUS_SHA` be the previous working commit SHA, and `ROLLBACK_DIR` be the backup path.

2. **Restore Previous Deployment Configuration**:

```sh
# [CT102 Container]
cd /opt/havefolio/deployment
export ROLLBACK_DIR=/opt/havefolio/deployment/REPLACE_WITH_ROLLBACK_DIRECTORY
unset RELEASE

cp -p "$ROLLBACK_DIR/compose.yaml" ./compose.yaml
cp -p "$ROLLBACK_DIR/.env" ./.env
for file in compose.override.yaml compose.override.yml; do
  if [ -f "$ROLLBACK_DIR/$file" ]; then cp -p "$ROLLBACK_DIR/$file" "./$file"; fi
done

docker compose config --quiet
```

3. **Recreate Containers with Previous Images**:

Because the previous images remain cached locally on CT102, Compose immediately recreates the containers:

```sh
# [CT102 Container]
cd /opt/havefolio/deployment
docker compose up -d --no-deps --wait api worker web
```

4. **Verify Health After Rollback**:

```sh
# [CT102 Container]
curl -fsS http://127.0.0.1:3020/api/v1/health/ready
```

5. **Update Release Metadata**:

```sh
# [CT102 Container]
cat <<EOF > /opt/havefolio/deployment/release.json
{
  "release": "havefolio-${PREVIOUS_SHA}",
  "deployedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "gitRevision": "${PREVIOUS_SHA}",
  "rollbackFrom": "${RELEASE_SHA}",
  "images": {
    "api": "havefolio-api:havefolio-${PREVIOUS_SHA}",
    "worker": "havefolio-worker:havefolio-${PREVIOUS_SHA}",
    "web": "havefolio-web:havefolio-${PREVIOUS_SHA}",
    "migration": "havefolio-migration:havefolio-${PREVIOUS_SHA}"
  }
}
EOF
```

---

## 10. Proxmox Host Maintenance & Thermal Safety

Proxmox CT102 runs on an Acer Aspire A514-54 laptop. Hardware thermals are actively managed on the physical host (`root@192.168.0.10`).

- **Fan Curve Service**: `acer-fan-curve.service` runs on the Proxmox host to prevent thermal throttling during Docker builds.
- **Inspect Thermals**:

```sh
# [Proxmox Host]
systemctl status acer-fan-curve.service --no-pager
sensors
```

See [PROXMOX_FAN_CONTROL.md](PROXMOX_FAN_CONTROL.md) for complete details on ACPI fan levels, hysteresis thresholds, and controller service management.

---

## 11. Authoritative References & Further Reading

For specific subsystems, consult the dedicated operational documents in `docs/operations/`:

- [CT102 Deployment Details](docs/operations/ct102-deployment.md) — Base deployment boundaries and first rollout history.
- [Shared Services Access & Isolation](docs/operations/shared-services.md) — Shared PostgreSQL and Valkey architecture, roles, and ACLs.
- [Health Monitoring & Gatus](docs/operations/health-monitoring.md) — Health contracts, single-flight probe protection, and Gatus configuration.
- [Structured Logging](docs/operations/structured-logging.md) — Pino JSON formatting, redaction, request correlation, and Seq ingestion.
- [GlitchTip Monitoring](docs/operations/glitchtip-monitoring.md) — Error reporting, BuildKit source-map uploads, and privacy boundaries.
- [Authentication Operations](docs/operations/authentication.md) — Session management, cookie attributes, and LAN HTTP opt-in rules.
- [Owner Sign-In Runbook](docs/operations/owner-sign-in.md) — Owner bootstrap and sign-in flow verification.
- [Monitoring Build Configuration](MONITORING_BUILD.md) — BuildKit secret mounting for monitoring configurations.
- [Proxmox Fan Control](PROXMOX_FAN_CONTROL.md) — Hardware thermal management for the Proxmox physical host.
