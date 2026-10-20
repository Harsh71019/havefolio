# PER-47: mobile capture resilience

PER-47 makes add-item capture on phones dependable. It converts HEIC photos where the browser can safely do so, keeps recoverable text drafts only with explicit consent, and makes item-creation retries idempotent. It also adds optional installability metadata without a service worker. This page records the storage and privacy policy, which was also recorded on the Kan card before implementation.

## HEIC/HEIF

- The API's Sharp 0.35.5 bundles libheif with AV1 (AVIF) decoding only, not HEVC. The API therefore keeps rejecting HEIC with `PHOTO_HEIC_UNSUPPORTED`, and no external conversion service is used.
- `components/heic-conversion.ts` checks once per page load whether the browser can decode HEIC, using an embedded 2×2 synthetic HEIC (617 bytes, no metadata). Where decoding works (Safari/WebKit, including iOS 17+), a HEIC file is drawn to a canvas and re-encoded as JPEG at quality 0.9.
- Conversion bounds: ≤10 MiB input, longest edge scaled to ≤4096 px (the API's stored master size, and within iOS canvas limits), 15 s decode/encode timeout, ≤10 MiB output. Files are converted one at a time to limit memory use.
- Detection matches the API's ISO-BMFF brand check, so HEIC files with no MIME type or a misleading name are still caught.
- Source metadata (GPS, camera, timestamps) never reaches the canvas. Verified in Playwright WebKit 26.6: the encoder adds only a 76-byte EXIF block (ColorSpace and pixel dimensions) and an empty Photoshop IRB, with no GPS IFD. The API still validates signature, MIME type and size, decodes in its bounded child process, re-encodes to WebP and strips metadata. No server limits were relaxed.
- Conversion runs **once, at selection**. The converted `File` is kept in memory, so every retry sends identical bytes under the same `Upload-Id`; the server's checksum-based recovery therefore applies. HEIC is never stored on the device.
- Unsupported browsers (Chromium/Firefox today) show actionable guidance: open the photo from the iPhone library (iOS shares it as JPEG), set Camera › Formats to Most Compatible, export as JPEG/PNG/WebP, or save the item now and add photos later. The gallery picker accepts `.heic` only when conversion is supported. The camera input stays JPEG/PNG/WebP.
- Desire photos keep the existing client-side HEIC rejection. Extending conversion to them is a follow-up.

## Local text drafts: policy

| Aspect          | Decision                                                                                                                                                                                                                                                                                         |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Scope           | The add-item form only. Edit, desire and goal forms stay memory-only.                                                                                                                                                                                                                            |
| Consent         | Off by default. The "Keep a draft on this device" switch is remembered per owner and device. When off, text stays in page memory: it survives offline periods and failed saves, but not reloads. Turning the switch off deletes the stored draft immediately and keeps the text on the page. |
| Retained fields | Name, status, currency, typed price / unknown flag, date precision and parts, category/subcategory/tag IDs, brand, model, description, notes, acquisition/condition/frequency, the pending create `commandId`, owner ID and timestamp.                                                            |
| Never stored    | Merchant selection, purchase URL, photos/files/previews/blobs, server responses, cookies, tokens, credentials, signed or private media URLs, provider keys.                                                                                                                                       |
| Owner isolation | Each record carries its owner ID and is returned only when it matches `/auth/me`. On sign-in (login page or inline) and on authenticated form load, other owners' drafts and consent are deleted. An inline sign-in as a different owner also clears the in-memory form.                      |
| Expiry / quota  | Deleted on read 7 days after the last edit. Future timestamps are rejected. One draft per owner, capped at 64 KiB serialized (enough for maximum field lengths in any script); larger drafts are not stored and the owner is told.                                                              |
| Discard         | "Discard draft" button. A successful save, "Add another item" and emptying the form also clear it.                                                                                                                                                                                              |
| Logout          | The new Settings → "Log out of this device" removes all drafts and consent **before** calling the existing `POST /auth/logout`, then does a full navigation to `/login`.                                                                                                                         |
| Account deletion | Submitting deletion removes all drafts and consent; only the existing deletion receipt remains.                                                                                                                                                                                                 |
| Labelling       | "Restored from this device. It is not saved to your inventory yet." and "Draft kept on this device at hh:mm — not saved to your inventory yet." These are distinct from the "saved to your home" confirmation.                                                                                    |
| Legacy (PER-11) | The earlier unconsented `havefolio_item_draft_v1_*` draft is loaded into memory once for its owner (if under 7 days old) and then removed from storage. It is stored again only with consent.                                                                                                    |

Limitations: revoking other sessions cannot reach another device's browser storage. Drafts there expire within 7 days or are removed at the next sign-in by a different owner. localStorage is not encrypted at rest beyond the operating system's protections; that is why storage is opt-in and bounded. Telemetry never receives draft content.

## Idempotent item creation

`POST /api/v1/items` accepts an optional `commandId` (UUIDv4), following the existing `*_COMMAND_REUSED` convention. The service derives the item ID as `sha256("item:" + owner + ":" + commandId)` formatted as a UUID and takes a transaction advisory lock on it. If a row already exists, it compares that row's immutable `original_entry` with the request:

- identical → the saved item is returned (201), with no second item, tag set or `created` event;
- different → `409 ITEM_COMMAND_REUSED`.

The command is not stored and is excluded from `originalEntry`. No migration is needed. The derivation includes the owner, so commands from different owners cannot collide. The client reuses one command until a confirmed save and keeps it with a consented draft, so a retry after a lost response, a reload or a reconnect cannot duplicate the item. On `ITEM_COMMAND_REUSED` the owner is told an earlier attempt saved the item. A separate item is saved only when the owner chooses "Save as a new item". If the saved item was deleted before the retry, the retry creates it again.

Photo uploads keep the PER-13 `Upload-Id` contract. The panel adds cancellation (abort, then retry with the same ID), offline guidance, and clearer session-expiry text: a 401 means nothing was saved, so the owner signs in again and adds the photo.

## Offline and secure-context behaviour

- `navigator.onLine` only drives guidance. Every failed request is still treated as possibly offline. Nothing claims offline inventory access, and the inventory, photos and totals still require the server.
- Everything works in the approved trusted-LAN plain-HTTP deployment: `randomId()` falls back to `crypto.getRandomValues`, and localStorage, canvas and `online`/`offline` events do not require a secure context.

## Installability

`app/manifest.ts` and neutral icons (`public/icons`) add installability metadata, with Apple touch-icon and web-app metadata in the root layout. **There is no service worker and no Cache Storage use**, so nothing private, authenticated or financial is cached. Browsers offer installation only over HTTPS or on localhost; the LAN HTTP deployment stays a normal website, and iOS "Add to Home Screen" still creates a shortcut. Authentication is unchanged.

## Verification

- API integration: identical, concurrent and post-edit replay; different details return 409; owner scoping; invalid command; update rejects `commandId`.
- Component tests: draft consent, isolation, expiry, quota, legacy migration, purge, logout and deletion cleanup, blocked storage; commandId retry and conflict; inline owner switch; offline states; HEIC detection, bounds, scaling, timeout and failure; identical bytes and Upload-Id on retry; cancellation; session expiry.
- Playwright (Chromium desktop and Pixel 7): consented draft restore and discard; offline save failure, then reload and retry with one command; unsupported-HEIC guidance; manifest served with no service worker or caches. Screenshots: `docs/screenshots/per-47-*`.
- One-off local check (not part of CI, which runs Chromium only): Playwright WebKit 26.6 on macOS decoded a 64×48 synthetic HEIC, offered `.heic` in the gallery picker, uploaded `IMG_SYNTH.jpg` as `image/jpeg` (JPEG SOI bytes) and showed "Saved privately".
- Not verified: HEIC conversion in real Safari on iOS/macOS, EXIF orientation on rotated real photos, physical-camera capture, assistive-technology sessions on devices, and the install prompt over HTTPS. These need release testing on real devices.
