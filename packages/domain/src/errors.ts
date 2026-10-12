/**
 * Stable financial-domain error codes. They are fixed public tokens: never interpolate amounts,
 * notes, dates or identifiers into them, so they are safe for API responses, logs and GlitchTip.
 */
export const financialErrorCodes = [
  'INVALID_CURRENCY',
  'CURRENCY_MISMATCH',
  'INVALID_MONEY_AMOUNT',
  'MONEY_PRECISION_EXCEEDED',
  'UNSAFE_MONEY_VALUE',
  'INVALID_DATE_PRECISION',
  'INVALID_CALENDAR_DATE',
  'REFUND_EXCEEDS_AMOUNT_PAID',
  'REFUND_REQUIRES_AMOUNT_PAID',
  'INVALID_ACQUISITION_COMBINATION',
  'INVALID_REFUND',
  'REFUND_NOT_FOUND',
  'REFUND_LIMIT_EXCEEDED',
] as const;
export type FinancialErrorCode = (typeof financialErrorCodes)[number];

export class FinancialDomainError extends Error {
  constructor(public readonly code: FinancialErrorCode) {
    // The message is the code itself, so no private value can leak through `message`.
    super(code);
    this.name = 'FinancialDomainError';
  }
}

export function isFinancialDomainError(value: unknown): value is FinancialDomainError {
  return value instanceof FinancialDomainError;
}

export const fail = (code: FinancialErrorCode): never => {
  throw new FinancialDomainError(code);
};
