import type { HomeSummary } from '@havefolio/contracts';

export class HomeRequestError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
const unavailable = 'Your Home summary is temporarily unavailable. Please retry.';
function isSummary(value: unknown): value is HomeSummary {
  const v = value as Partial<HomeSummary> | null;
  return Boolean(
    v &&
    v.inventory &&
    Array.isArray(v.spending?.buckets) &&
    Array.isArray(v.recentItems) &&
    Array.isArray(v.desires?.items) &&
    Array.isArray(v.goals?.items) &&
    v.rediscovery,
  );
}
/** One same-origin request; private data never enters shared server-rendered payloads. */
export async function readHome(signal?: AbortSignal): Promise<HomeSummary> {
  let response: Response;
  try {
    response = await fetch('/api/v1/home', {
      credentials: 'same-origin',
      cache: 'no-store',
      ...(signal ? { signal } : {}),
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new HomeRequestError(
      0,
      'Unable to connect. You may be offline. Check your connection and retry.',
    );
  }
  if (!response.ok)
    throw new HomeRequestError(
      response.status,
      response.status === 401 ? 'Sign in to see your private Home summary.' : unavailable,
    );
  const body: unknown = await response.json().catch(() => null);
  if (!isSummary(body)) throw new HomeRequestError(503, unavailable);
  return body;
}
