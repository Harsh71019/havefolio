import {
  itemPhotoLimits,
  type ItemPhoto,
  type ItemPhotoSnapshot,
  type ItemPhotoUploadResponse,
  type ItemPhotoVariant,
  type UpdateItemPhotoDescriptionRequest,
} from '@havefolio/contracts';
import type { PrivatePhotoSource } from '@havefolio/ui/components/havefolio/private-photo';

// Fixed public API codes only. Never echo server text, provider details or private input.
export const photoMessages: Record<string, string> = {
  PHOTO_HEIC_UNSUPPORTED: 'HEIC/HEIF is not supported. Export as JPEG, PNG or WebP.',
  PHOTO_FORMAT_MISMATCH: 'The file type, extension and contents must match JPEG, PNG or WebP.',
  PHOTO_INVALID: 'This image could not be decoded safely. Choose another image.',
  PHOTO_FILE_SIZE: 'Choose a photo smaller than 10 MiB.',
  PHOTO_PROCESSING_BUSY: 'Image processing is busy. Try this photo again shortly.',
  PHOTO_QUOTA_EXCEEDED: 'The photo limit is reached (8 per item).',
  PHOTO_UPLOAD_PENDING:
    'The previous attempt is being recovered. Keep this page open and retry later.',
  PHOTO_UPLOAD_RECOVERED: 'The failed attempt has been cleaned up. Retry to start a new upload.',
  PHOTO_ALT_TEXT_INVALID: 'Check the description: up to 250 characters without control characters.',
  PHOTO_ORDER_CHANGED: 'Photos changed elsewhere. The latest order has been loaded.',
  MEDIA_NOT_FOUND: 'This photo is no longer available. The gallery has been refreshed.',
  MEDIA_STORAGE_DISABLED: 'Private photo storage is not enabled yet.',
  STALE_ITEM_REVISION: 'Photos changed elsewhere. The latest version has been loaded.',
  ITEM_NOT_FOUND: 'This item is unavailable.',
};

export class PhotoRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'PhotoRequestError';
  }
  get conflict(): boolean {
    return this.status === 409 || this.code === 'MEDIA_NOT_FOUND';
  }
}

function fallback(status: number): string {
  if (status === 0) return 'Unable to connect. Check your connection and try again.';
  if (status === 401) return 'Your session has expired. Sign in to manage private photos.';
  if (status === 404) return 'This item is unavailable.';
  if (status === 503) return 'Photo storage is temporarily unavailable. Try again shortly.';
  return 'Something went wrong. Try again.';
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      credentials: 'same-origin',
      cache: 'no-store',
      ...(init.body ? { headers: { 'Content-Type': 'application/json' } } : {}),
    });
  } catch {
    throw new PhotoRequestError(0, 'NETWORK', fallback(0));
  }
  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as { message?: unknown };
    const code = typeof data.message === 'string' ? data.message : '';
    throw new PhotoRequestError(
      response.status,
      code,
      photoMessages[code] ?? fallback(response.status),
    );
  }
  return (await response.json()) as T;
}

const base = (itemId: string): string => `/api/v1/items/${encodeURIComponent(itemId)}/photos`;

export function fetchPhotos(itemId: string): Promise<ItemPhotoSnapshot> {
  return request(base(itemId));
}

export function reorderPhotos(
  itemId: string,
  revision: number,
  photoIds: string[],
): Promise<ItemPhotoSnapshot> {
  return request(`${base(itemId)}/order`, {
    method: 'PATCH',
    body: JSON.stringify({ revision, photoIds }),
  });
}

export function describePhoto(
  itemId: string,
  photoId: string,
  input: UpdateItemPhotoDescriptionRequest,
): Promise<ItemPhotoSnapshot> {
  return request(`${base(itemId)}/${encodeURIComponent(photoId)}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export function deletePhoto(
  itemId: string,
  photoId: string,
  revision: number,
): Promise<ItemPhotoSnapshot> {
  return request(`${base(itemId)}/${encodeURIComponent(photoId)}`, {
    method: 'DELETE',
    body: JSON.stringify({ revision }),
  });
}

export type UploadOutcome =
  { ok: true; photo: ItemPhoto } | { ok: false; message: string; recovered: boolean };

/** One file per request so progress, retries and partial failures stay per photo. */
export function uploadPhoto(
  itemId: string,
  uploadId: string,
  file: File,
  onProgress: (percent: number) => void,
  track?: (request: XMLHttpRequest) => () => void,
): Promise<UploadOutcome> {
  return new Promise((resolve) => {
    const req = new XMLHttpRequest();
    const untrack = track?.(req);
    const settle = (outcome: UploadOutcome): void => {
      untrack?.();
      resolve(outcome);
    };
    const failed = (message: string, recovered = false): void =>
      settle({ ok: false, message, recovered });
    req.open('POST', base(itemId));
    req.setRequestHeader('Upload-Id', uploadId);
    req.timeout = 150_000;
    req.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    req.onerror = () =>
      failed('Connection interrupted. Retry this photo to check its saved state.');
    req.ontimeout = () => failed('Upload timed out. Retry this photo to check its saved state.');
    req.onabort = () => failed('Upload cancelled. Retry to check its saved state.');
    req.onload = () => {
      try {
        const response = JSON.parse(req.responseText) as ItemPhotoUploadResponse & {
          message?: string;
        };
        const result = response.results?.[0];
        if (req.status === 201 && result?.photo) settle({ ok: true, photo: result.photo });
        else
          failed(
            req.status === 401
              ? 'Sign in to add private photos.'
              : req.status === 404
                ? 'This item is unavailable.'
                : (photoMessages[result?.error ?? response.message ?? ''] ??
                  'Could not save this photo. Retry to check its saved state.'),
            result?.error === 'PHOTO_UPLOAD_RECOVERED',
          );
      } catch {
        failed('Could not confirm the upload. Retry to check its saved state.');
      }
    };
    const form = new FormData();
    form.append('photos', file);
    req.send(form);
  });
}

/** Client-side pre-check; the API still validates signatures, decoding and HEIC brands. */
export function selectionError(file: File): string | undefined {
  if (/\.(heic|heif)$/i.test(file.name) || /^image\/hei[cf]/i.test(file.type))
    return 'HEIC/HEIF is not supported yet. Export this photo as JPEG, PNG or WebP and try again.';
  if (!(itemPhotoLimits.acceptedMimeTypes as readonly string[]).includes(file.type))
    return 'Choose JPEG, PNG or WebP. HEIC/HEIF is not supported.';
  if (file.size === 0 || file.size > itemPhotoLimits.maxFileBytes)
    return photoMessages.PHOTO_FILE_SIZE;
  return undefined;
}

export function photoContentUrl(
  itemId: string,
  photoId: string,
  variant: ItemPhotoVariant,
  attempt = 0,
): string {
  const url = `${base(itemId)}/${encodeURIComponent(photoId)}/content/${variant}`;
  return attempt ? `${url}?attempt=${attempt}` : url;
}

/** Accessible alternative: owner text, an explicit empty value, or a neutral positional label. */
export function photoAlt(photo: ItemPhoto, index: number, total: number): string {
  if (photo.decorative) return '';
  return photo.altText ?? `Item photo ${index + 1} of ${total}, not yet described`;
}

export function photoName(photo: ItemPhoto, index: number): string {
  return photo.altText ?? `Photo ${index + 1}`;
}

/**
 * Same-origin sources only. Thumbnails (320px) serve small slots; display (1600px) serves large
 * slots or dense screens. `attempt` busts a failed request without persisting any URL.
 */
export function photoSource(
  itemId: string,
  photo: Pick<ItemPhoto, 'id' | 'width' | 'height'>,
  alt: string,
  sizes: string,
  options: { attempt?: number; large?: boolean } = {},
): PrivatePhotoSource {
  const attempt = options.attempt ?? 0;
  // Variants fit inside 320/1600 squares without upscaling; descriptors use their real widths.
  const fit = (bound: number): number =>
    Math.max(1, Math.round(photo.width * Math.min(1, bound / Math.max(photo.width, photo.height))));
  const thumbnail = photoContentUrl(itemId, photo.id, 'thumbnail', attempt);
  const display = photoContentUrl(itemId, photo.id, 'display', attempt);
  return {
    alt,
    width: photo.width,
    height: photo.height,
    sizes,
    src: options.large ? display : thumbnail,
    srcSet:
      fit(320) === fit(1600)
        ? `${thumbnail} ${fit(320)}w`
        : `${thumbnail} ${fit(320)}w, ${display} ${fit(1600)}w`,
    ...(options.large ? { placeholderSrc: thumbnail } : {}),
  };
}
