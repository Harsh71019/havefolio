/**
 * PER-43: owner-private review contract. PER-45 adds receipt-only `pricePaid` (`"INR 89900"`:
 * ISO currency and integer minor units) and `purchaseDate` (`2026`, `2026-08` or
 * `2026-08-14`). Only receipt evidence can suggest them and only an explicit review applies them.
 */
export type EnrichmentField =
  'name' | 'brand' | 'model' | 'description' | 'pricePaid' | 'purchaseDate';
export interface EnrichmentRequest {
  commandId: string;
  revision: number;
  kind: 'name' | 'url' | 'barcode' | 'photo' | 'receipt';
  /** Required only for barcode; name/URL are read from the existing item. */
  barcode?: string;
  attachmentId?: string;
}
export interface EnrichmentReview {
  commandId: string;
  revision: number;
  candidateId: string;
  field: EnrichmentField;
  decision: 'accept' | 'reject' | 'correct';
  /** Only for correct. */
  value?: string;
}
export interface EnrichmentReviewEvent extends EnrichmentReview {
  id: string;
  workId: string;
  previousValue: string | null;
  confirmedValue: string | null;
  resultingRevision: number;
  createdAt: string;
}
export interface EnrichmentWork {
  id: string;
  itemId: string;
  /** PER-45: which typed input produced this work, so source-specific review stays separate. */
  inputKind: EnrichmentRequest['kind'];
  /** The owner's own private photo/receipt attachment ID; null for other inputs. */
  attachmentId: string | null;
  baseRevision: number;
  state: 'pending' | 'processing' | 'retry' | 'succeeded' | 'failed' | 'unconfigured' | 'stale';
  attempts: number;
  failureCode: 'PROVIDER_UNCONFIGURED' | 'PROVIDER_FAILED' | null;
  candidates: Array<{
    id: string;
    fields: Array<{
      field: EnrichmentField;
      value: string;
      confidence: number;
      source: { provider: string; inputKind: EnrichmentRequest['kind']; reference: string };
    }>;
  }>;
  createdAt: string;
}
export interface EnrichmentPage {
  /** `available` when at least one input kind has a configured local adapter. */
  providerStatus: 'available' | 'unconfigured';
  /** Input kinds that can currently produce suggestions; others resolve as unconfigured. */
  availableKinds: EnrichmentRequest['kind'][];
  items: EnrichmentWork[];
  nextBefore: string | null;
}
