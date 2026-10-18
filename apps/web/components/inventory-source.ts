import type {
  InventoryFacets,
  InventoryQuery as ContractInventoryQuery,
  ItemsPage,
  TaxonomySnapshot,
} from '@havefolio/contracts';
import { inventoryQueryParams } from './inventory-query-state';
import { taxonomyRequest } from './taxonomy-client';

/**
 * Browse query seam. Supports search, filters, sort, and bounded cursor pagination.
 */
export type InventoryQuery = ContractInventoryQuery & {
  cursor?: string | null;
};

export interface InventorySource {
  loadPage(query: InventoryQuery): Promise<ItemsPage>;
  loadTaxonomy(): Promise<TaxonomySnapshot>;
  /** Per-option counts for the filters; optional so sources without facets still browse. */
  loadFacets?(query: InventoryQuery): Promise<InventoryFacets>;
}

export class InventoryRequestError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'InventoryRequestError';
  }
  get unauthenticated(): boolean {
    return this.status === 401;
  }
}

export const inventoryPageSize = 60;

/** The current bounded `GET /api/v1/items` page (UUID keyset, at most 100 per request). */
export const apiInventorySource: InventorySource = {
  async loadPage(query) {
    const clean: ContractInventoryQuery = { ...query };
    delete (clean as { cursor?: unknown }).cursor;
    const after = query.after ?? query.cursor ?? undefined;
    if (after) {
      clean.after = after;
    } else {
      delete clean.after;
    }
    const params = inventoryQueryParams(clean);
    if (!params.has('limit')) {
      params.set('limit', String(inventoryPageSize));
    }
    let response: Response;
    try {
      response = await fetch(`/api/v1/items?${params.toString()}`, {
        credentials: 'same-origin',
        cache: 'no-store',
      });
    } catch {
      throw new InventoryRequestError(0, 'You appear to be offline or the connection dropped.');
    }
    if (!response.ok)
      throw new InventoryRequestError(
        response.status,
        response.status === 401
          ? 'Your session has ended. Sign in again to see your items.'
          : 'Your items could not load right now.',
      );
    return (await response.json()) as ItemsPage;
  },
  loadTaxonomy: () => taxonomyRequest(),
  async loadFacets(query) {
    const clean: ContractInventoryQuery = { ...query };
    // Counts ignore ordering and pagination.
    for (const key of ['cursor', 'after', 'sort', 'direction', 'limit'] as const)
      delete (clean as Record<string, unknown>)[key];
    const params = inventoryQueryParams(clean).toString();
    const response = await fetch(`/api/v1/items/facets${params ? `?${params}` : ''}`, {
      credentials: 'same-origin',
      cache: 'no-store',
    });
    if (!response.ok)
      throw new InventoryRequestError(response.status, 'Filter counts unavailable.');
    return (await response.json()) as InventoryFacets;
  },
};
