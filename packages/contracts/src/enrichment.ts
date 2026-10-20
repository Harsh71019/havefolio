/** PER-43: owner-private review contract. No purchase money/date fields are accepted. */
export type EnrichmentField = 'name' | 'brand' | 'model' | 'description';
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
  providerStatus: 'unconfigured';
  items: EnrichmentWork[];
  nextBefore: string | null;
}
