# PER-52: owner sign-in

`/login` has a standalone layout. The root layout supplies only document metadata and the theme provider. Inventory pages live under the `(inventory)` route group, whose layout owns the desktop sidebar, mobile navigation and inventory padding. Route groups preserve the existing URLs; login never renders those controls.

The responsive login composition includes a bundled generated home-object photograph, a desktop split layout and a compact mobile image crop. It keeps the repository's system typography and neutral light/dark UI themes. The WebP asset is approximately 165 KB and is imported statically through Next Image with eager loading; the emitted static asset avoids third-party image requests and runtime image-cache writes in the read-only container.

The form submits only to the existing same-origin login API. Credentials remain transient; no local/session storage, query-string credentials or request logging is added. The API's HttpOnly session remains authoritative. The form has labelled inputs, autocomplete, keyboard submission, an accessible password visibility toggle, a request guard, disabled controls while pending and announced generic invalid/rate/network errors. Success clears the inputs and returns to inventory. There is no public signup, reset or account recovery flow.

Validation covers both themes on mobile and desktop, loaded imagery, absence of inventory navigation on login, narrow 320px overflow, keyboard focus/submission, invalid and offline responses, successful navigation, password visibility and duplicate requests. Existing item, taxonomy and photo smoke tests verify that the inventory shell still works. Four screenshots are stored under `docs/screenshots/per-52-*-{light,dark}.png`.

## Updating the deployed web container

Build the `web` target from the reviewed PER-52 revision with the PER-40 Dockerfile and Docker ignore rules. Deploy a unique web image tag. When the API/worker release is unchanged, a protected operator `compose.override.yaml` can select just the new web image:

```yaml
services:
  web:
    image: havefolio-web:<reviewed-web-revision>
```

Load that image on CT102, save the previous override and image tag, validate Compose, then run `docker compose up -d --no-deps --wait web`. Update release provenance with the source revision and actual image ID. Verify HTTPS page/image, navigation absence in both viewport sizes, login/session and inventory navigation. Do not pass service credentials to the build or restart shared services. For rollback, restore the previous web image selector and recreate only web. At the next full release, remove or update the override deliberately so it cannot retain an old web image.

No database migration, API authentication change, global theme change or service-secret rotation belongs to this change.
