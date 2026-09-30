# PER-4 verification

Verified on 2026-09-30. No connection values, operator paths, private addresses or raw service logs are included.

| Gate | Result |
| --- | --- |
| Frozen-lockfile install | PASS |
| `pnpm check`: lint, formatting, typecheck, unit/component tests, production builds | PASS |
| Infrastructure policy (4 Python, 2 Node) and isolation policy (2 Node) | PASS |
| Migration gate regression: valid history, schema drift, CLI failure, uncommitted SQL, immutable history | PASS |
| NestJS application unit contract | PASS |
| React navigation semantics and keyboard focus (2 tests) | PASS |
| NestJS HTTP and real migration/service integration (2 tests) | PASS locally and on PER-3 shared test services |
| `pnpm db:migrate` on a new empty disposable database; repeat application | PASS |
| Runtime role CREATE/ALTER/migration denial and runtime DML/constraints | PASS |
| Three fresh schemas/journals/key namespaces; simulated failure cleans one and preserves the others | PASS |
| Two separate shared-service integration verifier processes run concurrently | PASS |
| Authenticated shared Valkey ACL rejects out-of-namespace write | PASS |
| `pnpm db:check` against committed artifacts and base history | PASS |
| Intentionally changed schema/SQL rejected with non-zero status and source restored | PASS |
| Playwright production startup and four navigation routes | PASS on desktop and mobile |
| Staged diff credential/private-address scan and whitespace check | PASS |
| Main requires strict `Repository gates`, including administrators | Configured and read back through GitHub API |

The shared test database stays intact: suites create and remove only their own random schemas and exact expiring keys. No shared-service restart, reprovisioning, production migration or deployment occurred. Ephemeral local/CI PostgreSQL and Valkey containers are distinct from shared production services.

The initial schema contains infrastructure metadata only. No user/domain tables or data fixtures are introduced. Domain tests will accompany domain implementation tickets. Legacy unauthenticated Valkey default access remains the PER-3 infrastructure limitation; process termination can leave a schema needing exact, reviewed operator cleanup. See the [operating guide](./migrations-and-tests.md).
