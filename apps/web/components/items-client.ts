import type {
  CorrectRefundRequest,
  CreateItemRequest,
  ItemActionRequest,
  ItemEventsPage,
  ItemRefundsSnapshot,
  ItemResponse,
  ItemsPage,
  OwnerResponse,
  RecordRefundRequest,
  UpdateItemRequest,
} from '@havefolio/contracts';

const messages: Record<string, string> = {
  INVALID_PURCHASE_URL:
    'Enter an absolute HTTP or HTTPS link without credentials, up to 2048 characters.',
  MERCHANT_NOT_FOUND:
    'This merchant is unavailable. Choose an active merchant or clear the selection.',
  MERCHANT_RETIRED:
    'This merchant has been retired. Choose an active merchant or clear the selection.',
  DEMO_ITEM_READ_ONLY: 'Demo items are read-only examples. Add your own item through manual entry.',
  INVALID_ITEM: 'Check the item name, price and details, then try again.',
  INVALID_ITEM_DATE: 'Check the purchase date. Enter a valid date or choose Date unknown.',
  INVALID_ITEM_TAXONOMY:
    'The selected category or subcategory is invalid. Choose an active category.',
  ITEM_TAXONOMY_NOT_FOUND: 'The selected category or subcategory was not found. Reload the page.',
  ITEM_TAXONOMY_RETIRED:
    'The selected category or subcategory has been retired. Choose an active category.',
  STALE_ITEM_REVISION: 'This item was modified elsewhere. Reload before saving changes.',
  ITEMS_UNAVAILABLE: 'The inventory service is temporarily unavailable. Try again shortly.',
  REQUEST_ORIGIN_REJECTED:
    'The server rejected this request origin. Check your connection or trusted origin configuration.',
  AUTH_REQUIRED: 'Your session has expired. Sign in to save this item.',
  REQUEST_TOO_LARGE: 'The item details are too large. Please shorten the description or notes.',
  ITEM_COMMAND_REUSED:
    'An earlier attempt already saved this item with different details. Check My Store before saving it as a new item.',
};

export class ItemRequestError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    /** Fixed public API code, or '' when the response had none. Never server prose. */
    public readonly code = '',
  ) {
    super(message);
    this.name = 'ItemRequestError';
  }
  get unauthenticated(): boolean {
    return this.status === 401;
  }
  get offline(): boolean {
    return this.status === 0;
  }
  get stale(): boolean {
    return this.code === 'STALE_ITEM_REVISION';
  }
}

export async function createItem(payload: CreateItemRequest): Promise<ItemResponse> {
  let response: Response;
  try {
    response = await fetch('/api/v1/items', {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new ItemRequestError(0, 'Unable to connect. Check your connection and try again.');
  }

  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as {
      message?: unknown;
      statusCode?: number;
    };
    const rawMessage = typeof data.message === 'string' ? data.message : undefined;
    const userMessage =
      (rawMessage && messages[rawMessage]) ||
      (response.status === 401
        ? 'Sign in to save items to your private inventory.'
        : response.status === 400
          ? 'Check the entered values, then try again.'
          : response.status === 413
            ? 'The item details are too large. Please shorten the description or notes.'
            : 'Could not save item. Try again.');

    throw new ItemRequestError(response.status, userMessage, rawMessage ?? '');
  }

  return response.json() as Promise<ItemResponse>;
}

export async function fetchCurrentOwner(): Promise<OwnerResponse | null> {
  try {
    const response = await fetch('/api/v1/auth/me', {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
    });
    if (!response.ok) return null;
    return (await response.json()) as OwnerResponse;
  } catch {
    return null;
  }
}

// Item details, corrections, lifecycle actions, history and deletion (PER-18).
// Fixed public API codes only; server text, identifiers and provider details are never echoed.
const detailMessages: Record<string, string> = {
  ...messages,
  ITEM_NOT_FOUND: 'This item is not in your inventory. It may have been deleted.',
  STALE_ITEM_REVISION: 'This item changed since you opened it.',
  INVALID_ITEM_TRANSITION: 'That change no longer applies to this item’s current status.',
  INVALID_ITEM_ACTION: 'That action could not be recorded. Reload and try again.',
  INVALID_ITEM_CURSOR: 'History could not continue from here. Reload the history.',
  ITEM_MEDIA_PENDING:
    'Some photos or documents are still being processed or cleaned up, so the item was kept.',
  MEDIA_STORAGE_UNAVAILABLE:
    'Private file storage is temporarily unavailable, so the item was kept.',
  ITEMS_UNAVAILABLE: 'Your inventory is temporarily unavailable. Try again shortly.',
  // Refunds (PER-22). Fixed codes only; amounts and notes are never echoed back.
  REFUND_NOT_FOUND: 'That refund is no longer recorded. The list has been refreshed.',
  REFUND_EXCEEDS_AMOUNT_PAID: 'Refunds can’t add up to more than the amount you paid.',
  REFUND_REQUIRES_AMOUNT_PAID: 'Add the amount you paid before recording a refund.',
  INVALID_ACQUISITION_COMBINATION:
    'No amount paid is recorded for this gift, so there is nothing to refund.',
  CURRENCY_MISMATCH: 'A refund uses the same currency as the purchase.',
  REFUND_LIMIT_EXCEEDED: 'This item already has the maximum number of refunds recorded.',
  INVALID_MONEY_AMOUNT: 'Enter an amount greater than zero.',
  MONEY_PRECISION_EXCEEDED: 'That amount has too many decimal places for its currency.',
  UNSAFE_MONEY_VALUE: 'That amount is larger than Havefolio can store.',
  INVALID_CURRENCY: 'Choose a valid currency.',
  INVALID_DATE_PRECISION: 'Check the refund date, or choose “Not recorded”.',
  INVALID_CALENDAR_DATE: 'That date doesn’t exist. Check the day, month and year.',
  INVALID_REFUND: 'Check the refund details, then try again.',
};

function detailFallback(status: number): string {
  if (status === 0) return 'You appear to be offline or the connection dropped.';
  if (status === 401) return 'Your session has ended. Sign in again to continue.';
  if (status === 404) return detailMessages.ITEM_NOT_FOUND!;
  if (status === 400) return 'Check the entered values, then try again.';
  if (status === 413) return 'These details are too large. Shorten the notes or specifications.';
  if (status === 503) return 'The service is temporarily unavailable. Try again shortly.';
  return 'Something went wrong. Try again.';
}

async function itemRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/v1/items${path}`, {
      ...init,
      credentials: 'same-origin',
      cache: 'no-store',
      ...(init.body ? { headers: { 'Content-Type': 'application/json' } } : {}),
    });
  } catch {
    throw new ItemRequestError(0, detailFallback(0), 'NETWORK');
  }
  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as { message?: unknown };
    const code = typeof data.message === 'string' ? data.message : '';
    // 401 always reads as session expiry, whatever code accompanies it.
    const message =
      response.status === 401
        ? detailFallback(401)
        : (detailMessages[code] ?? detailFallback(response.status));
    throw new ItemRequestError(response.status, message, code);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

const itemPath = (id: string): string => `/${encodeURIComponent(id)}`;

export function readItem(id: string): Promise<ItemResponse> {
  return itemRequest(itemPath(id));
}

export function updateItem(id: string, input: UpdateItemRequest): Promise<ItemResponse> {
  return itemRequest(itemPath(id), { method: 'PATCH', body: JSON.stringify(input) });
}

export function recordItemAction(id: string, input: ItemActionRequest): Promise<ItemResponse> {
  return itemRequest(`${itemPath(id)}/actions`, { method: 'POST', body: JSON.stringify(input) });
}

export function readItemHistory(id: string, after?: string | null): Promise<ItemEventsPage> {
  const params = new URLSearchParams({ limit: '50' });
  if (after) params.set('after', after);
  return itemRequest(`${itemPath(id)}/history?${params.toString()}`);
}

/** Erases the item and its private data. Attachments are cleaned up before the record goes. */
export function deleteItem(id: string, revision: number): Promise<void> {
  return itemRequest(itemPath(id), { method: 'DELETE', body: JSON.stringify({ revision }) });
}

/** Category/tag neighbours through the existing server-side inventory filters. No similarity. */
export function readRelatedItems(
  filter: { categoryId: string } | { tagId: string },
  limit = 7,
): Promise<ItemsPage> {
  const params = new URLSearchParams({ ...filter, limit: String(limit), sort: 'updated' });
  return itemRequest(`?${params.toString()}`);
}

const refundsPath = (id: string, refund?: string): string =>
  `${itemPath(id)}/refunds${refund ? `/${encodeURIComponent(refund)}` : ''}`;

/** Confirmed refunds with the unchanged amount paid and derived net recorded spend. */
export function readRefunds(id: string): Promise<ItemRefundsSnapshot> {
  return itemRequest(refundsPath(id));
}

export function recordRefund(id: string, input: RecordRefundRequest): Promise<ItemRefundsSnapshot> {
  return itemRequest(refundsPath(id), { method: 'POST', body: JSON.stringify(input) });
}

export function correctRefund(
  id: string,
  refund: string,
  input: CorrectRefundRequest,
): Promise<ItemRefundsSnapshot> {
  return itemRequest(refundsPath(id, refund), { method: 'PATCH', body: JSON.stringify(input) });
}

export function deleteRefund(
  id: string,
  refund: string,
  revision: number,
): Promise<ItemRefundsSnapshot> {
  return itemRequest(refundsPath(id, refund), {
    method: 'DELETE',
    body: JSON.stringify({ revision }),
  });
}
