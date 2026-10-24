import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ItemListEntry, ItemsPage, TaxonomySnapshot } from '@havefolio/contracts';
import { InventoryRequestError, type InventorySource } from '../components/inventory-source';
import { acquiredFact, priceFact, useFact } from '../components/item-presentation';
import { MyStore } from '../components/my-store';
import {
  densityBootstrap,
  densityImageSizes,
  densityKey,
  storeDensities,
} from '../components/store-density-config';
import { selectDensity } from '../components/store-density';
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

beforeEach(() => {
  window.history.replaceState({}, '', '/store');
  window.localStorage.clear();
  delete document.documentElement.dataset.storeDensity;
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

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
    render(<MyStore source={fake} />);
    expect(screen.getByTestId('store-skeleton')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByRole('status')).toHaveTextContent('Loading your items.');
    await screen.findByText('Nothing recorded yet');
  });

  it('shows a warm empty inventory with a direct add-item action', async () => {
    render(<MyStore source={source([page([])])} />);
    expect(await screen.findByText('Nothing recorded yet')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Add your first item' })).toHaveAttribute(
      'href',
      '/items/new',
    );
    expect(document.body.textContent).not.toMatch(/buy|shop now|cart|checkout|deal|sale/i);
  });

  it('reports API failure and recovers on retry', async () => {
    const fake = source([]);
    render(<MyStore source={fake} />);
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
    render(<MyStore source={fake} />);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Please sign in again');
    expect(within(alert).getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login');
  });

  it('renders name-only cards with headings, lifecycle badges and private covers', async () => {
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
    render(<MyStore source={source([page(items, uuid(7))])} />);
    // PER-66: all categories share one grid in taxonomy order; cards name their category.
    // PER-67: the category is announced, not shown; facts stay on the item page.
    await screen.findByRole('heading', { level: 2, name: 'All items' });
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([
      'All items',
      'Categories with nothing yet',
    ]);
    expect(document.querySelectorAll('.store-grid')).toHaveLength(1);
    expect(
      screen
        .getAllByRole('link', { name: /no longer owned|Owned/ })
        .map((c) => c.querySelector('[id$="-name"]')?.textContent),
    ).toEqual([
      'Free sample mug',
      'Kettle',
      'Old bike',
      'Broken chair',
      'Headphones',
      'Tent',
      'Umbrella',
    ]);
    expect(card('Old bike')).toHaveAccessibleDescription('Garden');
    const kettle = card('Kettle');
    expect(kettle).toHaveAccessibleName('Kettle Owned');
    expect(kettle).toHaveAccessibleDescription('Kitchen › Appliances');
    expect(kettle).not.toHaveTextContent(/Paid|Acquired|Use|View details/);
    // Owned items carry no visible badge; the status is only announced.
    expect(within(kettle).getByText('Owned').closest('[id$="-status"]')).toHaveClass('sr-only');
    expect(kettle).toHaveAttribute('href', `/items/${uuid(1)}`);
    const image = within(kettle).getByRole('img', { name: 'Steel kettle' });
    expect(image.getAttribute('src')).toBe(
      `/api/v1/items/${uuid(1)}/photos/${uuid(501)}/content/thumbnail`,
    );
    expect(image.getAttribute('srcset')).toContain('content/display 1600w');
    expect(image).toHaveAttribute('sizes', densityImageSizes.comfortable);
    expect(image).toHaveAttribute('width', '1600');
    expect(image).toHaveAttribute('loading', 'eager');
    expect(card('Free sample mug')).toHaveAccessibleDescription('Kitchen');
    expect(within(card('Free sample mug')).getByText('No photo yet')).toBeVisible();
    expect(card('Old bike')).toHaveAccessibleName('Old bike Sold, no longer owned');
    expect(card('Old bike').querySelector('[id$="-status"]')).not.toHaveClass('sr-only');
    expect(within(card('Old bike')).getByText('Sold')).toBeVisible();
    expect(card('Tent')).toHaveAccessibleName('Tent Donated, no longer owned');
    expect(card('Tent')).not.toHaveAccessibleDescription();
    expect(card('Broken chair')).toHaveAccessibleName('Broken chair Disposed, no longer owned');
    const brokenMedia = card('Broken chair').querySelector('[data-slot="owned-item-media"]');
    expect(brokenMedia).not.toHaveClass('grayscale');
    expect(brokenMedia).not.toHaveClass('opacity-70');
    expect(card('Umbrella')).toHaveAccessibleName('Umbrella Lost, no longer owned');
    expect(card('Headphones')).toHaveAccessibleName('Headphones Returned, no longer owned');
    expect(screen.getByText(/Books\. They appear here once/)).toBeVisible();
    // While more pages exist, the summary says the list is partial.
    expect(screen.getByText('7 items shown so far')).toBeVisible();
  });

  it('places one-item subcategories in one category grid, keeping each card’s subcategory', async () => {
    // PER-59 regression: one item per subcategory previously produced one single-card grid each.
    const electronics = uuid(920);
    const subs = ['Audio', 'Cameras', 'Phones', 'Wearables'].map((name, n) => ({
      id: uuid(930 + n),
      categoryId: electronics,
      name,
      position: n,
      isDemo: false,
      retiredAt: n === 3 ? '2026-01-01T00:00:00.000Z' : null,
      itemCount: 1,
    }));
    const sparse: TaxonomySnapshot = {
      ...taxonomy,
      categories: [
        ...taxonomy.categories,
        {
          id: electronics,
          name: 'Electronics',
          position: 3,
          isDemo: false,
          retiredAt: null,
          itemCount: 5,
        },
      ],
      subcategories: [...taxonomy.subcategories, ...subs],
    };
    // Supplied out of display order; Wearables is retired.
    const items = [
      item(14, { name: 'Smartwatch', categoryId: electronics, subcategoryId: subs[3]!.id }),
      item(12, { name: 'Camera', categoryId: electronics, subcategoryId: subs[1]!.id }),
      item(11, { name: 'Headphones', categoryId: electronics, subcategoryId: subs[0]!.id }),
      item(15, { name: 'Charger', categoryId: electronics }),
      item(13, { name: 'Phone', categoryId: electronics, subcategoryId: subs[2]!.id }),
    ];
    const fake = source([page(items)], sparse);
    // A selected category keeps its section heading; all categories share one grid instead.
    window.history.replaceState(null, '', `/store?categoryId=${electronics}`);
    render(<MyStore source={fake} />);
    const section = (await screen.findByRole('heading', { level: 2, name: 'Electronics' }))
      .parentElement!.parentElement!;
    expect(section.querySelectorAll('.store-grid')).toHaveLength(1);
    expect(within(section).queryAllByRole('heading', { level: 3 })).toHaveLength(0);
    const cards = within(section.querySelector('.store-grid')!).getAllByRole('link');
    expect(cards.map((c) => c.querySelector('[id$="-name"]')?.textContent)).toEqual([
      'Charger',
      'Headphones',
      'Camera',
      'Phone',
      'Smartwatch',
    ]);
    const expected: [string, string | null][] = [
      ['Charger', null],
      ['Headphones', 'Electronics › Audio'],
      ['Camera', 'Electronics › Cameras'],
      ['Phone', 'Electronics › Phones'],
      ['Smartwatch', 'Electronics › Wearables (retired)'],
    ];
    for (const [name, context] of expected) {
      const link = card(name);
      if (context) {
        expect(link).toHaveAccessibleDescription(context);
      } else {
        expect(link).not.toHaveAccessibleDescription();
      }
    }
    // Density changes restyle the same grid without another inventory request.
    expect(fake.loadPage).toHaveBeenCalledTimes(1);
    for (const mode of storeDensities) {
      act(() => selectDensity(mode));
      expect(section.querySelectorAll('.store-grid')).toHaveLength(1);
    }
    expect(fake.loadPage).toHaveBeenCalledTimes(1);
    window.history.replaceState(null, '', '/');
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
      />,
    );
    const desk = await screen.findByRole('link', { name: /^Desk/ });
    const image = within(desk).getByRole('img', { name: 'Photo of Desk' });
    expect(within(card('Rug')).queryByRole('img')).toBeNull();
    expect(card('Rug').querySelector('img')).toHaveAttribute('alt', '');
    // Image events can commit asynchronously under React's concurrent renderer.
    await act(() => Promise.resolve(fireEvent.error(image)));
    expect(await within(desk).findByText('Photo could not load.')).toBeVisible();
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
    render(<MyStore source={source([page(items)])} />);
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
      />,
    );
    expect(await screen.findByRole('heading', { level: 2, name: 'All items' })).toBeVisible();
    expect(screen.getByText(/Categories could not load/)).toBeVisible();
    expect(card('Lamp')).toBeVisible();
  });

  function observeEnd(): { enter: () => void; disconnect: ReturnType<typeof vi.fn> } {
    const callbacks: IntersectionObserverCallback[] = [];
    const disconnect = vi.fn();
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(callback: IntersectionObserverCallback) {
          callbacks.push(callback);
        }
        observe = vi.fn();
        disconnect = disconnect;
      },
    );
    return {
      enter: () =>
        act(() => {
          callbacks.forEach((callback) =>
            callback(
              [{ isIntersecting: true } as IntersectionObserverEntry],
              {} as IntersectionObserver,
            ),
          );
        }),
      disconnect,
    };
  }

  it.each(['', `?categoryId=${kitchen}`, '?sort=name&direction=asc'])(
    'automatically continues %s and stops when exhausted without moving focus',
    async (search) => {
      window.history.replaceState({}, '', `/store${search}`);
      const observer = observeEnd();
      const fake = source([
        page([item(1, { categoryId: kitchen })], uuid(1)),
        page([item(2, { name: 'Next', categoryId: kitchen })]),
      ]);
      render(<MyStore source={fake} />);
      const first = await screen.findByRole('link', { name: /^Item 1/ });
      first.focus();
      observer.enter();
      await screen.findByRole('link', { name: /^Next/ });
      expect(document.activeElement).toBe(first);
      expect(screen.queryByTestId('store-continuation')).toBeNull();
      observer.enter();
      expect(fake.loadPage).toHaveBeenCalledTimes(2);
      expect(observer.disconnect).toHaveBeenCalled();
      expect(screen.getByRole('status')).toHaveTextContent('All items loaded.');
    },
  );

  it('guards repeated notifications, pauses after failure and retries explicitly', async () => {
    const observer = observeEnd();
    const fake = source([page([item(1)], uuid(1))]);
    let reject!: (error: Error) => void;
    fake.loadPage
      .mockImplementationOnce(() => Promise.resolve(page([item(1)], uuid(1))))
      .mockImplementationOnce(
        () =>
          new Promise((_, fail) => {
            reject = fail;
          }),
      );
    render(<MyStore source={fake} />);
    await screen.findByRole('link', { name: /^Item 1/ });
    observer.enter();
    observer.enter();
    expect(fake.loadPage).toHaveBeenCalledTimes(2);
    await act(async () => {
      reject(new Error('offline'));
      await Promise.resolve();
    });
    await screen.findByRole('alert');
    observer.enter();
    expect(fake.loadPage).toHaveBeenCalledTimes(2);
    fake.loadPage.mockResolvedValueOnce(page([item(2)]));
    await userEvent.click(screen.getByRole('button', { name: 'Try loading more again' }));
    expect(await screen.findByRole('link', { name: /^Item 2/ })).toBeVisible();
  });

  it('pauses the observer offline and resumes on reconnect', async () => {
    const observer = observeEnd();
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const fake = source([page([item(1)], uuid(1)), page([item(2)])]);
    render(<MyStore source={fake} />);
    await screen.findByRole('link', { name: /^Item 1/ });
    observer.enter();
    expect(fake.loadPage).toHaveBeenCalledTimes(1);
    online.mockReturnValue(true);
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    observer.enter();
    expect(await screen.findByRole('link', { name: /^Item 2/ })).toBeVisible();
  });

  it.each(['query', 'refresh', 'unmount'])(
    'ignores continuation after %s changes',
    async (change) => {
      const observer = observeEnd();
      const fake = source([page([item(1)], uuid(1))]);
      let resolve!: (value: ItemsPage) => void;
      fake.loadPage
        .mockImplementationOnce(() => Promise.resolve(page([item(1)], uuid(1))))
        .mockImplementationOnce(
          () =>
            new Promise((done) => {
              resolve = done;
            }),
        )
        .mockResolvedValueOnce(page([item(3, { name: 'Fresh' })]));
      const view = render(<MyStore source={fake} />);
      await screen.findByRole('link', { name: /^Item 1/ });
      observer.enter();
      if (change === 'query') {
        act(() => {
          window.history.pushState({}, '', '/store?q=fresh');
          window.dispatchEvent(new PopStateEvent('popstate'));
        });
      } else if (change === 'refresh') {
        act(() => {
          window.dispatchEvent(new Event('havefolio-inventory-changed'));
        });
      } else view.unmount();
      if (change !== 'unmount') await screen.findByRole('link', { name: /^Fresh/ });
      await act(async () => {
        resolve(page([item(2, { name: 'Stale' })]));
        await Promise.resolve();
      });
      expect(screen.queryByRole('link', { name: /^Stale/ })).toBeNull();
    },
  );

  it('continues bounded pages with the API cursor, announcing and de-duplicating', async () => {
    const fake = source([
      page([item(1, { name: 'Alpha' }), item(2, { name: 'Beta' })], uuid(2)),
      page([item(2, { name: 'Beta' }), item(3, { name: 'Gamma' })]),
    ]);
    render(<MyStore source={fake} />);
    expect(await screen.findByText('Showing 2 items so far.')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Load more items' }));
    expect(await screen.findByRole('link', { name: /^Gamma/ })).toBeVisible();
    expect(fake.loadPage).toHaveBeenLastCalledWith({ cursor: uuid(2) });
    expect(screen.getAllByRole('link', { name: /^Beta/ })).toHaveLength(1);
    expect(screen.getByRole('status')).toHaveTextContent('Loaded 2 more items. All items loaded.');
    expect(screen.queryByRole('button', { name: 'Load more items' })).toBeNull();
  });

  it('keeps loaded items when a continuation fails and lets the owner retry', async () => {
    const fake = source([page([item(1, { name: 'Alpha' })], uuid(1))]);
    render(<MyStore source={fake} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Load more items' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Items already shown are unchanged.',
    );
    expect(card('Alpha')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Try loading more again' })).toBeEnabled();
  });

  it('shows an offline notice and pauses continuation', async () => {
    render(<MyStore source={source([page([item(1, { name: 'Alpha' })], uuid(1))])} />);
    await screen.findByRole('link', { name: /^Alpha/ });
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    act(() => {
      window.dispatchEvent(new Event('offline'));
    });
    expect(screen.getByText(/You are offline\./)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Load more items' })).toBeDisabled();
    online.mockReturnValue(true);
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Load more items' })).toBeEnabled(),
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
      />,
    );
    await screen.findByRole('link', { name: /^Alpha/ });
    const user = userEvent.setup();
    await user.tab();
    // Filters come first, then sorting, then the cards.
    expect(screen.getAllByTestId('store-filters')[0]).toContainElement(
      document.activeElement as HTMLElement,
    );
    card('Alpha').focus();
    expect(card('Alpha')).toHaveFocus();
    await user.tab();
    expect(card('Beta')).toHaveFocus();
    expect(within(card('Alpha')).queryAllByRole('button')).toHaveLength(0);
    expect(within(card('Beta')).queryAllByRole('button')).toHaveLength(0);
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
    render(<MyStore source={source([page([item(1, { name: 'Kettle' })])])} />);
    await screen.findByRole('link', { name: /^Kettle\b/ });
    expect(card('Kettle')).toHaveAttribute(
      'href',
      `/items/${uuid(1)}?returnTo=${encodeURIComponent('/store?q=kettle&sort=price&currency=INR')}`,
    );
  });

  it('confirms a deletion once without revealing anything else', async () => {
    window.sessionStorage.setItem('havefolio:item-deleted', 'Old kettle');
    const { unmount } = render(<MyStore source={source([page([item(2)])])} />);
    expect(
      await screen.findByText('“Old kettle” and its private photos and documents were deleted.'),
    ).toBeInTheDocument();
    expect(window.sessionStorage.getItem('havefolio:item-deleted')).toBeNull();
    unmount();
    render(<MyStore source={source([page([item(2)])])} />);
    await screen.findByRole('link', { name: /^Item 2\b/ });
    expect(screen.queryByText(/were deleted/)).toBeNull();
  });
});

describe('desktop density preference', () => {
  it.each([null, 'invalid', '{broken', 'COMPACT', 'v0:compact'])(
    'defaults safely for %s',
    async (value) => {
      if (value !== null) window.localStorage.setItem(densityKey, value);
      // Execute the actual pre-paint script, not a separate test implementation.
      window.eval(densityBootstrap);
      render(<MyStore source={source([page([item(1)])])} />);
      await screen.findByRole('link', { name: /^Item 1/ });
      expect(screen.getByRole('radio', { name: 'Comfortable' })).toBeChecked();
      expect(document.documentElement.dataset.storeDensity).toBe('comfortable');
    },
  );

  it.each(storeDensities)(
    'keeps grouping, cards, pagination and image hints in %s',
    async (density) => {
      window.localStorage.setItem(densityKey, density);
      window.eval(densityBootstrap);
      const fake = source([
        page(
          [
            item(1, {
              name: 'Zero',
              categoryId: kitchen,
              pricePaidMinor: '0',
              purchaseDate: { precision: 'month', year: 2026, month: 4, day: null },
              cover: {
                photoId: uuid(501),
                width: 1600,
                height: 1200,
                altText: 'Zero cover',
                decorative: false,
              },
            }),
            item(2, {
              name: 'Unknown',
              ownershipStatus: 'sold',
              purchaseDate: { precision: 'year', year: 2019, month: null, day: null },
            }),
          ],
          uuid(2),
        ),
        page([item(3, { name: 'Next' })]),
      ]);
      render(<MyStore source={fake} />);
      await screen.findByRole('link', { name: /^Zero/ });
      expect(
        screen.getByRole('radio', { name: density[0]!.toUpperCase() + density.slice(1) }),
      ).toBeChecked();
      expect(screen.getByRole('img', { name: 'Zero cover' })).toHaveAttribute(
        'sizes',
        densityImageSizes[density],
      );
      expect(card('Zero')).toHaveAccessibleDescription('Kitchen');
      expect(card('Unknown')).toHaveAccessibleName('Unknown Sold, no longer owned');
      expect(screen.getByText(/Books. They appear/)).toBeVisible();
      await userEvent.click(screen.getByRole('button', { name: 'Load more items' }));
      await screen.findByRole('link', { name: /^Next/ });
      expect(fake.loadPage).toHaveBeenCalledTimes(2);
      expect(fake.loadTaxonomy).toHaveBeenCalledTimes(1);
    },
  );

  it('selects all modes with arrow keys and restores after remount without fetching on selection', async () => {
    const fake = source([page([item(1)])]);
    const view = render(<MyStore source={fake} />);
    await screen.findByRole('link', { name: /^Item 1/ });
    const user = userEvent.setup();
    screen.getByRole('radio', { name: 'Comfortable' }).focus();
    await user.keyboard('{ArrowLeft>}');
    await waitFor(() => expect(screen.getByRole('radio', { name: 'Compact' })).toBeChecked());
    await user.keyboard('{/ArrowLeft}{ArrowRight>}');
    await waitFor(() => expect(screen.getByRole('radio', { name: 'Comfortable' })).toBeChecked());
    await user.keyboard('{/ArrowRight}{ArrowRight>}');
    await waitFor(() => expect(screen.getByRole('radio', { name: 'Large' })).toBeChecked());
    await user.keyboard('{/ArrowRight}');
    expect(window.localStorage.length).toBe(1);
    expect(window.localStorage.getItem(densityKey)).toBe('large');
    expect(fake.loadPage).toHaveBeenCalledTimes(1);
    view.unmount();
    render(<MyStore source={source([page([])])} />);
    await screen.findByText('Nothing recorded yet');
    expect(screen.getByRole('radio', { name: 'Large' })).toBeChecked();
  });

  it('survives storage read/write failures and synchronizes changes from another tab', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('Unavailable');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Full');
    });
    window.eval(densityBootstrap);
    render(<MyStore source={source([page([item(1)])])} />);
    await screen.findByRole('link', { name: /^Item 1/ });
    await userEvent.click(screen.getByRole('radio', { name: 'Compact' }));
    expect(screen.getByRole('radio', { name: 'Compact' })).toBeChecked();
    await act(() =>
      window.dispatchEvent(new StorageEvent('storage', { key: densityKey, newValue: 'large' })),
    );
    expect(screen.getByRole('radio', { name: 'Large' })).toBeChecked();
    await act(() =>
      window.dispatchEvent(new StorageEvent('storage', { key: densityKey, newValue: 'corrupt' })),
    );
    expect(screen.getByRole('radio', { name: 'Comfortable' })).toBeChecked();
  });

  it.each(storeDensities)(
    'retains loading, fallback, offline and retry states with %s',
    async (density) => {
      act(() => selectDensity(density));
      const fake = source([], new Error('taxonomy unavailable'));
      const view = render(<MyStore source={fake} />);
      expect(screen.getByTestId('store-skeleton')).toBeInTheDocument();
      await screen.findByRole('alert');
      fake.loadPage.mockResolvedValueOnce(page([item(1)], uuid(1)));
      await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
      await screen.findByRole('heading', { name: 'All items' });
      expect(screen.getByText(/Categories could not load/)).toBeVisible();
      vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
      act(() => {
        window.dispatchEvent(new Event('offline'));
      });
      expect(screen.getByRole('button', { name: 'Load more items' })).toBeDisabled();
      view.unmount();
      render(<MyStore source={source([page([])])} />);
      await screen.findByText('Nothing recorded yet');
      expect(
        screen.getByRole('radio', { name: density[0]!.toUpperCase() + density.slice(1) }),
      ).toBeChecked();
    },
  );
});
