export const healthStatuses = ['ok'] as const;

export type HealthStatus = (typeof healthStatuses)[number];

export interface HealthResponse {
  service: 'havefolio-api';
  status: HealthStatus;
  version: '1';
}

/** Owner-private, bounded taxonomy snapshot for management and later item selectors. */
export interface TaxonomyEntry {
  id: string;
  name: string;
  position: number;
  isDemo: boolean;
  retiredAt: string | null;
  itemCount: number;
}
export interface SubcategoryEntry extends TaxonomyEntry {
  categoryId: string;
}
export interface TagEntry {
  id: string;
  name: string;
  itemCount: number;
}
export interface TaxonomySnapshot {
  categories: TaxonomyEntry[];
  subcategories: SubcategoryEntry[];
  tags: TagEntry[];
  defaultsSeeded: boolean;
}

/** Fixed public error codes only; never include names, SQL, identifiers or private input. */
export const taxonomyErrorCodes = [
  'NAME_ALREADY_EXISTS',
  'INVALID_NAME',
  'CATEGORY_REQUIRED',
  'INVALID_PARENT',
  'PARENT_RETIRED',
  'TAXONOMY_NOT_FOUND',
  'TAXONOMY_LIMIT_EXCEEDED',
  'NO_CHANGES',
  'INVALID_OPERATION',
  'ORDER_CHANGED_RELOAD',
  'CONFIRM_SUBCATEGORY_REMOVAL',
  'REPLACEMENT_REQUIRED',
  'INVALID_REPLACEMENT',
  'CONFIRM_TAG_RELATIONSHIP_REMOVAL',
  'TAXONOMY_IN_USE',
  'TAXONOMY_UNAVAILABLE',
] as const;

export const itemStatuses = ['owned', 'sold', 'donated', 'disposed', 'lost', 'returned'] as const;
export type ItemStatus = (typeof itemStatuses)[number];

export const itemConditions = ['working', 'needs_repair', 'broken', 'unknown'] as const;
export type ItemCondition = (typeof itemConditions)[number];

export const itemFrequencies = ['often', 'sometimes', 'rarely', 'never', 'unknown'] as const;
export type ItemFrequency = (typeof itemFrequencies)[number];

export const itemAcquisitions = ['bought', 'gift', 'secondhand', 'other', 'unknown'] as const;
export type ItemAcquisition = (typeof itemAcquisitions)[number];

export const datePrecisions = ['exact', 'month', 'year', 'unknown'] as const;
export type DatePrecision = (typeof datePrecisions)[number];

export interface PurchaseDate {
  precision: DatePrecision;
  year?: number | null | undefined;
  month?: number | null | undefined;
  day?: number | null | undefined;
}

export interface CreateItemRequest {
  name: string;
  ownershipStatus: ItemStatus;
  currency: string;
  pricePaidMinor?: string | null | undefined;
  purchaseDate?: PurchaseDate | undefined;
  acquisitionType?: ItemAcquisition | undefined;
  condition?: ItemCondition | undefined;
  useFrequency?: ItemFrequency | undefined;
  categoryId?: string | null | undefined;
  subcategoryId?: string | null | undefined;
  tagIds?: string[] | undefined;
  brand?: string | null | undefined;
  model?: string | null | undefined;
  description?: string | null | undefined;
  notes?: string | null | undefined;
  specifications?: Record<string, unknown> | null | undefined;
}

export interface ItemResponse {
  id: string;
  name: string;
  ownershipStatus: ItemStatus;
  currency: string;
  pricePaidMinor: string | null;
  purchaseDate: PurchaseDate;
  acquisitionType: ItemAcquisition;
  condition: ItemCondition;
  useFrequency: ItemFrequency;
  categoryId: string | null;
  subcategoryId: string | null;
  tagIds: string[];
  brand: string | null;
  model: string | null;
  description: string | null;
  notes: string | null;
  specifications: Record<string, unknown> | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
  originalEntry: Record<string, unknown>;
  originalSource: string;
}

/** Current cover for browse cards: the first ready photo, identified for authenticated delivery. */
export interface ItemCoverSummary {
  photoId: string;
  width: number;
  height: number;
  altText: string | null;
  decorative: boolean;
}
export interface ItemListEntry extends Omit<ItemResponse, 'description' | 'notes' | 'specifications' | 'originalEntry' | 'originalSource'> {
  cover: ItemCoverSummary | null;
}
/** Bounded opaque cursor page from `GET /api/v1/items`. */
export interface ItemsPage {
  items: ItemListEntry[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface OwnerResponse {
  id: string;
  email: string;
  displayName: string | null;
}

export const itemErrorCodes = [
  'INVALID_ITEM',
  'INVALID_ITEM_DATE',
  'INVALID_ITEM_TAXONOMY',
  'INVALID_ITEM_ACTION',
  'ITEM_NOT_FOUND',
  'ITEM_TAXONOMY_NOT_FOUND',
  'ITEM_TAXONOMY_RETIRED',
  'STALE_ITEM_REVISION',
  'INVALID_ITEM_TRANSITION',
  'ITEM_MEDIA_PENDING',
  'ITEMS_UNAVAILABLE',
] as const;

export interface CurrencyOption {
  code: string;
  name: string;
  symbol: string;
}

export const popularCurrencies: CurrencyOption[] = [
  { code: 'INR', name: 'Indian Rupee', symbol: '₹' },
  { code: 'USD', name: 'US Dollar', symbol: '$' },
  { code: 'EUR', name: 'Euro', symbol: '€' },
  { code: 'GBP', name: 'British Pound', symbol: '£' },
  { code: 'CAD', name: 'Canadian Dollar', symbol: '$' },
  { code: 'AUD', name: 'Australian Dollar', symbol: '$' },
  { code: 'JPY', name: 'Japanese Yen', symbol: '¥' },
  { code: 'SGD', name: 'Singapore Dollar', symbol: '$' },
  { code: 'AED', name: 'UAE Dirham', symbol: 'د.إ' },
  { code: 'CHF', name: 'Swiss Franc', symbol: 'CHF' },
];

/** Exponent (number of minor unit decimal digits) for ISO 4217 currencies. */
export function getCurrencyMinorUnitDigits(currency: string): number {
  const code = currency.toUpperCase();
  // 0 decimals
  if (
    [
      'BIF',
      'BYR',
      'CLP',
      'DJF',
      'GNF',
      'ISK',
      'JPY',
      'KMF',
      'KRW',
      'MGA',
      'PYG',
      'RWF',
      'UGX',
      'UYI',
      'VND',
      'VUV',
      'XAF',
      'XOF',
      'XPF',
    ].includes(code)
  ) {
    return 0;
  }
  // 3 decimals
  if (['BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND'].includes(code)) {
    return 3;
  }
  // 4 decimals
  if (['CLF', 'UYW'].includes(code)) {
    return 4;
  }
  // Standard 2 decimals (including INR, USD, EUR, GBP, CAD, AUD, etc.)
  return 2;
}

/**
 * Converts a user-entered decimal string to integer minor units without floating-point math.
 */
export function parseDisplayAmountToMinorUnits(displayAmount: string, currency: string): string {
  const cleaned = displayAmount.trim().replace(/,/g, '');
  if (!cleaned) {
    throw new Error('Amount is required');
  }

  // Validate format: digits, optional single dot and digits
  if (!/^\d+(\.\d+)?$/.test(cleaned)) {
    throw new Error('Enter a valid positive number or 0');
  }

  const [intPart, fracPart = ''] = cleaned.split('.');
  const exponent = getCurrencyMinorUnitDigits(currency);

  if (exponent === 0 && fracPart.length > 0 && BigInt(fracPart) > 0n) {
    throw new Error(`Amounts in ${currency} cannot have decimal places`);
  }

  if (fracPart.length > exponent) {
    throw new Error(
      `Amounts in ${currency} cannot have more than ${exponent} decimal place${exponent === 1 ? '' : 's'}`,
    );
  }

  const paddedFrac = fracPart.padEnd(exponent, '0');
  const combined = intPart + paddedFrac;

  // Trim leading zeros but preserve single "0"
  const normalized = combined.replace(/^0+/, '') || '0';

  if (BigInt(normalized) > 9223372036854775807n) {
    throw new Error('Amount exceeds maximum supported limit');
  }

  return normalized;
}

/**
 * Formats integer minor units to user-facing display string without floating point arithmetic.
 */
export function formatMinorUnitsToDisplay(
  minorUnits: string | null | undefined,
  currency: string,
): string {
  if (minorUnits == null) return '';
  const exponent = getCurrencyMinorUnitDigits(currency);
  if (exponent === 0) return minorUnits;

  const padded = minorUnits.padStart(exponent + 1, '0');
  const intPart = padded.slice(0, -exponent);
  const fracPart = padded.slice(-exponent);
  return `${intPart}.${fracPart}`;
}

/** Ready item photo metadata. Never contains provider identifiers, object keys or URLs. */
export interface ItemPhoto {
  id: string;
  position: number;
  cover: boolean;
  width: number;
  height: number;
  byteSize: number;
  mimeType: 'image/webp';
  /** Owner-supplied description; null when not yet described. */
  altText: string | null;
  /** Owner explicitly chose an empty alternative because nearby text already conveys the photo. */
  decorative: boolean;
}
export interface ItemPhotoSnapshot {
  revision: number;
  photos: ItemPhoto[];
}
export interface ItemPhotoUploadResult {
  index: number;
  photo?: ItemPhoto;
  error?: string;
}
export interface ItemPhotoUploadResponse {
  results: ItemPhotoUploadResult[];
}
export interface UpdateItemPhotoDescriptionRequest {
  revision: number;
  altText: string | null;
  decorative: boolean;
}
export const itemPhotoLimits = {
  maxPhotosPerItem: 8,
  maxFileBytes: 10 * 1024 * 1024,
  maxAltTextLength: 250,
  acceptedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
} as const;
export type ItemPhotoVariant = 'display' | 'thumbnail';

export const inventorySorts = ['id', 'name', 'newest', 'oldest', 'price', 'updated'] as const;
export const unknownModes = ['include', 'exclude', 'only'] as const;
export interface InventoryQuery {
  q?: string;
  sort?: (typeof inventorySorts)[number];
  direction?: 'asc' | 'desc';
  categoryId?: string;
  subcategoryId?: string;
  tagId?: string;
  ownershipStatus?: ItemStatus;
  useFrequency?: ItemFrequency;
  priceKnown?: (typeof unknownModes)[number];
  dateKnown?: (typeof unknownModes)[number];
  datePrecision?: DatePrecision;
  currency?: string;
  priceMin?: string;
  priceMax?: string;
  purchasedFrom?: string;
  purchasedTo?: string;
  limit?: number;
  after?: string;
}
export type ItemCard = ItemListEntry;
export interface InventoryPage {
  items: ItemCard[];
  nextCursor: string | null;
  hasMore: boolean;
}
export function normalizeInventorySearch(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase();
}
/** A bounded allowlist shared by URLs and API clients. No item records or credentials. */
export const inventoryQueryKeys = [
  'q',
  'sort',
  'direction',
  'categoryId',
  'subcategoryId',
  'tagId',
  'ownershipStatus',
  'useFrequency',
  'priceKnown',
  'dateKnown',
  'datePrecision',
  'currency',
  'priceMin',
  'priceMax',
  'purchasedFrom',
  'purchasedTo',
  'limit',
  'after',
] as const;
