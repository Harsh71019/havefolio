import type { TaxonomySnapshot } from '@havefolio/contracts';

const messages: Record<string, string> = {
  NAME_ALREADY_EXISTS:
    'That name already exists, including retired entries. Choose another name or restore the existing entry.',
  INVALID_NAME: 'Enter a name with visible characters within the allowed length.',
  REPLACEMENT_REQUIRED: 'Choose a replacement before deleting a category used by items.',
  CONFIRM_SUBCATEGORY_REMOVAL: 'Confirm child subcategory removal before deleting the parent.',
  CONFIRM_TAG_RELATIONSHIP_REMOVAL:
    'Confirm removal of this tag from its items before deleting it.',
  TAXONOMY_IN_USE:
    'The classification changed or is still in use. Reload and choose a replacement.',
  PARENT_RETIRED: 'Restore the parent category first.',
  INVALID_REPLACEMENT: 'Choose an active replacement in the same category for a subcategory.',
  ORDER_CHANGED_RELOAD: 'The list changed. Reload before reordering.',
  TAXONOMY_LIMIT_EXCEEDED:
    'The limit is 500 entries of each kind. Remove unused entries before adding more.',
  TAXONOMY_NOT_FOUND: 'This entry is no longer available. Reload the list.',
  REQUEST_ORIGIN_REJECTED:
    'The server rejected this request origin. Check the application’s trusted origin configuration.',
};
export class TaxonomyRequestError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function taxonomyRequest(
  path = '',
  method = 'GET',
  body?: object,
): Promise<TaxonomySnapshot> {
  let response: Response;
  try {
    response = await fetch(`/api/v1/taxonomy${path}`, {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
      ...(body
        ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
        : {}),
    });
  } catch {
    throw new TaxonomyRequestError(0, 'Unable to connect. Check your connection and try again.');
  }
  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as { message?: unknown };
    throw new TaxonomyRequestError(
      response.status,
      response.status === 401
        ? 'Sign in to manage your private categories and tags.'
        : (typeof data.message === 'string' && messages[data.message]) ||
            (response.status === 400
              ? 'Check the name and selected values, then try again.'
              : 'Could not save or load taxonomy. Try again.'),
    );
  }
  return response.json() as Promise<TaxonomySnapshot>;
}
