import {
  inventoryQueryKeys,
  inventorySorts,
  unknownModes,
  itemStatuses,
  itemFrequencies,
  datePrecisions,
  normalizeInventorySearch,
  type InventoryQuery,
} from '@havefolio/contracts';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Parse only bounded, supported public query fields. Invalid cursor state is discarded. API validates relationships and ranges. */
export function readInventoryQuery(params: URLSearchParams): InventoryQuery {
  const query: Record<string, string | number> = {};
  const enums: Record<string, readonly string[]> = {
    sort: inventorySorts,
    direction: ['asc', 'desc'],
    priceKnown: unknownModes,
    dateKnown: unknownModes,
    ownershipStatus: itemStatuses,
    useFrequency: itemFrequencies,
    datePrecision: datePrecisions,
  };
  for (const key of inventoryQueryKeys) {
    const value = params.get(key);
    if (value === null || value.length > 2048 || params.getAll(key).length !== 1) continue;
    if (enums[key]) {
      if (enums[key].includes(value)) query[key] = value;
      continue;
    }
    if (key === 'q') {
      const normalized = normalizeInventorySearch(value);
      if (normalized.length <= 200 && normalized) query[key] = normalized;
      continue;
    }
    if (['categoryId', 'subcategoryId', 'tagId'].includes(key)) {
      if (uuid.test(value)) query[key] = value;
      continue;
    }
    if (key === 'currency') {
      if (/^[A-Z]{3}$/.test(value)) query[key] = value;
      continue;
    }
    if (key === 'priceMin' || key === 'priceMax') {
      if (/^(0|[1-9][0-9]{0,18})$/.test(value) && BigInt(value) <= 9223372036854775807n)
        query[key] = value;
      continue;
    }
    if (key === 'purchasedFrom' || key === 'purchasedTo') {
      if (/^\d{4}-\d{2}-\d{2}$/.test(value)) query[key] = value;
      continue;
    }
    if (key === 'limit') {
      if (/^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= 100)
        query[key] = Number(value);
      continue;
    }
    if (key === 'after' && /^v1\.[A-Za-z0-9_-]{40,2045}$/.test(value)) query[key] = value;
  }
  if (!query.categoryId) delete query.subcategoryId;
  return query;
}
export function inventoryQueryParams(query: InventoryQuery): URLSearchParams {
  const result = new URLSearchParams();
  for (const key of inventoryQueryKeys) {
    const value = query[key];
    if (
      value === undefined ||
      value === '' ||
      (key === 'limit' && value === 25) ||
      (key === 'sort' && value === 'id') ||
      (['priceKnown', 'dateKnown'].includes(key) && value === 'include')
    )
      continue;
    result.set(key, String(value));
  }
  return result;
}
/** Every changed filter/sort invalidates the previous cursor. Explicit pagination alone retains it. */
export function changeInventoryQuery(
  query: InventoryQuery,
  patch: Partial<InventoryQuery>,
): InventoryQuery {
  const next = { ...query, ...patch };
  if (Object.keys(patch).some((key) => key !== 'after')) delete next.after;
  if ('categoryId' in patch && patch.categoryId !== query.categoryId) delete next.subcategoryId;
  if ('sort' in patch && patch.sort !== query.sort && !('direction' in patch))
    delete next.direction;
  return next;
}
