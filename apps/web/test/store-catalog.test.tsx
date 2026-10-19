import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InventoryFacets, ItemListEntry, TaxonomySnapshot } from '@havefolio/contracts';
import type { InventorySource } from '../components/inventory-source';
import { MyStore } from '../components/my-store';

const uuid = (n: number): string => `00000000-0000-4000-a000-${String(n).padStart(12, '0')}`;
const kitchen = uuid(901);
const garden = uuid(902);
const appliances = uuid(911);
const cookware = uuid(912);

function item(n: number, extra: Partial<ItemListEntry> = {}): ItemListEntry {
  return {
    isDemo: false,
    id: uuid(n),
    name: `Item ${n}`,
    ownershipStatus: 'owned',
    currency: 'INR',
    pricePaidMinor: null,
    purchaseDate: { precision: 'unknown', year: null, month: null, day: null },
    acquisitionType: 'bought',
    condition: 'working',
    useFrequency: 'unknown',
    categoryId: null,
    subcategoryId: null,
    tagIds: [],
    brand: null,
    model: null,
    revision: 1,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    cover: null,
    ...extra,
  };
}

const taxonomy: TaxonomySnapshot = {
  categories: [
    { id: kitchen, name: 'Kitchen', position: 0, isDemo: false, retiredAt: null, itemCount: 5 },
    { id: garden, name: 'Garden', position: 1, isDemo: false, retiredAt: null, itemCount: 1 },
  ],
  subcategories: [
    {
      id: appliances,
      categoryId: kitchen,
      name: 'Appliances',
      position: 0,
      isDemo: false,
      retiredAt: null,
      itemCount: 2,
    },
    {
      id: cookware,
      categoryId: kitchen,
      name: 'Cookware',
      position: 1,
      isDemo: false,
      retiredAt: null,
      itemCount: 1,
    },
  ],
  tags: [],
  defaultsSeeded: true,
};

const facets: InventoryFacets = {
  total: 6,
  ownershipStatus: [
    { value: 'owned', count: 5 },
    { value: 'sold', count: 1 },
  ],
  useFrequency: [
    { value: 'often', count: 4 },
    { value: 'unknown', count: 2 },
  ],
  categories: [
    { value: kitchen, count: 5 },
    { value: null, count: 1 },
  ],
  subcategories: [
    { value: appliances, categoryId: kitchen, count: 2 },
    { value: cookware, categoryId: kitchen, count: 1 },
  ],
  brands: [
    { value: 'Prestige', count: 3 },
    ...Array.from({ length: 9 }, (_, n) => ({ value: `Maker ${n + 1}`, count: 1 })),
  ],
  brandsTruncated: false,
  prices: [{ currency: 'INR', minMinor: '10000', maxMinor: '1000000', count: 4 }],
};

type FakeSource = {
  loadPage: ReturnType<typeof vi.fn<InventorySource['loadPage']>>;
  loadTaxonomy: ReturnType<typeof vi.fn<InventorySource['loadTaxonomy']>>;
  loadFacets?: ReturnType<typeof vi.fn<NonNullable<InventorySource['loadFacets']>>>;
};

function createSource(items: ItemListEntry[] = [], withFacets = true): FakeSource {
  const loadPage = vi.fn<InventorySource['loadPage']>(() =>
    Promise.resolve({
      items,
      nextCursor: null,
      hasMore: false,
    }),
  );
  const loadTaxonomy = vi.fn<InventorySource['loadTaxonomy']>(() => Promise.resolve(taxonomy));
  if (!withFacets) return { loadPage, loadTaxonomy };
  const loadFacets = vi.fn<NonNullable<InventorySource['loadFacets']>>(() =>
    Promise.resolve(facets),
  );
  return { loadPage, loadTaxonomy, loadFacets };
}

const filters = (): HTMLElement => screen.getAllByTestId('store-filters')[0]!;

beforeEach(() => {
  window.history.replaceState(null, '', '/store');
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('My Store catalog', () => {
  it('shows filters with counts beside a sortable result summary', async () => {
    const fake = createSource([item(1, { name: 'Espresso Maker', categoryId: kitchen })]);
    render(<MyStore source={fake} />);

    expect(await screen.findByText('Espresso Maker')).toBeVisible();
    expect(screen.getByText('Showing 1 of 6 items.')).toBeVisible();
    expect(screen.getByRole('combobox', { name: 'Sort by' })).toHaveTextContent('Category');
    const panel = filters();
    expect(within(panel).getByRole('radio', { name: 'Kitchen (5)' })).toBeVisible();
    // Options that would return nothing are not offered.
    expect(within(panel).queryByRole('radio', { name: /^Garden/ })).toBeNull();
    expect(within(panel).getByRole('radio', { name: 'Owned (5)' })).toBeVisible();
    expect(within(panel).queryByRole('radio', { name: /^Donated/ })).toBeNull();
    expect(within(panel).getByRole('radio', { name: 'Often (4)' })).toBeVisible();
    expect(fake.loadFacets).toHaveBeenCalledWith({});
  });

  it('keeps every option without counts when facets are unavailable', async () => {
    const fake = createSource([item(1, { name: 'Tent' })], false);
    render(<MyStore source={fake} />);
    await screen.findByText('Tent');
    const panel = filters();
    expect(within(panel).getByRole('radio', { name: 'Kitchen (5)' })).toBeVisible();
    expect(within(panel).getByRole('radio', { name: 'Donated' })).toBeVisible();
    expect(within(panel).queryByText('Brand')).toBeNull();
    expect(screen.getByText('Showing 1 item.')).toBeVisible();
  });

  it('filters by category, then subcategory, and back to all', async () => {
    const fake = createSource([
      item(1, { name: 'Blender', categoryId: kitchen, subcategoryId: appliances }),
    ]);
    render(<MyStore source={fake} />);
    await screen.findByText('Blender');
    const user = userEvent.setup();

    await user.click(within(filters()).getByRole('radio', { name: 'Kitchen (5)' }));
    expect(fake.loadPage).toHaveBeenLastCalledWith(
      expect.objectContaining({ categoryId: kitchen }),
    );
    expect(fake.loadFacets).toHaveBeenLastCalledWith({ categoryId: kitchen });
    expect(window.location.search).toBe(`?categoryId=${kitchen}`);

    await user.click(await within(filters()).findByRole('radio', { name: 'Appliances (2)' }));
    expect(fake.loadPage).toHaveBeenLastCalledWith(
      expect.objectContaining({ categoryId: kitchen, subcategoryId: appliances }),
    );
    expect(within(filters()).getByRole('radio', { name: 'All Kitchen (5)' })).not.toBeChecked();

    await user.click(within(filters()).getByRole('radio', { name: 'All categories' }));
    expect(window.location.search).toBe('');
  });

  it('filters by ownership and how often things are used', async () => {
    const fake = createSource([item(1, { name: 'Tent' })]);
    render(<MyStore source={fake} />);
    await screen.findByText('Tent');
    const user = userEvent.setup();

    await user.click(within(filters()).getByRole('radio', { name: 'Sold (1)' }));
    await user.click(within(filters()).getByRole('radio', { name: 'Often (4)' }));
    expect(fake.loadPage).toHaveBeenLastCalledWith(
      expect.objectContaining({ ownershipStatus: 'sold', useFrequency: 'often' }),
    );
    await user.click(within(filters()).getByRole('radio', { name: 'Any status' }));
    expect(fake.loadPage.mock.lastCall?.[0]?.ownershipStatus).toBeUndefined();
  });

  it('previews common brands, finds the rest by search and filters by one', async () => {
    const fake = createSource([item(1, { name: 'Cooker', brand: 'Prestige' })]);
    render(<MyStore source={fake} />);
    await screen.findByText('Cooker');
    const user = userEvent.setup();
    const panel = filters();

    expect(within(panel).getByRole('radio', { name: 'Prestige (3)' })).toBeVisible();
    expect(within(panel).queryByRole('radio', { name: /^Maker 9/ })).toBeNull();
    await user.click(within(panel).getByRole('button', { name: '+ 2 more' }));
    expect(within(panel).getByRole('radio', { name: 'Maker 9 (1)' })).toBeVisible();

    await user.click(within(panel).getByRole('button', { name: 'Search brands' }));
    const brandSearch = within(panel).getByRole('searchbox', { name: 'Search brands' });
    await user.type(brandSearch, 'zzz');
    expect(within(panel).getByText('No brand matches “zzz”.')).toBeVisible();
    await user.clear(brandSearch);
    await user.type(brandSearch, 'maker 8');
    expect(within(panel).getAllByRole('radio', { name: /^Maker/ })).toHaveLength(1);
    await user.click(within(panel).getByRole('radio', { name: 'Maker 8 (1)' }));
    expect(fake.loadPage).toHaveBeenLastCalledWith(expect.objectContaining({ brand: 'Maker 8' }));
    expect(window.location.search).toBe('?brand=Maker+8');
  });

  it('narrows to a known price range with the slider and resets to any price', async () => {
    const fake = createSource([item(1, { name: 'Chair', pricePaidMinor: '150000' })]);
    render(<MyStore source={fake} />);
    await screen.findByText('Chair');
    const user = userEvent.setup();
    const panel = filters();

    // ₹100 – ₹10,000 recorded; 100 steps of ₹100.
    expect(within(panel).getByText('₹100 – ₹10,000+')).toBeVisible();
    within(panel).getByRole('slider', { name: 'Highest price' }).focus();
    await user.keyboard('{PageDown}');
    expect(fake.loadPage).toHaveBeenLastCalledWith(
      expect.objectContaining({ priceMax: '900000', currency: 'INR', priceKnown: 'exclude' }),
    );
    expect(fake.loadPage.mock.lastCall?.[0]?.priceMin).toBeUndefined();
    const chip = await screen.findByRole('button', { name: 'Remove filter: Up to ₹9,000' });
    expect(chip).toBeVisible();

    await user.click(within(filters()).getByRole('button', { name: 'Any price' }));
    const last = fake.loadPage.mock.lastCall?.[0];
    expect([last?.priceMax, last?.priceKnown, last?.currency]).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
  });

  it('sorts by price in one currency and keeps the order when filters are cleared', async () => {
    window.history.replaceState(null, '', '/store?ownershipStatus=owned');
    const fake = createSource([item(1, { name: 'Desk' })]);
    render(<MyStore source={fake} />);
    await screen.findByText('Desk');
    const user = userEvent.setup();

    await user.click(screen.getByRole('combobox', { name: 'Sort by' }));
    await user.click(await screen.findByRole('option', { name: 'Price: low to high' }));
    expect(fake.loadPage).toHaveBeenLastCalledWith(
      expect.objectContaining({ sort: 'price', direction: 'asc', currency: 'INR' }),
    );
    // Facets ignore ordering.
    expect(fake.loadFacets).toHaveBeenLastCalledWith({
      ownershipStatus: 'owned',
      sort: 'price',
      direction: 'asc',
      currency: 'INR',
    });
    expect(screen.getByRole('button', { name: /^Filters, 1 active/ })).toBeVisible();

    await user.click(
      within(screen.getByTestId('store-active-chips')).getByRole('button', { name: 'Clear all' }),
    );
    expect(window.location.search).toBe('?sort=price&direction=asc&currency=INR');
  });

  it('shows removable chips for each active filter', async () => {
    window.history.replaceState(
      null,
      '',
      `/store?q=kettle&categoryId=${kitchen}&brand=Prestige&useFrequency=often`,
    );
    const fake = createSource([item(1, { name: 'Steel Kettle', categoryId: kitchen })]);
    render(<MyStore source={fake} />);
    await screen.findByText('Steel Kettle');
    const user = userEvent.setup();
    const chips = screen.getByTestId('store-active-chips');

    expect(
      within(chips)
        .getAllByRole('button')
        .map((b) => b.getAttribute('aria-label') ?? b.textContent),
    ).toEqual([
      'Remove filter: “kettle”',
      'Remove filter: Kitchen',
      'Remove filter: Prestige',
      'Remove filter: Used often',
      'Clear all',
    ]);
    await user.click(within(chips).getByRole('button', { name: 'Remove filter: Kitchen' }));
    expect(fake.loadPage.mock.lastCall?.[0]?.categoryId).toBeUndefined();
    expect(fake.loadPage).toHaveBeenLastCalledWith(
      expect.objectContaining({ q: 'kettle', brand: 'Prestige' }),
    );

    await user.click(within(chips).getByRole('button', { name: 'Clear all' }));
    expect(fake.loadPage).toHaveBeenLastCalledWith({ cursor: null });
    expect(window.location.search).toBe('');
  });

  it('offers to clear filters when nothing matches', async () => {
    window.history.replaceState(null, '', '/store?q=nonexistent');
    const fake = createSource([]);
    render(<MyStore source={fake} />);

    expect(await screen.findByText('No items match your filters')).toBeVisible();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Clear all filters' }));
    expect(fake.loadPage).toHaveBeenLastCalledWith({ cursor: null });
    expect(window.location.search).toBe('');
  });
});
