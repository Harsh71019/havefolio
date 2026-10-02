import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ItemListEntry, ItemsPage, TaxonomySnapshot } from '@havefolio/contracts';
import { InventoryRequestError, type InventorySource } from '../components/inventory-source';
import { acquiredFact, priceFact, useFact } from '../components/item-presentation';
import { MyStore } from '../components/my-store';
import { groupInventory } from '../components/store-grouping';

const now = new Date(2026, 9, 2); // 2 Oct 2026, local time
const uuid = (n: number): string => `00000000-0000-4000-a000-${String(n).padStart(12, '0')}`;
const kitchen = uuid(901);
const garden = uuid(902);
const appliances = uuid(911);
const cookware = uuid(912);
const emptyCategory = uuid(903);

function item(n: number, extra: Partial<ItemListEntry> = {}): ItemListEntry {
  return {
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
    { id: garden, name: 'Garden', position: 1, isDemo: false, retiredAt: null, itemCount: 1 },
    { id: kitchen, name: 'Kitchen', position: 0, isDemo: false, retiredAt: null, itemCount: 5 },
    { id: emptyCategory, name: 'Books', position: 2, isDemo: false, retiredAt: null, itemCount: 0 },
  ],
  subcategories: [
    {
      id: cookware,
      categoryId: kitchen,
      name: 'Cookware',
      position: 1,
      isDemo: false,
      retiredAt: null,
      itemCount: 1,
    },
    {
      id: appliances,
      categoryId: kitchen,
      name: 'Appliances',
      position: 0,
      isDemo: false,
      retiredAt: null,
      itemCount: 2,
    },
  ],
  tags: [],
  defaultsSeeded: true,
};

type FakeSource = {
  loadPage: ReturnType<typeof vi.fn<InventorySource['loadPage']>>;
  loadTaxonomy: ReturnType<typeof vi.fn<InventorySource['loadTaxonomy']>>;
};
function source(pages: ItemsPage[], tax: TaxonomySnapshot | Error = taxonomy): FakeSource {
  const queue = [...pages];
  const loadPage = vi.fn<InventorySource['loadPage']>(() => {
    const next = queue.shift();
    return next
      ? Promise.resolve(next)
      : Promise.reject(new InventoryRequestError(503, 'Your items could not load right now.'));
  });
  const loadTaxonomy = vi.fn<InventorySource['loadTaxonomy']>(() =>
    tax instanceof Error ? Promise.reject(tax) : Promise.resolve(tax),
  );
  return { loadPage, loadTaxonomy };
}
const page = (items: ItemListEntry[], nextCursor: string | null = null): ItemsPage => ({
  items,
  nextCursor,
  hasMore: Boolean(nextCursor),
});
const card = (name: string): HTMLElement =>
  screen.getByRole('link', { name: new RegExp(`^${name}\\b`) });

afterEach(() => vi.restoreAllMocks());

describe('price, date and use presentation', () => {
  it('keeps known, zero, unknown and gift prices distinct without floating point', () => {
    expect(
      priceFact({ pricePaidMinor: '129900', currency: 'INR', acquisitionType: 'bought' }).value,
    ).toBe('₹1,299');
    expect(
      priceFact({ pricePaidMinor: '129950', currency: 'INR', acquisitionType: 'bought' }).value,
    ).toBe('₹1,299.50');
    expect(
      priceFact({ pricePaidMinor: '0', currency: 'INR', acquisitionType: 'bought' }).value,
    ).toBe('₹0');
    expect(priceFact({ pricePaidMinor: null, currency: 'INR', acquisitionType: 'bought' })).toEqual(
      {
        label: 'Paid',
        value: 'Not recorded',
        muted: true,
      },
    );
    expect(
      priceFact({ pricePaidMinor: null, currency: 'INR', acquisitionType: 'gift' }).value,
    ).toBe('Gift, no amount');
    expect(
      priceFact({ pricePaidMinor: '50000', currency: 'INR', acquisitionType: 'gift' }).value,
    ).toBe('₹500');
    expect(
      priceFact({ pricePaidMinor: '1500', currency: 'JPY', acquisitionType: 'bought' }).value,
    ).toBe('JP¥1,500');
    expect(
      priceFact({
        pricePaidMinor: '900719925474099312',
        currency: 'INR',
        acquisitionType: 'bought',
      }).value,
    ).toBe('₹9,00,71,99,25,47,40,993.12');
  });

  it('distinguishes exact, month, year and unknown dates without inventing components', () => {
    expect(acquiredFact({ precision: 'exact', year: 2024, month: 3, day: 12 }, now).value).toBe(
      '12 Mar 2024 · 2 years ago',
    );
    expect(acquiredFact({ precision: 'exact', year: 2026, month: 9, day: 20 }, now).value).toBe(
      '20 Sept 2026 · under a month ago',
    );
    expect(acquiredFact({ precision: 'month', year: 2026, month: 4, day: null }, now).value).toBe(
      'Apr 2026 · about 6 months ago',
    );
    expect(acquiredFact({ precision: 'month', year: 2026, month: 10, day: null }, now).value).toBe(
      'Oct 2026 · this month',
    );
    expect(acquiredFact({ precision: 'year', year: 2019, month: null, day: null }, now).value).toBe(
      '2019 · about 7 years ago',
    );
    expect(acquiredFact({ precision: 'year', year: 2026, month: null, day: null }, now).value).toBe(
      '2026 · this year',
    );
    expect(acquiredFact({ precision: 'unknown', year: null, month: null, day: null }, now)).toEqual(
      {
        label: 'Acquired',
        value: 'Date not recorded',
        muted: true,
      },
    );
  });

  it('labels known and unknown use frequency', () => {
    expect(useFact('often').value).toBe('Often');
    expect(useFact('never').value).toBe('Not used');
    expect(useFact('unknown')).toEqual({ label: 'Use', value: 'Not recorded', muted: true });
  });
});

describe('grouping', () => {
  it('orders categories and subcategories by taxonomy position and items by name then id', () => {
    const { groups, emptyCategories } = groupInventory(
      [
        item(1, { name: 'zebra mug', categoryId: kitchen }),
        item(2, { name: 'Apron', categoryId: kitchen }),
        item(3, { name: 'Kettle', categoryId: kitchen, subcategoryId: appliances }),
        item(4, { name: 'Pan', categoryId: kitchen, subcategoryId: cookware }),
        item(5, { name: 'Hose', categoryId: garden }),
        item(6, { name: 'Loose', categoryId: null }),
        item(7, { name: 'Orphan', categoryId: uuid(999) }),
        item(8, { name: 'Kettle', categoryId: kitchen, subcategoryId: appliances }),
      ],
      taxonomy,
    );
    expect(groups.map((g) => g.title)).toEqual(['Kitchen', 'Garden', 'Not yet categorised']);
    expect(groups[0]!.subgroups.map((s) => s.title)).toEqual([
      'No subcategory',
      'Appliances',
      'Cookware',
    ]);
    expect(groups[0]!.subgroups[0]!.items.map((i) => i.name)).toEqual(['Apron', 'zebra mug']);
    expect(groups[0]!.subgroups[1]!.items.map((i) => i.id)).toEqual([uuid(3), uuid(8)]);
    expect(groups[1]!.subgroups[0]!.title).toBeNull();
    expect(groups[2]!.subgroups[0]!.items.map((i) => i.name)).toEqual(['Loose', 'Orphan']);
    expect(emptyCategories).toEqual(['Books']);
  });
});

describe('My Store page', () => {
  it('announces loading once and hides the skeleton from assistive technology', async () => {
    const fake = source([page([])]);
    render(<MyStore source={fake} now={now} />);
    expect(screen.getByTestId('store-skeleton')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByRole('status')).toHaveTextContent('Loading your items.');
    await screen.findByText('Nothing recorded yet');
  });

  it('shows a warm empty inventory with a direct add-item action', async () => {
    render(<MyStore source={source([page([])])} now={now} />);
    expect(await screen.findByText('Nothing recorded yet')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Add your first item' })).toHaveAttribute(
      'href',
      '/items/new',
    );
    expect(document.body.textContent).not.toMatch(/buy|shop now|cart|checkout|deal|sale/i);
  });

  it('reports API failure and recovers on retry', async () => {
    const fake = source([]);
    render(<MyStore source={fake} now={now} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('My Store could not load');
    fake.loadPage.mockResolvedValueOnce(page([item(1, { name: 'Lamp' })]));
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('link', { name: /^Lamp/ })).toBeVisible();
  });

  it('offers sign-in when the session has expired', async () => {
    const fake = source([]);
    fake.loadPage.mockRejectedValueOnce(
      new InventoryRequestError(401, 'Your session has ended. Sign in again to see your items.'),
    );
    render(<MyStore source={fake} now={now} />);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Please sign in again');
    expect(within(alert).getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login');
  });

  it('renders grouped cards with headings, correct facts, lifecycle text and private covers', async () => {
    const items = [
      item(1, {
        name: 'Kettle',
        categoryId: kitchen,
        subcategoryId: appliances,
        pricePaidMinor: '249900',
        purchaseDate: { precision: 'exact', year: 2024, month: 3, day: 12 },
        useFrequency: 'often',
        cover: {
          photoId: uuid(501),
          width: 1600,
          height: 1200,
          altText: 'Steel kettle',
          decorative: false,
        },
      }),
      item(2, {
        name: 'Free sample mug',
        categoryId: kitchen,
        pricePaidMinor: '0',
        purchaseDate: { precision: 'month', year: 2026, month: 4, day: null },
      }),
      item(3, {
        name: 'Old bike',
        categoryId: garden,
        ownershipStatus: 'sold',
        purchaseDate: { precision: 'year', year: 2019, month: null, day: null },
      }),
      item(4, { name: 'Tent', ownershipStatus: 'donated', acquisitionType: 'gift' }),
      item(5, { name: 'Broken chair', ownershipStatus: 'disposed' }),
      item(6, { name: 'Umbrella', ownershipStatus: 'lost' }),
      item(7, { name: 'Headphones', ownershipStatus: 'returned' }),
    ];
    render(<MyStore source={source([page(items, uuid(7))])} now={now} />);
    await screen.findByRole('heading', { level: 2, name: 'Kitchen' });
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([
      'Kitchen',
      'Garden',
      'Not yet categorised',
      'Categories with nothing yet',
    ]);
    expect(screen.getByRole('heading', { level: 3, name: 'Appliances' })).toBeVisible();
    const kettle = card('Kettle');
    expect(kettle).toHaveAccessibleName('Kettle Owned');
    expect(kettle).toHaveAccessibleDescription(
      /Paid ₹2,499 Acquired 12 Mar 2024 · 2 years ago Use Often/,
    );
    expect(kettle).toHaveAttribute('href', `/items/${uuid(1)}`);
    const image = within(kettle).getByRole('img', { name: 'Steel kettle' });
    expect(image.getAttribute('src')).toBe(
      `/api/v1/items/${uuid(1)}/photos/${uuid(501)}/content/thumbnail`,
    );
    expect(image.getAttribute('srcset')).toContain('content/display 1600w');
    expect(image.getAttribute('sizes')).toContain('92vw');
    expect(image).toHaveAttribute('width', '1600');
    expect(image).toHaveAttribute('loading', 'eager');
    expect(card('Free sample mug')).toHaveAccessibleDescription(
      /Paid ₹0 Acquired Apr 2026 · about 6 months ago Use Not recorded/,
    );
    expect(within(card('Free sample mug')).getByText('No photo yet')).toBeVisible();
    expect(card('Old bike')).toHaveAccessibleName('Old bike Sold, no longer owned');
    expect(card('Old bike')).toHaveAccessibleDescription(
      /Paid Not recorded Acquired 2019 · about 7 years ago/,
    );
    expect(within(card('Old bike')).getByText('No longer in your home')).toBeVisible();
    expect(card('Tent')).toHaveAccessibleName('Tent Donated, no longer owned');
    expect(card('Tent')).toHaveAccessibleDescription(
      /Paid Gift, no amount Acquired Date not recorded/,
    );
    expect(card('Broken chair')).toHaveAccessibleName('Broken chair Disposed, no longer owned');
    expect(card('Umbrella')).toHaveAccessibleName('Umbrella Lost, no longer owned');
    expect(card('Headphones')).toHaveAccessibleName('Headphones Returned, no longer owned');
    expect(screen.getByText(/Books\. They appear here once/)).toBeVisible();
    // While more pages exist, taxonomy's owner-wide count shows the group is partial.
    expect(screen.getByText('2 of 5 shown')).toBeVisible();
    expect(screen.getByText('1 item')).toBeVisible();
  });

  it('uses fallback alt text, decorative covers and quiet failed-image text', async () => {
    render(
      <MyStore
        source={source([
          page([
            item(1, {
              name: 'Desk',
              cover: {
                photoId: uuid(601),
                width: 800,
                height: 600,
                altText: null,
                decorative: false,
              },
            }),
            item(2, {
              name: 'Rug',
              cover: {
                photoId: uuid(602),
                width: 800,
                height: 600,
                altText: null,
                decorative: true,
              },
            }),
          ]),
        ])}
        now={now}
      />,
    );
    const desk = await screen.findByRole('link', { name: /^Desk/ });
    const image = within(desk).getByRole('img', { name: 'Photo of Desk' });
    expect(within(card('Rug')).queryByRole('img')).toBeNull();
    expect(card('Rug').querySelector('img')).toHaveAttribute('alt', '');
    fireEvent.error(image);
    expect(within(desk).getByText('Photo could not load.')).toBeVisible();
    expect(screen.queryByRole('alert')).toBeNull();
    // No interactive control is nested inside a card link.
    expect(within(desk).queryByRole('button')).toBeNull();
  });

  it('lazy-loads cards after the first four', async () => {
    const items = Array.from({ length: 6 }, (_, n) =>
      item(n + 1, {
        name: `Box ${n + 1}`,
        cover: {
          photoId: uuid(700 + n),
          width: 400,
          height: 300,
          altText: `Box photo ${n + 1}`,
          decorative: false,
        },
      }),
    );
    render(<MyStore source={source([page(items)])} now={now} />);
    expect(await screen.findByRole('img', { name: 'Box photo 4' })).toHaveAttribute(
      'loading',
      'eager',
    );
    expect(screen.getByRole('img', { name: 'Box photo 5' })).toHaveAttribute('loading', 'lazy');
  });

  it('keeps items visible when taxonomy fails', async () => {
    render(
      <MyStore
        source={source([page([item(1, { name: 'Lamp', categoryId: kitchen })])], new Error('x'))}
        now={now}
      />,
    );
    expect(await screen.findByRole('heading', { level: 2, name: 'All items' })).toBeVisible();
    expect(screen.getByText(/Categories could not load/)).toBeVisible();
    expect(card('Lamp')).toBeVisible();
  });

  it('continues bounded pages with the API cursor, announcing and de-duplicating', async () => {
    const fake = source([
      page([item(1, { name: 'Alpha' }), item(2, { name: 'Beta' })], uuid(2)),
      page([item(2, { name: 'Beta' }), item(3, { name: 'Gamma' })]),
    ]);
    render(<MyStore source={fake} now={now} />);
    expect(await screen.findByText('Showing 2 items so far.')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Show more items' }));
    expect(await screen.findByRole('link', { name: /^Gamma/ })).toBeVisible();
    expect(fake.loadPage).toHaveBeenLastCalledWith({ cursor: uuid(2) });
    expect(screen.getAllByRole('link', { name: /^Beta/ })).toHaveLength(1);
    expect(screen.getByRole('status')).toHaveTextContent('Loaded 2 more items.');
    expect(screen.queryByRole('button', { name: 'Show more items' })).toBeNull();
  });

  it('keeps loaded items when a continuation fails and lets the owner retry', async () => {
    const fake = source([page([item(1, { name: 'Alpha' })], uuid(1))]);
    render(<MyStore source={fake} now={now} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Show more items' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Items already shown are unchanged.',
    );
    expect(card('Alpha')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Try loading more again' })).toBeEnabled();
  });

  it('shows an offline notice and pauses continuation', async () => {
    render(<MyStore source={source([page([item(1, { name: 'Alpha' })], uuid(1))])} now={now} />);
    await screen.findByRole('link', { name: /^Alpha/ });
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    act(() => {
      window.dispatchEvent(new Event('offline'));
    });
    expect(screen.getByText(/You are offline\./)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Show more items' })).toBeDisabled();
    online.mockReturnValue(true);
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Show more items' })).toBeEnabled(),
    );
  });

  it('makes every card keyboard reachable without marketplace controls or provider details', async () => {
    render(
      <MyStore
        source={source([
          page([
            item(1, {
              name: 'Alpha',
              cover: { photoId: uuid(801), width: 10, height: 10, altText: 'A', decorative: false },
            }),
            item(2, { name: 'Beta' }),
          ]),
        ])}
        now={now}
      />,
    );
    await screen.findByRole('link', { name: /^Alpha/ });
    const user = userEvent.setup();
    await user.tab();
    expect(card('Alpha')).toHaveFocus();
    await user.tab();
    expect(card('Beta')).toHaveFocus();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    const html = document.body.innerHTML;
    expect(html).not.toMatch(
      /cloudinary|api_key|signature=|havefolio\/(test|production|development)|receipt|warranty/i,
    );
    expect(document.body.textContent).not.toMatch(
      /\b(buy|cart|checkout|resell|sell now|recommended|deal|hurry)\b/i,
    );
  });
});

describe('item navigation context', () => {
  afterEach(() => {
    window.history.replaceState(null, '', '/');
    window.sessionStorage.clear();
  });

  it('opens item details carrying the sanitized current browse state', async () => {
    window.history.replaceState(null, '', '/store?q=kettle&sort=price&currency=INR&evil=1');
    render(<MyStore source={source([page([item(1, { name: 'Kettle' })])])} now={now} />);
    await screen.findByRole('link', { name: /^Kettle\b/ });
    expect(card('Kettle')).toHaveAttribute(
      'href',
      `/items/${uuid(1)}?returnTo=${encodeURIComponent('/store?q=kettle&sort=price&currency=INR')}`,
    );
    expect(card('Kettle')).toHaveTextContent('View details');
  });

  it('confirms a deletion once without revealing anything else', async () => {
    window.sessionStorage.setItem('havefolio:item-deleted', 'Old kettle');
    const { unmount } = render(<MyStore source={source([page([item(2)])])} now={now} />);
    expect(
      await screen.findByText('“Old kettle” and its private photos and documents were deleted.'),
    ).toBeInTheDocument();
    expect(window.sessionStorage.getItem('havefolio:item-deleted')).toBeNull();
    unmount();
    render(<MyStore source={source([page([item(2)])])} now={now} />);
    await screen.findByRole('link', { name: /^Item 2\b/ });
    expect(screen.queryByText(/were deleted/)).toBeNull();
  });
});
