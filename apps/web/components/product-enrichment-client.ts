import type {
  EnrichmentPage,
  EnrichmentRequest,
  EnrichmentReview,
  EnrichmentReviewEvent,
  EnrichmentWork,
} from '@havefolio/contracts';
export async function enrichmentRequest<T>(
  itemId: string,
  path: string,
  body?: unknown,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/v1/items/${encodeURIComponent(itemId)}/enrichment${path}`, {
      method: body ? 'POST' : 'GET',
      cache: 'no-store',
      credentials: 'same-origin',
      ...(body
        ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
        : {}),
    });
  } catch {
    throw new Error(
      'Could not connect. Your saved item is available through manual entry. Retry when online.',
    );
  }
  if (!response.ok)
    throw new Error(
      response.status === 409
        ? 'This item or suggestion changed. Refresh before reviewing again.'
        : response.status === 401
          ? 'Sign in again to review suggestions.'
          : response.status === 400
            ? 'Check the public product link or GTIN barcode. The image or details may be unsupported.'
            : response.status === 429
              ? 'The request limit was reached. Review existing suggestions or try later.'
              : 'Suggestions are temporarily unavailable. Your saved item is unchanged; retry the same action.',
    );
  return response.json() as Promise<T>;
}
export const productEnrichmentApi = {
  list: (id: string, before?: string) =>
    enrichmentRequest<EnrichmentPage>(id, before ? `?before=${encodeURIComponent(before)}` : ''),
  request: (id: string, body: EnrichmentRequest) => enrichmentRequest<EnrichmentWork>(id, '', body),
  review: (id: string, work: string, body: EnrichmentReview) =>
    enrichmentRequest<EnrichmentReviewEvent>(id, `/${encodeURIComponent(work)}/reviews`, body),
  history: (id: string, before?: string) =>
    enrichmentRequest<{ items: EnrichmentReviewEvent[]; nextBefore: string | null }>(
      id,
      `/reviews${before ? `?before=${encodeURIComponent(before)}` : ''}`,
    ),
};
