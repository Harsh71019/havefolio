# PER-3 verification evidence

Verified on 2026-09-30 against the existing shared PostgreSQL 18.4 and Valkey 8.1.8 services. Credentials and raw infrastructure output are deliberately excluded.

| Check | Result |
| --- | --- |
| Existing services attached to `shared-services`, service DNS resolves | PASS |
| Three isolated databases with separate migration/runtime roles | PASS |
| Migration role creates a probe table; runtime performs DML using default table/sequence grants | PASS |
| Runtime cannot create tables/databases/temp tables, assume migration identity or read `pg_authid` | PASS |
| Both role types rejected from every other connectable database, including `treasury_ops` and `admin` | PASS |
| API and worker identities authenticate and read/write their environment's Havefolio prefix | PASS |
| Out-of-prefix/cross-environment/multi-key/Lua/channel operations denied | PASS |
| Global discovery/admin/config/flush operations denied | PASS |
| Approved controlled Valkey restart loads ACLs from the existing persistent volume | PASS |
| Existing running and previously healthy consumers recover without new restart-count changes | PASS |
| Repeat provisioning reuses credentials/data; repeat persistence performs no restart | PASS |
| Pinned BullMQ 6.3.10 API producer/QueueEvents and worker complete a real job with separate test ACLs | PASS |
| Narrow infrastructure policy/config tests (4 Python, 2 Node) | PASS |
| Repository lint, format check, typecheck, tests and production builds | PASS |

Several unrelated containers were already restarting before provisioning. They were preserved and excluded from claims of previously healthy consumer recovery. Shared PostgreSQL/Valkey connectivity and previously healthy Treasury Ops consumers passed before and after the approved restart.

The checks establish authenticated identity and configured-client isolation. The unrestricted legacy Valkey default identity remains a documented shared-network risk; see the operator procedure. Application data schemas, uploads, migrations and full application deployment are outside PER-3.

The real queue smoke identified the missing optional-peer transport; the worker now explicitly pins `ioredis` 5.11.1. Random queue metadata was cleaned by the operator after completion. No application schema migration was added.
