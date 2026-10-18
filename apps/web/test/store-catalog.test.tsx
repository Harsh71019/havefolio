import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ItemListEntry, TaxonomySnapshot } from '@havefolio/contracts';
import type { InventorySource } from '../components/inventory-source';
import { MyStore } from '../components/my-store';

const now = new Date(2026, 9, 2);
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

type FakeSource = {
  loadPage: ReturnType<typeof vi.fn<InventorySource['loadPage']>>;
  loadTaxonomy: ReturnType<typeof vi.fn<InventorySource['loadTaxonomy']>>;
};

function createSource(items: ItemListEntry[] = []): FakeSource {
  const loadPage = vi.fn<InventorySource['loadPage']>(() =>
    Promise.resolve({
      items,
      nextCursor: null,
      hasMore: false,
    }),
  );
  const loadTaxonomy = vi.fn<InventorySource['loadTaxonomy']>(() => Promise.resolve(taxonomy));
  return { loadPage, loadTaxonomy };
}

beforeEach(() => {
  window.history.replaceState(null, '', '/store');
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('My Store e-commerce catalog experience', () => {
  it('renders the top toolbar and desktop sidebar filters', async () => {
    const fake = createSource([item(1, { name: 'Espresso Maker', categoryId: kitchen })]);
    render(<MyStore source={fake} now={now} />);

    expect(await screen.findByRole('searchbox', { name: 'Search your items' })).toBeVisible();
    expect(screen.getByTestId('store-toolbar')).toBeVisible();
    expect(screen.getByTestId('store-filters')).toBeVisible();
    expect(screen.getByText('Espresso Maker')).toBeVisible();
  });

  it('filters items by search query when submitted', async () => {
    const fake = createSource([item(1, { name: 'Toaster' })]);
    render(<MyStore source={fake} now={now} />);

    const searchInput = await screen.findByRole('searchbox', { name: 'Search your items' });
    const user = userEvent.setup();

    await user.type(searchInput, 'Toaster{enter}');

    expect(fake.loadPage).toHaveBeenLastCalledWith(
      expect.objectContaining({
        q: 'toaster',
      }),
    );
    expect(window.location.search).toContain('q=toaster');
  });

  it('filters items by category and subcategory from the sidebar', async () => {
    const fake = createSource([
      item(1, { name: 'Blender', categoryId: kitchen, subcategoryId: appliances }),
    ]);
    render(<MyStore source={fake} now={now} />);

    await screen.findByText('Blender');
    const user = userEvent.setup();

    // Click Kitchen category in sidebar
    const kitchenBtn = screen.getByRole('button', { name: /Kitchen/i });
    await user.click(kitchenBtn);

    expect(fake.loadPage).toHaveBeenLastCalledWith(
      expect.objectContaining({
        categoryId: kitchen,
      }),
    );
    expect(window.location.search).toContain(`categoryId=${kitchen}`);

    // Subcategories should now be visible
    const appliancesBtn = await screen.findByRole('button', { name: /Appliances/i });
    await user.click(appliancesBtn);

    expect(fake.loadPage).toHaveBeenLastCalledWith(
      expect.objectContaining({
        categoryId: kitchen,
        subcategoryId: appliances,
      }),
    );
    expect(window.location.search).toContain(`subcategoryId=${appliances}`);
  });

  it('filters by ownership status and use frequency', async () => {
    const fake = createSource([item(1, { name: 'Tent', ownershipStatus: 'owned' })]);
    render(<MyStore source={fake} now={now} />);

    await screen.findByText('Tent');
    const user = userEvent.setup();

    // Filter by Currently owned
    const ownedBtn = screen.getByRole('button', { name: /^Owned$/i });
    await user.click(ownedBtn);

    expect(fake.loadPage).toHaveBeenLastCalledWith(
      expect.objectContaining({
        ownershipStatus: 'owned',
      }),
    );

    // Filter by Often frequency
    const oftenBtn = screen.getByRole('button', { name: /^Often$/i });
    await user.click(oftenBtn);

    expect(fake.loadPage).toHaveBeenLastCalledWith(
      expect.objectContaining({
        ownershipStatus: 'owned',
        useFrequency: 'often',
      }),
    );
  });

  it('filters by price range and price presets', async () => {
    const fake = createSource([item(1, { name: 'Chair', pricePaidMinor: '150000' })]);
    render(<MyStore source={fake} now={now} />);

    await screen.findByText('Chair');
    const user = userEvent.setup();

    // Click Under ₹500 preset
    const presetUnder500 = screen.getByRole('button', { name: 'Under ₹500' });
    await user.click(presetUnder500);

    expect(fake.loadPage).toHaveBeenLastCalledWith(
      expect.objectContaining({
        priceMax: '50000',
        currency: 'INR',
      }),
    );
    expect(window.location.search).toContain('priceMax=50000');
  });

  it('updates sorting order and includes currency when sorting by price', async () => {
    const fake = createSource([item(1, { name: 'Desk' })]);
    render(<MyStore source={fake} now={now} />);

    await screen.findByText('Desk');
    const user = userEvent.setup();

    // Select Price: Low to High
    const sortTrigger = screen.getByRole('combobox');
    await user.click(sortTrigger);

    const priceAscOption = await screen.findByRole('option', { name: 'Price: Low to High' });
    await user.click(priceAscOption);

    expect(fake.loadPage).toHaveBeenLastCalledWith(
      expect.objectContaining({
        sort: 'price',
        direction: 'asc',
        currency: 'INR',
      }),
    );
    expect(window.location.search).toContain('sort=price');
    expect(window.location.search).toContain('currency=INR');
  });

  it('renders active filter chips and allows removing individual filters or clearing all', async () => {
    window.history.replaceState(null, '', `/store?q=kettle&categoryId=${kitchen}`);
    const fake = createSource([item(1, { name: 'Steel Kettle', categoryId: kitchen })]);
    render(<MyStore source={fake} now={now} />);

    await screen.findByText('Steel Kettle');
    const user = userEvent.setup();

    // Active chips container should be visible with chips
    const activeChips = screen.getByTestId('store-active-chips');
    expect(within(activeChips).getByText('“kettle”')).toBeVisible();
    expect(within(activeChips).getByText('Category: Kitchen')).toBeVisible();

    // Remove category filter chip
    const removeCatBtn = within(activeChips).getByRole('button', {
      name: 'Remove filter: Category: Kitchen',
    });
    await user.click(removeCatBtn);

    expect(fake.loadPage).toHaveBeenLastCalledWith(
      expect.objectContaining({
        q: 'kettle',
      }),
    );
    expect(fake.loadPage.mock.lastCall?.[0]?.categoryId).toBeUndefined();

    // Clear all filters
    const clearAllBtn = within(activeChips).getByRole('button', { name: 'Clear all' });
    await user.click(clearAllBtn);

    expect(fake.loadPage).toHaveBeenLastCalledWith({ cursor: null });
    expect(window.location.search).toBe('');
  });

  it('displays empty state with clear filters CTA when search/filters yield zero results', async () => {
    window.history.replaceState(null, '', '/store?q=nonexistent');
    const fake = createSource([]);
    render(<MyStore source={fake} now={now} />);

    expect(await screen.findByText('No items match your filters')).toBeVisible();
    expect(
      screen.getByText(/We couldn’t find anything in your home matching your search/i),
    ).toBeVisible();

    const clearBtn = screen.getByRole('button', { name: 'Clear all filters' });
    const user = userEvent.setup();
    await user.click(clearBtn);

    expect(fake.loadPage).toHaveBeenLastCalledWith({ cursor: null });
    expect(window.location.search).toBe('');
  });
});
