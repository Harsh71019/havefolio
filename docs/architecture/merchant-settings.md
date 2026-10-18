# Merchant settings and Categories navigation (PER-62)

Settings links to `/settings/merchants`, where the owner can save any merchant without creating an item first. Name is required; website host is optional, including for offline sellers. Amazon and Flipkart remain optional suggestions in item forms rather than a fixed merchant catalogue.

The client reuses the existing authenticated, no-store `/api/v1/merchants` endpoints. Search is a bounded server-side name-prefix query with all active/retired states and opaque keyset pagination (25 per page). Corrections apply to the existing merchant everywhere. Retirement preserves item/history links and prevents new assignment; restoration makes the merchant available again. The existing normalization and owner isolation rules remain authoritative. No API, schema, queue, upload or money semantics change.

Drafts remain in component memory after failed saves. Merchant data is not added to browser storage, URLs or telemetry. An optional website is displayed as text and is never fetched. Existing item forms load the same saved merchants on entry/reload.

Categories links directly to the existing `/settings/taxonomy` route in the desktop sidebar and mobile More menu. Only Categories is current on that route; Settings stays current on other settings destinations, including merchants. Existing taxonomy links and behavior remain compatible.

Verification includes component coverage of create/retry, server search/pagination, correction/restore, and exclusive navigation state; synthetic browser coverage of the Settings entry point, invalid-host recovery, merchant persistence across reload, retirement/restore, item-selector parity and responsive navigation. Screenshots use synthetic fixtures in desktop/mobile light/dark. Browser mocks establish UI behavior; the separate existing real PostgreSQL integration suite establishes merchant API persistence/ownership behavior. Production rollout and live manual screen-reader verification are not claimed.

Release requires the reviewed web image only. No migration or production mutation is performed by this ticket.
