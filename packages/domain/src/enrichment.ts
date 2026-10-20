/** PER-43: private, opt-in adapter boundary. URLs are provenance, never fetch permission. */
export const enrichmentFields = ['name', 'brand', 'model', 'description'] as const;
export type EnrichmentField = (typeof enrichmentFields)[number];
export type EnrichmentInput =
  | { kind: 'name'; name: string }
  | { kind: 'url'; url: string }
  | { kind: 'barcode'; barcode: string }
  | { kind: 'photo' | 'receipt'; attachmentId: string };
export interface EnrichmentSuggestion {
  field: EnrichmentField;
  value: string;
  confidence: number;
  source: { provider: string; inputKind: EnrichmentInput['kind']; reference: string };
}
export interface EnrichmentCandidate {
  id: string;
  fields: EnrichmentSuggestion[];
}
export interface EnrichmentProvider {
  /** Stable non-secret adapter identity, never credentials or a model prompt. */
  readonly id: string;
  readonly kinds: readonly EnrichmentInput['kind'][];
  /** Adapters must honour cancellation and never forward private files externally. */
  suggest(input: EnrichmentInput, signal: AbortSignal): Promise<EnrichmentCandidate[]>;
}
export const enrichmentQueue = 'item-enrichment';
export const enrichmentLimits = {
  candidates: 5,
  fields: 4,
  resultBytes: 32768,
  attempts: 3,
  timeoutMs: 5000,
  leaseMs: 30000,
  batch: 10,
  circuitFailures: 3,
  circuitCooldownMs: 60000,
} as const;
export function validEnrichmentValue(field: EnrichmentField, value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    value.length <= (field === 'description' ? 5000 : 300) &&
    !Array.from(value).some((character) => {
      const code = character.codePointAt(0)!;
      return code <= 31 && ![9, 10, 13].includes(code);
    })
  );
}
/** Runtime validation is mandatory even for typed adapters. Never persist arbitrary payloads. */
export function validateEnrichmentCandidates(
  value: EnrichmentCandidate[],
  provider: string,
  kind: EnrichmentInput['kind'],
): EnrichmentCandidate[] {
  if (
    !Array.isArray(value) ||
    value.length > enrichmentLimits.candidates ||
    new TextEncoder().encode(JSON.stringify(value)).length > enrichmentLimits.resultBytes
  )
    throw new Error('ENRICHMENT_INVALID_RESULT');
  const ids = new Set<string>();
  return value.map((candidate) => {
    if (
      !candidate ||
      typeof candidate.id !== 'string' ||
      !/^[a-zA-Z0-9_-]{1,80}$/.test(candidate.id) ||
      ids.has(candidate.id) ||
      !Array.isArray(candidate.fields) ||
      candidate.fields.length < 1 ||
      candidate.fields.length > enrichmentLimits.fields
    )
      throw new Error('ENRICHMENT_INVALID_RESULT');
    ids.add(candidate.id);
    const fields = new Set<string>();
    return {
      id: candidate.id,
      fields: candidate.fields.map((suggestion) => {
        if (
          !suggestion ||
          !enrichmentFields.includes(suggestion.field) ||
          fields.has(suggestion.field) ||
          !validEnrichmentValue(suggestion.field, suggestion.value) ||
          !Number.isFinite(suggestion.confidence) ||
          suggestion.confidence < 0 ||
          suggestion.confidence > 1 ||
          suggestion.source?.provider !== provider ||
          suggestion.source.inputKind !== kind ||
          typeof suggestion.source.reference !== 'string' ||
          !suggestion.source.reference.trim() ||
          suggestion.source.reference.length > 512
        )
          throw new Error('ENRICHMENT_INVALID_RESULT');
        fields.add(suggestion.field);
        return {
          field: suggestion.field,
          value: suggestion.value,
          confidence: suggestion.confidence,
          source: { provider, inputKind: kind, reference: suggestion.source.reference },
        };
      }),
    };
  });
}
/** Process-local circuit: failures never log the provider exception or input. */
export class EnrichmentCircuit {
  private failures = 0;
  private openUntil = 0;
  constructor(private readonly now: () => number = Date.now) {}
  isOpen(): boolean {
    return this.now() < this.openUntil;
  }
  success(): void {
    this.failures = 0;
    this.openUntil = 0;
  }
  failure(): void {
    if (++this.failures >= enrichmentLimits.circuitFailures)
      this.openUntil = this.now() + enrichmentLimits.circuitCooldownMs;
  }
}
export async function callEnrichmentProvider(
  provider: EnrichmentProvider,
  input: EnrichmentInput,
  timeoutMs: number = enrichmentLimits.timeoutMs,
): Promise<EnrichmentCandidate[]> {
  const abort = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      Promise.resolve().then(() => provider.suggest(input, abort.signal)),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          abort.abort();
          reject(new Error('ENRICHMENT_TIMEOUT'));
        }, timeoutMs);
      }),
    ]);
    return validateEnrichmentCandidates(result, provider.id, input.kind);
  } finally {
    if (timer) clearTimeout(timer);
    abort.abort();
  }
}
