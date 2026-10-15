import type { SpendingQuery, SpendingReport } from '@havefolio/contracts';
import { spendingQueryParams } from './spending-query';

const messages: Record<string, string> = {
  INVALID_SPENDING_QUERY:
    'These filters are no longer available. Reset filters or choose another category.',
  INVALID_REQUEST: 'Check the selected filters and purchase-date range.',
  SPENDING_BUCKET_LIMIT:
    'There are too many groups to show. Narrow the currency, category or purchase-date filters.',
  SPENDING_PRECISION_UNREPRESENTABLE:
    'Some purchases only have a year recorded. Choose the yearly view; no month or day has been assumed.',
};
export class SpendingRequestError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function readSpending(
  q: SpendingQuery,
  signal?: AbortSignal,
): Promise<SpendingReport> {
  let response: Response;
  try {
    response = await fetch(`/api/v1/spending?${spendingQueryParams(q)}`, {
      credentials: 'same-origin',
      cache: 'no-store',
      ...(signal ? { signal } : {}),
    });
  } catch {
    throw new SpendingRequestError(
      0,
      'Unable to connect. You may be offline. Check your connection and retry.',
    );
  }
  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as { message?: unknown };
    throw new SpendingRequestError(
      response.status,
      response.status === 401
        ? 'Your session has ended. Sign in again to see recorded spending.'
        : (typeof data.message === 'string' && messages[data.message]) ||
            'Recorded spending is temporarily unavailable. Please retry.',
    );
  }
  try {
    return (await response.json()) as SpendingReport;
  } catch {
    throw new SpendingRequestError(
      503,
      'Recorded spending is temporarily unavailable. Please retry.',
    );
  }
}
