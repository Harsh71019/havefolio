import { inventoryQueryParams, readInventoryQuery } from './inventory-query-state';

/** A one-time My Store notice after deletion; holds only the deleted item's name. */
export const deletedFlashKey = 'havefolio:item-deleted';

/** Where item pages may send the owner back to. Anything else falls back to My Store. */
const returnRoutes = ['/store'] as const;
export const defaultReturnPath = '/store';

/**
 * Accepts only a same-origin application route from the allowlist, rebuilt from parsed parts so
 * no scheme, host, protocol-relative prefix, credentials, fragment or unknown query survives.
 * The query is reduced to the bounded PER-17 inventory keys.
 */
export function safeReturnPath(raw: string | null | undefined): string {
  if (!raw || raw.length > 4096 || !raw.startsWith('/') || raw.startsWith('//')) {
    return defaultReturnPath;
  }
  if (raw.includes('\\') || [...raw].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127))
    return defaultReturnPath;
  let url: URL;
  try {
    // A fixed placeholder origin: if parsing escapes it, the input was not a local path.
    url = new URL(raw, 'https://havefolio.invalid');
  } catch {
    return defaultReturnPath;
  }
  if (url.origin !== 'https://havefolio.invalid') return defaultReturnPath;
  const route = returnRoutes.find((path) => path === url.pathname);
  if (!route) return defaultReturnPath;
  const query = inventoryQueryParams(readInventoryQuery(url.searchParams)).toString();
  return query ? `${route}?${query}` : route;
}

/** The current My Store location, as a return path to carry into item pages. */
export function storeReturnPath(search: string): string {
  return safeReturnPath(`/store${search.startsWith('?') || !search ? search : `?${search}`}`);
}

const withReturn = (path: string, returnTo: string): string =>
  returnTo === defaultReturnPath ? path : `${path}?returnTo=${encodeURIComponent(returnTo)}`;

export function itemDetailHref(id: string, returnTo = defaultReturnPath): string {
  return withReturn(`/items/${encodeURIComponent(id)}`, safeReturnPath(returnTo));
}

export function itemPhotosHref(id: string, returnTo = defaultReturnPath): string {
  return withReturn(`/items/${encodeURIComponent(id)}/photos`, safeReturnPath(returnTo));
}
