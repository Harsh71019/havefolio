/** PER-43: private, opt-in adapter boundary. URLs are provenance, never fetch permission. */
import { approximateDate, type ApproximateDate } from './approximate-date.js';
import { isCurrencyCode } from './currencies.js';
import { MAX_MINOR_UNITS, minorUnitsPattern, type Money } from './money.js';

/**
 * PER-45 adds the receipt fields additively. `pricePaid` is the canonical `"<ISO> <minor>"`
 * form (`"INR 89900"`); `purchaseDate` is ISO 8601 reduced precision (`2026`, `2026-08` or
 * `2026-08-14`) so year/month-only evidence never gains an invented day.
 */
export const enrichmentFields = [
  'name',
  'brand',
  'model',
  'description',
  'image',
  'pricePaid',
  'purchaseDate',
] as const;
export type EnrichmentField = (typeof enrichmentFields)[number] | `specification:${string}`;
/** Only receipt evidence may suggest what was paid and when; product/link prices never may. */
export const receiptOnlyFields: readonly EnrichmentField[] = ['pricePaid', 'purchaseDate'];
export type EnrichmentInput =
  | { kind: 'name'; name: string }
  | { kind: 'url'; url: string; consent?: 'public-product-metadata-v1' }
  | { kind: 'barcode'; barcode: string; consent?: 'open-food-facts-v1' }
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
/** Owner-authorised scope of a claimed work item; adapters must re-check media against it. */
export interface EnrichmentContext {
  ownerId: string;
  itemId: string;
}
export interface EnrichmentProvider {
  /** Stable non-secret adapter identity, never credentials or a model prompt. */
  readonly id: string;
  readonly kinds: readonly EnrichmentInput['kind'][];
  /** Optional discriminator for source-specific consent; older providers remain compatible. */
  supports?(input: EnrichmentInput): boolean;
  /** Optional deadline; clamped to `maxTimeoutMs` so it always ends inside the work lease. */
  readonly timeoutMs?: number;
  /** Adapters must honour cancellation and never forward private files externally. */
  suggest(
    input: EnrichmentInput,
    signal: AbortSignal,
    context?: EnrichmentContext,
  ): Promise<EnrichmentCandidate[]>;
}
export const enrichmentQueue = 'item-enrichment';
export const enrichmentLimits = {
  candidates: 5,
  fields: 16,
  resultBytes: 32768,
  attempts: 3,
  timeoutMs: 5000,
  /** Below the 30-second lease so a slow local adapter cannot outlive its claim. */
  maxTimeoutMs: 25000,
  leaseMs: 30000,
  batch: 10,
  circuitFailures: 3,
  circuitCooldownMs: 60000,
} as const;
export function validEnrichmentField(field: unknown): field is EnrichmentField {
  return (
    typeof field === 'string' &&
    (enrichmentFields.includes(field as (typeof enrichmentFields)[number]) ||
      /^specification:[a-zA-Z0-9][a-zA-Z0-9 _-]{0,63}$/.test(field))
  );
}
export function validBarcode(value: string): boolean {
  if (!/^(?:[0-9]{8}|[0-9]{12,14})$/.test(value)) return false;
  const digits = [...value].map(Number);
  const last = digits.pop();
  const sum = digits.reverse().reduce((n, d, i) => n + d * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === last;
}
function validImageReference(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.port
    );
  } catch {
    return false;
  }
}
export function formatPricePaidValue(value: Money): string {
  return `${value.currency} ${value.minor.toString()}`;
}
/** Strict canonical parse; anything else (decimals, grouping, symbols) is rejected. */
export function parsePricePaidValue(value: unknown): Money | null {
  if (typeof value !== 'string') return null;
  const match = /^([A-Z]{3}) ([0-9]{1,19})$/.exec(value);
  if (!match || !isCurrencyCode(match[1]) || !minorUnitsPattern.test(match[2]!)) return null;
  const minor = BigInt(match[2]!);
  return minor > MAX_MINOR_UNITS ? null : { currency: match[1], minor };
}
export type KnownDate = Exclude<ApproximateDate, { precision: 'unknown' }>;
export function formatPurchaseDateValue(date: KnownDate): string {
  const pad = (n: number, l: number): string => String(n).padStart(l, '0');
  if (date.precision === 'year') return pad(date.year, 4);
  if (date.precision === 'month') return `${pad(date.year, 4)}-${pad(date.month, 2)}`;
  return `${pad(date.year, 4)}-${pad(date.month, 2)}-${pad(date.day, 2)}`;
}
export function parsePurchaseDateValue(value: unknown): KnownDate | null {
  if (typeof value !== 'string') return null;
  const match = /^([0-9]{4})(?:-([0-9]{2})(?:-([0-9]{2}))?)?$/.exec(value);
  if (!match) return null;
  const [year, month, day] = [match[1], match[2], match[3]].map((v) =>
    v === undefined ? undefined : Number(v),
  );
  try {
    return approximateDate({
      precision: day !== undefined ? 'exact' : month !== undefined ? 'month' : 'year',
      year,
      month,
      day,
    }) as KnownDate;
  } catch {
    return null;
  }
}
export function validEnrichmentValue(field: EnrichmentField, value: unknown): value is string {
  if (field === 'pricePaid') return parsePricePaidValue(value) !== null;
  if (field === 'purchaseDate') return parsePurchaseDateValue(value) !== null;
  return (
    validEnrichmentField(field) &&
    (field !== 'image' || (typeof value === 'string' && validImageReference(value))) &&
    typeof value === 'string' &&
    value.trim().length > 0 &&
    value.length <=
      (field === 'description'
        ? 5000
        : field === 'image'
          ? 2048
          : field.startsWith('specification:')
            ? 1000
            : 300) &&
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
          !validEnrichmentField(suggestion.field) ||
          (receiptOnlyFields.includes(suggestion.field) && kind !== 'receipt') ||
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
  timeoutMs: number = Math.min(
    provider.timeoutMs ?? enrichmentLimits.timeoutMs,
    enrichmentLimits.maxTimeoutMs,
  ),
  context?: EnrichmentContext,
): Promise<EnrichmentCandidate[]> {
  const abort = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      Promise.resolve().then(() => provider.suggest(input, abort.signal, context)),
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
