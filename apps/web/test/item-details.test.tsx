import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  ItemDocumentSnapshot,
  ItemEvent,
  ItemPhotoSnapshot,
  ItemResponse,
  TaxonomySnapshot,
} from '@havefolio/contracts';
import { DocumentRequestError } from '../components/documents-client';
import { ItemDetails, type ItemDetailsApi } from '../components/item-details';
import { ItemRequestError } from '../components/items-client';

const replace = vi.fn();
const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace, refresh, push: vi.fn() }) }));

const uuid = (n: number): string => `00000000-0000-4000-a000-${String(n).padStart(12, '0')}`;
const kitchen = uuid(901);
const appliances = uuid(911);
const daily = uuid(921);
const gifted = uuid(922);
const taxonomy: TaxonomySnapshot = {
  categories: [
    { id: kitchen, name: 'Kitchen', position: 0, isDemo: false, retiredAt: null, itemCount: 2 },
  ],
  subcategories: [
    {
      id: appliances,
      categoryId: kitchen,
      name: 'Appliances',
      position: 0,
      isDemo: false,
      retiredAt: null,
      itemCount: 1,
    },
  ],
  tags: [
    { id: daily, name: 'Daily use', itemCount: 1 },
    { id: gifted, name: 'From family', itemCount: 0 },
  ],
  defaultsSeeded: true,
};

function item(extra: Partial<ItemResponse> = {}): ItemResponse {
  return {
    id: uuid(1),
    name: 'Electric kettle',
    ownershipStatus: 'owned',
    currency: 'INR',
    pricePaidMinor: '125000',
    purchaseDate: { precision: 'exact', year: 2024, month: 3, day: 9 },
    acquisitionType: 'bought',
    condition: 'working',
    useFrequency: 'often',
    categoryId: kitchen,
    subcategoryId: appliances,
    tagIds: [daily],
    brand: 'Prestige',
    model: 'PKOSS 1.5',
    description: 'Steel body, 1.5 litre.',
    notes: 'Descale monthly.',
    specifications: { Wattage: '1500 W', Capacity: '1.5 L' },
    revision: 3,
    createdAt: '2026-09-01T05:30:00.000Z',
    updatedAt: '2026-09-20T05:30:00.000Z',
    originalEntry: { name: 'Electric kettle', internalHint: 'do-not-render' },
    originalSource: 'manual',
    ...extra,
  };
}
const sparse = (): ItemResponse =>
  item({
    name: 'Old umbrella',
    pricePaidMinor: null,
    purchaseDate: { precision: 'unknown', year: null, month: null, day: null },
    acquisitionType: 'unknown',
    condition: 'unknown',
    useFrequency: 'unknown',
    categoryId: null,
    subcategoryId: null,
    tagIds: [],
    brand: null,
    model: null,
    description: null,
    notes: null,
    specifications: null,
  });

const events: ItemEvent[] = [
  {
    id: uuid(501),
    eventType: 'created',
    occurredAt: '2026-09-01T05:30:00.000Z',
    createdAt: '2026-09-01T05:30:00.000Z',
    metadata: { source: 'user', ownershipStatus: 'owned' },
  },
  {
    id: uuid(502),
    eventType: 'details_updated',
    occurredAt: '2026-09-10T05:30:00.000Z',
    createdAt: '2026-09-10T05:30:00.000Z',
    metadata: { source: 'user', fields: ['pricePaidMinor', 'purchaseDate'], revision: 2 },
  },
  {
    id: uuid(503),
    eventType: 'repaired',
    occurredAt: '2026-09-12T12:00:00.000Z',
    createdAt: '2026-09-20T05:30:00.000Z',
    metadata: { source: 'user', revision: 3, note: 'Replaced the switch', providerAssetId: 'x9' },
  },
  {
    id: uuid(504),
    eventType: 'condition_changed',
    occurredAt: '2026-09-20T05:30:00.000Z',
    createdAt: '2026-09-20T05:30:00.000Z',
    metadata: { source: 'user', from: 'needs_repair', to: 'working' },
  },
];
const photos: ItemPhotoSnapshot = {
  revision: 3,
  photos: [
    {
      id: uuid(301),
      position: 0,
      cover: true,
      width: 1200,
      height: 900,
      byteSize: 1000,
      mimeType: 'image/webp',
      altText: 'Kettle on the counter',
      decorative: false,
    },
  ],
};
const documents: ItemDocumentSnapshot = {
  revision: 3,
  documents: [
    {
      id: uuid(401),
      kind: 'receipt',
      mimeType: 'application/pdf',
      byteSize: 240_000,
      width: null,
      height: null,
    },
    {
      id: uuid(402),
      kind: 'warranty',
      mimeType: 'image/webp',
      byteSize: 90_000,
      width: 800,
      height: 1000,
    },
  ],
};

type Fake = { [K in keyof ItemDetailsApi]: ReturnType<typeof vi.fn<ItemDetailsApi[K]>> };
function fakeApi(start: ItemResponse = item(), overrides: Partial<Fake> = {}): Fake {
  let current = start;
  return {
    readItem: vi.fn<ItemDetailsApi['readItem']>(() => Promise.resolve(current)),
    updateItem: vi.fn<ItemDetailsApi['updateItem']>((_id, input) => {
      const { revision, ...changes } = input;
      if (revision !== current.revision)
        return Promise.reject(
          new ItemRequestError(
            409,
            'This item changed since you opened it.',
            'STALE_ITEM_REVISION',
          ),
        );
      current = { ...current, ...(changes as Partial<ItemResponse>), revision: revision + 1 };
      return Promise.resolve(current);
    }),
    recordItemAction: vi.fn<ItemDetailsApi['recordItemAction']>((_id, input) => {
      current = {
        ...current,
        ownershipStatus: input.ownershipStatus ?? current.ownershipStatus,
        revision: current.revision + 1,
      };
      return Promise.resolve(current);
    }),
    readItemHistory: vi.fn<ItemDetailsApi['readItemHistory']>(() =>
      Promise.resolve({ events, nextCursor: null, hasMore: false }),
    ),
    deleteItem: vi.fn<ItemDetailsApi['deleteItem']>(() => Promise.resolve()),
    readRelatedItems: vi.fn<ItemDetailsApi['readRelatedItems']>(() =>
      Promise.resolve({
        items: [
          { ...item(), cover: null },
          {
            ...item({ id: uuid(2), name: 'Toaster', ownershipStatus: 'donated' }),
            cover: null,
          },
        ],
        nextCursor: null,
        hasMore: false,
      }),
    ),
    loadTaxonomy: vi.fn<ItemDetailsApi['loadTaxonomy']>(() => Promise.resolve(taxonomy)),
    fetchPhotos: vi.fn<ItemDetailsApi['fetchPhotos']>(() => Promise.resolve(photos)),
    fetchDocuments: vi.fn<ItemDetailsApi['fetchDocuments']>(() => Promise.resolve(documents)),
    uploadDocument: vi.fn<ItemDetailsApi['uploadDocument']>(() =>
      Promise.resolve(documents.documents[0]!),
    ),
    deleteDocument: vi.fn<ItemDetailsApi['deleteDocument']>(() =>
      Promise.resolve({ revision: 4, documents: [] }),
    ),
    ...overrides,
  };
}

async function renderDetails(
  api: Fake,
  returnTo?: string,
): Promise<ReturnType<typeof render> & { user: ReturnType<typeof userEvent.setup> }> {
  const user = userEvent.setup();
  const view = render(<ItemDetails itemId={uuid(1)} api={api} returnTo={returnTo} />);
  await screen.findByRole('heading', { level: 1 });
  await waitFor(() => expect(api.readItemHistory).toHaveBeenCalled());
  return { ...view, user };
}
const section = (name: string): HTMLElement =>
  screen.getByRole('heading', { level: 2, name }).closest('section')!;
const fact = (scope: HTMLElement, label: string): string =>
  within(scope).getByText(label, { selector: 'dt' }).nextElementSibling!.textContent ?? '';

beforeEach(() => {
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: true });
  window.sessionStorage.clear();
});
afterEach(() => {
  replace.mockReset();
  refresh.mockReset();
});

describe('item details rendering', () => {
  it('renders a complete record with semantic sections, separate photos and documents', async () => {
    const api = fakeApi();
    const { container } = await renderDetails(api);
    expect(screen.getByRole('heading', { level: 1, name: 'Electric kettle' })).toBeInTheDocument();
    expect(screen.getByText('Prestige · PKOSS 1.5')).toBeInTheDocument();
    // Status is text plus an icon, never colour alone.
    expect(screen.getByText('Status:', { exact: false }).parentElement).toHaveTextContent(
      'Status: Owned',
    );

    const purchase = section('Purchase');
    expect(fact(purchase, 'Price paid')).toContain('₹1,250');
    expect(fact(purchase, 'Price paid')).toContain('Not a current value');
    expect(fact(purchase, 'When you got it')).toBe('9 March 2024');
    expect(fact(purchase, 'How you got it')).toBe('Bought new');

    const state = section('Condition and use');
    expect(fact(state, 'Condition')).toBe('Working');
    expect(fact(state, 'How often you use it')).toBe('Often');
    expect(fact(state, 'Ownership')).toContain('Owned');

    await waitFor(() => expect(fact(section('Category and tags'), 'Category')).toBe('Kitchen'));
    expect(fact(section('Category and tags'), 'Subcategory')).toBe('Appliances');
    expect(
      within(section('Category and tags')).getByRole('list', { name: 'Tags' }),
    ).toHaveTextContent('Daily use');
    const notes = section('Notes and specifications');
    expect(notes).toHaveTextContent('Descale monthly.');
    expect(fact(notes, 'Wattage')).toBe('1500 W');
    expect(screen.getByText('Entered by you')).toBeInTheDocument();

    // Photos: same-origin authenticated content only.
    const photoSection = await waitFor(() =>
      screen.getByRole('heading', { level: 2, name: /^Photos\s*\(1\)$/ }).closest('section')!,
    );
    const cover = within(photoSection).getByRole('img', { name: 'Kettle on the counter' });
    expect(cover.getAttribute('src')).toMatch(/^\/api\/v1\/items\/[^/]+\/photos\/[^/]+\/content\//);
    expect(within(photoSection).getByRole('link', { name: /Manage photos/ })).toHaveAttribute(
      'href',
      `/items/${uuid(1)}/photos`,
    );
    // Documents are listed in their own section, never in the gallery.
    const docs = await waitFor(() => section('Receipts and warranties'));
    expect(within(docs).getByText('Receipt 1')).toBeInTheDocument();
    expect(within(docs).getByText('Warranty 1')).toBeInTheDocument();
    expect(within(photoSection).queryByText(/Receipt|Warranty/)).toBeNull();
    expect(within(docs).getByRole('link', { name: 'Download Receipt 1' })).toHaveAttribute(
      'href',
      `/api/v1/items/${uuid(1)}/documents/${uuid(401)}/download`,
    );
    // Internal provenance and provider metadata never reach the page.
    expect(container.innerHTML).not.toMatch(
      /cloudinary|providerAssetId|x9|internalHint|do-not-render/i,
    );
  });

  it('renders a sparse record with explicit unknowns and optional invitations', async () => {
    const api = fakeApi(sparse(), {
      fetchPhotos: vi.fn<ItemDetailsApi['fetchPhotos']>(() =>
        Promise.resolve({ revision: 3, photos: [] }),
      ),
      fetchDocuments: vi.fn<ItemDetailsApi['fetchDocuments']>(() =>
        Promise.resolve({ revision: 3, documents: [] }),
      ),
    });
    const { user } = await renderDetails(api);
    const purchase = section('Purchase');
    expect(fact(purchase, 'Price paid')).toContain('Not recorded');
    expect(fact(purchase, 'Price paid')).toContain('left out of totals');
    expect(fact(purchase, 'When you got it')).toBe('Not recorded');
    expect(fact(section('Category and tags'), 'Category')).toBe('Uncategorised');
    expect(section('Category and tags')).toHaveTextContent('No tags');
    expect(section('Notes and specifications')).toHaveTextContent('No notes yet');
    expect(await screen.findByText('No photos yet')).toBeInTheDocument();
    expect(await screen.findByText(/No receipts or warranties yet/)).toBeInTheDocument();
    expect(api.readRelatedItems).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: /Add details \(9 optional\)/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Add details' });
    expect(dialog).toHaveTextContent('All optional');
    await user.click(within(dialog).getByRole('button', { name: 'Add brand' }));
    const editor = await screen.findByRole('dialog', {
      name: 'Edit name, brand, model and description',
    });
    await waitFor(() => expect(within(editor).getByLabelText('Brand (optional)')).toHaveFocus());
  });

  it('distinguishes zero, gift and gift-with-amount prices', async () => {
    const zero = await renderDetails(fakeApi(item({ pricePaidMinor: '0' })));
    expect(fact(section('Purchase'), 'Price paid')).toContain('₹0 (nothing paid)');
    zero.unmount();
    const gift = await renderDetails(
      fakeApi(item({ pricePaidMinor: null, acquisitionType: 'gift' })),
    );
    expect(fact(section('Purchase'), 'Amount you paid')).toBe('Gift — nothing paid recorded');
    gift.unmount();
    await renderDetails(fakeApi(item({ pricePaidMinor: '50000', acquisitionType: 'gift' })));
    expect(fact(section('Purchase'), 'Amount you paid')).toContain('₹500');
    expect(fact(section('Purchase'), 'Amount you paid')).toContain('towards a gift');
  });

  it('shows month-only and year-only dates without inventing precision', async () => {
    const month = await renderDetails(
      fakeApi(item({ purchaseDate: { precision: 'month', year: 2023, month: 11, day: null } })),
    );
    expect(fact(section('Purchase'), 'When you got it')).toBe('November 2023Month only');
    month.unmount();
    await renderDetails(
      fakeApi(item({ purchaseDate: { precision: 'year', year: 2019, month: null, day: null } })),
    );
    expect(fact(section('Purchase'), 'When you got it')).toBe('2019Year only');
  });

  it('renders history oldest first as accessible text without raw metadata', async () => {
    await renderDetails(fakeApi());
    const list = await screen.findByRole('list', { name: 'Item history, oldest first' });
    const entries = within(list).getAllByRole('listitem');
    expect(entries.map((li) => li.querySelector('p')?.textContent)).toEqual([
      'Added to Havefolio',
      'Details corrected',
      'Repaired',
      'Condition updated',
    ]);
    expect(entries[1]).toHaveTextContent('Updated price paid and purchase date');
    // Backdated: occurrence and record-creation times are both shown.
    expect(entries[2]).toHaveTextContent(/12 Sept? 2026 · recorded 20 Sept? 2026/);
    expect(entries[2]).toHaveTextContent('Note: Replaced the switch');
    expect(entries[3]).toHaveTextContent('Needs repair → Working');
    expect(within(list).getAllByText(/2026/)[0]!.closest('time')).toHaveAttribute('dateTime');
    expect(list.textContent).not.toMatch(/source|revision|user|providerAssetId/);
  });

  it('opens related items in the same category while keeping the original return path', async () => {
    const returnTo = '/store?q=kettle&sort=price&currency=INR';
    await renderDetails(fakeApi(), returnTo);
    const related = await screen.findByRole('list', { name: 'Also in Kitchen' });
    const links = within(related).getAllByRole('link');
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAccessibleName(/Toaster/);
    expect(links[0]).toHaveAttribute(
      'href',
      `/items/${uuid(2)}?returnTo=${encodeURIComponent(returnTo)}`,
    );
    expect(screen.getAllByRole('link', { name: /Back to My Store/ })[0]).toHaveAttribute(
      'href',
      returnTo,
    );
  });
});

describe('page states', () => {
  it('shows not found without a retry', async () => {
    const api = fakeApi(item(), {
      readItem: vi.fn<ItemDetailsApi['readItem']>(() =>
        Promise.reject(new ItemRequestError(404, 'gone', 'ITEM_NOT_FOUND')),
      ),
    });
    render(<ItemDetails itemId={uuid(1)} api={api} />);
    expect(
      await screen.findByRole('heading', { name: 'This item is not in your inventory' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  it('asks to sign in again when the session expired', async () => {
    const api = fakeApi(item(), {
      readItem: vi.fn<ItemDetailsApi['readItem']>(() =>
        Promise.reject(
          new ItemRequestError(401, 'Your session has ended. Sign in again to continue.'),
        ),
      ),
    });
    render(<ItemDetails itemId={uuid(1)} api={api} />);
    expect(
      await screen.findByRole('heading', { name: 'Please sign in again' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login');
  });

  it('retries after an API failure or interrupted request', async () => {
    const readItem = vi
      .fn<ItemDetailsApi['readItem']>()
      .mockRejectedValueOnce(new ItemRequestError(0, 'You appear to be offline.', 'NETWORK'))
      .mockResolvedValue(item());
    const user = userEvent.setup();
    render(<ItemDetails itemId={uuid(1)} api={fakeApi(item(), { readItem })} />);
    expect(
      await screen.findByText(/You appear to be offline. Nothing has been changed./),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Electric kettle' }),
    ).toBeInTheDocument();
  });

  it('announces loading and disables changes while offline', async () => {
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: false });
    render(<ItemDetails itemId={uuid(1)} api={fakeApi()} />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading item.');
    await screen.findByRole('heading', { level: 1 });
    expect(screen.getByText(/You are offline/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Used it again' })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Delete item/ })).toBeDisabled();
  });

  it('shows attachment processing and storage states honestly', async () => {
    const api = fakeApi(item(), {
      fetchDocuments: vi.fn<ItemDetailsApi['fetchDocuments']>(() =>
        Promise.reject(
          new DocumentRequestError(
            503,
            'MEDIA_STORAGE_DISABLED',
            'Private document storage is not enabled yet.',
          ),
        ),
      ),
    });
    await renderDetails(api);
    expect(
      await screen.findByText('Private document storage is not enabled yet.'),
    ).toBeInTheDocument();
  });
});

describe('editing', () => {
  it('changes condition independently of use frequency and ownership', async () => {
    const api = fakeApi();
    const { user } = await renderDetails(api);
    await user.click(screen.getByRole('button', { name: 'Edit condition and use' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit condition and use' });
    await user.click(within(dialog).getByRole('combobox', { name: 'Condition' }));
    await user.click(await screen.findByRole('option', { name: 'Needs repair' }));
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(api.updateItem).toHaveBeenCalledWith(uuid(1), {
        condition: 'needs_repair',
        revision: 3,
      }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(fact(section('Condition and use'), 'Condition')).toBe('Needs repair');
    expect(fact(section('Condition and use'), 'How often you use it')).toBe('Often');
    expect(screen.getByText('Status:', { exact: false }).parentElement).toHaveTextContent('Owned');
    await waitFor(() =>
      expect(screen.getByText('Changes saved.', { selector: '.sr-only' })).toBeInTheDocument(),
    );
    // Focus returns to the control that opened the editor.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Edit condition and use' })).toHaveFocus(),
    );
  });

  it('edits use frequency alone', async () => {
    const api = fakeApi();
    const { user } = await renderDetails(api);
    await user.click(screen.getByRole('button', { name: 'Edit condition and use' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('combobox', { name: 'How often you use it' }));
    await user.click(await screen.findByRole('option', { name: 'Rarely' }));
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(api.updateItem).toHaveBeenCalledWith(uuid(1), { useFrequency: 'rarely', revision: 3 }),
    );
  });

  it('edits category, subcategory and tags with the shared selectors', async () => {
    const api = fakeApi();
    const { user } = await renderDetails(api);
    await waitFor(() => expect(api.loadTaxonomy).toHaveBeenCalled());
    await user.click(screen.getByRole('button', { name: 'Edit category and tags' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('checkbox', { name: 'From family' }));
    await user.click(within(dialog).getByRole('checkbox', { name: 'Daily use' }));
    await user.click(within(dialog).getByRole('combobox', { name: 'Subcategory (optional)' }));
    await user.click(await screen.findByRole('option', { name: 'No subcategory' }));
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(api.updateItem).toHaveBeenCalledWith(uuid(1), {
        subcategoryId: null,
        tagIds: [gifted],
        revision: 3,
      }),
    );
  });

  it('edits notes and specifications, keeping unchanged values', async () => {
    const api = fakeApi();
    const { user } = await renderDetails(api);
    await user.click(screen.getByRole('button', { name: 'Edit notes and specifications' }));
    const dialog = await screen.findByRole('dialog');
    const notes = within(dialog).getByLabelText('Notes (optional)');
    await user.clear(notes);
    await user.type(notes, 'Keep the filter.');
    await user.click(within(dialog).getByRole('button', { name: 'Add a specification' }));
    await user.type(within(dialog).getByLabelText('Specification 3 name'), 'Colour');
    await user.type(within(dialog).getByLabelText('Specification 3 value'), 'Steel');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(api.updateItem).toHaveBeenCalledWith(uuid(1), {
        notes: 'Keep the filter.',
        specifications: { Wattage: '1500 W', Capacity: '1.5 L', Colour: 'Steel' },
        revision: 3,
      }),
    );
  });

  it('corrects price to explicit zero, unknown and month-only dates', async () => {
    const api = fakeApi();
    const { user } = await renderDetails(api);
    await user.click(screen.getByRole('button', { name: 'Edit purchase details' }));
    let dialog = await screen.findByRole('dialog');
    const amount = within(dialog).getByLabelText('Amount paid');
    await user.clear(amount);
    await user.type(amount, '0');
    await user.click(within(dialog).getByRole('radio', { name: 'Month and year' }));
    await user.click(within(dialog).getByRole('combobox', { name: 'Month' }));
    await user.click(await screen.findByRole('option', { name: 'March' }));
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(api.updateItem).toHaveBeenLastCalledWith(uuid(1), {
        pricePaidMinor: '0',
        purchaseDate: { precision: 'month', year: 2024, month: 3 },
        revision: 3,
      }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await user.click(screen.getByRole('button', { name: 'Edit purchase details' }));
    dialog = await screen.findByRole('dialog');
    const priceKnown = within(dialog).getByRole('radiogroup', { name: 'Is the price known?' });
    await user.click(within(priceKnown).getByRole('radio', { name: 'Not recorded' }));
    const precision = within(dialog).getByRole('radiogroup', {
      name: 'How precisely do you know the date?',
    });
    await user.click(within(precision).getByRole('radio', { name: 'Not recorded' }));
    expect(within(dialog).getByText(/no date is filled in for you/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(api.updateItem).toHaveBeenLastCalledWith(uuid(1), {
        pricePaidMinor: null,
        purchaseDate: { precision: 'unknown' },
        revision: 4,
      }),
    );
  });

  it('summarises and associates validation errors without submitting', async () => {
    const api = fakeApi();
    const { user } = await renderDetails(api);
    await user.click(
      screen.getByRole('button', { name: 'Edit name, brand, model and description' }),
    );
    const dialog = await screen.findByRole('dialog');
    const name = within(dialog).getByLabelText('Name');
    await user.clear(name);
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    const summary = await within(dialog).findByRole('alert');
    expect(summary).toHaveTextContent('Check this field');
    expect(name).toHaveAttribute('aria-invalid', 'true');
    expect(name).toHaveAccessibleDescription('Enter a name for this item.');
    expect(api.updateItem).not.toHaveBeenCalled();
    await user.click(within(summary).getByRole('link', { name: 'Enter a name for this item.' }));
    expect(name).toHaveFocus();
  });

  it('preserves unsaved input on a stale revision and offers review before overwriting', async () => {
    const api = fakeApi();
    const { user } = await renderDetails(api);
    // Someone else changes the brand after the page loaded.
    api.readItem.mockResolvedValue(item({ brand: 'Philips', revision: 4 }));
    await user.click(
      screen.getByRole('button', { name: 'Edit name, brand, model and description' }),
    );
    const dialog = await screen.findByRole('dialog');
    const model = within(dialog).getByLabelText('Model (optional)');
    await user.clear(model);
    await user.type(model, 'PKOSS 1.8');
    api.updateItem.mockRejectedValueOnce(
      new ItemRequestError(409, 'This item changed since you opened it.', 'STALE_ITEM_REVISION'),
    );
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    const conflict = await within(dialog).findByText('This item changed since you opened it');
    const alert = conflict.closest('[role="alert"]')!;
    expect(alert).toHaveTextContent('Nothing was overwritten');
    expect(alert).toHaveTextContent('Brand is now “Philips”.');
    expect(model).toHaveValue('PKOSS 1.8');
    expect(within(dialog).getByRole('button', { name: 'Save' })).toBeDisabled();
    api.updateItem.mockResolvedValueOnce(
      item({ brand: 'Philips', model: 'PKOSS 1.8', revision: 5 }),
    );
    await user.click(within(dialog).getByRole('button', { name: 'Save my version' }));
    await waitFor(() =>
      expect(api.updateItem).toHaveBeenLastCalledWith(uuid(1), { model: 'PKOSS 1.8', revision: 4 }),
    );
  });

  it('keeps input after a failed save and restores an unsaved draft after closing', async () => {
    const api = fakeApi();
    api.updateItem.mockRejectedValueOnce(
      new ItemRequestError(0, 'You appear to be offline or the connection dropped.', 'NETWORK'),
    );
    const { user } = await renderDetails(api);
    await user.click(
      screen.getByRole('button', { name: 'Edit name, brand, model and description' }),
    );
    let dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Brand (optional)'), ' India');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByText(/Your changes are still here/)).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await user.click(
      screen.getByRole('button', { name: 'Edit name, brand, model and description' }),
    );
    dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText('Brand (optional)')).toHaveValue('Prestige India');
    expect(within(dialog).getByText('Your unsaved changes were kept')).toBeInTheDocument();
  });

  it('ignores duplicate submissions while saving', async () => {
    let resolve!: (value: ItemResponse) => void;
    const api = fakeApi();
    api.updateItem.mockImplementationOnce(() => new Promise((r) => (resolve = r)));
    const { user } = await renderDetails(api);
    await user.click(
      screen.getByRole('button', { name: 'Edit name, brand, model and description' }),
    );
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Model (optional)'), 'X');
    const save = within(dialog).getByRole('button', { name: 'Save' });
    await user.dblClick(save);
    expect(within(dialog).getByRole('button', { name: 'Saving…' })).toBeDisabled();
    expect(api.updateItem).toHaveBeenCalledTimes(1);
    resolve(item({ model: 'PKOSS 1.5X', revision: 4 }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('is operable with the keyboard alone and restores focus on close', async () => {
    const { user } = await renderDetails(fakeApi());
    const edit = screen.getByRole('button', { name: 'Edit purchase details' });
    edit.focus();
    await user.keyboard('{Enter}');
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    await user.tab();
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(edit).toHaveFocus());
  });
});

describe('lifecycle actions', () => {
  it('records using it again without changing ownership', async () => {
    const api = fakeApi();
    const { user } = await renderDetails(api);
    await user.click(screen.getByRole('button', { name: 'Used it again' }));
    const dialog = await screen.findByRole('alertdialog', {
      name: 'Record that you used this again',
    });
    expect(dialog).toHaveTextContent('Ownership, condition and how often you use it stay the same');
    await user.click(within(dialog).getByRole('button', { name: 'Record use' }));
    await waitFor(() =>
      expect(api.recordItemAction).toHaveBeenCalledWith(uuid(1), { action: 'used', revision: 3 }),
    );
    await waitFor(() =>
      expect(
        screen.getByText('Recorded that you used this again.', { selector: '.sr-only' }),
      ).toBeInTheDocument(),
    );
    expect(screen.getByText('Status:', { exact: false }).parentElement).toHaveTextContent('Owned');
    expect(api.readItemHistory).toHaveBeenCalledTimes(2);
  });

  it('records a repair with a backdated date and note, never as a replacement', async () => {
    const api = fakeApi();
    const { user } = await renderDetails(api);
    await user.click(screen.getByRole('button', { name: 'Record a repair' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Record a repair' });
    expect(dialog).toHaveTextContent('nothing is replaced');
    await user.type(
      within(dialog).getByLabelText('When did this happen? (optional)'),
      '2026-09-12',
    );
    await user.type(within(dialog).getByLabelText('Note (optional, private)'), 'New switch');
    await user.click(within(dialog).getByRole('button', { name: 'Record repair' }));
    await waitFor(() =>
      expect(api.recordItemAction).toHaveBeenCalledWith(uuid(1), {
        action: 'repaired',
        revision: 3,
        occurredAt: '2026-09-12T12:00:00Z',
        note: 'New switch',
      }),
    );
  });

  it.each([
    ['Sold it', 'Mark as sold', 'sold', 'does not record or estimate a sale price'],
    ['Donated it', 'Mark as donated', 'donated', 'no longer in your home'],
    ['Disposed of it', 'Mark as disposed of', 'disposed', 'no longer in your home'],
    ['Lost it', 'Mark as lost', 'lost', 'mark it as found later'],
  ])('confirms %s before changing ownership', async (menuItem, title, status, explanation) => {
    const api = fakeApi();
    const { user } = await renderDetails(api);
    await user.click(screen.getByRole('button', { name: 'No longer have it' }));
    await user.click(await screen.findByRole('menuitem', { name: menuItem }));
    const dialog = await screen.findByRole('alertdialog', { name: title });
    expect(dialog).toHaveTextContent(explanation);
    expect(dialog).toHaveTextContent(
      'purchase details and spending history stay exactly as recorded',
    );
    expect(api.recordItemAction).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: title }));
    await waitFor(() =>
      expect(api.recordItemAction).toHaveBeenCalledWith(uuid(1), {
        action: 'ownership_changed',
        ownershipStatus: status,
        revision: 3,
      }),
    );
    // Purchase information is untouched and the item now offers only valid actions.
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Used it again' })).toBeNull());
    expect(fact(section('Purchase'), 'Price paid')).toContain('₹1,250');
    // Focus moves to the heading because the triggering control no longer exists.
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toHaveFocus());
  });

  it('offers only recovery for an inactive item', async () => {
    await renderDetails(fakeApi(item({ ownershipStatus: 'lost' })));
    const group = screen.getByRole('group', { name: 'Record what happened' });
    expect(
      within(group)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['Found it']);
    expect(screen.getByText('Status:', { exact: false }).parentElement).toHaveTextContent(
      'Lost · no longer in your home',
    );
  });

  it('reloads and explains an invalid or stale transition without recording', async () => {
    const api = fakeApi();
    const { user } = await renderDetails(api);
    api.recordItemAction.mockRejectedValueOnce(
      new ItemRequestError(409, 'no', 'INVALID_ITEM_TRANSITION'),
    );
    api.readItem.mockResolvedValue(item({ ownershipStatus: 'sold', revision: 4 }));
    await user.click(screen.getByRole('button', { name: 'Used it again' }));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Record use' }));
    expect(await within(dialog).findByText(/no longer applies/)).toBeInTheDocument();
    expect(api.readItem).toHaveBeenCalledTimes(2);
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('button', { name: 'Own it again' })).toBeInTheDocument();
  });

  it('shows lifecycle failures and keeps the note', async () => {
    const api = fakeApi();
    api.recordItemAction.mockRejectedValueOnce(
      new ItemRequestError(503, 'The service is temporarily unavailable. Try again shortly.'),
    );
    const { user } = await renderDetails(api);
    await user.click(screen.getByRole('button', { name: 'Record a repair' }));
    const dialog = await screen.findByRole('alertdialog');
    await user.type(within(dialog).getByLabelText('Note (optional, private)'), 'Hinge');
    await user.click(within(dialog).getByRole('button', { name: 'Record repair' }));
    expect(
      await within(dialog).findByText(/Nothing was recorded; your note is still here/),
    ).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Note (optional, private)')).toHaveValue('Hinge');
  });
});

describe('deletion', () => {
  it('requires the item name, explains attachment removal and returns to My Store', async () => {
    const api = fakeApi();
    const returnTo = '/store?q=kettle';
    const { user } = await renderDetails(api, returnTo);
    await waitFor(() => expect(api.fetchDocuments).toHaveBeenCalled());
    await user.click(screen.getByRole('button', { name: /Delete item/ }));
    const dialog = await screen.findByRole('alertdialog', {
      name: /Delete “Electric kettle” permanently\?/,
    });
    expect(dialog).toHaveTextContent('1 photo');
    expect(dialog).toHaveTextContent('2 receipt or warranty documents');
    const confirm = within(dialog).getByRole('button', { name: 'Delete permanently' });
    expect(confirm).toBeDisabled();
    await user.type(
      within(dialog).getByLabelText('Type the item name to confirm'),
      'electric kettle',
    );
    expect(confirm).toBeEnabled();
    await user.dblClick(confirm);
    await waitFor(() => expect(replace).toHaveBeenCalledWith(returnTo));
    expect(api.deleteItem).toHaveBeenCalledTimes(1);
    expect(api.deleteItem).toHaveBeenCalledWith(uuid(1), 3);
    expect(window.sessionStorage.getItem('havefolio:item-deleted')).toBe('Electric kettle');
  });

  it('keeps the item and explains pending attachment cleanup', async () => {
    const api = fakeApi();
    api.deleteItem.mockRejectedValueOnce(
      new ItemRequestError(409, 'pending', 'ITEM_MEDIA_PENDING'),
    );
    const { user } = await renderDetails(api);
    await user.click(screen.getByRole('button', { name: /Delete item/ }));
    const dialog = await screen.findByRole('alertdialog');
    await user.type(
      within(dialog).getByLabelText('Type the item name to confirm'),
      'Electric kettle',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Delete permanently' }));
    const alert = await within(dialog).findByRole('alert');
    expect(alert).toHaveTextContent('Not fully deleted yet');
    expect(alert).toHaveTextContent('item record was kept');
    expect(alert.textContent).not.toMatch(/cloudinary|provider/i);
    expect(replace).not.toHaveBeenCalled();
  });

  it('reloads on a stale delete and does not delete', async () => {
    const api = fakeApi();
    api.deleteItem.mockRejectedValueOnce(new ItemRequestError(409, 'stale', 'STALE_ITEM_REVISION'));
    const { user } = await renderDetails(api);
    await user.click(screen.getByRole('button', { name: /Delete item/ }));
    const dialog = await screen.findByRole('alertdialog');
    await user.type(
      within(dialog).getByLabelText('Type the item name to confirm'),
      'Electric kettle',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Delete permanently' }));
    expect(await within(dialog).findByText('Not deleted — this item changed')).toBeInTheDocument();
    expect(api.readItem).toHaveBeenCalledTimes(2);
    expect(replace).not.toHaveBeenCalled();
  });

  it('shows a general delete failure', async () => {
    const api = fakeApi();
    api.deleteItem.mockRejectedValueOnce(
      new ItemRequestError(500, 'Something went wrong. Try again.'),
    );
    const { user } = await renderDetails(api);
    await user.click(screen.getByRole('button', { name: /Delete item/ }));
    const dialog = await screen.findByRole('alertdialog');
    await user.type(
      within(dialog).getByLabelText('Type the item name to confirm'),
      'Electric kettle',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Delete permanently' }));
    expect(await within(dialog).findByText('Not deleted')).toBeInTheDocument();
  });
});

describe('documents', () => {
  it('uploads a warranty, refreshing the item revision', async () => {
    const api = fakeApi();
    const { user } = await renderDetails(api);
    const docs = await waitFor(() => section('Receipts and warranties'));
    await waitFor(() => expect(within(docs).getByText('Receipt 1')).toBeInTheDocument());
    await user.click(within(docs).getByRole('radio', { name: 'Warranty' }));
    const file = new File(['%PDF-1.7'], 'warranty.pdf', { type: 'application/pdf' });
    await user.upload(within(docs).getByLabelText('File'), file);
    await user.click(within(docs).getByRole('button', { name: 'Upload document' }));
    await waitFor(() =>
      expect(api.uploadDocument).toHaveBeenCalledWith(
        uuid(1),
        expect.any(String),
        'warranty',
        file,
      ),
    );
    expect(await within(docs).findByText('Warranty added.')).toBeInTheDocument();
    expect(api.readItem).toHaveBeenCalledTimes(2);
  });

  it('rejects unsupported files before uploading', async () => {
    const api = fakeApi();
    const { user } = await renderDetails(api);
    const docs = await waitFor(() => section('Receipts and warranties'));
    await waitFor(() => within(docs).getByLabelText('File'));
    // Bypass the input's accept filter, as a drag-and-drop or older browser would.
    fireEvent.change(within(docs).getByLabelText('File'), {
      target: { files: [new File(['x'], 'note.txt', { type: 'text/plain' })] },
    });

    await user.click(within(docs).getByRole('button', { name: 'Upload document' }));
    expect(await within(docs).findByRole('alert')).toHaveTextContent(
      'Choose a JPEG, PNG, WebP image or a PDF.',
    );
    expect(api.uploadDocument).not.toHaveBeenCalled();
  });

  it('confirms before removing a document', async () => {
    const api = fakeApi();
    const { user } = await renderDetails(api);
    const docs = await waitFor(() => section('Receipts and warranties'));
    await user.click(await within(docs).findByRole('button', { name: 'Remove Receipt 1' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Remove this receipt?' });
    await user.click(within(dialog).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(api.deleteDocument).toHaveBeenCalledWith(uuid(1), uuid(401), 3));
    expect(await within(docs).findByText(/No receipts or warranties yet/)).toBeInTheDocument();
  });
});
