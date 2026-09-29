# ADR-0002: Reuse shared PostgreSQL and Valkey with isolation

## Status

Proposed

## Context

CT102 already runs healthy shared PostgreSQL and Valkey/Redis-compatible services on the `shared-services` Docker network. Adding duplicate database and cache containers would increase memory use, storage pressure and maintenance work on the same host.

Havefolio contains relational lifecycle and financial-aggregation rules that require transactions, constraints and explainable queries. It also needs ephemeral queue state for reminders and background processing.

## Decision

- Use the existing shared PostgreSQL instance as the primary datastore.
- Create isolated Havefolio development, test and production databases or equivalently strong isolated schemas.
- Use separate least-privilege migration and runtime roles.
- Use Drizzle ORM with reviewed, forward-only migrations.
- Use the existing shared Valkey service for BullMQ and ephemeral coordination.
- Use a dedicated Valkey ACL identity where supported and prefix every key/queue with `havefolio:`.
- Do not run new production PostgreSQL or Redis/Valkey containers for the MVP.

PostgreSQL is the durable source of truth. Valkey must not be the only record of a user decision, reminder intent or financial fact.

## Consequences

### Positive

- Reuses proven running infrastructure and reduces CT102 resource usage.
- PostgreSQL provides transactions, relational integrity and precise aggregation.
- Valkey provides the primitives expected by BullMQ.
- Dedicated identities and namespaces allow access testing and clearer operations.

### Negative

- A shared-service outage can affect multiple applications on CT102.
- Resource contention must be monitored and bounded.
- Incorrect grants or prefixes could expose or collide with another application’s data.
- Database upgrades require coordination with other consumers.

### Neutral

- Local and CI tests may use isolated ephemeral services; the restriction applies to production deployment.
- Scaling remains vertical/single-host until measurements justify another design.

## Alternatives considered

### Dedicated PostgreSQL and Redis containers

Rejected for production because isolation can be achieved with databases, roles, ACLs and prefixes without duplicating service overhead on the same guest.

### SQLite

Rejected because concurrent API/worker access, migrations, relational aggregation and deployment parity favour PostgreSQL.

### MongoDB

Rejected because the domain has relational ownership, lifecycle and financial rules that benefit from schema constraints and transactional joins.

### Valkey as durable application storage

Rejected because queue/cache availability must not determine whether user-owned facts are durable.

## References

- [MVP architecture](../README.md)
- PER-1
- PER-3
