import type { InventoryQuery } from './inventory-source';
import { inventoryQueryParams } from './inventory-query-state';

const storeQueryEvent = 'havefolio-store-query';

/** My Store keeps its query in the URL; history changes made here notify every subscriber. */
export function subscribeStoreLocation(callback: () => void): () => void {
  window.addEventListener('popstate', callback);
  window.addEventListener(storeQueryEvent, callback);
  return () => {
    window.removeEventListener('popstate', callback);
    window.removeEventListener(storeQueryEvent, callback);
  };
}

export function storeHref(query: InventoryQuery): string {
  const params = inventoryQueryParams(query).toString();
  return params ? `/store?${params}` : '/store';
}

export function saveStoreLocation(query: InventoryQuery, replace = false): void {
  const url = storeHref(query);
  if (window.location.pathname + window.location.search === url) return;
  window.history[replace ? 'replaceState' : 'pushState'](null, '', url);
  window.dispatchEvent(new Event(storeQueryEvent));
}
