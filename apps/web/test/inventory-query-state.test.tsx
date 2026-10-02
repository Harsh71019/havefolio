import { describe, it, expect } from 'vitest';
import {
  changeInventoryQuery,
  inventoryQueryParams,
  readInventoryQuery,
} from '../components/inventory-query-state';
describe('inventory URL contract', () => {
  it('round trips bounded state and omits defaults and private fields', () => {
    const query = {
      q: 'steel kettle',
      sort: 'price' as const,
      currency: 'INR',
      priceMin: '0',
      priceKnown: 'exclude' as const,
      limit: 25,
    };
    const params = inventoryQueryParams(query);
    expect(params.has('limit')).toBe(false);
    expect(readInventoryQuery(params)).toEqual({ ...query, limit: undefined });
  });
  it('normalizes Unicode search and rejects malformed, duplicate, oversized and unrelated keys', () => {
    expect(
      readInventoryQuery(
        new URLSearchParams(
          'q=%20ＫＥＴＴＬＥ%20%20STEEL&sort=bad&limit=101&ownerId=secret&after=bad&priceMin=-1',
        ),
      ),
    ).toEqual({ q: 'kettle steel' });
    expect(
      readInventoryQuery(new URLSearchParams('q=' + 'x'.repeat(201) + '&sort=name&sort=price')),
    ).toEqual({});
  });
  it('resets cursor on changes, clears dependent child/direction and preserves pagination', () => {
    expect(
      changeInventoryQuery({ after: 'cursor', sort: 'price', direction: 'desc' }, { sort: 'name' }),
    ).toEqual({ sort: 'name' });
    expect(
      changeInventoryQuery(
        { after: 'cursor', categoryId: 'old', subcategoryId: 'child' },
        { categoryId: 'new' },
      ),
    ).toEqual({ categoryId: 'new' });
    expect(changeInventoryQuery({ q: 'tea' }, { after: 'cursor' })).toEqual({
      q: 'tea',
      after: 'cursor',
    });
  });
});
