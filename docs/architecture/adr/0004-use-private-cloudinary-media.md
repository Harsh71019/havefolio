# ADR-0004: Use private Cloudinary media storage

## Status

Accepted by explicit user instruction on 2026-09-30; PER-12. Supersedes ADR-0003's initial local-volume provider choice, while retaining its storage interface and private-access requirements.

## Context

The PER-5 read-only preflight found only 6.30 GiB available on CT102 against the 10 GiB local-media enablement gate, plus unverified backup coverage. The user chose Cloudinary instead of capacity remediation. No cleanup or resize is authorised. Authentication and item/user models are still pending PER-7/8.

## Decision

Use server-side Cloudinary SDK 2.11.0 through `PrivateMediaStorage`. Store JPEG/PNG/WebP as authenticated image assets and PDFs as authenticated raw assets. Use opaque UUID keys under `havefolio/<NODE_ENV>/`, no private filenames or owner data in provider keys/metadata, no unsigned browser upload and no persistent public URLs. Generate 60-second authenticated API download links only after a server service ownership lookup; ordinary CDN URL signatures alone are not expiry controls. This approach does not require assuming paid token/CDN features, but account capabilities still require a live smoke test.

Persist pending intent before upload, promote to ready only after verified provider response, and retain deleting/deleted records for exact-key reconciliation. Recovery uses a state/timestamp compare-and-set so stale pending work cannot delete ready media. Keep provider URLs and secrets out of browser bundles/logs. Expose no media HTTP routes until authentication, owner/item integration, quotas and full validation exist.

## Alternatives and trade-offs

Local filesystem remains a future adapter option but is deferred; local capacity cleanup/resize is not needed for permanent Cloudinary media. This does not resolve CT root-disk image/deployment headroom, memory or PostgreSQL backup needs. S3/object storage was not chosen because the user explicitly requested Cloudinary; no duplicate database/cache or local object-store service is added.

Cloudinary receives private original media and brings Internet dependency, provider retention/cost and portability concerns. Authenticated assets protect originals and derivatives; the `private` type alone can expose derivatives by default. Time-limited API download URLs are bearer capabilities and cost additional bandwidth; use them conservatively until a reviewed private image delivery design exists. Manual inventory operations must remain usable during provider failures.

## Consequences and follow-ups

The adapter is off by default. Operators must configure a dedicated Cloudinary environment and protected server credentials, verify authenticated image/raw access and deletion, establish budget monitoring and prove coordinated metadata/media export and recovery before production. PER-13 owns image decoding/EXIF/variants and client upload flow; PER-14 private document UX; PER-15 gallery; PER-7/8 identity/ownership; PER-40 deployment; PER-50/51 health and monitoring. No application rollout or provider account purchase is included.

## Sources

- [Cloudinary access controls](https://cloudinary.com/documentation/control_access_to_media)
- [Cloudinary upload API](https://cloudinary.com/documentation/image_upload_api_reference)
- [Cloudinary Node SDK](https://cloudinary.com/documentation/node_integration)
