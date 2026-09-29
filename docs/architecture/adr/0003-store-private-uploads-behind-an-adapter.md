# ADR-0003: Store private uploads behind an adapter

## Status

Proposed

## Context

Havefolio stores private item photos, receipts and warranty documents. CT102 has constrained resources and no requirement yet for horizontal application instances. Adding an object-storage service such as MinIO now would increase operational and capacity costs, but coupling domain code directly to local filesystem paths would make future migration difficult and could expose private files accidentally.

## Decision

- Define an application storage interface for put, read, delete and derived-object operations.
- Implement the MVP adapter using a persistent CT102 volume.
- Generate opaque object keys inside the application; never use user filenames as paths.
- Store ownership, media type, size, checksum, lifecycle and provenance metadata in PostgreSQL.
- Serve objects only through authenticated and authorised API access or deliberately short-lived signed access supported by a future adapter.
- Keep the upload directory outside public web roots.
- Validate file size, declared MIME type, detected signature and image-processing limits.
- Make writes and cleanup idempotent so failed operations do not leave trusted partial metadata.

## Consequences

### Positive

- Avoids another production service during the MVP.
- Keeps media private by default.
- Provides a defined migration path to S3-compatible storage.
- Centralises validation, naming, quotas and cleanup.

### Negative

- Local volume durability is limited by the CT102 storage and backup design.
- Multiple API instances cannot safely assume local-only access without shared mounting or an object-store migration.
- Capacity and inode pressure require explicit monitoring.
- Backup and restore must coordinate PostgreSQL metadata with media objects.

### Neutral

- The adapter boundary adds a small amount of code before multiple implementations exist.
- Image transformation may run in the worker but follows the same storage interface.

## Alternatives considered

### Public static upload directory

Rejected because predictable or leaked URLs could expose private inventory and receipt data and would bypass owner authorisation.

### MinIO on CT102

Deferred because S3 semantics are useful but do not yet justify another memory-, storage- and operations-heavy service. Reconsider after the capacity preflight or when multi-instance access is required.

### External cloud object storage

Deferred because it adds cost, Internet dependency and a third-party privacy boundary. The adapter keeps this option available.

### Store binary files in PostgreSQL

Rejected because large media would complicate database backup size, I/O and serving without improving the product model.

## References

- [MVP architecture](../README.md)
- PER-1
- PER-5
- PER-12 through PER-15
