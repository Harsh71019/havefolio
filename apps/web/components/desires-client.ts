import type {
  ConvertDesireRequest,
  CreateDesireMatchRequest,
  CreateReviewRequest,
  CreateSuggestionFeedbackRequest,
  DesireConversion,
  DesireConversionState,
  DesireMatch,
  DesireMatchesPage,
  DesireSuggestionFeedback,
  DesireSuggestionItem,
  DesireSuggestionsPage,
  ItemsPage,
  MatchCandidatesPage,
  PatchDesireMatchRequest,
  ReviewEvent,
  ReviewHistoryPage,
} from '@havefolio/contracts';
import {
  type CreateDesireRequest,
  type Desire,
  type DesireClassification,
  type DesireEffectiveState,
  type DesirePhoto,
  type DesiresPage,
  type DesireStatus,
  type PatchDesireRequest,
  itemPhotoLimits,
} from '@havefolio/contracts';
import type { PrivatePhotoSource } from '@havefolio/ui/components/havefolio/private-photo';

// Fixed public API codes only. Never echo server text, provider details or private input.
export const desireMessages: Record<string, string> = {
  ALLOCATION_ALREADY_EXISTS: 'This desire already has an allocation. Reload to view its history.',
  ALLOCATION_COMMAND_REUSED: 'This confirmation changed. Reload before trying again.',
  STALE_DECLINED_OUTCOME: 'The declined decision changed. Reload before allocating.',
  ALLOCATION_ESTIMATE_REQUIRED: 'A known positive estimate is needed to allocate.',
  GOAL_NOT_FOUND: 'This goal is unavailable. It may have been deleted.',
  STALE_GOAL_REVISION: 'The goal changed. Reload and confirm its latest details.',
  GOAL_ARCHIVED: 'This goal is archived. Restore it before changing allocations.',
  GOAL_CURRENCY_MISMATCH: 'The estimate and goal must use the same currency.',
  CONTRIBUTION_ALREADY_CORRECTED: 'This entry was corrected elsewhere. Reload its history.',
  CONTRIBUTION_COMMAND_REUSED: 'This correction changed. Reload before trying again.',
  GOALS_UNAVAILABLE: 'Goals are temporarily unavailable. Try again shortly.',
  GOAL_CURRENCY_LOCKED:
    'This goal already has contributions, so its currency stays fixed. No conversion is applied.',
  INVALID_GOAL: 'Check the goal name, target amount, currency and optional date, then try again.',
  INVALID_CONTRIBUTION: 'Check the amount and optional note, then try again.',
  CONTRIBUTION_NOT_FOUND: 'This entry is no longer available. Reload its history.',
  REVIEW_EVENT_REQUIRED:
    'Change the waiting period through Decision history to preserve the recorded decisions.',
  REVIEW_COMMAND_REUSED: 'This submission changed. Reload history before trying again.',
  REVIEW_CORRECTION_REQUIRED: 'Reload history and correct the latest decision.',
  REVIEW_ITEM_UNAVAILABLE: 'That item is unavailable. Choose another item or outcome.',
  INVALID_REVIEW: 'Check the decision and optional note, then try again.',
  INVALID_REVIEW_DATE: 'Choose a future review date for a delayed decision.',
  INVALID_REVIEW_ITEM: 'Choose an owned item for this decision.',
  INVALID_DESIRE: 'Check the desire name and details, then try again.',
  INVALID_DESIRE_PRICE: 'Enter a valid likely price and currency, or leave both empty.',
  INVALID_DESIRE_URL: 'Enter a valid web link starting with http:// or https://.',
  INVALID_DESIRE_WAIT: 'Choose a review date and time in the future.',
  INVALID_DESIRE_TRANSITION: 'That waiting state transition is not allowed.',
  DESIRE_NOT_FOUND: 'This desire is no longer available. It may have been deleted.',
  STALE_DESIRE_REVISION:
    'This desire was modified elsewhere. Review the latest version before saving.',
  INVALID_DESIRE_CURSOR: 'The list could not continue from here. Reloading the list.',
  DESIRE_PHOTO_NOT_FOUND: 'The attached photo was not found.',
  DESIRE_PHOTO_LIMIT: 'A desire can only have one photo attached.',
  DESIRE_MEDIA_PENDING: 'Photo processing is still pending. Try again in a moment.',
  DESIRES_UNAVAILABLE: 'The desires service is temporarily unavailable. Try again shortly.',
  MATCH_ALREADY_EXISTS: 'This possession is already matched to this desire.',
  MATCH_NOT_FOUND: 'This match is no longer available.',
  INVALID_MATCH_REASON: 'Enter an explanation up to 1000 characters, or leave it blank.',
  INVALID_MATCH_RELEVANCE: 'Select whether this match is relevant or irrelevant.',
  MATCH_LIMIT_EXCEEDED: 'A desire can have up to 50 matched items.',
  MATCHES_UNAVAILABLE: 'Possession matching is temporarily unavailable. Try again shortly.',
  AUTH_REQUIRED: 'Your session has expired. Sign in again to continue.',
  PHOTO_UPLOAD_ID_REQUIRED: 'Photo upload tracking identifier is missing.',
  PHOTO_FILE_REQUIRED: 'Select a photo file to upload.',
  PHOTO_PROCESSING_BUSY: 'Image processing is currently busy. Try again shortly.',
  PHOTO_DELIVERY_BUSY: 'Image delivery is currently busy. Try again shortly.',
  PHOTO_VARIANT_INVALID: 'Invalid photo size variant requested.',
  PHOTO_FILE_SIZE: 'Choose a photo smaller than 10 MiB.',
  INVALID_CONVERSION: 'Check the confirmed purchase details, then try again.',
  DESIRE_NOT_BOUGHT:
    'The current decision for this want is no longer bought. Review its decision history first.',
  STALE_BOUGHT_OUTCOME: 'The bought decision changed elsewhere. Reload before adding this item.',
  DESIRE_ALREADY_CONVERTED: 'This want is already in your inventory.',
  CONVERSION_COMMAND_REUSED: 'This submission changed. Reload before trying again.',
  CONVERSION_NOT_FOUND: 'This want has not been added to your inventory.',
  INVALID_ITEM: 'Check the item details and amount, then try again.',
  INVALID_ITEM_DATE: 'Check the purchase date and its precision.',
  PHOTO_QUOTA_EXCEEDED: 'Photo storage is full. Add the item without copying the photo.',
  MEDIA_STORAGE_UNAVAILABLE: 'Photo storage is temporarily unavailable. Try again shortly.',
};

export class DesireRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'DesireRequestError';
  }
  get unauthenticated(): boolean {
    return this.status === 401 || this.code === 'AUTH_REQUIRED';
  }
  get offline(): boolean {
    return this.status === 0;
  }
  get stale(): boolean {
    return this.code === 'STALE_DESIRE_REVISION' || this.status === 409;
  }
  get notFound(): boolean {
    return this.status === 404 || this.code === 'DESIRE_NOT_FOUND';
  }
}

function fallbackMessage(status: number): string {
  if (status === 0) return 'Unable to connect. Check your connection and try again.';
  if (status === 401) return 'Your session has expired. Sign in again to continue.';
  if (status === 404)
    return desireMessages.DESIRE_NOT_FOUND ?? 'This desire is no longer available.';
  if (status === 409)
    return desireMessages.STALE_DESIRE_REVISION ?? 'This desire was modified elsewhere.';
  if (status === 503)
    return desireMessages.DESIRES_UNAVAILABLE ?? 'The desires service is temporarily unavailable.';
  return 'Something went wrong. Try again.';
}

export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      credentials: 'same-origin',
      cache: 'no-store',
      ...(init.body && typeof init.body === 'string'
        ? { headers: { 'Content-Type': 'application/json', ...init.headers } }
        : init.headers
          ? { headers: init.headers }
          : {}),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw error;
    }
    throw new DesireRequestError(0, 'NETWORK', fallbackMessage(0));
  }
  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as { message?: unknown };
    const code = typeof data.message === 'string' ? data.message : '';
    throw new DesireRequestError(
      response.status,
      code,
      desireMessages[code] ?? fallbackMessage(response.status),
    );
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export function createDesire(input: CreateDesireRequest, signal?: AbortSignal): Promise<Desire> {
  return request('/api/v1/desires', {
    method: 'POST',
    body: JSON.stringify(input),
    ...(signal ? { signal } : {}),
  });
}

export interface DesiresQuery {
  limit?: number;
  after?: string | null;
  status?: DesireStatus;
  effectiveState?: DesireEffectiveState;
  classification?: DesireClassification;
}

export function listDesires(query: DesiresQuery = {}, signal?: AbortSignal): Promise<DesiresPage> {
  const searchParams = new URLSearchParams();
  if (query.limit != null) searchParams.set('limit', String(query.limit));
  if (query.after != null && query.after !== '') searchParams.set('after', query.after);
  if (query.status != null) searchParams.set('status', query.status);
  if (query.effectiveState != null) searchParams.set('effectiveState', query.effectiveState);
  if (query.classification != null) searchParams.set('classification', query.classification);

  const qs = searchParams.toString();
  return request(`/api/v1/desires${qs ? `?${qs}` : ''}`, {
    method: 'GET',
    ...(signal ? { signal } : {}),
  });
}

export function getDesire(id: string, signal?: AbortSignal): Promise<Desire> {
  return request(`/api/v1/desires/${encodeURIComponent(id)}`, {
    method: 'GET',
    ...(signal ? { signal } : {}),
  });
}

export function updateDesire(
  id: string,
  input: PatchDesireRequest,
  signal?: AbortSignal,
): Promise<Desire> {
  return request(`/api/v1/desires/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
    ...(signal ? { signal } : {}),
  });
}

export function deleteDesire(id: string, revision: number, signal?: AbortSignal): Promise<void> {
  return request(`/api/v1/desires/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    body: JSON.stringify({ revision }),
    ...(signal ? { signal } : {}),
  });
}

export type UploadPhotoOutcome =
  { ok: true; photo: DesirePhoto } | { ok: false; message: string; recovered: boolean };

/**
 * Uploads a private photo for a desire with stable Upload-Id, timeout, and progress reporting.
 */
export function uploadDesirePhoto(
  desireId: string,
  file: File,
  uploadId: string,
  onProgress?: (percent: number) => void,
  track?: (req: XMLHttpRequest) => () => void,
): Promise<UploadPhotoOutcome> {
  return new Promise((resolve) => {
    const req = new XMLHttpRequest();
    const untrack = track?.(req);
    const settle = (outcome: UploadPhotoOutcome): void => {
      untrack?.();
      resolve(outcome);
    };
    const failed = (message: string, recovered = false): void =>
      settle({ ok: false, message, recovered });

    req.open('POST', `/api/v1/desires/${encodeURIComponent(desireId)}/photo`);
    req.setRequestHeader('Upload-Id', uploadId);
    req.timeout = 150_000;
    if (onProgress && req.upload) {
      req.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
      };
    }
    req.onerror = () =>
      failed('Connection interrupted. Retry this photo to check its saved state.');
    req.ontimeout = () => failed('Upload timed out. Retry this photo to check its saved state.');
    req.onabort = () => failed('Upload cancelled. Retry to check its saved state.');
    req.onload = () => {
      try {
        const response = JSON.parse(req.responseText) as DesirePhoto & { message?: string };
        if (req.status === 201 && response.id) {
          settle({ ok: true, photo: response });
        } else {
          failed(
            req.status === 401
              ? 'Sign in to add private photos.'
              : req.status === 404
                ? 'This desire is unavailable.'
                : (desireMessages[response.message ?? ''] ??
                  'Could not save this photo. Retry to check its saved state.'),
          );
        }
      } catch {
        failed('Could not confirm the upload. Retry to check its saved state.');
      }
    };

    const form = new FormData();
    form.append('photo', file);
    req.send(form);
  });
}

export function getDesirePhoto(desireId: string, signal?: AbortSignal): Promise<DesirePhoto> {
  return request(`/api/v1/desires/${encodeURIComponent(desireId)}/photo`, {
    method: 'GET',
    ...(signal ? { signal } : {}),
  });
}

export function deleteDesirePhoto(
  desireId: string,
  revision: number,
  signal?: AbortSignal,
): Promise<{ revision: number }> {
  return request(`/api/v1/desires/${encodeURIComponent(desireId)}/photo`, {
    method: 'DELETE',
    body: JSON.stringify({ revision }),
    ...(signal ? { signal } : {}),
  });
}

export function getDesireMatches(
  desireId: string,
  options: {
    after?: string | undefined;
    limit?: number | undefined;
    signal?: AbortSignal | undefined;
  } = {},
): Promise<DesireMatchesPage> {
  const params = new URLSearchParams();
  if (options.after) params.set('after', options.after);
  if (options.limit) params.set('limit', String(options.limit));
  const query = params.toString();
  return request<DesireMatchesPage>(
    `/api/v1/desires/${encodeURIComponent(desireId)}/matches${query ? `?${query}` : ''}`,
    { ...(options.signal ? { signal: options.signal } : {}) },
  );
}

export function addDesireMatch(
  desireId: string,
  input: CreateDesireMatchRequest,
  signal?: AbortSignal,
): Promise<DesireMatch> {
  return request<DesireMatch>(`/api/v1/desires/${encodeURIComponent(desireId)}/matches`, {
    method: 'POST',
    body: JSON.stringify(input),
    ...(signal ? { signal } : {}),
  });
}

export function updateDesireMatch(
  desireId: string,
  matchId: string,
  input: PatchDesireMatchRequest,
  signal?: AbortSignal,
): Promise<DesireMatch> {
  return request<DesireMatch>(
    `/api/v1/desires/${encodeURIComponent(desireId)}/matches/${encodeURIComponent(matchId)}`,
    {
      method: 'PATCH',
      body: JSON.stringify(input),
      ...(signal ? { signal } : {}),
    },
  );
}

export function deleteDesireMatch(
  desireId: string,
  matchId: string,
  signal?: AbortSignal,
): Promise<void> {
  return request<void>(
    `/api/v1/desires/${encodeURIComponent(desireId)}/matches/${encodeURIComponent(matchId)}`,
    {
      method: 'DELETE',
      ...(signal ? { signal } : {}),
    },
  );
}

export function getMatchCandidates(
  desireId: string,
  options: {
    q?: string | undefined;
    categoryId?: string | undefined;
    includeUnavailable?: boolean | undefined;
    after?: string | undefined;
    limit?: number | undefined;
    signal?: AbortSignal | undefined;
  } = {},
): Promise<MatchCandidatesPage> {
  const params = new URLSearchParams();
  if (options.q) params.set('q', options.q);
  if (options.categoryId) params.set('categoryId', options.categoryId);
  if (options.includeUnavailable) params.set('includeUnavailable', 'true');
  if (options.after) params.set('after', options.after);
  if (options.limit) params.set('limit', String(options.limit));
  const query = params.toString();
  return request<MatchCandidatesPage>(
    `/api/v1/desires/${encodeURIComponent(desireId)}/matches/candidates${query ? `?${query}` : ''}`,
    { ...(options.signal ? { signal: options.signal } : {}) },
  );
}

export function getDesireSuggestions(
  desireId: string,
  options: {
    after?: string | undefined;
    limit?: number | undefined;
    includeDismissed?: boolean | undefined;
    signal?: AbortSignal | undefined;
  } = {},
): Promise<DesireSuggestionsPage> {
  const params = new URLSearchParams();
  if (options.after) params.set('after', options.after);
  if (options.limit) params.set('limit', String(options.limit));
  if (options.includeDismissed) params.set('includeDismissed', 'true');
  const query = params.toString();
  return request<DesireSuggestionsPage>(
    `/api/v1/desires/${encodeURIComponent(desireId)}/matches/suggestions${query ? `?${query}` : ''}`,
    { ...(options.signal ? { signal: options.signal } : {}) },
  );
}

export function recordSuggestionFeedback(
  desireId: string,
  input: CreateSuggestionFeedbackRequest,
  signal?: AbortSignal,
): Promise<DesireSuggestionFeedback> {
  return request<DesireSuggestionFeedback>(
    `/api/v1/desires/${encodeURIComponent(desireId)}/matches/suggestions/feedback`,
    {
      method: 'POST',
      body: JSON.stringify(input),
      ...(signal ? { signal } : {}),
    },
  );
}

export function deleteSuggestionFeedback(
  desireId: string,
  feedbackId: string,
  signal?: AbortSignal,
): Promise<void> {
  return request<void>(
    `/api/v1/desires/${encodeURIComponent(desireId)}/matches/suggestions/feedback/${encodeURIComponent(feedbackId)}`,
    {
      method: 'DELETE',
      ...(signal ? { signal } : {}),
    },
  );
}

export function getSuggestionFeedback(
  desireId: string,
  signal?: AbortSignal,
): Promise<DesireSuggestionFeedback[]> {
  return request<DesireSuggestionFeedback[]>(
    `/api/v1/desires/${encodeURIComponent(desireId)}/matches/suggestions/feedback`,
    { ...(signal ? { signal } : {}) },
  );
}

export function desirePhotoContentUrl(
  desireId: string,
  variant: 'display' | 'thumbnail',
  attempt = 0,
): string {
  const url = `/api/v1/desires/${encodeURIComponent(desireId)}/photo/content/${variant}`;
  return attempt ? `${url}?attempt=${attempt}` : url;
}

export function desirePhotoSource(
  desireId: string,
  photo: Pick<DesirePhoto, 'id' | 'width' | 'height'>,
  alt: string,
  sizes: string,
  options: { attempt?: number; large?: boolean } = {},
): PrivatePhotoSource {
  const attempt = options.attempt ?? 0;
  const fit = (bound: number): number =>
    Math.max(1, Math.round(photo.width * Math.min(1, bound / Math.max(photo.width, photo.height))));
  const thumbnail = desirePhotoContentUrl(desireId, 'thumbnail', attempt);
  const display = desirePhotoContentUrl(desireId, 'display', attempt);
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

/** Pre-validation for private desire image selection. */
export function selectionError(file: File): string | undefined {
  if (/\.(heic|heif)$/i.test(file.name) || /^image\/hei[cf]/i.test(file.type)) {
    return 'HEIC/HEIF is not supported yet. Export this photo as JPEG, PNG or WebP and try again.';
  }
  if (!(itemPhotoLimits.acceptedMimeTypes as readonly string[]).includes(file.type)) {
    return 'Choose JPEG, PNG or WebP. HEIC/HEIF is not supported.';
  }
  if (file.size === 0 || file.size > itemPhotoLimits.maxFileBytes) {
    return desireMessages.PHOTO_FILE_SIZE;
  }
  return undefined;
}

export const classificationInfo: Record<
  DesireClassification,
  { label: string; explanation: string }
> = {
  need: {
    label: 'Need',
    explanation: 'Supports something essential or important for your situation.',
  },
  want: {
    label: 'Want',
    explanation: 'Could add enjoyment, convenience or comfort.',
  },
  greed: {
    label: 'Greed',
    explanation: 'Feels like more than you need right now, but the decision remains yours.',
  },
};

export const effectiveStateInfo: Record<
  DesireEffectiveState,
  { label: string; description: string }
> = {
  bought: { label: 'Bought', description: 'Recorded as bought. Purchase details are separate.' },
  declined: {
    label: 'Declined',
    description: 'Recorded as declined. Any amount not spent is an estimate.',
  },
  used_owned: {
    label: 'Using something owned',
    description: 'Recorded a decision to use an owned item.',
  },
  considering: {
    label: 'Considering',
    description: 'Reflecting without a set deadline.',
  },
  waiting: {
    label: 'Waiting',
    description: 'Waiting period active before reviewing.',
  },
  ready_for_review: {
    label: 'Ready to review',
    description: 'The waiting period has elapsed.',
  },
};

export type WaitingPresetKey = 'none' | '24h' | '7d' | '30d' | 'custom';

export interface WaitingPresetOption {
  key: WaitingPresetKey;
  label: string;
  deriveReviewAt: (now?: Date) => string | null;
}

export const waitingPresets: WaitingPresetOption[] = [
  {
    key: 'none',
    label: 'No waiting period',
    deriveReviewAt: () => null,
  },
  {
    key: '24h',
    label: '24 hours',
    deriveReviewAt: (now = new Date()) =>
      new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    key: '7d',
    label: '7 days',
    deriveReviewAt: (now = new Date()) =>
      new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    key: '30d',
    label: '30 days',
    deriveReviewAt: (now = new Date()) =>
      new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    key: 'custom',
    label: 'Custom review time',
    deriveReviewAt: () => null,
  },
];

export function readReviews(
  id: string,
  before?: number,
  signal?: AbortSignal,
): Promise<ReviewHistoryPage> {
  return request(
    `/api/v1/desires/${encodeURIComponent(id)}/reviews${before ? `?before=${before}` : ''}`,
    { method: 'GET', ...(signal ? { signal } : {}) },
  );
}
export function recordReview(id: string, input: CreateReviewRequest): Promise<ReviewEvent> {
  return request(`/api/v1/desires/${encodeURIComponent(id)}/reviews`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}
export function reviewItems(after?: string): Promise<ItemsPage> {
  const params = new URLSearchParams({ ownershipStatus: 'owned', limit: '25' });
  if (after) params.set('after', after);
  return request(`/api/v1/items?${params}`, { method: 'GET' });
}

/** PER-29: optional bought-desire conversion. */
export function getConversion(id: string, signal?: AbortSignal): Promise<DesireConversionState> {
  return request(`/api/v1/desires/${encodeURIComponent(id)}/conversion`, {
    method: 'GET',
    ...(signal ? { signal } : {}),
  });
}
export function convertDesire(id: string, input: ConvertDesireRequest): Promise<DesireConversion> {
  return request(`/api/v1/desires/${encodeURIComponent(id)}/conversion`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}
export function resumeConversionPhoto(id: string): Promise<DesireConversion> {
  return request(`/api/v1/desires/${encodeURIComponent(id)}/conversion/photo`, {
    method: 'POST',
  });
}
