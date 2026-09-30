# PER-3: shared-service access

## Isolation and operational effects

Reuse `shared-postgres` and `shared-redis` on the external `shared-services` Docker network. Connection files use these DNS names. No PostgreSQL or Valkey container is added. Operator commands run on the Docker host with Python 3, Docker Compose, and access to the existing PostgreSQL administrator through its container environment. Never copy that administrator credential into Havefolio environments.

| Environment | Database | Migration role | Runtime role | Valkey identities | Key/channel prefix |
| --- | --- | --- | --- | --- | --- |
| Development | `havefolio_dev` | `havefolio_dev_migrate` | `havefolio_dev_runtime` | `havefolio_dev_api`, `havefolio_dev_worker` | `havefolio:dev:*` |
| Test | `havefolio_test` | `havefolio_test_migrate` | `havefolio_test_runtime` | `havefolio_test_api`, `havefolio_test_worker` | `havefolio:test:*` |
| Production | `havefolio` | `havefolio_migrate` | `havefolio_runtime` | `havefolio_production_api`, `havefolio_production_worker` | `havefolio:production:*` |

Migration roles own only their database. Runtime roles have CONNECT, schema USAGE, table SELECT/INSERT/UPDATE/DELETE and sequence USAGE/SELECT. Future migration-created tables/sequences inherit these grants. Runtime roles have no database/schema creation, temporary tables, role membership, superuser, database creation, role administration, replication or RLS bypass. New functions have no default PUBLIC execute grant; migrations must explicitly grant safe application functions. Additional schemas need reviewed grants in PER-4 migrations.

Existing databases grant PUBLIC connection access. PostgreSQL has no per-role negative database ACL. A managed block **before existing `pg_hba.conf` rules** permits each Havefolio identity into only its own database, then rejects other local/IPv4/IPv6 database connections. It persists on the existing PostgreSQL volume. Only configuration reload is needed; other roles' rules/grants and existing sessions are unaffected. Do not replace this with global PUBLIC revocations: those can interrupt other applications.

Valkey ACLs use explicit commands, environment-specific key patterns and channel patterns. They permit BullMQ's data/Lua/stream/blocking commands and selected connection subcommands. They deny global key discovery, CONFIG, ACL, FLUSH, MONITOR and script flushing. API producers and workers use different credentials. Lua and multi-key operations are checked by Valkey's ACL enforcement. Worker configuration rejects prefixes outside its environment, missing/different worker identities and databases other than zero when queues are enabled. Test runs can append a safe suffix, such as `havefolio:test:run_123`.

**Shared-network limitation:** existing Valkey consumers use an unrestricted, unauthenticated default identity. It is deliberately preserved. Isolation checks prove the permissions of authenticated Havefolio identities and configured clients, not isolation against an untrusted process reconnecting as the default user on the shared network. Removing that legacy access needs a coordinated migration of existing consumers and separate approval. Shared-network membership must remain trusted; do not expose Valkey publicly. This is a remaining infrastructure risk, not a claim of complete network-level tenant isolation.

Valkey originally started without an ACL file. `aclfile` is immutable on this live version, so provisioning stages the ACL file on its existing volume. A separately approved, controlled Compose recreation adds only `--aclfile /data/havefolio-users.acl`. It preserves existing ACLs, images, volumes, networks, logging, resource overrides and default identity. Existing clients briefly disconnect; no data volume is removed. ACL rules store password hashes in a mode-0600 file.

## Protected operator state

Choose a root-owned directory outside the repository, mode 0700; below, `STATE_DIR` and `TOOL_DIR` are operator-selected absolute paths. Do not enable shell tracing or print files, SQL, Docker inspect environments, Compose rendered configuration or CLI errors. Tools capture service output and report safe assertions only. Never upload operator state as CI/PR artifacts.

State contains mode-0600 generated credentials, separate `.env.<environment>.api`, `.env.<environment>.worker`, and `.env.<environment>.migration` files, plus private health/configuration/ACL/snapshot backups. The migration file contains only the migration URL; API/worker files contain only runtime database credentials and their own Valkey identity. Mount/pass only the appropriate file to each process. Never provide migration credentials to API, worker or web. `.env.example` contains placeholders only. Do not copy it unchanged into production.

Backup this protected state through the existing encrypted backup mechanism. Losing it requires an explicitly reviewed credential recovery/rotation, not deleting and reprovisioning databases. Scripts reuse the existing passwords on repeat runs; they do not rotate them. A host-level advisory lock prevents concurrent provisioning and persistence changes.

## Provisioning procedure

1. Read-only audit the existing service topology, consumers, persistent volumes, capacity and Compose overrides. Confirm an operator-approved maintenance window before any Valkey recreation.
2. Copy the repository's `scripts/shared-services/*.py` to `TOOL_DIR` on the existing Docker host. Set root-only permissions on operator state.
3. Capture the baseline before modifying services:

   ```sh
   python3 "$TOOL_DIR/provision.py" inspect --state-dir "$STATE_DIR"
   ```

4. Provision only Havefolio databases/roles and ACLs, stage persistence and run privilege checks:

   ```sh
   python3 "$TOOL_DIR/provision.py" provision --state-dir "$STATE_DIR"
   ```

   Pre-existing unmanaged Havefolio databases/roles cause a stop. Unexpected database ownership or ACL persistence configuration also causes a stop. New database creation is intentionally outside a SQL transaction; each database's grants are transactional. A partial attempt can be resumed with the same protected state. Existing Havefolio records are preserved.

5. **With explicit approval for the brief consumer interruption**, configure persistent startup and recreate only the existing Valkey service:

   ```sh
   python3 "$TOOL_DIR/persist-valkey.py" --state-dir "$STATE_DIR" --approved-restart
   ```

   The tool snapshots data first, validates Compose, preserves files/overrides, captures command output, waits for consumer recovery and restores the original Compose if recovery fails. Repeating an already configured persistence step does not restart Valkey. Redis-specific overrides or non-default startup commands require operator review.

6. Prove post-restart isolation and consumer health:

   ```sh
   python3 "$TOOL_DIR/provision.py" verify --state-dir "$STATE_DIR"
   ```

   This verifies role flags/membership; migration DDL; runtime DML and default sequence grants; denied runtime DDL/database creation/temporary tables/role elevation/administrative credential reads; actual rejected connections to every other connectable database including `treasury_ops` and `admin`; both identities' allowed/denied keys, cross-environment keys, channels, multi-key and Lua operations; global/admin command denials; persistent ACL configuration; and the previously running/healthy consumer baseline. Random probe tables are removed in `finally`, and probe keys expire after 60 seconds even if interrupted. Verification temporarily writes only its own random probe objects.

7. Repeat provisioning and verification once to establish idempotence. Do not rerun `inspect` to overwrite the original baseline during this change. Investigate any new failure before application rollout.

## Real BullMQ smoke

From the reviewed checkout, deploy the lockfile-pinned worker dependencies into a disposable directory using `pnpm --filter @havefolio/worker deploy --prod --os linux --cpu x64 --libc musl --ignore-scripts <directory>`. The worker explicitly pins `ioredis`: BullMQ 6 declares the transport as an optional peer and enabling queues requires it. Target Linux/x64/musl for the approved Alpine verifier image. Ensure the deployment includes `test/shared-services.smoke.mjs`; copy that disposable deployment to the Docker host. Do not copy root environment files. Review available disk capacity before staging dependencies or pulling an operator image.

Pull an approved Node 24 image, record its digest privately, then run:

```sh
python3 "$TOOL_DIR/verify-bullmq.py" --state-dir "$STATE_DIR" \
  --worker-dir "$WORKER_PROBE_DIR" --image "$PINNED_NODE_IMAGE"
```

The tool starts a temporary, non-root, read-only Node verifier on `shared-services`, with dropped capabilities, no Docker socket, and bounded CPU/memory/processes. It passes credentials through captured stdin. The real pinned BullMQ Queue/QueueEvents use the API identity; the Worker uses its separate identity. One test job must complete. Only the operator can discover and delete the exact random probe queue's residual keys; application identities cannot SCAN. Delete the disposable deployment/archive after verification. This adds no data-service container and the verifier container is removed automatically.

## Rollback and limits

- PostgreSQL: disable new Havefolio role logins to stop new Havefolio sessions. Removing only the managed HBA block and reloading restores original authentication rules, but first revoke/disable Havefolio identities to avoid PUBLIC cross-database access. Do not overwrite unrelated intervening edits with a whole-file backup. Existing application roles/databases need no changes.
- Valkey: the persistence tool automatically restores its original Compose on failure. This can require a second brief restart. Existing default-user consumers retain their original permissions. Havefolio must remain disabled until its ACLs are reprovisioned and verified. Restore only the approved service command from the private backup; never run `down -v`, flush keys, or delete volumes.
- Do not restore an old data snapshot over a live dataset as routine rollback. Keep the snapshot for an explicitly approved recovery scenario.
- Database/schema/role deletion, active session termination, password rotation, default-user hardening and key/volume deletion require separate review and approval. No destructive teardown script is provided.
- Configuration backups contain operational details and may contain secrets; retain only through protected storage with bounded retention.
- No application schema migration, UI, upload, telemetry provider or deployment rollout is introduced. PER-4 owns Drizzle migrations/integration test infrastructure; PER-40 owns the application deployment. Neither application startup nor CI accesses infrastructure administrator credentials.
- No GitHub branch-protection requirements were configured at implementation time. The PR adds a `Repository gates` workflow for existing format/lint/typecheck/test/build scripts and infrastructure policy tests; administrators should select it as a required check if merge protection is desired.

See [verification evidence](./shared-services-verification.md).
