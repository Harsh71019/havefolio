import type {
  EnrichmentPage,
  EnrichmentRequest,
  EnrichmentReview,
  EnrichmentReviewEvent,
  EnrichmentWork,
} from '@havefolio/contracts';

// Fixed public API codes only. Server text, image content and storage details are never shown.
export const suggestionMessages: Record<string, string> = {
  ACCOUNT_DELETION_PENDING: 'Your account is being deleted, so nothing can change now.',
  CURRENCY_MISMATCH:
    'Refunds are recorded in another currency, so this currency can’t be used. Edit the amount in the recorded currency instead.',
  DEMO_ITEM_READ_ONLY: 'Demo items can’t be changed.',
  ENRICHMENT_ATTACHMENT_NOT_FOUND:
    'That photo or receipt is no longer available. The list has been refreshed.',
  ENRICHMENT_ATTACHMENT_UNSUPPORTED:
    'PDF receipts can’t be read yet. Add a photo of the receipt to get suggestions.',
  ENRICHMENT_COMMAND_CONFLICT:
    'That conflicted with an earlier action. The latest state is loaded.',
  ENRICHMENT_FIELD_NOT_FOUND: 'That suggestion is no longer available.',
  ENRICHMENT_LIMIT_REACHED:
    'This item has as many reading requests as it can take right now. Wait for current ones to finish.',
  ENRICHMENT_NOT_REVIEWABLE: 'These suggestions aren’t ready to review.',
  INVALID_ENRICHMENT_REVIEW: 'Check the corrected value and try again.',
  ITEM_NOT_FOUND: 'This item is unavailable.',
  REFUND_EXCEEDS_AMOUNT_PAID:
    'Refunds recorded for this item add up to more than that. Enter at least the refunded total.',
  STALE_ENRICHMENT_REVISION:
    'This item changed after these suggestions were made, so they can’t be applied safely. Read the image again for fresh suggestions.',
  STALE_ITEM_REVISION: 'This item changed elsewhere. The latest details are loaded; try again.',
};

export class SuggestionRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'SuggestionRequestError';
  }
}

function fallback(status: number): string {
  if (status === 0) return 'You appear to be offline or the connection dropped. Nothing changed.';
  if (status === 401) return 'Your session has ended. Sign in again to review suggestions.';
  if (status === 404) return 'This item is unavailable.';
  if (status === 429) return suggestionMessages.ENRICHMENT_LIMIT_REACHED!;
  if (status === 503) return 'Havefolio is busy. Try again shortly; nothing changed.';
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
    throw new SuggestionRequestError(0, 'NETWORK', fallback(0));
  }
  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as { message?: unknown };
    const code = typeof data.message === 'string' ? data.message : '';
    throw new SuggestionRequestError(
      response.status,
      code,
      response.status === 401
        ? fallback(401)
        : (suggestionMessages[code] ?? fallback(response.status)),
    );
  }
  return (await response.json()) as T;
}

const base = (itemId: string): string => `/api/v1/items/${encodeURIComponent(itemId)}/enrichment`;

/** The newest suggestion sets (bounded to 20). Older ones stay in the private export. */
export function readSuggestions(itemId: string): Promise<EnrichmentPage> {
  return request(`${base(itemId)}?limit=20`);
}

export function requestReading(
  itemId: string,
  input: Pick<EnrichmentRequest, 'commandId' | 'revision' | 'attachmentId'> & {
    kind: 'photo' | 'receipt';
  },
): Promise<EnrichmentWork> {
  return request(base(itemId), { method: 'POST', body: JSON.stringify(input) });
}

export function reviewSuggestion(
  itemId: string,
  workId: string,
  review: EnrichmentReview,
): Promise<EnrichmentReviewEvent> {
  return request(`${base(itemId)}/${encodeURIComponent(workId)}/reviews`, {
    method: 'POST',
    body: JSON.stringify(review),
  });
}

/** The newest 20 decisions; previous and confirmed values are always both kept. */
export async function readDecisions(itemId: string): Promise<EnrichmentReviewEvent[]> {
  return (
    await request<{ items: EnrichmentReviewEvent[]; nextBefore: string | null }>(
      `${base(itemId)}/reviews?limit=20`,
    )
  ).items;
}
