# PER-44: product link and barcode suggestions

## Provider decision (20 October 2026)

Use static schema.org Product JSON-LD with Open Graph fallback for explicit public product
links. No browser engine or script execution. Use Open Food Facts API v3 for explicit GTIN
food barcode lookups. The owner delegated the catalogue decision after being informed of
third-party disclosure and licence requirements. No paid service, AI, credential, account
scraping or new production service is added. WorkerModule registers these real adapters;
name/photo/receipt remain unconfigured and PER-45 is independent.

References checked against primary documentation:

- [Schema.org Product](https://schema.org/Product): identity, image and additionalProperty.
- [Open Food Facts API](https://openfoodfacts.github.io/openfoodfacts-server/api/):
  credential-free read, identifying User-Agent, field projection and rate limits.
- [OFF licence](https://github.com/openfoodfacts/openfoodfacts-server/blob/main/docs/api/tutorials/license-be-on-the-legal-side.md):
  database ODbL, individual contents DbCL, product images CC BY-SA. Retain attribution and
  provenance in private exports. Any future public redistribution must review licence terms;
  no public dataset is published by this feature.
- [htmlparser2](https://github.com/fb55/htmlparser2): non-executing HTML parser.
- [ipaddr.js](https://github.com/whitequark/ipaddr.js): public-address classification.
- [Node HTTP](https://nodejs.org/api/http.html): direct address connection, agent isolation.
- [BarcodeDetector](https://developer.mozilla.org/en-US/docs/Web/API/BarcodeDetector):
  secure-context feature detection and supported formats. Native detection avoids a new
  decoder bundle and keeps camera frames local; manual GTIN entry always remains available.

Coverage is intentionally limited: food products only for OFF; GTIN-8/12/13/14 checksum
validation; no fuzzy barcode search or paid general catalogue. Product pages requiring JS,
login, bot challenges, other ports or compressed responses can fail. Failure/no-match never
changes the saved item. Metadata confidence is a conservative heuristic, not probability.
Prices/offers and dates are omitted: actual money/date remain owner-confirmed manual fields.

## Security and bounded work

Only POST enrichment requests with the matching `providerConsent` value (`public-product-metadata-v1` or `open-food-facts-v1`) authorize network access. The source UI sends this acknowledgement only after displaying the disclosure. Typed work inputs retain a consent marker; real adapters decline legacy PER-43 requests without it, leaving them unconfigured. Old pending requests never silently acquire fetch/transfer permission. Saving/viewing a purchase URL
never fetches it. Requests may supply a separate URL without changing private purchase
provenance. Public HTTP(S), default ports, no credentials. PublicFetcher validates all DNS
answers and every redirect, rejects special/private/mapped/tunnel ranges, and connects to a
vetted IP directly while retaining Host/TLS SNI and certificate verification. No validation
vs connection DNS race, pooled socket, ambient proxy, cookies, authorization or referer.
HTTPS cannot downgrade. Maximum three redirects, 32 DNS answers, 16 KiB response headers,
four-second total fetch deadline and two active operations per process. A stuck resolver
retains its slot; a cancelled request never starts a subsequent connection. Compressed
responses are rejected (Accept-Encoding identity), preventing decompression bombs.

HTML is limited to 512 KiB, catalogue JSON to 256 KiB; only explicit MIME allowlists.
At most 12 JSON-LD blocks, 200 nodes per block, five candidates, 16 fields per candidate,
and existing 32 KiB results. Hostile HTML is converted to plain text; UI escapes all data.
Images are stored as suggestions without hotlink previews. Only explicit image acceptance
fetches up to 10 MiB JPEG/PNG/WebP through the same public-address boundary, then uses the
existing isolated image processor/private storage, quotas, validation, EXIF stripping,
recovery and deletion pipeline. No arbitrary fetch/download endpoint exists.

## Additive review contract

PER-43 text fields are unchanged. `specification:<key>` accepts one bounded scalar property
at a time (ASCII key, max 64 characters; value max 1000). Existing other specifications are
preserved. `image` accepts or rejects one proposed URL; correction is intentionally rejected.
Image acceptance records the protected attachment ID, never a public hotlink. All reviews
retain command identity, original input, previous/confirmed values, provenance, confidence
and current-revision chain. Network work runs outside transactions; revision/ownership and
deletion admission are rechecked at publication. Source-specific UI lives independently of
PER-45. New fields use existing private work/review tables and existing item/media exports
and account/item erasure; no additional private table or provider cleanup policy.

Production rollout requires the additive review-field constraint migration before API/worker
images. No automatic startup migration. Web/API/worker change; shared services do not.
Telemetry continues using fixed error codes without remote URLs, metadata, barcodes or
provider exceptions. OFF requests identify Havefolio and are limited to one per two seconds
per process; existing durable retries/circuits apply. Multiple replicas multiply this limit.
No deployment or real owner-data/provider request is part of implementation verification.
