import type {
  CreateItemRequest,
  DatePrecision,
  ItemAcquisition,
  ItemActionRequest,
  ItemCondition,
  ItemEventsPage,
  ItemFrequency,
  ItemResponse,
  ItemsPage,
  ItemStatus,
  OwnerResponse,
  UpdateItemRequest,
} from '@havefolio/contracts';

const messages: Record<string, string> = {
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

    throw new ItemRequestError(response.status, userMessage);
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

export interface ItemDraft {
  version: 1;
  name: string;
  ownershipStatus: ItemStatus;
  currency: string;
  priceMode: 'known' | 'unknown';
  priceDisplay: string;
  datePrecision: DatePrecision;
  purchaseYear?: string | undefined;
  purchaseMonth?: string | undefined;
  purchaseDay?: string | undefined;
  categoryId?: string | undefined;
  subcategoryId?: string | undefined;
  tagIds?: string[] | undefined;
  brand?: string | undefined;
  model?: string | undefined;
  description?: string | undefined;
  notes?: string | undefined;
  acquisitionType?: ItemAcquisition | undefined;
  condition?: ItemCondition | undefined;
  useFrequency?: ItemFrequency | undefined;
  updatedAt: string;
}

export function getDraftStorageKey(ownerId: string): string {
  return `havefolio_item_draft_v1_${ownerId}`;
}

export function saveItemDraft(
  ownerId: string,
  draft: Omit<ItemDraft, 'version' | 'updatedAt'>,
): void {
  if (typeof window === 'undefined' || !ownerId) return;
  try {
    const fullDraft: ItemDraft = {
      ...draft,
      version: 1,
      updatedAt: new Date().toISOString(),
    };
    window.localStorage.setItem(getDraftStorageKey(ownerId), JSON.stringify(fullDraft));
  } catch {
    // Quota exceeded or storage unavailable; silently fail safe without throwing
  }
}

export function loadItemDraft(ownerId: string): ItemDraft | null {
  if (typeof window === 'undefined' || !ownerId) return null;
  try {
    const raw = window.localStorage.getItem(getDraftStorageKey(ownerId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (
      parsed &&
      typeof parsed === 'object' &&
      'version' in parsed &&
      parsed.version === 1 &&
      'name' in parsed &&
      typeof parsed.name === 'string'
    ) {
      return parsed as ItemDraft;
    }
    // Incompatible or corrupt version, discard safely
    window.localStorage.removeItem(getDraftStorageKey(ownerId));
    return null;
  } catch {
    // Corrupt JSON, clear safely
    try {
      window.localStorage.removeItem(getDraftStorageKey(ownerId));
    } catch {
      // Ignore storage errors
    }
    return null;
  }
}

export function clearItemDraft(ownerId: string): void {
  if (typeof window === 'undefined' || !ownerId) return;
  try {
    window.localStorage.removeItem(getDraftStorageKey(ownerId));
  } catch {
    // Ignore storage errors
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
