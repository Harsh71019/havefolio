import { render, screen, within, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { ItemResponse, OwnerResponse, TaxonomySnapshot } from '@havefolio/contracts';
import {
  parseDisplayAmountToMinorUnits,
  formatMinorUnitsToDisplay,
  getCurrencyMinorUnitDigits,
} from '@havefolio/contracts';
import { AddItemForm } from '../components/add-item-form';
import {
  saveItemDraft,
  loadItemDraft,
  clearItemDraft,
  getDraftStorageKey,
} from '../components/items-client';

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
    expect(getCurrencyMinorUnitDigits('INR')).toBe(2);
    expect(getCurrencyMinorUnitDigits('USD')).toBe(2);
    expect(getCurrencyMinorUnitDigits('JPY')).toBe(0);
    expect(getCurrencyMinorUnitDigits('KRW')).toBe(0);
    expect(getCurrencyMinorUnitDigits('KWD')).toBe(3);
    expect(getCurrencyMinorUnitDigits('BHD')).toBe(3);
  });

  it('converts display amounts to minor units without floating point rounding errors', () => {
    expect(parseDisplayAmountToMinorUnits('1250', 'INR')).toBe('125000');
    expect(parseDisplayAmountToMinorUnits('1250.5', 'INR')).toBe('125050');
    expect(parseDisplayAmountToMinorUnits('1250.50', 'INR')).toBe('125050');
    expect(parseDisplayAmountToMinorUnits('0.05', 'INR')).toBe('5');
    expect(parseDisplayAmountToMinorUnits('0', 'INR')).toBe('0');
    expect(parseDisplayAmountToMinorUnits('0.00', 'INR')).toBe('0');

    // 0 decimal currencies
    expect(parseDisplayAmountToMinorUnits('5000', 'JPY')).toBe('5000');

    // 3 decimal currencies
    expect(parseDisplayAmountToMinorUnits('1.250', 'KWD')).toBe('1250');
    expect(parseDisplayAmountToMinorUnits('1.25', 'KWD')).toBe('1250');
  });

  it('rejects invalid amounts or excessive precision', () => {
    expect(() => parseDisplayAmountToMinorUnits('12.345', 'INR')).toThrow(/decimal place/);
    expect(() => parseDisplayAmountToMinorUnits('10.5', 'JPY')).toThrow(
      /cannot have decimal places/,
    );
    expect(() => parseDisplayAmountToMinorUnits('-50', 'INR')).toThrow(/valid positive number/);
    expect(() => parseDisplayAmountToMinorUnits('abc', 'INR')).toThrow(/valid positive number/);
    expect(() => parseDisplayAmountToMinorUnits('', 'INR')).toThrow(/required/);
  });

  it('formats minor units to display string', () => {
    expect(formatMinorUnitsToDisplay('125000', 'INR')).toBe('1250.00');
    expect(formatMinorUnitsToDisplay('50', 'INR')).toBe('0.50');
    expect(formatMinorUnitsToDisplay('5', 'INR')).toBe('0.05');
    expect(formatMinorUnitsToDisplay('0', 'INR')).toBe('0.00');
    expect(formatMinorUnitsToDisplay('5000', 'JPY')).toBe('5000');
    expect(formatMinorUnitsToDisplay(null, 'INR')).toBe('');
  });
});

describe('draft persistence and isolation', () => {
  it('saves, loads, and clears draft scoped to owner ID', () => {
    const ownerA = 'owner-a';
    const ownerB = 'owner-b';

    saveItemDraft(ownerA, {
      name: 'Coffee Grinder',
      ownershipStatus: 'owned',
      currency: 'INR',
      priceMode: 'known',
      priceDisplay: '4500',
      datePrecision: 'year',
      purchaseYear: '2023',
    });

    const draftA = loadItemDraft(ownerA);
    expect(draftA).not.toBeNull();
    expect(draftA?.name).toBe('Coffee Grinder');
    expect(draftA?.priceDisplay).toBe('4500');

    // Owner B cannot see Owner A's draft
    const draftB = loadItemDraft(ownerB);
    expect(draftB).toBeNull();

    clearItemDraft(ownerA);
    expect(loadItemDraft(ownerA)).toBeNull();
  });

  it('safely handles corrupted or incompatible draft formats', () => {
    const ownerId = 'corrupt-owner';
    const key = getDraftStorageKey(ownerId);

    // Corrupted JSON
    window.localStorage.setItem(key, 'invalid json {');
    expect(loadItemDraft(ownerId)).toBeNull();
    expect(window.localStorage.getItem(key)).toBeNull();

    // Incompatible version
    window.localStorage.setItem(key, JSON.stringify({ version: 99, name: 'Old' }));
    expect(loadItemDraft(ownerId)).toBeNull();
    expect(window.localStorage.getItem(key)).toBeNull();
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

    // Draft is stored in localStorage
    const saved = loadItemDraft(mockOwner.id);
    expect(saved).not.toBeNull();
    expect(saved?.name).toBe('Draft Item');
  });

  it('autosaves draft, shows restored notice, and allows discarding draft', async () => {
    // Pre-populate localStorage with a draft for mockOwner
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

    // Discard draft
    await user.click(screen.getByRole('button', { name: /Discard/ }));

    expect(screen.getByLabelText(/Item name/)).toHaveValue('');
    expect(loadItemDraft(mockOwner.id)).toBeNull();
  });

  it('clears draft after successful creation', async () => {
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

  it('prevents duplicate submissions while in flight', async () => {
    let resolveItemsPromise: (value: Response) => void;
    const itemsPromise = new Promise<Response>((resolve) => {
      resolveItemsPromise = resolve;
    });

    fetchMock.mockImplementation((input) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.includes('/api/v1/auth/me')) return Promise.resolve(jsonResponse(mockOwner));
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
        acquisitionType: 'bought',
        condition: 'working',
        useFrequency: 'often',
      });
    });
  });

  it('renders pre-existing retired category as disabled when restored from draft', async () => {
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
