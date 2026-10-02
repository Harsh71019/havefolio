import type {
  CreateItemRequest,
  DatePrecision,
  ItemAcquisition,
  ItemCondition,
  ItemFrequency,
  ItemResponse,
  ItemStatus,
  OwnerResponse,
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
  ) {
    super(message);
    this.name = 'ItemRequestError';
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
