import type { ItemsPage, TaxonomySnapshot } from '@havefolio/contracts';
import { taxonomyRequest } from './taxonomy-client';

/**
 * Browse query seam. PER-16 only pages the existing bounded list; PER-17 extends this type with
 * search, filters and sort and maps it to URL state and its server query parameters.
 */
export interface InventoryQuery {
  cursor?: string | null;
}

export interface InventorySource {
  loadPage(query: InventoryQuery): Promise<ItemsPage>;
  loadTaxonomy(): Promise<TaxonomySnapshot>;
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
  async loadPage({ cursor }) {
    const params = new URLSearchParams({ limit: String(inventoryPageSize) });
    if (cursor) params.set('after', cursor);
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
};
