# Private receipt and warranty uploads (PER-14)

Receipt and warranty proof uses the existing `media_attachments` model, owner/item foreign keys,
PER-12 server-only Cloudinary adapter and PER-13 recovery scheduler. No migration, production
migration, gallery UI or item-detail UI change is required. Warranty proof is an attachment with
`kind=warranty`; `item_warranties` remains the separate owner/item record of provider, dates and
terms. Uploading proof creates no dates or warranty metadata.

## HTTP contract

All routes require the PER-8 session and recheck the authenticated owner, item and attachment.
Cross-owner and wrong-item reads return safe not-found errors. Owner claims in multipart fields
are rejected. OpenAPI documents multipart, binary download and error responses.

- `POST /api/v1/items/{itemId}/documents`: exactly one `document` file and an explicit `kind` of
  `receipt` or `warranty`, with a UUID-v4 `Upload-Id` header. Returns safe ready metadata.
- `GET /api/v1/items/{itemId}/documents`: at most 16 ready original documents and item revision.
- `GET /api/v1/items/{itemId}/documents/{documentId}/download`: bytes through the API with
  owner authorization on every request; no provider URL/key is returned.
- `DELETE /api/v1/items/{itemId}/documents/{documentId}`: item revision in JSON body; returns
  the updated document snapshot. Failed cleanup hides access and is retryable.

All documents, including safe images, download as attachments. Headers explicitly set the validated
content type, `nosniff`, `private, no-store`, `no-referrer`, sandbox CSP and standards-compliant
Content-Disposition (`filename` and RFC 5987 `filename*`). Names are generated `receipt.pdf`,
`warranty.pdf`, `receipt.webp` or `warranty.webp`. Original names never reach provider keys,
response headers or persistent metadata; control characters and path separators are rejected.

Document access is more restricted than photos: no signed URL response, inline preview, display/
thumbnail variants, ordering or cover selection. Existing photo queries/order/access explicitly
filter photo kind; integration tests reject documents on those routes and photos on document routes.

## Content and resource policy

JPEG, PNG and WebP must match declared MIME, extension, actual signature and successful decoding.
PER-13 Sharp processing applies orientation, image/frame/dimension limits and metadata removal.
Only the sanitized original WebP output is retained; generated display/thumbnail bytes are discarded.
Images retain the existing 10 MiB/file input bound, 24 MP and 8192-axis bounds and decoder deadline.

PDFs retain the PER-12 20 MiB/file bound. A request is at most 21 MiB including multipart overhead,
with one file, one bounded kind field and a 30-second receive deadline. These bounds also apply
without Content-Length. A process accepts one document upload at a time. Shared storage quotas
remain 2 GiB/owner and 4 GiB/application, serialized with the same owner/global locks as photos.
A maximum of 16 active documents/item keeps metadata listing and deletion bounded.

PDF validation uses exactly pinned `@libpdf/core` 0.5.1, following its
[documented low-level object model](https://libpdf.documenso.com/docs/advanced/library-authors).
Strict loading disables lenient repair; encryption (including empty-password encryption), recovery
and parser warnings are rejected. Header/end marker checks reject obvious truncation. The parser
walks resolved dictionaries, arrays, names, references and decoded streams; escaped names and
compressed object streams are interpreted by the parser, rather than matched only against raw bytes.
Actions, JavaScript, launch, external file/URL references, embedded files, XFA/forms, rich media,
PostScript and related active content are conservatively rejected. No rendering, OCR, field extraction,
network fetch or action execution occurs in the parser.

PDFs are limited to 100 pages, 20,000 indirect object numbers, 100,000 visited nodes, depth 128,
64 MiB aggregate decoded streams and finite positive page dimensions at most 14,400 points.
Parsing runs in a disposable child with a 128 MiB V8 heap limit, a ten-second kill deadline and
256 MiB resident-memory kill threshold sampled every 100 ms. Linux reads `/proc`; macOS uses
`/bin/ps`. Sampling can overshoot the threshold briefly; production container memory limits must
provide the final OS-level ceiling. Parser stdout is bounded, stderr suppressed, environment contains
no credentials, and only a validity marker is returned. Input/output buffers are released/scrubbed
on completion; no persistent temporary document files are created. Rejected features and budgets
are deliberate conservative support limits, so some otherwise readable PDFs require a simpler export.

## Storage and recovery

Images are Cloudinary authenticated image assets, PDFs authenticated raw assets with opaque
UUID/environment keys. Browser uploads and public assets are never used. Downloads use the existing
60-second authenticated provider signature only inside the server; bounded provider fetches reject
redirects, oversized/truncated responses and enforce a 30-second deadline. The API verifies the
stored checksum before delivering bytes and supplies its own trusted download headers. At most two
document downloads retain buffers per process, with a 30-second response inactivity timeout and
release on disconnect/failure.

Owner-scoped Upload-Id plus validated content/kind/item deduplicates ready retries. Durable pending
intent and quota reservation commit before any provider write. Ready publication and item revision
advance atomically. Failed writes re-read durable state under the owner lock: confirmed pending
intent is cleaned by exact key through PER-12, while an ambiguous ready commit is preserved.
If state or cleanup cannot be established, pending/deleting intent remains for reconciliation; a
failed/recovered Upload-Id must be replaced after cleanup, preventing late-write resurrection.

Deletion commits `deleting` separately before touching the provider, removes only the exact object
with invalidation, and scrubs filename/checksum/dimensions/provider metadata on confirmation.
Provider or database failures preserve recoverable intent. Existing PER-12 tombstones retain only
cleanup identity, not document content, for repeat invalidation of ambiguous late writes; tombstone pruning requires the
existing PER-12 reviewed provider-finality/retention gate. There is no automatic pruning policy. Item deletion handles documents through
the same exact-key cleanup and detaches only confirmed-deleted tombstones before erasure. Its
active-cleanup bound excludes already-deleted tombstones, so repeated document upload/deletion
cycles cannot block later item erasure.

## Verification and release boundaries

Fixtures are generated synthetic PDFs/images, fake provider identifiers and reserved example.test
identities; no personal document or protected service fixture is committed. Unit/provider and
isolated PostgreSQL/Valkey HTTP tests cover content policy, authorization, retry/ambiguous commits,
cleanup/provider/SQL failures, headers, quotas, photo exclusion, item erasure and OpenAPI.

Live Cloudinary account raw/PDF availability, unsigned denial, signed access expiry, download API
redirect behaviour, deletion/invalidation, backups/export/restore and CT102 memory/headroom still
require release verification. No live provider operation or production deployment is performed by
this ticket. PER-40 and PER-52 PRs were open at start. This branch was subsequently rebased onto merged
PER-40 deployment PR #14 after its main CI passed. Sign-in PR #13 remains open; its code is
not assumed on main. PER-40 already supplies API container memory/process limits; PDF workload
headroom and raw-document provider delivery still need deployment verification. OCR, extraction, reminders, public sharing, gallery changes and local
CT102 document storage remain outside PER-14.
