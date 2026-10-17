import type { Merchant, MerchantsPage } from '@havefolio/contracts';
export async function merchantRequest<T = MerchantsPage>(
  path = '',
  method = 'GET',
  body?: object,
  signal?: AbortSignal,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/v1/merchants${path}`, {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
      ...(signal ? { signal } : {}),
      ...(body
        ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
        : {}),
    });
  } catch {
    throw new Error('Could not connect. Your entries are kept; check your connection and retry.');
  }
  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as { message?: string };
    throw new Error(
      response.status === 401
        ? 'Sign in again to access your private merchants.'
        : data.message === 'MERCHANT_NAME_EXISTS'
          ? 'That name is already reserved, including retired merchants.'
          : response.status === 400
            ? 'Check the merchant name and website host, then retry.'
            : 'Could not load or save merchants. Your entries are kept; retry when connected.',
    );
  }
  const result: unknown = await response.json();
  if (
    method === 'GET' &&
    (path === '' || path.startsWith('?')) &&
    (!result ||
      typeof result !== 'object' ||
      !('merchants' in result) ||
      !Array.isArray(result.merchants))
  ) {
    throw new Error('Could not load merchants. Your entries are kept; retry.');
  }
  return result as T;
}
export const saveMerchant = (input: {
  displayName: string;
  websiteHost?: string | null;
}): Promise<Merchant> => merchantRequest<Merchant>('', 'POST', input);
