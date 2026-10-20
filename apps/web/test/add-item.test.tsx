import { render, screen, within, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { ItemResponse, OwnerResponse, TaxonomySnapshot } from '@havefolio/contracts';
import { currencyMinorDigits } from '@havefolio/domain';
import { amountEntryToMinor, minorToAmountEntry } from '../components/money-entry';
import { AddItemForm } from '../components/add-item-form';
import {
  clearAllCaptureDrafts,
  clearItemDraft,
  draftLimits,
  hasDraftConsent,
  loadItemDraft,
  purgeOtherOwnersDrafts,
  saveItemDraft,
  setDraftConsent,
  takeLegacyItemDraft,
} from '../components/capture-drafts';

const mockOwner: OwnerResponse = {
  id: '7b9e0789-f538-4e78-95ef-9a5d1b764011',
  email: 'owner@example.test',
  displayName: 'Harsh',
};

const mockTaxonomy: TaxonomySnapshot = {
  categories: [
    {
      id: 'cat-kitchen',
      name: 'Kitchen',
      position: 0,
      isDemo: false,
      retiredAt: null,
      itemCount: 1,
    },
    {
      id: 'cat-electronics',
      name: 'Electronics',
      position: 1,
      isDemo: false,
      retiredAt: null,
      itemCount: 2,
    },
    {
      id: 'cat-retired',
      name: 'Old hobbies',
      position: 2,
      isDemo: false,
      retiredAt: '2026-01-01T00:00:00.000Z',
      itemCount: 1,
    },
  ],
  subcategories: [
    {
      id: 'sub-coffee',
      categoryId: 'cat-kitchen',
      name: 'Coffee & Tea',
      position: 0,
      isDemo: false,
      retiredAt: null,
      itemCount: 1,
    },
  ],
  tags: [{ id: 'tag-daily', name: 'Daily use', itemCount: 2 }],
  defaultsSeeded: true,
};

const createdItemResponse: ItemResponse = {
  isDemo: false,
  id: 'c8382c40-f655-46aa-b2b7-a0eef0816912',
  name: 'Aeropress Coffee Maker',
  ownershipStatus: 'owned',
  currency: 'INR',
  pricePaidMinor: '185000',
  purchaseDate: { precision: 'exact', year: 2024, month: 3, day: 15 },
  acquisitionType: 'bought',
  condition: 'working',
  useFrequency: 'often',
  categoryId: 'cat-kitchen',
  subcategoryId: 'sub-coffee',
  tagIds: ['tag-daily'],
  brand: 'Aeropress',
  model: 'Original',
  description: 'Hand coffee press',
  notes: 'Keep with extra filters',
  specifications: null,
  revision: 1,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  originalEntry: {},
  originalSource: 'manual',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

beforeEach(() => {
  window.localStorage.clear();
  fetchMock = vi.fn<typeof fetch>().mockImplementation((input) => {
    const url = typeof input === 'string' ? input : (input as Request).url;
    if (url.includes('/api/v1/auth/me')) {
      return Promise.resolve(jsonResponse(mockOwner));
    }
    if (url.includes('/api/v1/merchants'))
      return Promise.resolve(jsonResponse({ merchants: [], nextCursor: null, hasMore: false }));
    if (url.includes('/api/v1/taxonomy')) {
      return Promise.resolve(jsonResponse(mockTaxonomy));
    }
    if (url.includes('/api/v1/items')) {
      return Promise.resolve(jsonResponse(createdItemResponse, 201));
    }
    return Promise.resolve(jsonResponse({}));
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe('money, currency, and date conversion logic', () => {
  it('correctly maps currency decimal exponents', () => {
    expect(currencyMinorDigits('INR')).toBe(2);
    expect(currencyMinorDigits('USD')).toBe(2);
    expect(currencyMinorDigits('JPY')).toBe(0);
    expect(currencyMinorDigits('KRW')).toBe(0);
    expect(currencyMinorDigits('KWD')).toBe(3);
    expect(currencyMinorDigits('BHD')).toBe(3);
  });

  it('converts display amounts to minor units without floating point rounding errors', () => {
    expect(amountEntryToMinor('1250', 'INR')).toBe('125000');
    expect(amountEntryToMinor('1250.5', 'INR')).toBe('125050');
    expect(amountEntryToMinor('1250.50', 'INR')).toBe('125050');
    expect(amountEntryToMinor('0.05', 'INR')).toBe('5');
    expect(amountEntryToMinor('0', 'INR')).toBe('0');
    expect(amountEntryToMinor('0.00', 'INR')).toBe('0');

    // 0 decimal currencies
    expect(amountEntryToMinor('5000', 'JPY')).toBe('5000');

    // 3 decimal currencies
    expect(amountEntryToMinor('1.250', 'KWD')).toBe('1250');
    expect(amountEntryToMinor('1.25', 'KWD')).toBe('1250');
  });

  it('rejects invalid amounts or excessive precision', () => {
    expect(() => amountEntryToMinor('12.345', 'INR')).toThrow(/decimal place/);
    expect(() => amountEntryToMinor('10.5', 'JPY')).toThrow(/cannot have decimal places/);
    expect(() => amountEntryToMinor('-50', 'INR')).toThrow(/valid positive number/);
    expect(() => amountEntryToMinor('abc', 'INR')).toThrow(/valid positive number/);
    expect(() => amountEntryToMinor('', 'INR')).toThrow(/valid positive number/);
    // Malformed grouping is rejected rather than reinterpreted as a different amount.
    expect(() => amountEntryToMinor('1,2,3', 'INR')).toThrow(/valid positive number/);
    expect(amountEntryToMinor('1,29,999.50', 'INR')).toBe('12999950');
    expect(() => amountEntryToMinor('100000000000000000000', 'INR')).toThrow(/larger than/);
  });

  it('formats minor units to display string', () => {
    expect(minorToAmountEntry('125000', 'INR')).toBe('1250.00');
    expect(minorToAmountEntry('50', 'INR')).toBe('0.50');
    expect(minorToAmountEntry('5', 'INR')).toBe('0.05');
    expect(minorToAmountEntry('0', 'INR')).toBe('0.00');
    expect(minorToAmountEntry('5000', 'JPY')).toBe('5000');
    expect(minorToAmountEntry(null, 'INR')).toBe('');
  });
});

describe('PER-47 capture draft policy', () => {
  const fields = {
    name: 'Coffee Grinder',
    ownershipStatus: 'owned' as const,
    currency: 'INR',
    priceMode: 'known' as const,
    priceDisplay: '4500',
    datePrecision: 'year' as const,
    purchaseYear: '2023',
  };
  const ownerA = 'owner-a';
  const ownerB = 'owner-b';

  it('stores nothing without explicit consent, and revoking consent deletes the draft', () => {
    expect(saveItemDraft(ownerA, fields)).toBe('unavailable');
    expect(window.localStorage.length).toBe(0);
    expect(setDraftConsent(ownerA, true)).toBe(true);
    expect(saveItemDraft(ownerA, fields)).toBe('saved');
    expect(loadItemDraft(ownerA)).toMatchObject({ ...fields, version: 2, ownerId: ownerA });
    setDraftConsent(ownerA, false);
    expect(hasDraftConsent(ownerA)).toBe(false);
    expect(window.localStorage.length).toBe(0);
  });

  it('isolates owners and purges other owners on sign-in', () => {
    setDraftConsent(ownerA, true);
    saveItemDraft(ownerA, fields);
    expect(loadItemDraft(ownerB)).toBeNull();
    // A record copied under another owner's key is still refused.
    const raw = window.localStorage.getItem(`havefolio.capture-draft.v2.${ownerA}`)!;
    setDraftConsent(ownerB, true);
    window.localStorage.setItem(`havefolio.capture-draft.v2.${ownerB}`, raw);
    expect(loadItemDraft(ownerB)).toBeNull();
    purgeOtherOwnersDrafts(ownerB);
    expect(loadItemDraft(ownerA)).toBeNull();
    expect(hasDraftConsent(ownerA)).toBe(false);
    expect(hasDraftConsent(ownerB)).toBe(true);
  });

  it('expires drafts after seven days and rejects corrupt or future records', () => {
    setDraftConsent(ownerA, true);
    saveItemDraft(ownerA, fields);
    const saved = Date.parse(loadItemDraft(ownerA)!.updatedAt);
    expect(loadItemDraft(ownerA, saved + draftLimits.ttlMs - 1000)).not.toBeNull();
    expect(loadItemDraft(ownerA, saved + draftLimits.ttlMs)).toBeNull();
    expect(window.localStorage.getItem(`havefolio.capture-draft.v2.${ownerA}`)).toBeNull();
    const key = `havefolio.capture-draft.v2.${ownerA}`;
    window.localStorage.setItem(key, 'invalid json {');
    expect(loadItemDraft(ownerA)).toBeNull();
    expect(window.localStorage.getItem(key)).toBeNull();
    window.localStorage.setItem(
      key,
      JSON.stringify({ ...fields, version: 2, ownerId: ownerA, updatedAt: '2999-01-01T00:00:00Z' }),
    );
    expect(loadItemDraft(ownerA)).toBeNull();
  });

  it('caps the stored size and keeps only text fields', () => {
    setDraftConsent(ownerA, true);
    expect(saveItemDraft(ownerA, { ...fields, notes: '\u0939'.repeat(30_000) })).toBe('too-large');
    expect(loadItemDraft(ownerA)).toBeNull();
    saveItemDraft(ownerA, { ...fields, notes: '\u0939'.repeat(10_000) });
    const stored = window.localStorage.getItem(`havefolio.capture-draft.v2.${ownerA}`)!;
    expect(Object.keys(JSON.parse(stored) as object).sort()).toEqual(
      [...Object.keys(fields), 'notes', 'version', 'ownerId', 'updatedAt'].sort(),
    );
    expect(stored).not.toMatch(/merchant|purchaseUrl|token|cookie|https?:/i);
  });

  it('reads a legacy unconsented draft into memory once and removes it from storage', () => {
    const key = `havefolio_item_draft_v1_${ownerA}`;
    window.localStorage.setItem(
      key,
      JSON.stringify({ ...fields, version: 1, updatedAt: new Date().toISOString() }),
    );
    expect(takeLegacyItemDraft(ownerA)).toMatchObject(fields);
    expect(window.localStorage.getItem(key)).toBeNull();
    expect(takeLegacyItemDraft(ownerA)).toBeNull();
    window.localStorage.setItem(
      key,
      JSON.stringify({ ...fields, version: 1, updatedAt: '2020-01-01T00:00:00Z' }),
    );
    expect(takeLegacyItemDraft(ownerA)).toBeNull();
    expect(window.localStorage.getItem(key)).toBeNull();
  });

  it('clears every capture draft on logout or deletion without touching other settings', () => {
    setDraftConsent(ownerA, true);
    saveItemDraft(ownerA, fields);
    setDraftConsent(ownerB, true);
    window.localStorage.setItem('havefolio_item_draft_v1_x', '{}');
    window.localStorage.setItem('havefolio.store-density', 'compact');
    clearAllCaptureDrafts();
    expect(Object.keys(window.localStorage)).toEqual(['havefolio.store-density']);
    clearItemDraft(ownerA);
  });

  it('fails safe when storage is blocked', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    expect(setDraftConsent(ownerA, true)).toBe(false);
    spy.mockRestore();
  });
});

describe('fast manual add-item flow component', () => {
  it('submits a minimal item with INR default, unknown price, and unknown date', async () => {
    const user = userEvent.setup();
    render(<AddItemForm />);

    expect(screen.getByRole('status', { name: 'Loading form' })).toBeInTheDocument();
    expect(await screen.findByLabelText(/Item name/)).toBeInTheDocument();

    await user.type(screen.getByLabelText(/Item name/), 'Ceramic Mug');

    // Select price unknown
    await user.click(screen.getByLabelText('Price unknown'));
    expect(screen.getByPlaceholderText('Unknown')).toBeDisabled();

    // Select date unknown
    await user.click(screen.getByLabelText('Date unknown'));

    // Submit
    await user.click(screen.getByRole('button', { name: 'Save item' }));

    await waitFor(() => {
      const calls = fetchMock.mock.calls.filter(
        (c) => typeof c[0] === 'string' && c[0].includes('/api/v1/items'),
      );
      expect(calls.length).toBeGreaterThan(0);
      const lastCall = calls[calls.length - 1];
      const parsedBody = JSON.parse(lastCall?.[1]?.body as string);
      expect(parsedBody).toMatchObject({
        name: 'Ceramic Mug',
        ownershipStatus: 'owned',
        currency: 'INR',
        pricePaidMinor: null,
        purchaseDate: { precision: 'unknown' },
      });
    });

    // Post-save actions appear
    expect(await screen.findByText(/saved to your home/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Add photo/ })).toHaveAttribute(
      'href',
      `/items/${createdItemResponse.id}/photos/new`,
    );
    expect(screen.getByRole('link', { name: /Add more details/ })).toHaveAttribute(
      'href',
      `/items/${createdItemResponse.id}/edit`,
    );
    expect(screen.getByRole('link', { name: /View item/ })).toHaveAttribute(
      'href',
      `/items/${createdItemResponse.id}`,
    );
  });

  it('supports explicit zero price and different currency', async () => {
    const user = userEvent.setup();
    render(<AddItemForm />);

    expect(await screen.findByLabelText(/Item name/)).toBeInTheDocument();
    await user.type(screen.getByLabelText(/Item name/), 'Gifted Book');

    // Change currency to USD
    const currencyCombo = screen.getByRole('combobox', { name: 'Currency' });
    currencyCombo.focus();
    await user.keyboard('{ArrowDown}');
    await user.click(await screen.findByRole('option', { name: /USD/ }));

    // Explicit 0 price
    const priceInput = screen.getByLabelText('Actual amount paid');
    await user.type(priceInput, '0');

    await user.click(screen.getByLabelText('Date unknown'));
    await user.click(screen.getByRole('button', { name: 'Save item' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/items',
        expect.objectContaining({
          body: expect.stringContaining('"pricePaidMinor":"0"'),
        }),
      );
    });
  });

  it('supports exact date precision with valid components', async () => {
    const user = userEvent.setup();
    render(<AddItemForm />);

    expect(await screen.findByLabelText(/Item name/)).toBeInTheDocument();
    await user.type(screen.getByLabelText(/Item name/), 'Kettle');
    await user.click(screen.getByLabelText('Price unknown'));

    // Date defaults to exact date
    const dateInput = screen.getByLabelText('Exact purchase date');
    fireEvent.change(dateInput, { target: { value: '2024-03-15' } });

    await user.click(screen.getByRole('button', { name: 'Save item' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/items',
        expect.objectContaining({
          body: expect.stringContaining(
            '"purchaseDate":{"precision":"exact","year":2024,"month":3,"day":15}',
          ),
        }),
      );
    });
  });

  it('supports month-only and year-only date precision', async () => {
    const user = userEvent.setup();
    render(<AddItemForm />);

    expect(await screen.findByLabelText(/Item name/)).toBeInTheDocument();
    await user.type(screen.getByLabelText(/Item name/), 'Winter Jacket');
    await user.click(screen.getByLabelText('Price unknown'));

    // Switch to month & year
    await user.click(screen.getByLabelText('Month & year'));
    await user.type(screen.getByPlaceholderText(/YYYY/), '2023');

    await user.click(screen.getByRole('button', { name: 'Save item' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/items',
        expect.objectContaining({
          body: expect.stringContaining(
            '"purchaseDate":{"precision":"month","year":2023,"month":1}',
          ),
        }),
      );
    });
  });

  it('displays category & subcategory and prevents new assignment to retired taxonomy', async () => {
    const user = userEvent.setup();
    render(<AddItemForm />);

    expect(await screen.findByLabelText(/Item name/)).toBeInTheDocument();

    const categoryCombo = screen.getByRole('combobox', { name: 'Category' });
    categoryCombo.focus();
    await user.keyboard('{ArrowDown}');

    // Retired category should NOT be available for new assignment
    expect(screen.queryByRole('option', { name: /Old hobbies/ })).not.toBeInTheDocument();

    // Active category selectable
    await user.click(screen.getByRole('option', { name: 'Kitchen' }));

    // Subcategory becomes enabled
    const subcategoryCombo = screen.getByRole('combobox', { name: /Subcategory/ });
    expect(subcategoryCombo).toBeEnabled();
    subcategoryCombo.focus();
    await user.keyboard('{ArrowDown}');
    await user.click(screen.getByRole('option', { name: 'Coffee & Tea' }));

    expect(subcategoryCombo).toHaveTextContent('Coffee & Tea');
  });

  it('displays validation summary and focuses the summary upon validation error', async () => {
    const user = userEvent.setup();
    render(<AddItemForm />);

    expect(await screen.findByLabelText(/Item name/)).toBeInTheDocument();

    // Click submit on empty form
    await user.click(screen.getByRole('button', { name: 'Save item' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Please check the following before saving');
    expect(within(alert).getByText('Enter an item name.')).toBeInTheDocument();
    expect(
      within(alert).getByText('Enter the amount paid, or choose Price unknown.'),
    ).toBeInTheDocument();

    expect(screen.getByLabelText(/Item name/)).toHaveAttribute('aria-invalid', 'true');
  });

  it('preserves form input during recoverable server failure', async () => {
    const user = userEvent.setup();
    fetchMock.mockImplementation((input) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.includes('/api/v1/auth/me')) return Promise.resolve(jsonResponse(mockOwner));
      if (url.includes('/api/v1/merchants'))
        return Promise.resolve(jsonResponse({ merchants: [], nextCursor: null, hasMore: false }));
      if (url.includes('/api/v1/taxonomy')) return Promise.resolve(jsonResponse(mockTaxonomy));
      if (url.includes('/api/v1/items')) {
        return Promise.resolve(jsonResponse({ message: 'ITEMS_UNAVAILABLE' }, 503));
      }
      return Promise.resolve(jsonResponse({}));
    });

    render(<AddItemForm />);

    expect(await screen.findByLabelText(/Item name/)).toBeInTheDocument();
    await user.type(screen.getByLabelText(/Item name/), 'Espresso Machine');
    await user.click(screen.getByLabelText('Price unknown'));
    await user.click(screen.getByLabelText('Date unknown'));

    await user.click(screen.getByRole('button', { name: 'Save item' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/inventory service is temporarily unavailable/);

    // Form input is completely preserved!
    expect(screen.getByLabelText(/Item name/)).toHaveValue('Espresso Machine');
  });

  it('preserves draft and displays sign in dialog when session expires', async () => {
    const user = userEvent.setup();
    fetchMock.mockImplementation((input) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.includes('/api/v1/auth/me')) return Promise.resolve(jsonResponse(mockOwner));
      if (url.includes('/api/v1/merchants'))
        return Promise.resolve(jsonResponse({ merchants: [], nextCursor: null, hasMore: false }));
      if (url.includes('/api/v1/taxonomy')) return Promise.resolve(jsonResponse(mockTaxonomy));
      if (url.includes('/api/v1/items')) {
        return Promise.resolve(jsonResponse({ message: 'AUTH_REQUIRED' }, 401));
      }
      return Promise.resolve(jsonResponse({}));
    });

    render(<AddItemForm />);

    expect(await screen.findByLabelText(/Item name/)).toBeInTheDocument();
    await user.type(screen.getByLabelText(/Item name/), 'Draft Item');
    await user.click(screen.getByLabelText('Price unknown'));
    await user.click(screen.getByLabelText('Date unknown'));

    await user.click(screen.getByRole('button', { name: 'Save item' }));

    // Inline Sign In prompt appears
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.getByText(/session expired/i)).toBeInTheDocument();

    // Without consent the text stays in page memory only.
    expect(loadItemDraft(mockOwner.id)).toBeNull();
    expect(window.localStorage.length).toBe(0);
  });

  it('autosaves draft, shows restored notice, and allows discarding draft', async () => {
    // Pre-populate localStorage with a consented draft for mockOwner
    setDraftConsent(mockOwner.id, true);
    saveItemDraft(mockOwner.id, {
      name: 'Restored Kettle',
      ownershipStatus: 'owned',
      currency: 'INR',
      priceMode: 'known',
      priceDisplay: '2200',
      datePrecision: 'unknown',
    });

    const user = userEvent.setup();
    render(<AddItemForm />);

    expect(await screen.findByLabelText(/Item name/)).toBeInTheDocument();
    expect(screen.getByDisplayValue('Restored Kettle')).toBeInTheDocument();
    expect(screen.getByDisplayValue('2200')).toBeInTheDocument();
    expect(screen.getByText('Draft restored')).toBeInTheDocument();
    expect(
      screen.getByText('Restored from this device. It is not saved to your inventory yet.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Keep a draft on this device' })).toBeChecked();

    // Discard draft
    await user.click(screen.getByRole('button', { name: /Discard/ }));

    expect(screen.getByLabelText(/Item name/)).toHaveValue('');
    expect(loadItemDraft(mockOwner.id)).toBeNull();
  });

  it('clears draft after successful creation', async () => {
    setDraftConsent(mockOwner.id, true);
    saveItemDraft(mockOwner.id, {
      name: 'To Be Saved',
      ownershipStatus: 'owned',
      currency: 'INR',
      priceMode: 'unknown',
      priceDisplay: '',
      datePrecision: 'unknown',
    });

    const user = userEvent.setup();
    render(<AddItemForm />);

    expect(await screen.findByLabelText(/Item name/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save item' }));

    expect(await screen.findByText(/saved to your home/)).toBeInTheDocument();
    expect(loadItemDraft(mockOwner.id)).toBeNull();
  });

  it('PER-47: keeps a device draft only after consent and deletes it when turned off', async () => {
    const user = userEvent.setup();
    render(<AddItemForm />);
    const name = await screen.findByLabelText(/Item name/);
    await user.type(name, 'Desk lamp');
    expect(window.localStorage.length).toBe(0);
    expect(screen.getByText('Off: your text stays on this page only.')).toBeInTheDocument();

    const consent = screen.getByRole('switch', { name: 'Keep a draft on this device' });
    await user.click(consent);
    await waitFor(() => expect(loadItemDraft(mockOwner.id)?.name).toBe('Desk lamp'));
    expect(
      await screen.findByText(/Draft kept on this device at .* not saved to your inventory yet/),
    ).toBeInTheDocument();

    await user.click(consent);
    expect(window.localStorage.length).toBe(0);
    // Turning storage off never erases what is on the page.
    expect(name).toHaveValue('Desk lamp');
  });

  it('PER-47: retries an unconfirmed save with the same command and no duplicate', async () => {
    const user = userEvent.setup();
    const bodies: { commandId?: string }[] = [];
    fetchMock.mockImplementation((input, init) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.includes('/api/v1/auth/me')) return Promise.resolve(jsonResponse(mockOwner));
      if (url.includes('/api/v1/merchants'))
        return Promise.resolve(jsonResponse({ merchants: [], nextCursor: null, hasMore: false }));
      if (url.includes('/api/v1/taxonomy')) return Promise.resolve(jsonResponse(mockTaxonomy));
      if (url.includes('/api/v1/items')) {
        bodies.push(JSON.parse(init?.body as string) as { commandId?: string });
        // The first response is lost after the server may have saved the item.
        return bodies.length === 1
          ? Promise.reject(new TypeError('Failed to fetch'))
          : Promise.resolve(jsonResponse(createdItemResponse, 201));
      }
      return Promise.resolve(jsonResponse({}));
    });
    setDraftConsent(mockOwner.id, true);
    render(<AddItemForm />);
    await user.type(await screen.findByLabelText(/Item name/), 'Lost response kettle');
    await user.click(screen.getByLabelText('Price unknown'));
    await user.click(screen.getByLabelText('Date unknown'));
    await user.click(screen.getByRole('button', { name: 'Save item' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /not confirmed saved; your draft is kept on this device.*will not create a duplicate/,
    );
    // The pending command survives navigation with the consented draft.
    await waitFor(() => expect(loadItemDraft(mockOwner.id)?.commandId).toBe(bodies[0]?.commandId));

    await user.click(screen.getByRole('button', { name: 'Save item' }));
    expect(await screen.findByText(/saved to your home/)).toBeInTheDocument();
    expect(bodies).toHaveLength(2);
    expect(bodies[0]?.commandId).toMatch(/^[0-9a-f-]{36}$/);
    expect(bodies[1]?.commandId).toBe(bodies[0]?.commandId);
    expect(loadItemDraft(mockOwner.id)).toBeNull();
  });

  it('PER-47: explains a reused command and saves separately only on request', async () => {
    const user = userEvent.setup();
    const commands: (string | undefined)[] = [];
    fetchMock.mockImplementation((input, init) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.includes('/api/v1/auth/me')) return Promise.resolve(jsonResponse(mockOwner));
      if (url.includes('/api/v1/merchants'))
        return Promise.resolve(jsonResponse({ merchants: [], nextCursor: null, hasMore: false }));
      if (url.includes('/api/v1/taxonomy')) return Promise.resolve(jsonResponse(mockTaxonomy));
      if (url.includes('/api/v1/items')) {
        commands.push((JSON.parse(init?.body as string) as { commandId?: string }).commandId);
        return Promise.resolve(
          commands.length === 1
            ? jsonResponse({ message: 'ITEM_COMMAND_REUSED' }, 409)
            : jsonResponse(createdItemResponse, 201),
        );
      }
      return Promise.resolve(jsonResponse({}));
    });
    render(<AddItemForm />);
    await user.type(await screen.findByLabelText(/Item name/), 'Edited after failure');
    await user.click(screen.getByLabelText('Price unknown'));
    await user.click(screen.getByLabelText('Date unknown'));
    await user.click(screen.getByRole('button', { name: 'Save item' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /earlier attempt already saved this item.*Check My Store/,
    );
    await user.click(screen.getByRole('button', { name: 'Save as a new item' }));
    expect(await screen.findByText(/saved to your home/)).toBeInTheDocument();
    expect(commands).toHaveLength(2);
    expect(commands[1]).not.toBe(commands[0]);
  });

  it('PER-47: a different owner signing in inline never sees the previous text', async () => {
    const user = userEvent.setup();
    const otherOwner = { ...mockOwner, id: '9a3a2f2e-7c4b-4b8e-9d55-3f1f6f5d8a10' };
    let signedIn = false;
    fetchMock.mockImplementation((input) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.includes('/api/v1/auth/me'))
        return Promise.resolve(jsonResponse(signedIn ? otherOwner : mockOwner));
      if (url.includes('/api/v1/auth/login')) {
        signedIn = true;
        return Promise.resolve(jsonResponse(otherOwner));
      }
      if (url.includes('/api/v1/merchants'))
        return Promise.resolve(jsonResponse({ merchants: [], nextCursor: null, hasMore: false }));
      if (url.includes('/api/v1/taxonomy')) return Promise.resolve(jsonResponse(mockTaxonomy));
      if (url.includes('/api/v1/items'))
        return Promise.resolve(jsonResponse({ message: 'AUTH_REQUIRED' }, 401));
      return Promise.resolve(jsonResponse({}));
    });
    setDraftConsent(mockOwner.id, true);
    render(<AddItemForm />);
    await user.type(await screen.findByLabelText(/Item name/), 'Private first-owner text');
    await waitFor(() => expect(loadItemDraft(mockOwner.id)).not.toBeNull());
    await user.click(screen.getByLabelText('Price unknown'));
    await user.click(screen.getByLabelText('Date unknown'));
    await user.click(screen.getByRole('button', { name: 'Save item' }));

    await user.type(await screen.findByLabelText('Email'), 'other@example.test');
    await user.type(screen.getByLabelText('Password'), 'synthetic-password-1');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    const name = await screen.findByLabelText(/Item name/);
    expect(name).toHaveValue('');
    expect(loadItemDraft(mockOwner.id)).toBeNull();
    expect(hasDraftConsent(mockOwner.id)).toBe(false);
  });

  it('PER-47: announces offline state without claiming the item is saved', async () => {
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    render(<AddItemForm />);
    expect(await screen.findByText(/You.re offline\. Keep typing/)).toHaveTextContent(
      'your text stays on this page',
    );
    expect(screen.getByText(/nothing reaches your inventory until then/)).toBeInTheDocument();
    online.mockRestore();
  });

  it('prevents duplicate submissions while in flight', async () => {
    let resolveItemsPromise: (value: Response) => void;
    const itemsPromise = new Promise<Response>((resolve) => {
      resolveItemsPromise = resolve;
    });

    fetchMock.mockImplementation((input) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.includes('/api/v1/auth/me')) return Promise.resolve(jsonResponse(mockOwner));
      if (url.includes('/api/v1/merchants'))
        return Promise.resolve(jsonResponse({ merchants: [], nextCursor: null, hasMore: false }));
      if (url.includes('/api/v1/taxonomy')) return Promise.resolve(jsonResponse(mockTaxonomy));
      if (url.includes('/api/v1/items')) return itemsPromise;
      return Promise.resolve(jsonResponse({}));
    });

    const user = userEvent.setup();
    render(<AddItemForm />);

    expect(await screen.findByLabelText(/Item name/)).toBeInTheDocument();
    await user.type(screen.getByLabelText(/Item name/), 'Single Click Item');
    await user.click(screen.getByLabelText('Price unknown'));
    await user.click(screen.getByLabelText('Date unknown'));

    const saveButton = screen.getByRole('button', { name: 'Save item' });
    await user.click(saveButton);

    expect(saveButton).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Saving item…' })).toBeInTheDocument();

    // Click again while in-flight
    await user.click(saveButton);

    // Only 1 item POST request in flight
    const itemCalls = fetchMock.mock.calls.filter(
      (call) => typeof call[0] === 'string' && call[0].includes('/api/v1/items'),
    );
    expect(itemCalls.length).toBe(1);

    // Resolve
    resolveItemsPromise!(jsonResponse(createdItemResponse, 201));
    expect(await screen.findByText(/saved to your home/)).toBeInTheDocument();
  });

  it('supports keyboard-only completion and submission', async () => {
    const user = userEvent.setup();
    render(<AddItemForm />);

    const nameInput = await screen.findByLabelText(/Item name/);
    nameInput.focus();
    await user.keyboard('Keyboard Mechanical');

    // Tab to price unknown checkbox and toggle with Space
    const priceUnknownBox = screen.getByLabelText('Price unknown');
    priceUnknownBox.focus();
    await user.keyboard(' ');
    expect(priceUnknownBox).toBeChecked();

    // Tab to date unknown checkbox and toggle with Space
    const dateUnknownBox = screen.getByLabelText('Date unknown');
    dateUnknownBox.focus();
    await user.keyboard(' ');
    expect(dateUnknownBox).toBeChecked();

    // Submit with button focus + Enter
    const saveButton = screen.getByRole('button', { name: 'Save item' });
    saveButton.focus();
    await user.keyboard('{Enter}');

    expect(await screen.findByText(/saved to your home/)).toBeInTheDocument();
  });

  it('supports optional details including tags, brand, model, and notes', async () => {
    const user = userEvent.setup();
    render(<AddItemForm />);

    expect(await screen.findByLabelText(/Item name/)).toBeInTheDocument();
    await user.type(screen.getByLabelText(/Item name/), 'Noise-Cancelling Headphones');
    await user.click(screen.getByLabelText('Price unknown'));
    await user.click(screen.getByLabelText('Date unknown'));

    // Expand optional details
    await user.click(screen.getByRole('button', { name: /Additional details/ }));

    // Select tag
    const tagCheckbox = screen.getByLabelText('Daily use');
    await user.click(tagCheckbox);

    // Enter brand & model
    await user.type(screen.getByLabelText('Brand'), 'Sony');
    await user.type(screen.getByLabelText('Model / Variant'), 'WH-1000XM4');
    await user.type(screen.getByLabelText('Notes'), 'Desk drawer');

    await user.click(screen.getByRole('button', { name: 'Save item' }));

    await waitFor(() => {
      const calls = fetchMock.mock.calls.filter(
        (c) => typeof c[0] === 'string' && c[0].includes('/api/v1/items'),
      );
      const lastCall = calls[calls.length - 1];
      const parsedBody = JSON.parse(lastCall?.[1]?.body as string);
      expect(parsedBody).toMatchObject({
        name: 'Noise-Cancelling Headphones',
        brand: 'Sony',
        model: 'WH-1000XM4',
        notes: 'Desk drawer',
        tagIds: ['tag-daily'],
      });
    });
  });

  it('PER-73: preserves selected metadata across collapse and a lost-response retry', async () => {
    const user = userEvent.setup();
    const requests: Record<string, unknown>[] = [];
    const originalFetch = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation((input, init) => {
      if (
        (typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url
        ).endsWith('/api/v1/items')
      ) {
        requests.push(JSON.parse(init?.body as string) as Record<string, unknown>);
        return requests.length === 1
          ? Promise.reject(new TypeError('Failed to fetch'))
          : Promise.resolve(jsonResponse({ ...createdItemResponse, ...requests[0] }, 201));
      }
      return originalFetch(input, init);
    });
    render(<AddItemForm />);
    await user.type(await screen.findByLabelText(/Item name/), 'Synthetic gifted jacket');
    await user.click(screen.getByLabelText('Price unknown'));
    await user.click(screen.getByLabelText('Date unknown'));
    const disclosure = screen.getByRole('button', { name: /Additional details/ });
    disclosure.focus();
    await user.keyboard('{Enter}');
    expect(disclosure).toHaveAttribute('aria-expanded', 'true');
    for (const [label, value] of [
      ['Acquisition', 'Gift'],
      ['Condition', 'Worn out'],
      ['Use frequency', 'Rarely (a few times a year)'],
    ] as const) {
      screen.getByRole('combobox', { name: label }).focus();
      await user.keyboard('{Enter}');
      (await screen.findByRole('option', { name: value })).focus();
      await user.keyboard('{Enter}');
    }
    disclosure.focus();
    await user.keyboard(' ');
    expect(disclosure).toHaveFocus();
    expect(disclosure).toHaveAttribute('aria-expanded', 'false');
    await user.click(screen.getByRole('button', { name: 'Save item' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/not confirmed saved/);
    expect(requests[0]).toMatchObject({
      acquisitionType: 'gift',
      condition: 'worn_out',
      useFrequency: 'rarely',
      pricePaidMinor: null,
    });
    await user.click(disclosure);
    expect(screen.getByRole('combobox', { name: 'Acquisition' })).toHaveTextContent('Gift');
    expect(screen.getByRole('combobox', { name: 'Condition' })).toHaveTextContent('Worn out');
    expect(screen.getByRole('combobox', { name: 'Use frequency' })).toHaveTextContent('Rarely');
    await user.click(screen.getByRole('button', { name: 'Save item' }));
    expect(await screen.findByText(/saved to your home/)).toBeInTheDocument();
    expect(requests).toHaveLength(2);
    expect(requests[1]).toEqual(requests[0]);
    expect(requests[0]?.commandId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it.each([0, 1, 2])(
    'PER-73: untouched fields are omitted after %i disclosure toggles',
    async (toggles) => {
      const user = userEvent.setup();
      render(<AddItemForm />);
      await user.type(await screen.findByLabelText(/Item name/), 'Synthetic untouched item');
      await user.click(screen.getByLabelText('Price unknown'));
      await user.click(screen.getByLabelText('Date unknown'));
      for (let i = 0; i < toggles; i++)
        await user.click(screen.getByRole('button', { name: /Additional details/ }));
      await user.click(screen.getByRole('button', { name: 'Save item' }));
      expect(await screen.findByText(/saved to your home/)).toBeInTheDocument();
      const call = fetchMock.mock.calls.find(([url]) =>
        (typeof url === 'string' ? url : url instanceof URL ? url.href : url.url).endsWith(
          '/api/v1/items',
        ),
      );
      const body = JSON.parse(call?.[1]?.body as string) as Record<string, unknown>;
      for (const field of ['acquisitionType', 'condition', 'useFrequency'])
        expect(body).not.toHaveProperty(field);
    },
  );

  it('PER-73: explicitly chosen display defaults are saved while untouched fields stay omitted', async () => {
    const user = userEvent.setup();
    render(<AddItemForm />);
    await user.type(await screen.findByLabelText(/Item name/), 'Synthetic selected default');
    await user.click(screen.getByLabelText('Price unknown'));
    await user.click(screen.getByLabelText('Date unknown'));
    await user.click(screen.getByRole('button', { name: /Additional details/ }));
    screen.getByRole('combobox', { name: 'Condition' }).focus();
    await user.keyboard('{Enter}');
    (await screen.findByRole('option', { name: 'Working well' })).focus();
    await user.keyboard('{Enter}');
    await user.click(screen.getByRole('button', { name: /Additional details/ }));
    await user.click(screen.getByRole('button', { name: 'Save item' }));
    expect(await screen.findByText(/saved to your home/)).toBeInTheDocument();
    const call = fetchMock.mock.calls.find(([url]) =>
      (typeof url === 'string' ? url : url instanceof URL ? url.href : url.url).endsWith(
        '/api/v1/items',
      ),
    );
    const body = JSON.parse(call?.[1]?.body as string) as Record<string, unknown>;
    expect(body.condition).toBe('working');
    expect(body).not.toHaveProperty('acquisitionType');
    expect(body).not.toHaveProperty('useFrequency');
    await user.click(screen.getByRole('button', { name: /Add another item/ }));
    await user.type(await screen.findByLabelText(/Item name/), 'Synthetic reset');
    await user.click(screen.getByLabelText('Price unknown'));
    await user.click(screen.getByLabelText('Date unknown'));
    await user.click(screen.getByRole('button', { name: 'Save item' }));
    await waitFor(() => {
      const calls = fetchMock.mock.calls.filter(([url]) =>
        (typeof url === 'string' ? url : url instanceof URL ? url.href : url.url).endsWith(
          '/api/v1/items',
        ),
      );
      expect(calls).toHaveLength(2);
      expect(JSON.parse(calls[1]?.[1]?.body as string)).not.toHaveProperty('condition');
    });
  });

  it('PER-73: consented metadata-only edits are dirty and restored while collapsed', async () => {
    setDraftConsent(mockOwner.id, true);
    const user = userEvent.setup();
    const view = render(<AddItemForm />);
    await screen.findByLabelText(/Item name/);
    await user.click(screen.getByRole('button', { name: /Additional details/ }));
    screen.getByRole('combobox', { name: 'Acquisition' }).focus();
    await user.keyboard('{Enter}');
    (await screen.findByRole('option', { name: 'Gift' })).focus();
    await user.keyboard('{Enter}');
    await user.click(screen.getByRole('button', { name: /Additional details/ }));
    await waitFor(() => expect(loadItemDraft(mockOwner.id)?.acquisitionType).toBe('gift'));
    expect(loadItemDraft(mockOwner.id)?.condition).toBeUndefined();
    view.unmount();
    render(<AddItemForm />);
    await user.type(await screen.findByLabelText(/Item name/), 'Synthetic restored gift');
    expect(screen.getByRole('button', { name: /Additional details/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    await user.click(screen.getByLabelText('Price unknown'));
    await user.click(screen.getByLabelText('Date unknown'));
    await user.click(screen.getByRole('button', { name: 'Save item' }));
    expect(await screen.findByText(/saved to your home/)).toBeInTheDocument();
    const call = fetchMock.mock.calls.find(([url]) =>
      (typeof url === 'string' ? url : url instanceof URL ? url.href : url.url).endsWith(
        '/api/v1/items',
      ),
    );
    expect(JSON.parse(call?.[1]?.body as string)).toMatchObject({
      acquisitionType: 'gift',
      pricePaidMinor: null,
    });
    expect(loadItemDraft(mockOwner.id)).toBeNull();
  });

  it('creates an owned item that is already worn out', async () => {
    const user = userEvent.setup();
    render(<AddItemForm />);

    expect(await screen.findByLabelText(/Item name/)).toBeInTheDocument();
    await user.type(screen.getByLabelText(/Item name/), 'Faded denim jacket');
    await user.click(screen.getByLabelText('Price unknown'));
    await user.click(screen.getByLabelText('Date unknown'));
    await user.click(screen.getByRole('button', { name: /Additional details/ }));

    screen.getByRole('combobox', { name: 'Condition' }).focus();
    await user.keyboard('{Enter}');
    const option = await screen.findByRole('option', { name: 'Worn out' });
    option.focus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('combobox', { name: 'Condition' })).toHaveTextContent('Worn out');

    await user.click(screen.getByRole('button', { name: 'Save item' }));

    await waitFor(() => {
      const calls = fetchMock.mock.calls.filter(
        (c) => typeof c[0] === 'string' && c[0].includes('/api/v1/items'),
      );
      const parsedBody = JSON.parse(calls[calls.length - 1]?.[1]?.body as string);
      expect(parsedBody).toMatchObject({
        name: 'Faded denim jacket',
        ownershipStatus: 'owned',
        condition: 'worn_out',
      });
    });
  });

  it('renders pre-existing retired category as disabled when restored from draft', async () => {
    setDraftConsent(mockOwner.id, true);
    saveItemDraft(mockOwner.id, {
      name: 'Old Projector',
      ownershipStatus: 'owned',
      currency: 'INR',
      priceMode: 'unknown',
      priceDisplay: '',
      datePrecision: 'unknown',
      categoryId: 'cat-retired',
    });

    const user = userEvent.setup();
    render(<AddItemForm />);

    expect(await screen.findByLabelText(/Item name/)).toBeInTheDocument();
    const categoryCombo = screen.getByRole('combobox', { name: 'Category' });
    categoryCombo.focus();
    await user.keyboard('{ArrowDown}');

    // The existing assignment to retired category is displayed as disabled
    expect(await screen.findByRole('option', { name: /Old hobbies \(retired\)/ })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });

  it('allows resetting form to add another item after success', async () => {
    const user = userEvent.setup();
    render(<AddItemForm />);

    expect(await screen.findByLabelText(/Item name/)).toBeInTheDocument();
    await user.type(screen.getByLabelText(/Item name/), 'First Item');
    await user.click(screen.getByLabelText('Price unknown'));
    await user.click(screen.getByLabelText('Date unknown'));
    await user.click(screen.getByRole('button', { name: 'Save item' }));

    expect(await screen.findByText(/saved to your home/)).toBeInTheDocument();

    // Click "Add another item"
    await user.click(screen.getByRole('button', { name: /Add another item/ }));

    // Back to fresh form
    expect(await screen.findByLabelText(/Item name/)).toHaveValue('');
    expect(screen.queryByText(/saved to your home/)).not.toBeInTheDocument();
  });
});
