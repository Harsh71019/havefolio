import {
  itemDocumentLimits,
  type ItemDocument,
  type ItemDocumentKind,
  type ItemDocumentSnapshot,
} from '@havefolio/contracts';

// Fixed public API codes only. Never echo server text, provider details or file paths.
export const documentMessages: Record<string, string> = {
  DOCUMENT_FILE_SIZE: 'Choose an image under 10 MiB or a PDF under 20 MiB.',
  DOCUMENT_INVALID: 'This file could not be checked safely. Choose a JPEG, PNG, WebP or PDF.',
  DOCUMENT_FILENAME_INVALID: 'Rename the file without slashes or special characters, then retry.',
  DOCUMENT_PROCESSING_BUSY: 'Document processing is busy. Try again shortly.',
  DOCUMENT_QUOTA_EXCEEDED: 'The document limit is reached (16 per item, or your storage quota).',
  DOCUMENT_UPLOAD_PENDING: 'The previous attempt is still being checked. Retry shortly.',
  DOCUMENT_UPLOAD_RECOVERED: 'The earlier attempt was cleaned up. Retry to start a new upload.',
  DOCUMENT_UPLOAD_UNAVAILABLE: 'Private storage is temporarily unavailable. Try again shortly.',
  MEDIA_STORAGE_DISABLED: 'Private document storage is not enabled yet.',
  MEDIA_STORAGE_UNAVAILABLE: 'Private storage is temporarily unavailable. Try again shortly.',
  MEDIA_NOT_FOUND: 'This document is no longer available. The list has been refreshed.',
  STALE_ITEM_REVISION: 'This item changed elsewhere. The latest documents have been loaded.',
  ITEM_NOT_FOUND: 'This item is unavailable.',
};

export class DocumentRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'DocumentRequestError';
  }
  get disabled(): boolean {
    return this.code === 'MEDIA_STORAGE_DISABLED';
  }
}

function fallback(status: number): string {
  if (status === 0) return 'You appear to be offline or the connection dropped.';
  if (status === 401) return 'Your session has ended. Sign in again to manage documents.';
  if (status === 404) return 'This item is unavailable.';
  if (status === 503) return 'Private storage is temporarily unavailable. Try again shortly.';
  return 'Something went wrong. Try again.';
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      credentials: 'same-origin',
      cache: 'no-store',
      ...(typeof init.body === 'string' ? { headers: { 'Content-Type': 'application/json' } } : {}),
    });
  } catch {
    throw new DocumentRequestError(0, 'NETWORK', fallback(0));
  }
  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as { message?: unknown };
    const code = typeof data.message === 'string' ? data.message : '';
    throw new DocumentRequestError(
      response.status,
      code,
      response.status === 401
        ? fallback(401)
        : (documentMessages[code] ?? fallback(response.status)),
    );
  }
  return (await response.json()) as T;
}

const base = (itemId: string): string => `/api/v1/items/${encodeURIComponent(itemId)}/documents`;

export function fetchDocuments(itemId: string): Promise<ItemDocumentSnapshot> {
  return request(base(itemId));
}

export function deleteDocument(
  itemId: string,
  documentId: string,
  revision: number,
): Promise<ItemDocumentSnapshot> {
  return request(`${base(itemId)}/${encodeURIComponent(documentId)}`, {
    method: 'DELETE',
    body: JSON.stringify({ revision }),
  });
}

/** One file per request. Reusing `uploadId` with the same file recovers a completed upload. */
export function uploadDocument(
  itemId: string,
  uploadId: string,
  kind: ItemDocumentKind,
  file: File,
): Promise<ItemDocument> {
  const form = new FormData();
  form.append('kind', kind);
  form.append('document', file);
  return request(base(itemId), { method: 'POST', body: form, headers: { 'Upload-Id': uploadId } });
}

/** Authenticated same-origin download; the API answers with an attachment and a safe name. */
export function documentDownloadUrl(itemId: string, documentId: string): string {
  return `${base(itemId)}/${encodeURIComponent(documentId)}/download`;
}

/** Client-side pre-check only; the API still validates signatures, decoding and PDF safety. */
export function documentSelectionError(file: File): string | undefined {
  if (!(itemDocumentLimits.acceptedMimeTypes as readonly string[]).includes(file.type))
    return 'Choose a JPEG, PNG, WebP image or a PDF.';
  const max =
    file.type === 'application/pdf'
      ? itemDocumentLimits.maxPdfBytes
      : itemDocumentLimits.maxImageBytes;
  if (file.size === 0 || file.size > max) return documentMessages.DOCUMENT_FILE_SIZE;
  return undefined;
}

export function documentSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
