import {
  BadRequestException,
  ConflictException,
  type HttpException,
  NotFoundException,
} from '@nestjs/common';
import { isFinancialDomainError, type FinancialErrorCode } from '@havefolio/domain';

const conflicts = new Set<FinancialErrorCode>([
  'CURRENCY_MISMATCH',
  'REFUND_EXCEEDS_AMOUNT_PAID',
  'REFUND_REQUIRES_AMOUNT_PAID',
  'INVALID_ACQUISITION_COMBINATION',
  'REFUND_LIMIT_EXCEEDED',
]);

/** Fixed domain code to HTTP status. The response and logs carry only the code token. */
export function financialHttpException(code: FinancialErrorCode): HttpException {
  if (code === 'REFUND_NOT_FOUND') return new NotFoundException(code);
  return conflicts.has(code) ? new ConflictException(code) : new BadRequestException(code);
}

/** Runs pure domain validation, translating its stable codes; other errors pass through. */
export function domain<T>(operation: () => T): T {
  try {
    return operation();
  } catch (error) {
    if (isFinancialDomainError(error)) throw financialHttpException(error.code);
    throw error;
  }
}

/**
 * Database backstops for refund invariants (PER-22 migration). The application validates first;
 * these only fire if a write races or bypasses it. SQL text and values are never surfaced.
 */
export function refundConstraintException(error: unknown): HttpException | undefined {
  const constraint =
    error && typeof error === 'object' && 'constraint' in error ? error.constraint : undefined;
  if (constraint === 'refund_total_check')
    return new ConflictException('REFUND_EXCEEDS_AMOUNT_PAID');
  if (constraint === 'refund_item_owner_currency_fk')
    return new ConflictException('CURRENCY_MISMATCH');
  return undefined;
}
