# ADR-0001: Use a TypeScript modular monolith

## Status

Accepted

## Context

Havefolio starts as a private household application for 1–10 concurrent users on one Proxmox guest. It has several product domains—inventory, spending, desires, goals, media and notifications—but no current need for independent team ownership or service-level scaling. Operational simplicity and fast end-to-end delivery matter more than theoretical horizontal scale.

The selected frontend is Next.js and the selected backend is NestJS. Background reminders and media processing require a small worker.

## Decision

Use a TypeScript `pnpm` monorepo containing:

- A Next.js web application.
- A NestJS modular-monolith REST API.
- A small BullMQ worker that reuses domain/application packages.
- Shared packages for contracts, database access, configuration and test utilities where justified.

Deploy web, API and worker as separate containers, but keep one codebase, one relational data model and one coordinated release.

## Consequences

### Positive

- Simple local development, deployment, debugging and transactions.
- Clear domain boundaries without network calls between every feature.
- End-to-end TypeScript contracts and shared tooling.
- API and worker can share business rules without copying them.
- Modules can be extracted later if measured requirements justify it.

### Negative

- Application modules cannot scale or deploy independently.
- Weak discipline could allow cross-module coupling.
- A coordinated release affects web, API and worker together.
- Separate containers consume more memory than a single all-in-one process.

### Neutral

- Module boundaries are enforced by repository conventions and dependency tests rather than service network boundaries.
- PostgreSQL remains shared across modules, with ownership expressed in code and migrations.

## Alternatives considered

### Single Next.js application with route handlers

Rejected because a dedicated API and worker give clearer backend ownership, OpenAPI contracts, queue reuse and long-running job isolation. It would use less memory but blur application boundaries as the domain grows.

### Microservices

Rejected for the MVP because service discovery, distributed tracing, network failure, eventual consistency and multiple release pipelines add cost without a measured scaling or team requirement.

### Go or Rust backend

Not selected for the MVP. Both can provide lower runtime overhead, but NestJS best matches the current developer experience, delivery speed and shared TypeScript contracts. This can be revisited only with profiling evidence or a new operational constraint.

## References

- [MVP architecture](../README.md)
- `anti-consumerism-app-build-prompt.md`
- PER-1
