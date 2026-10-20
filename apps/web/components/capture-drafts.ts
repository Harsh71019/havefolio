import type {
  DatePrecision,
  ItemAcquisition,
  ItemCondition,
  ItemFrequency,
  ItemStatus,
} from '@havefolio/contracts';

/**
 * PER-47 local capture-draft policy (docs/architecture/mobile-capture-resilience.md).
 *
 * - Opt-in per owner and device; without consent drafts live only in page memory.
 * - One add-item draft per owner. Only typed text and taxonomy IDs; never merchants, purchase
 *   URLs, files, previews, server responses, credentials, tokens or private media URLs.
 * - Every record names its owner and is returned only for that owner.
 * - Expires 7 days after the last edit and is capped at 64 KiB serialized (field maxima in any script).
 * - Sign-in by another owner, Log out and account deletion remove it.
 */
export const draftLimits = { ttlMs: 7 * 24 * 60 * 60 * 1000, maxBytes: 64 * 1024 } as const;

const prefix = 'havefolio.capture-draft.v2.';
const consentPrefix = 'havefolio.capture-draft-consent.v1.';
// PER-11 autosaved without consent, expiry or sign-out cleanup; only read once, then removed.
const legacyPrefix = 'havefolio_item_draft_v1_';

export interface ItemDraftFields {
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
  /** Create command reused after an unconfirmed save so a retry cannot duplicate the item. */
  commandId?: string | undefined;
}

export interface ItemDraft extends ItemDraftFields {
  version: 2;
  ownerId: string;
  updatedAt: string;
}

export type SaveDraftResult = 'saved' | 'too-large' | 'unavailable';

function storage(): Storage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

function remove(key: string): void {
  try {
    storage()?.removeItem(key);
  } catch {
    // Storage blocked: nothing could have been written either.
  }
}

function keys(): string[] {
  const store = storage();
  if (!store) return [];
  try {
    return Array.from({ length: store.length }, (_v, i) => store.key(i) ?? '');
  } catch {
    return [];
  }
}

const allPrefixes = [prefix, consentPrefix, legacyPrefix];

export function hasDraftConsent(ownerId: string): boolean {
  try {
    return storage()?.getItem(consentPrefix + ownerId) === 'granted';
  } catch {
    return false;
  }
}

/** Revoking consent deletes the stored draft immediately; page memory is the caller's. */
export function setDraftConsent(ownerId: string, granted: boolean): boolean {
  if (!granted) {
    remove(consentPrefix + ownerId);
    remove(prefix + ownerId);
    return true;
  }
  try {
    const store = storage();
    if (!store) return false;
    store.setItem(consentPrefix + ownerId, 'granted');
    return true;
  } catch {
    return false;
  }
}

export function saveItemDraft(ownerId: string, fields: ItemDraftFields): SaveDraftResult {
  if (!ownerId || !hasDraftConsent(ownerId)) return 'unavailable';
  const draft: ItemDraft = {
    ...fields,
    version: 2,
    ownerId,
    updatedAt: new Date().toISOString(),
  };
  const value = JSON.stringify(draft);
  if (new Blob([value]).size > draftLimits.maxBytes) {
    remove(prefix + ownerId);
    return 'too-large';
  }
  try {
    const store = storage();
    if (!store) return 'unavailable';
    store.setItem(prefix + ownerId, value);
    return 'saved';
  } catch {
    return 'unavailable';
  }
}

function fresh(updatedAt: unknown, now: number): boolean {
  const time = typeof updatedAt === 'string' ? Date.parse(updatedAt) : NaN;
  return Number.isFinite(time) && time <= now + 60_000 && now - time < draftLimits.ttlMs;
}

export function loadItemDraft(ownerId: string, now = Date.now()): ItemDraft | null {
  if (!ownerId) return null;
  const key = prefix + ownerId;
  try {
    const raw = storage()?.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ItemDraft> | null;
    if (
      parsed?.version === 2 &&
      parsed.ownerId === ownerId &&
      typeof parsed.name === 'string' &&
      fresh(parsed.updatedAt, now) &&
      hasDraftConsent(ownerId)
    )
      return parsed as ItemDraft;
  } catch {
    // Corrupt JSON is discarded below.
  }
  remove(key);
  return null;
}

/**
 * Reads a PER-11 draft saved without consent into memory once and deletes it from storage.
 * It is stored again only if the owner turns on device drafts.
 */
export function takeLegacyItemDraft(ownerId: string, now = Date.now()): ItemDraftFields | null {
  if (!ownerId) return null;
  const key = legacyPrefix + ownerId;
  let draft: ItemDraftFields | null = null;
  try {
    const raw = storage()?.getItem(key);
    const parsed = raw ? (JSON.parse(raw) as Record<string, unknown> | null) : null;
    if (parsed?.version === 1 && typeof parsed.name === 'string' && fresh(parsed.updatedAt, now)) {
      const fields = { ...parsed };
      delete fields.version;
      delete fields.updatedAt;
      draft = fields as unknown as ItemDraftFields;
    }
  } catch {
    draft = null;
  }
  remove(key);
  return draft;
}

export function clearItemDraft(ownerId: string): void {
  if (ownerId) remove(prefix + ownerId);
}

/** After a sign-in: drafts and consent of every other owner on this device are removed. */
export function purgeOtherOwnersDrafts(ownerId: string): void {
  for (const key of keys())
    for (const p of allPrefixes)
      if (key.startsWith(p) && key.slice(p.length) !== ownerId) remove(key);
}

/** Log out and account deletion: remove every capture draft and consent on this device. */
export function clearAllCaptureDrafts(): void {
  for (const key of keys()) if (allPrefixes.some((p) => key.startsWith(p))) remove(key);
}
