# PER-40: private CT102 deployment

Build `deployment/Dockerfile` targets `api`, `worker`, `web`, and `migration` for Linux amd64. Use a unique immutable release tag for all four images. The build installs the committed lockfile, builds workspace packages, and exports production dependencies. Images contain no environment files or credentials. Web requests use the internal same-origin API proxy; Cloudinary credentials belong only to the API.

Compose uses the existing external `shared-services` network. PostgreSQL and Valkey are not part of this stack. API and worker use their separate protected `/opt/havefolio/secrets/shared-services/.env.production.*` files. Migration credentials are used only by the one-shot migration service. Runtime processes run as the unprivileged Node user with dropped capabilities, read-only roots, bounded temporary storage, bounded logs and memory/CPU limits. No local media volume is needed for Cloudinary.

Set API `NODE_ENV=production`, `API_CORS_ORIGIN=https://apps.taild40172.ts.net`, `AUTH_REGISTRATION_ENABLED=false`, `API_DOCS_ENABLED=false`, and `MEDIA_STORAGE_ENABLED=true`. Retain existing protected runtime database, API ACL, Cloudinary and HMAC credentials. Keep `VALKEY_PREFIX=havefolio:production`. Worker uses its worker ACL and queue prefix, never API/migration credentials.

Before rollout inspect disk/memory, existing service health, port 3020 and Tailscale Serve configuration. Do not overwrite an existing Serve route. After loading the release images on CT102:

```sh
cd /opt/havefolio/deployment
export RELEASE=<immutable-release-tag>
docker compose run --rm migrate
# Bootstrap the configured owner only after inspecting for an existing credentialed owner.
docker compose up -d --wait api worker web
# Only when the apps node's HTTPS root has no existing route:
tailscale serve --bg --https=443 http://127.0.0.1:3020
```

The web host port binds only to loopback; API, worker and database/cache have no new published ports. Tailscale terminates private HTTPS. The user explicitly selected this in place of the original NPMplus criterion. The API startup checks actual database/schema and authenticated Valkey availability and fails safely when unavailable. Process health is intentionally separate from that startup gate; ongoing dependency-aware monitoring remains PER-41.

Owner bootstrap takes a precomputed Argon2id hash from `/opt/havefolio/secrets/owner-bootstrap.json` (0600, root-only directory). Use a parameterized transaction against the runtime role with the same advisory lock as registration. Refuse to overwrite another credentialed owner or bind an identity shell. Registration remains disabled. Do not copy this file into an image or expose the hash or password in logs. Verify HTTPS login, HttpOnly/Secure/SameSite cookie, private API denial, owner inventory and a synthetic upload/private access/deletion after rollout. Never use private fixtures for smoke tests.

Record deployed Git revisions and image IDs in `/opt/havefolio/deployment/release.json`. Keep the previous image tag and Compose configuration for rollback. To roll back application containers, set `RELEASE` to the prior compatible tag and recreate only this stack's api/worker/web services. Never reverse applied SQL, restore old data over live data, remove shared services, or run `down -v`. On the first deployment there is no earlier application release: stop only Havefolio services and remove only its Serve route if the release fails. Additive migrations remain applied for a corrected forward rollout.

This deployment does not implement the rest of the product backlog, provider backup/restore, full observability, password recovery or broader hardening. The owner sign-in prerequisite is tracked separately under PER-52.
