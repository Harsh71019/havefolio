export const healthStatuses = ['ok'] as const;

export type HealthStatus = (typeof healthStatuses)[number];

export interface HealthResponse {
  service: 'havefolio-api';
  status: HealthStatus;
  version: '1';
}

export interface LivenessResponse {
  service: 'havefolio-api';
  status: 'ok';
}

export const dependencyStatuses = ['ok', 'degraded', 'unavailable', 'disabled'] as const;
export type DependencyStatus = (typeof dependencyStatuses)[number];

export const healthErrorCodes = [
  'DATABASE_UNAVAILABLE',
  'VALKEY_UNAVAILABLE',
  'STORAGE_UNAVAILABLE',
  'TIMEOUT',
] as const;
export type HealthErrorCode = (typeof healthErrorCodes)[number];

export interface DependencyHealth {
  status: DependencyStatus;
  error?: HealthErrorCode;
}

export const readinessStatuses = ['ok', 'degraded', 'unavailable'] as const;
export type ReadinessStatus = (typeof readinessStatuses)[number];

export interface ReadinessDependencies {
  postgres: DependencyHealth;
  valkey: DependencyHealth;
  storage: DependencyHealth;
}

export interface ReadinessResponse {
  service: 'havefolio-api';
  status: ReadinessStatus;
  dependencies: ReadinessDependencies;
  durationMs?: number;
}

export interface WebAvailabilityResponse {
  service: 'havefolio-web';
  status: 'ok';
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
  /** Persisted sample identity; internal dataset IDs are never exposed. */
  isDemo: boolean;
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
export interface ItemListEntry extends Omit<
  ItemResponse,
  'description' | 'notes' | 'specifications' | 'originalEntry' | 'originalSource'
> {
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
  'INVALID_ITEM_QUERY',
  'INVALID_ITEM_CURSOR',
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

// Money parsing, minor-unit rules and formatting live in @havefolio/domain (PER-22).

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
  /** Exact spending membership; additive, used only by the insights drill-down. */
  spendingScope?: SpendingScope;
  spendingDateBucket?: SpendingBucket['dateBucket'];
  spendingUnassigned?: 'category' | 'subcategory';
  spendingYear?: string;
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
  'spendingScope',
  'spendingDateBucket',
  'spendingUnassigned',
  'spendingYear',
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

/** `PATCH /api/v1/items/:id`. Ownership changes only through actions; revision is last-seen. */
export type UpdateItemRequest = Partial<Omit<CreateItemRequest, 'ownershipStatus'>> & {
  revision: number;
};

export const itemActions = ['ownership_changed', 'used', 'repaired'] as const;
export type ItemAction = (typeof itemActions)[number];
/** `POST /api/v1/items/:id/actions`. Appends history; never edits purchase details. */
export interface ItemActionRequest {
  revision: number;
  action: ItemAction;
  /** Required only for `ownership_changed`. */
  ownershipStatus?: ItemStatus;
  /** ISO date-time the event happened; omitted records the current time. */
  occurredAt?: string;
  note?: string;
}

export const itemEventTypes = [
  'created',
  'details_updated',
  'ownership_changed',
  'condition_changed',
  'usage_changed',
  'used',
  'repaired',
  'refund_recorded',
  'refund_corrected',
  'refund_deleted',
  'correction',
] as const;
export type ItemEventType = (typeof itemEventTypes)[number];
/** Append-only lifecycle event. Metadata is owner-private and must be presented, not dumped. */
export interface ItemEvent {
  id: string;
  eventType: ItemEventType;
  occurredAt: string;
  createdAt: string;
  metadata: Record<string, unknown>;
}
/** `GET /api/v1/items/:id/history`: chronological by occurrence; cursor is the last event ID. */
export interface ItemEventsPage {
  events: ItemEvent[];
  nextCursor: string | null;
  hasMore: boolean;
}

export const itemDocumentKinds = ['receipt', 'warranty'] as const;
export type ItemDocumentKind = (typeof itemDocumentKinds)[number];
/** Ready private receipt/warranty metadata. Never contains provider identifiers or URLs. */
export interface ItemDocument {
  id: string;
  kind: ItemDocumentKind;
  mimeType: 'application/pdf' | 'image/webp';
  byteSize: number;
  width: number | null;
  height: number | null;
}
export interface ItemDocumentSnapshot {
  revision: number;
  documents: ItemDocument[];
}
export const itemDocumentLimits = {
  maxDocumentsPerItem: 16,
  maxImageBytes: 10 * 1024 * 1024,
  maxPdfBytes: 20 * 1024 * 1024,
  acceptedMimeTypes: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'],
} as const;

/** A confirmed refund received for an item. Amounts are integer minor-unit decimal strings. */
export interface ItemRefund {
  id: string;
  amountMinor: string;
  /** Always the purchase currency; never converted. */
  currency: string;
  /** Exact, month-only, year-only or unknown; unknown never becomes today. */
  refundDate: PurchaseDate;
  /** Private neutral note; never sent to telemetry. */
  note: string | null;
  createdAt: string;
  updatedAt: string;
}
/** Purchase amount stays the historical fact; net recorded spend is derived, never stored. */
export interface ItemRefundTotals {
  currency: string;
  /** null is not recorded; "0" is an explicit zero. */
  amountPaidMinor: string | null;
  refundedMinor: string;
  /** Amount paid minus refunds; null when the amount paid is not recorded. Never negative. */
  netMinor: string | null;
}
/** `GET|POST|PATCH|DELETE /api/v1/items/:id/refunds[/:refundId]` response. */
export interface ItemRefundsSnapshot {
  /** Item revision to send with the next refund change. */
  revision: number;
  ownershipStatus: ItemStatus;
  acquisitionType: ItemAcquisition;
  totals: ItemRefundTotals;
  refunds: ItemRefund[];
}
export interface RecordRefundRequest {
  revision: number;
  amountMinor: string;
  currency: string;
  refundDate?: PurchaseDate | undefined;
  note?: string | null | undefined;
}
export type CorrectRefundRequest = Partial<Omit<RecordRefundRequest, 'revision'>> & {
  revision: number;
};

/** PER-20: one purchase-basis analysis; no cross-currency grand total. */
export type SpendingScope = 'current-owned' | 'all-history';
export type SpendingGrouping = 'overall' | 'category' | 'subcategory' | 'year' | 'month';
export interface SpendingQuery {
  scope: SpendingScope;
  grouping?: SpendingGrouping;
  currency?: string;
  categoryId?: string;
  subcategoryId?: string;
  purchasedFrom?: string;
  purchasedTo?: string;
}
export interface SpendingBucket {
  currency: string;
  /** null for overall, unassigned taxonomy or unknown date; see grouping/dateBucket. */
  key: string | null;
  dateBucket: 'dated' | 'spanningRange' | 'unknownDate';
  grossMinor: string;
  refundedMinor: string;
  netMinor: string;
  pricedItemCount: number;
  unknownPriceCount: number;
  notSpendingCount: number;
  explicitZeroCount: number;
  knownDateCount: number;
  unknownDateCount: number;
  totalItemCount: number;
}
export interface SpendingReport {
  scope: SpendingScope;
  grouping: SpendingGrouping;
  basis: 'purchase-date';
  purchasedFrom: string | null;
  purchasedTo: string | null;
  buckets: SpendingBucket[];
}

export type OnboardingState = 'not_started' | 'active' | 'skipped' | 'completed';
export type OnboardingAction =
  'start' | 'skip' | 'complete' | 'revisit' | 'browse_store' | 'review_item';
export interface OnboardingStatus {
  state: OnboardingState;
  genuineItemCount: number;
  demoItemCount: number;
  browsedStore: boolean;
  reviewedItem: boolean;
  triedDemo: boolean;
  removedDemo: boolean;
}

/** PER-23: Desires and waiting-period contracts. */
export const desireClassifications = ['need', 'want', 'greed'] as const;
export type DesireClassification = (typeof desireClassifications)[number];

export const desireStatuses = [
  'considering',
  'waiting',
  'bought',
  'declined',
  'used_owned',
] as const;
export type DesireStatus = (typeof desireStatuses)[number];

export const desireEffectiveStates = [
  'considering',
  'waiting',
  'ready_for_review',
  'bought',
  'declined',
  'used_owned',
] as const;
export type DesireEffectiveState = (typeof desireEffectiveStates)[number];

export interface WaitingPeriodInput {
  reviewAt: string;
  startedAt?: string;
}

export interface DesirePhoto {
  id: string;
  width: number;
  height: number;
  byteSize: number;
  mimeType: 'image/webp';
  altText: string | null;
  decorative: boolean;
  createdAt: string;
}

export interface Desire {
  id: string;
  name: string;
  classification: DesireClassification | null;
  likelyPriceMinor: string | null;
  currency: string | null;
  productUrl: string | null;
  reason: string | null;
  status: DesireStatus;
  effectiveState: DesireEffectiveState;
  waitingStartedAt: string | null;
  reviewAt: string | null;
  photo: DesirePhoto | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface DesiresPage {
  items: Desire[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface CreateDesireRequest {
  name: string;
  classification?: DesireClassification | null;
  likelyPriceMinor?: string | null;
  currency?: string | null;
  productUrl?: string | null;
  reason?: string | null;
  waitingPeriod?: WaitingPeriodInput | null;
}

export interface PatchDesireRequest {
  revision: number;
  name?: string;
  classification?: DesireClassification | null;
  likelyPriceMinor?: string | null;
  currency?: string | null;
  productUrl?: string | null;
  reason?: string | null;
  waitingPeriod?: WaitingPeriodInput | null;
}

export const desireMatchErrorCodes = [
  'MATCH_ALREADY_EXISTS',
  'MATCH_NOT_FOUND',
  'INVALID_MATCH_REASON',
  'INVALID_MATCH_RELEVANCE',
  'MATCH_LIMIT_EXCEEDED',
  'MATCHES_UNAVAILABLE',
] as const;
export type DesireMatchErrorCode = (typeof desireMatchErrorCodes)[number];

/** PER-29: fixed bought-desire conversion tokens; never names, notes, URLs or amounts. */
export const desireConversionErrorCodes = [
  'INVALID_CONVERSION',
  'DESIRE_NOT_BOUGHT',
  'STALE_BOUGHT_OUTCOME',
  'DESIRE_ALREADY_CONVERTED',
  'CONVERSION_COMMAND_REUSED',
  'CONVERSION_NOT_FOUND',
] as const;
export type DesireConversionErrorCode = (typeof desireConversionErrorCodes)[number];

export const desireErrorCodes = [
  'INVALID_DESIRE',
  'INVALID_DESIRE_PRICE',
  'INVALID_DESIRE_URL',
  'INVALID_DESIRE_WAIT',
  'INVALID_DESIRE_TRANSITION',
  'DESIRE_NOT_FOUND',
  'STALE_DESIRE_REVISION',
  'INVALID_DESIRE_CURSOR',
  'DESIRE_PHOTO_NOT_FOUND',
  'DESIRE_PHOTO_LIMIT',
  'DESIRE_MEDIA_PENDING',
  'DESIRES_UNAVAILABLE',
  ...desireMatchErrorCodes,
  ...desireConversionErrorCodes,
] as const;
export type DesireErrorCode = (typeof desireErrorCodes)[number];

/** PER-27: private in-app reminder delivery. */
export const notificationTypes = ['desire_wait_ended'] as const;
export type NotificationType = (typeof notificationTypes)[number];

export interface Notification {
  id: string;
  type: NotificationType;
  desireId: string;
  occurredAt: string;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationsPage {
  items: Notification[];
  nextCursor: string | null;
  hasMore: boolean;
  unreadCount: number;
}

export const notificationErrorCodes = [
  'INVALID_NOTIFICATION_CURSOR',
  'NOTIFICATION_NOT_FOUND',
  'NOTIFICATIONS_UNAVAILABLE',
] as const;
export type NotificationErrorCode = (typeof notificationErrorCodes)[number];

/** PER-28: immutable owner-private review history. Amounts are estimates, never savings. */
export const reviewOutcomes = ['bought', 'delayed', 'declined', 'used_owned'] as const;
export type ReviewOutcome = (typeof reviewOutcomes)[number];
export interface CreateReviewRequest {
  commandId: string;
  revision: number;
  outcome: ReviewOutcome;
  note?: string;
  linkedItemId?: string;
  reviewAt?: string;
  supersedesEventId?: string;
}
export interface ReviewEvent {
  id: string;
  sequence: number;
  outcome: ReviewOutcome;
  occurredAt: string;
  note: string | null;
  linkedItemId: string | null;
  linkedItemName: string | null;
  reviewAt: string | null;
  supersedesEventId: string | null;
  estimatedNotSpentMinor: string | null;
  currency: string | null;
}
export interface ReviewHistoryPage {
  items: ReviewEvent[];
  nextBefore: number | null;
  currentEventId: string | null;
  estimatedNotSpentMinor: string | null;
  currency: string | null;
}

/** PER-25: Manual owned-item matching with explainable reasons. */
export const matchRelevanceValues = ['relevant', 'irrelevant'] as const;
export type MatchRelevance = (typeof matchRelevanceValues)[number];

export const matchSources = ['manual', 'suggested'] as const;
export type MatchSource = (typeof matchSources)[number];

export interface DesireMatchItemSummary {
  id: string;
  name: string;
  brand: string | null;
  model: string | null;
  ownershipStatus: ItemStatus;
  condition: ItemCondition;
  useFrequency: ItemFrequency;
  categoryId: string | null;
  categoryName: string | null;
  subcategoryId: string | null;
  subcategoryName: string | null;
  tags: string[];
  cover: ItemCoverSummary | null;
  isUsableAlternative: boolean;
}

export interface DesireMatchHints {
  categoryHint: string | null;
  usageHint: string | null;
  conditionHint: string | null;
  traitHints: string[];
}

export interface DesireMatch {
  id: string;
  desireId: string;
  itemId: string;
  reason: string;
  relevance: MatchRelevance;
  source: MatchSource;
  item: DesireMatchItemSummary;
  hints: DesireMatchHints;
  createdAt: string;
  updatedAt: string;
}

export interface DesireMatchesPage {
  items: DesireMatch[];
  nextCursor: string | null;
  hasMore: boolean;
  totalCount: number;
}

export interface CreateDesireMatchRequest {
  itemId: string;
  reason?: string | undefined;
  relevance?: MatchRelevance | undefined;
}

export interface PatchDesireMatchRequest {
  reason?: string | undefined;
  relevance?: MatchRelevance | undefined;
}

export interface MatchCandidateItem extends DesireMatchItemSummary {
  isAlreadyMatched: boolean;
  suggestedReason: string;
  hints: DesireMatchHints;
}

export interface MatchCandidatesPage {
  items: MatchCandidateItem[];
  nextCursor: string | null;
  hasMore: boolean;
}

/**
 * PER-29: optional conversion of an effective bought desire into an owned item. Suggestions are
 * copied desire data the owner may accept or edit; the likely price is reference only and is
 * never used as the actual price paid.
 */
export const conversionPhotoStates = ['not_requested', 'pending', 'copied', 'unavailable'] as const;
export type ConversionPhotoState = (typeof conversionPhotoStates)[number];

export interface DesireConversion {
  id: string;
  desireId: string;
  itemId: string;
  itemName: string;
  boughtEventId: string;
  /** False after a later review correction; the item is retained, never silently deleted. */
  boughtOutcomeCurrent: boolean;
  photo: ConversionPhotoState;
  createdAt: string;
}

export interface DesireConversionSuggestions {
  name: string;
  notes: string | null;
  productUrl: string | null;
  photo: DesirePhoto | null;
  /** Reference only: what the owner expected to pay. Never the actual price paid. */
  likelyPriceMinor: string | null;
  likelyCurrency: string | null;
}

export type DesireConversionEligibility = 'eligible' | 'converted' | 'not_bought';

export interface DesireConversionState {
  desireId: string;
  eligibility: DesireConversionEligibility;
  /** The current effective bought event, or null when the current outcome is not bought. */
  boughtEventId: string | null;
  suggestions: DesireConversionSuggestions;
  conversion: DesireConversion | null;
}

/** Explicit actual price paid: a known amount (including "0") or unknown. Never inferred. */
export type ConfirmedPricePaid = { state: 'known'; minor: string } | { state: 'unknown' };

export interface ConvertDesireItemRequest {
  name: string;
  ownershipStatus: ItemStatus;
  currency: string;
  pricePaid: ConfirmedPricePaid;
  purchaseDate: PurchaseDate;
  acquisitionType: ItemAcquisition;
  condition: ItemCondition;
  useFrequency: ItemFrequency;
  categoryId?: string | null | undefined;
  subcategoryId?: string | null | undefined;
  tagIds?: string[] | undefined;
  brand?: string | null | undefined;
  model?: string | null | undefined;
  notes?: string | null | undefined;
}

export interface ConvertDesireRequest {
  /** Stable client command UUID. Retry the identical body with the same UUID. */
  commandId: string;
  /** The effective bought event the owner is confirming. */
  boughtEventId: string;
  copyPhoto: boolean;
  item: ConvertDesireItemRequest;
}
