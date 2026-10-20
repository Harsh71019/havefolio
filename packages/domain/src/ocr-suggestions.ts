/**
 * PER-45: deterministic interpretation of locally recognised text. OCR output is untrusted
 * data: nothing here follows links, evaluates markup or treats text as instructions. Only
 * the few lines that support a suggestion are kept (as bounded evidence); everything else is
 * discarded by the caller. Uncertain evidence is weakened or dropped, never upgraded to fact.
 */
import { approximateDate, type CalendarDay } from './approximate-date.js';
import type { CurrencyCode } from './currencies.js';
import {
  enrichmentLimits,
  formatPricePaidValue,
  formatPurchaseDateValue,
  validEnrichmentValue,
  type EnrichmentCandidate,
  type EnrichmentField,
  type EnrichmentSuggestion,
  type KnownDate,
} from './enrichment.js';
import { parseDecimalAmount, type Money } from './money.js';

export interface OcrLine {
  text: string;
  /** Recogniser confidence, 0–100. */
  confidence: number;
  /** Line box height in pixels; used only to find the most prominent label text. */
  height: number;
}

/** Fixed caveat tokens carried in a suggestion's source reference and explained in the UI. */
export const ocrFlags = [
  'currency-from-receipt',
  'line-amount',
  'order-total',
  'order-total-unmatched',
  'multiple-units',
  'date-order-unclear',
  'month-only',
  'two-digit-year',
  'more-lines',
  'prominent-text',
  'labelled',
] as const;
export type OcrFlag = (typeof ocrFlags)[number];

export interface OcrReference {
  line: number;
  flags: OcrFlag[];
  text: string;
}

/** `ocr:v1|line=<n>|flags=<a,b>|text=<evidence>`; evidence is the last segment. */
export function formatOcrReference(reference: OcrReference): string {
  return `ocr:v1|line=${reference.line}|flags=${reference.flags.join(',')}|text=${reference.text}`;
}

export function parseOcrReference(value: string): OcrReference | null {
  const match = /^ocr:v1\|line=([0-9]{1,4})\|flags=([a-z,-]*)\|text=([\s\S]*)$/.exec(value);
  if (!match) return null;
  const flags = match[2] ? match[2].split(',') : [];
  if (!flags.every((f) => (ocrFlags as readonly string[]).includes(f))) return null;
  return { line: Number(match[1]), flags: flags as OcrFlag[], text: match[3]! };
}

/** Display bands for adapter confidence. Evidence strength, not a calibrated probability. */
export const ocrConfidenceBands = { clear: 0.85, check: 0.6 } as const;
export function confidenceBand(confidence: number): 'clear' | 'check' | 'unclear' {
  return confidence >= ocrConfidenceBands.clear
    ? 'clear'
    : confidence >= ocrConfidenceBands.check
      ? 'check'
      : 'unclear';
}

export const ocrLimits = {
  /** Lines considered from one image; later lines are ignored rather than buffered. */
  lines: 200,
  lineLength: 300,
  evidenceLength: 160,
  nameLength: 120,
  /** Lines below this recogniser confidence are not used at all. */
  minimumLineConfidence: 40,
} as const;

const months = [
  'jan',
  'feb',
  'mar',
  'apr',
  'may',
  'jun',
  'jul',
  'aug',
  'sep',
  'oct',
  'nov',
  'dec',
] as const;
const monthPattern =
  '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';

// Explicit markers only. A bare "$" is shared by many currencies, so it never decides one.
const currencyMarkers: ReadonlyArray<[RegExp, CurrencyCode]> = [
  [/₹|\brs\b\.?|\binr\b/i, 'INR'],
  [/\busd\b|\bus\$/i, 'USD'],
  [/€|\beur\b/i, 'EUR'],
  [/£|\bgbp\b/i, 'GBP'],
  [/\baed\b/i, 'AED'],
  [/\bsgd\b|\bs\$/i, 'SGD'],
];

function lineCurrency(text: string): CurrencyCode | null | 'mixed' {
  const found = new Set(currencyMarkers.filter(([p]) => p.test(text)).map(([, c]) => c));
  return found.size === 0 ? null : found.size > 1 ? 'mixed' : [...found][0]!;
}

const amountAtEnd =
  /(?:^|[\s:=])(?:₹|rs\.?|inr|usd|us\$|eur|€|gbp|£|aed|sgd|s\$|\$)?\s*([0-9]{1,3}(?:,[0-9]{2,3})+(?:\.[0-9]{1,3})?|[0-9]+(?:\.[0-9]{1,3})?)\s*(?:inr|usd|eur|gbp|aed|sgd)?\s*$/i;

interface Amount {
  text: string;
  /** Raw decimal text, parsed exactly per currency only once a currency is known. */
  decimal: string;
  explicitCurrency: CurrencyCode | null;
  hasFraction: boolean;
  before: string;
}

function trailingAmount(text: string): Amount | null {
  const match = amountAtEnd.exec(text);
  if (!match) return null;
  const currency = lineCurrency(match[0]);
  if (currency === 'mixed') return null;
  return {
    text: match[0].trim(),
    decimal: match[1]!,
    explicitCurrency: currency,
    hasFraction: match[1]!.includes('.'),
    before: text.slice(0, match.index + (match[0].length - match[0].trimStart().length)).trim(),
  };
}

function exactMoney(decimal: string, currency: CurrencyCode): Money | null {
  try {
    return parseDecimalAmount(decimal, currency);
  } catch {
    return null;
  }
}

const totalPattern =
  /\b(grand\s*total|total(?:\s*(?:amount|payable|due))?|net\s*(?:amount|payable|total)|amount\s*(?:paid|payable)|bill\s*amount)\b/i;
const notTotalPattern =
  /\b(sub\s*-?\s*total|total\s*(?:qty|quantity|items?|savings?|discount|tax|gst|mrp))\b/i;
// Lines that carry money but never describe a purchased item.
const nonItemPattern =
  /\b(sub\s*-?\s*total|total|tax|taxable|gst|cgst|sgst|igst|vat|cess|discount|savings?|saved|round(?:ing|\s*off)?|change|cash|tendered|card|upi|paid|payable|balance|due|tip|service\s*charge|delivery|shipping|packing|invoice|bill\s*no|gstin|phone|tel|mobile|date|time|qty|items?|thank|mrp|you\s*saved|loyalty|points?|refund|net)\b/i;
const quantityHeader = /\b(qty|quantity)\b/i;
const sensitivePattern = /\b(serial|s\/n|imei|card\s*no|a\/c|account|gstin|pan|aadhaar)\b/i;

function letters(text: string): number {
  return (text.match(/\p{L}/gu) ?? []).length;
}

function clean(text: string): string {
  return Array.from(text)
    .filter((c) => {
      const code = c.codePointAt(0)!;
      return code > 31 && code !== 127;
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, ocrLimits.lineLength);
}

function evidence(text: string): string {
  return text.slice(0, ocrLimits.evidenceLength).replace(/\|/g, '/');
}

const confidence = (line: OcrLine, factor: number): number =>
  Math.round(Math.max(0, Math.min(1, (line.confidence / 100) * factor)) * 100) / 100;

interface DateEvidence {
  date: KnownDate;
  flags: OcrFlag[];
  factor: number;
}

function monthIndex(token: string): number {
  return months.indexOf(token.slice(0, 3).toLowerCase() as (typeof months)[number]) + 1;
}

function datesIn(text: string, today: CalendarDay): DateEvidence[] {
  const [ty, tm, td] = today.split('-').map(Number) as [number, number, number];
  const results: DateEvidence[] = [];
  const add = (
    precision: 'exact' | 'month' | 'year',
    year: number,
    month: number | undefined,
    day: number | undefined,
    flags: OcrFlag[],
    factor: number,
  ): void => {
    if (year < 2000 || year > ty) return;
    let date: KnownDate;
    try {
      date = approximateDate({ precision, year, month, day }) as KnownDate;
    } catch {
      return;
    }
    // A receipt cannot be from the future; allow one day for time zones.
    const comparable = [year, month ?? 1, day ?? 1];
    const limit = [ty, tm, td + 1];
    for (let i = 0; i < 3; i++) {
      if (comparable[i]! < limit[i]!) break;
      if (comparable[i]! > limit[i]!) return;
    }
    results.push({ date, flags, factor });
  };
  const fullYear = (raw: string): [number, OcrFlag[], number] =>
    raw.length === 4 ? [Number(raw), [], 1] : [2000 + Number(raw), ['two-digit-year'], 0.8];
  for (const m of text.matchAll(/\b([0-9]{4})[-/.]([0-9]{1,2})[-/.]([0-9]{1,2})\b/g))
    add('exact', Number(m[1]), Number(m[2]), Number(m[3]), [], 1);
  for (const m of text.matchAll(/\b([0-9]{1,2})[-/.]([0-9]{1,2})[-/.]([0-9]{4}|[0-9]{2})\b/g)) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const [year, flags, factor] = fullYear(m[3]!);
    if (a > 12 && b <= 12) add('exact', year, b, a, flags, factor);
    else if (b > 12 && a <= 12) add('exact', year, a, b, flags, factor);
    else if (a === b) add('exact', year, a, b, flags, factor);
    // Day and month could be either way round: keep only the part the receipt proves.
    else add('year', year, undefined, undefined, [...flags, 'date-order-unclear'], factor * 0.7);
  }
  for (const m of text.matchAll(
    new RegExp(
      `\\b([0-9]{1,2})(?:st|nd|rd|th)?[\\s-]+${monthPattern}\\.?[\\s,'-]+([0-9]{4}|[0-9]{2})\\b`,
      'gi',
    ),
  )) {
    const [year, flags, factor] = fullYear(m[3]!);
    add('exact', year, monthIndex(m[2]!), Number(m[1]), flags, factor);
  }
  for (const m of text.matchAll(
    new RegExp(`\\b${monthPattern}\\.?\\s+([0-9]{1,2})(?:st|nd|rd|th)?,?\\s+([0-9]{4})\\b`, 'gi'),
  ))
    add('exact', Number(m[3]), monthIndex(m[1]!), Number(m[2]), [], 1);
  if (!results.length)
    for (const m of text.matchAll(
      new RegExp(`(?<![0-9]\\s?)\\b${monthPattern}\\.?[\\s,'-]+([0-9]{4})\\b`, 'gi'),
    ))
      add('month', Number(m[2]), monthIndex(m[1]!), undefined, ['month-only'], 0.95);
  return results;
}

interface Located<T> {
  index: number;
  line: OcrLine;
  value: T;
}

function receiptDate(lines: OcrLine[], today: CalendarDay): Located<DateEvidence> | null {
  const found: Located<DateEvidence>[] = [];
  lines.forEach((line, index) => {
    for (const value of datesIn(line.text, today)) found.push({ index, line, value });
  });
  if (!found.length) return null;
  const distinct = new Set(found.map((f) => formatPurchaseDateValue(f.value.date)));
  if (distinct.size === 1) return found[0]!;
  // Several different dates (bill, due, warranty…): only a single labelled one is used.
  const labelled = found.filter((f) =>
    /\b(bill|invoice|order|txn|purchase)?\s*date\b/i.test(f.line.text),
  );
  const labelledValues = new Set(labelled.map((f) => formatPurchaseDateValue(f.value.date)));
  return labelledValues.size === 1 ? labelled[0]! : null;
}

function suggestion(
  field: EnrichmentField,
  value: string,
  score: number,
  provider: string,
  kind: 'photo' | 'receipt',
  index: number,
  line: OcrLine,
  flags: OcrFlag[],
): EnrichmentSuggestion | null {
  if (!validEnrichmentValue(field, value)) return null;
  return {
    field,
    value,
    confidence: score,
    source: {
      provider,
      inputKind: kind,
      reference: formatOcrReference({ line: index + 1, flags, text: evidence(line.text) }),
    },
  };
}

function itemName(before: string, quantityColumn: boolean): { name: string; quantity: number } {
  let name = before.replace(/^[0-9]{1,3}[.)]\s+/, '').trim();
  let quantity = 1;
  const explicit = /\s+([0-9]{1,3})\s*[x×@]\s*[0-9][0-9,]*(?:\.[0-9]{1,3})?\s*$/i.exec(name);
  if (explicit) {
    quantity = Number(explicit[1]);
    name = name.slice(0, explicit.index).trim();
  } else if (quantityColumn) {
    // Inside a quantity column, OCR often reads 1 as i/l/I/| and 0 as O/o.
    const column = /\s+([0-9Iil|Oo]{1,2})\s*$/.exec(name);
    if (column) {
      quantity = Number(column[1]!.replace(/[Iil|]/g, '1').replace(/[Oo]/g, '0'));
      name = name.slice(0, column.index).trim();
    }
  }
  return { name: name.slice(0, ocrLimits.nameLength).trim(), quantity };
}

function receiptCandidates(
  lines: OcrLine[],
  provider: string,
  today: CalendarDay,
): EnrichmentCandidate[] {
  const currencies = new Set<CurrencyCode>();
  let mixed = false;
  for (const line of lines) {
    const found = lineCurrency(line.text);
    if (found === 'mixed') mixed = true;
    else if (found) currencies.add(found);
  }
  // The currency must be printed on this receipt; several different ones decide nothing.
  const documentCurrency = !mixed && currencies.size === 1 ? [...currencies][0]! : null;
  const priced = (amount: Amount): { money: Money; flags: OcrFlag[]; factor: number } | null => {
    const currency = amount.explicitCurrency ?? documentCurrency;
    if (!currency) return null;
    const money = exactMoney(amount.decimal, currency);
    if (!money) return null;
    return amount.explicitCurrency
      ? { money, flags: [], factor: 1 }
      : { money, flags: ['currency-from-receipt'], factor: 0.9 };
  };

  const totalIndex = lines.findIndex(
    (l) => totalPattern.test(l.text) || /sub\s*-?\s*total/i.test(l.text),
  );
  const itemRegion = totalIndex === -1 ? lines : lines.slice(0, totalIndex);
  const quantityColumn = lines.some((l) => quantityHeader.test(l.text));
  const items: Located<{ name: string; quantity: number; amount: Amount }>[] = [];
  itemRegion.forEach((line, index) => {
    if (nonItemPattern.test(line.text) || sensitivePattern.test(line.text)) return;
    const amount = trailingAmount(line.text);
    // Whole numbers without a currency marker are usually codes, phone or bill numbers.
    if (!amount || (!amount.hasFraction && !amount.explicitCurrency)) return;
    const { name, quantity } = itemName(amount.before, quantityColumn);
    if (letters(name) < 3) return;
    items.push({ index, line, value: { name, quantity, amount } });
  });

  let total: Located<Amount> | null = null;
  lines.forEach((line, index) => {
    if (!totalPattern.test(line.text) || notTotalPattern.test(line.text)) return;
    const amount = trailingAmount(line.text);
    if (!amount) return;
    // Grand/net totals outrank a plain "Total"; otherwise the last total line wins.
    const strong = /grand|net|payable|paid/i.test(line.text);
    if (!total || strong || !/grand|net|payable|paid/i.test(total.line.text))
      total = { index, line, value: amount };
  });

  const date = receiptDate(lines, today);
  const dateField = (): EnrichmentSuggestion | null =>
    date
      ? suggestion(
          'purchaseDate',
          formatPurchaseDateValue(date.value.date),
          confidence(date.line, date.value.factor),
          provider,
          'receipt',
          date.index,
          date.line,
          date.value.flags,
        )
      : null;
  const compact = (fields: Array<EnrichmentSuggestion | null>): EnrichmentSuggestion[] =>
    fields.filter((f): f is EnrichmentSuggestion => f !== null);

  const candidates: EnrichmentCandidate[] = [];
  if (items.length === 0) {
    const t = total as Located<Amount> | null;
    const price = t ? priced(t.value) : null;
    const fields = compact([
      t && price
        ? suggestion(
            'pricePaid',
            formatPricePaidValue(price.money),
            // The total may cover several purchases; it is never presented as clear.
            Math.min(confidence(t.line, price.factor * 0.6), ocrConfidenceBands.check - 0.01),
            provider,
            'receipt',
            t.index,
            t.line,
            [...price.flags, 'order-total-unmatched'],
          )
        : null,
      dateField(),
    ]);
    if (fields.length) candidates.push({ id: 'receipt-summary', fields });
    return candidates;
  }
  const shown = items.slice(0, enrichmentLimits.candidates);
  const more = items.length > shown.length;
  for (const item of shown) {
    const extra: OcrFlag[] = [
      ...(item.value.quantity > 1 ? (['multiple-units'] as const) : []),
      ...(more ? (['more-lines'] as const) : []),
    ];
    let price: EnrichmentSuggestion | null = null;
    const t = total as Located<Amount> | null;
    const single = items.length === 1;
    const totalPrice = single && t ? priced(t.value) : null;
    if (t && totalPrice) {
      // One item line: the receipt total is what was paid for it, including its charges.
      price = suggestion(
        'pricePaid',
        formatPricePaidValue(totalPrice.money),
        confidence(t.line, totalPrice.factor * (item.value.quantity > 1 ? 0.6 : 0.9)),
        provider,
        'receipt',
        t.index,
        t.line,
        [...totalPrice.flags, 'order-total', ...extra],
      );
    } else {
      // Several lines: each keeps its own amount; the order total is never spread across them.
      const linePrice = priced(item.value.amount);
      if (linePrice)
        price = suggestion(
          'pricePaid',
          formatPricePaidValue(linePrice.money),
          confidence(item.line, linePrice.factor * (item.value.quantity > 1 ? 0.6 : 0.85)),
          provider,
          'receipt',
          item.index,
          item.line,
          [...linePrice.flags, 'line-amount', ...extra],
        );
    }
    const fields = compact([
      suggestion(
        'name',
        item.value.name,
        confidence(item.line, 0.9),
        provider,
        'receipt',
        item.index,
        item.line,
        more ? ['more-lines'] : [],
      ),
      price,
      dateField(),
    ]);
    if (fields.length) candidates.push({ id: `receipt-line-${item.index + 1}`, fields });
  }
  return candidates;
}

function photoCandidates(lines: OcrLine[], provider: string): EnrichmentCandidate[] {
  const fields: EnrichmentSuggestion[] = [];
  const used = new Set<number>();
  const labelled = (field: 'brand' | 'model', pattern: RegExp): void => {
    for (const [index, line] of lines.entries()) {
      const match = pattern.exec(line.text);
      if (!match) continue;
      const value = match[1]!.trim().slice(0, ocrLimits.nameLength);
      const s = suggestion(field, value, confidence(line, 0.9), provider, 'photo', index, line, [
        'labelled',
      ]);
      if (s) {
        fields.push(s);
        used.add(index);
      }
      return;
    }
  };
  labelled(
    'model',
    /\b(?:model(?:\s*(?:no|number|#))?\.?|m\/n)\s*[:#.-]?\s*([A-Z0-9][A-Z0-9./-]{1,39})\b/i,
  );
  labelled('brand', /\bbrand\s*[:-]\s*(\p{L}[\p{L}\p{N} &'.-]{1,59})$/iu);
  // The largest readable text is often a brand, logo or slogan, so it is only ever unclear.
  const prominent = lines
    .map((line, index) => ({ line, index }))
    .filter(
      ({ line, index }) =>
        letters(line.text) >= 4 && !sensitivePattern.test(line.text) && !used.has(index),
    )
    .sort((a, b) => b.line.height - a.line.height || a.index - b.index)[0];
  if (prominent) {
    const s = suggestion(
      'name',
      prominent.line.text.slice(0, ocrLimits.nameLength),
      Math.min(confidence(prominent.line, 0.6), ocrConfidenceBands.check - 0.01),
      provider,
      'photo',
      prominent.index,
      prominent.line,
      ['prominent-text'],
    );
    if (s) fields.unshift(s);
  }
  return fields.length ? [{ id: 'photo-label', fields }] : [];
}

/**
 * Turns recognised lines into bounded, reviewable candidates. `today` is the caller's UTC
 * calendar day, used only to reject impossible future receipt dates.
 */
export function ocrCandidates(
  kind: 'photo' | 'receipt',
  rawLines: readonly OcrLine[],
  provider: string,
  today: CalendarDay,
): EnrichmentCandidate[] {
  const lines = rawLines
    .slice(0, ocrLimits.lines)
    .map((line) => ({
      text: clean(typeof line.text === 'string' ? line.text : ''),
      confidence: Number.isFinite(line.confidence) ? line.confidence : 0,
      height: Number.isFinite(line.height) ? line.height : 0,
    }))
    .filter((line) => line.text && line.confidence >= ocrLimits.minimumLineConfidence);
  return kind === 'receipt'
    ? receiptCandidates(lines, provider, today)
    : photoCandidates(lines, provider);
}
