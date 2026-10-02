# PER-15: item photo gallery and image management

The management route is `/items/[itemId]/photos`. The PER-13 capture route `/items/[itemId]/photos/new` now shares the same upload panel and links to the manager. Neither route implements My Store (PER-16) or the full item details page (PER-18); `ItemCover` in `packages/ui/src/components/havefolio` is the reusable cover those screens consume. Receipts and warranties (PER-14) are never listed, selectable or deliverable through these endpoints.

## Image delivery

PER-13's `GET …/access/{variant}` returns a 60-second Cloudinary `private_download_url`. That URL contains the cloud name, API key and `public_id`, so placing it in `<img src>` would expose provider details in the DOM, history and devtools. PER-15 adds `GET /api/v1/items/{itemId}/photos/{photoId}/content/{display|thumbnail}`:

- The existing owner session and item ownership check run under the item lock; the provider read happens after the transaction so slow delivery never holds the lock.
- The server reads through the shared `PrivateMediaStorage.read()` port introduced by PER-14 (fresh short-lived signed access per request, exact stored byte size, no redirects, 30-second deadline) and verifies the stored SHA-256 before responding. Mismatch, oversize, provider errors and timeouts return only `MEDIA_STORAGE_UNAVAILABLE`.
- Responses are `image/webp`, `Cache-Control: private, no-store`, `nosniff`, `no-referrer`, `Cross-Origin-Resource-Policy: same-origin`, a sandboxing CSP and `inline` disposition. At most eight deliveries run per API process (`PHOTO_DELIVERY_BUSY` otherwise).
- The `original` variant is not deliverable here; only the bounded display (1600px) and thumbnail (320px) variants are.

Because signing happens server-side per request, the browser never holds an expiring URL and nothing is persisted in storage. An image that fails to load (expired session, deleted photo, provider outage) triggers one automatic revalidation of the snapshot plus a cache-busting retry (`?attempt=n`); further failures show readable text and a Retry button. The original access endpoint is unchanged for compatibility. The trade-off is that image bytes now pass through the API container; PER-40 must include this bandwidth/memory in CT102 budgets.

Images use plain `<img>` (not the Next.js optimizer, whose shared cache must not hold private bytes) with `srcset` descriptors computed from each variant's real width, `sizes` per slot, explicit `width`/`height`, `loading="lazy"` beyond the first row and `decoding="async"`. The large cover view shows the thumbnail first, then the display variant.

## Alt text

Migration `0007_photo_alt_text` adds nullable `media_attachments.alt_text`. `NULL` means not yet described, `''` means the owner explicitly marked the photo decorative. A check constraint limits it to photo originals, at most 250 characters and no surrounding whitespace. `PATCH /api/v1/items/{itemId}/photos/{photoId}` takes `{ revision, altText, decorative }`, rejects control/format characters and decorative-with-text (`PHOTO_ALT_TEXT_INVALID`), increments the item revision and returns the snapshot. Tombstoning clears the text. `PhotoDto` gains `altText` and `decorative`. Undescribed photos use a neutral positional alternative ("Item photo 2 of 5, not yet described"); file names are never used, and the UI rejects descriptions that look like file names. Alt text is private owner data and is not logged or sent to telemetry.

## Ordering, cover, replace and delete

- Move earlier/later buttons (44px, labelled per photo) are the primary reorder interaction; there is no drag-only path. The gallery applies the order optimistically, sends the complete ID list with the last-seen item revision, announces the result and keeps focus on the moved photo. A `409` (stale revision or changed set) restores the server order, reloads and explains; other failures restore the previous order.
- The first photo is the cover, exactly as the API defines it. "Set as cover" moves a photo first. The cover is marked with an icon, visible text and screen-reader text, not colour alone.
- Replace is client-orchestrated from existing APIs: upload and confirm the replacement, reorder it into the original's position, copy the original's description, then delete the original. Every intermediate state is a valid server state; if a later step fails both photos remain visible with an explanation. Replacement needs one free slot (8-photo limit) so the original is never removed first.
- Delete uses an `AlertDialog` that states cover consequences, disables duplicate submissions and only removes the photo after the server accepts. If provider cleanup fails after the family is hidden (PER-13 marks it deleting first), the UI reloads, sees the photo is gone and reports that private cleanup will finish automatically; otherwise the photo stays and the error is shown. Focus moves to the nearest remaining photo or the Add photos heading.

## UI composition

shadcn `AlertDialog`, `DropdownMenu`, `Progress` and `Sonner` were added to `packages/ui` from the registry (with `exactOptionalPropertyTypes` fixes). The registry `Progress` destructured `value` without forwarding it, leaving bars indeterminate with no `aria-valuenow`; it now forwards the value. `toast` is re-exported from `packages/ui` so applications do not depend on `sonner` directly. Kibo UI's Dropzone was not used because separate native camera and gallery inputs are required for capture hints. No custom colours, fonts or variants are introduced; motion respects `prefers-reduced-motion`.

## Verification limits

Component, integration and Playwright tests use synthetic images and mocked provider/API responses. Live Cloudinary delivery, physical camera capture and real screen-reader passes remain release checks, as for PER-13.
