import { useState, type ReactElement } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Merchant, ItemResponse } from '@havefolio/contracts';
import { PurchaseSourceFields } from '../components/purchase-source-fields';
import { draftFrom, sectionChanges } from '../components/item-edit-dialog';
import { describeEvent } from '../components/item-detail-presentation';

const amazon: Merchant = {
  id: '11111111-1111-4111-8111-111111111111',
  displayName: 'Amazon',
  websiteHost: null,
  state: 'active',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};
const response = (json: unknown, status = 200): Response =>
  new Response(JSON.stringify(json), { status, headers: { 'Content-Type': 'application/json' } });
let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
function Form({ initial = null }: { initial?: Merchant | null }): ReactElement {
  const [merchant, setMerchant] = useState(initial),
    [url, setUrl] = useState('');
  return (
    <>
      <PurchaseSourceFields
        merchant={merchant}
        merchantId={merchant?.id ?? null}
        purchaseUrl={url}
        onMerchant={setMerchant}
        onUrl={setUrl}
      />
      <output aria-label="Selected source">
        {merchant?.displayName ?? 'Not recorded'} {url}
      </output>
    </>
  );
}
beforeEach(() => {
  fetchMock = vi
    .fn<typeof fetch>()
    .mockImplementation((_input, init) =>
      Promise.resolve(
        init?.method === 'POST'
          ? response(amazon, 201)
          : response({ merchants: [amazon], hasMore: false, nextCursor: null }),
      ),
    );
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());
describe('private purchase source composition', () => {
  it('supports keyboard selection, common suggestions and independent URL entry', async () => {
    const user = userEvent.setup();
    render(<Form />);
    expect(screen.getByRole('combobox', { name: 'Purchase merchant' })).toHaveTextContent(
      'Not recorded',
    );
    await screen.findByText('1 saved merchants shown.');
    const select = screen.getByRole('combobox', { name: 'Purchase merchant' });
    select.focus();
    await user.keyboard('{ArrowDown}');
    await user.click(screen.getByRole('option', { name: 'Amazon' }));
    await user.type(
      screen.getByLabelText('Purchase URL (optional)'),
      'https://shop.example.test/synthetic',
    );
    expect(screen.getByLabelText('Selected source')).toHaveTextContent(
      'Amazon https://shop.example.test/synthetic',
    );
    await user.click(select);
    await user.click(screen.getByRole('option', { name: 'Not recorded' }));
    expect(screen.getByLabelText('Selected source')).toHaveTextContent(
      'https://shop.example.test/synthetic',
    );
    await user.click(screen.getByRole('button', { name: 'Amazon' }));
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/merchants',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ displayName: 'Amazon' }) }),
    );
    expect(await screen.findByText('Merchant selected.')).toBeInTheDocument();
  });
  it('searches on the server with bounded pages and supports offline retry without losing entries', async () => {
    const user = userEvent.setup();
    fetchMock.mockRejectedValue(new Error('synthetic offline'));
    render(<Form />);
    await user.type(
      screen.getByLabelText('Purchase URL (optional)'),
      'https://shop.example.test/synthetic',
    );
    await screen.findByRole('alert');
    expect(screen.getByLabelText('Purchase URL (optional)')).toHaveValue(
      'https://shop.example.test/synthetic',
    );
    fetchMock.mockResolvedValue(response({ merchants: [], nextCursor: null, hasMore: false }));
    await user.click(screen.getByRole('button', { name: 'Retry merchants' }));
    await user.type(screen.getByLabelText('Search saved merchants'), 'Local');
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/merchants?q=Local&limit=25',
        expect.anything(),
      ),
    );
    expect(
      await screen.findByText('No matching merchants. You can create one below.'),
    ).toBeInTheDocument();
  });
  it('keeps a failed custom merchant entry and retries it without resetting the item URL', async () => {
    const user = userEvent.setup();
    render(<Form />);
    await user.click(screen.getByText('Create a custom merchant'));
    await user.type(screen.getByLabelText('Merchant name'), 'Offline seller');
    await user.type(
      screen.getByLabelText('Purchase URL (optional)'),
      'http://shop.example.test/synthetic',
    );
    fetchMock.mockImplementation((_input, init) =>
      Promise.resolve(
        init?.method === 'POST'
          ? response({}, 503)
          : response({ merchants: [], nextCursor: null, hasMore: false }),
      ),
    );
    await user.click(screen.getByRole('button', { name: 'Create and select merchant' }));
    await screen.findByRole('alert');
    expect(screen.getByLabelText('Merchant name')).toHaveValue('Offline seller');
    expect(screen.getByLabelText('Purchase URL (optional)')).toHaveValue(
      'http://shop.example.test/synthetic',
    );
    fetchMock.mockResolvedValue(response({ ...amazon, displayName: 'Offline seller' }, 201));
    await user.click(screen.getByRole('button', { name: 'Create and select merchant' }));
    expect(await screen.findByText('Merchant selected.')).toBeInTheDocument();
  });
  it('identifies retired historical records and offers correction, retirement and restoration', async () => {
    const user = userEvent.setup();
    render(<Form initial={{ ...amazon, state: 'retired' }} />);
    expect(screen.getByRole('combobox', { name: 'Purchase merchant' })).toHaveTextContent(
      'Amazon (retired)',
    );
    await user.click(screen.getByRole('button', { name: 'Correct or retire merchant' }));
    fetchMock.mockResolvedValue(response(amazon));
    await user.click(screen.getByRole('button', { name: 'Restore merchant' }));
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/v1/merchants/${amazon.id}`,
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ state: 'active' }) }),
    );
    expect(
      await screen.findByText('Merchant updated. Historical item links are kept.'),
    ).toBeInTheDocument();
  });
  it('validates edits and independently clears merchant and URL', () => {
    const base = {
      name: 'Synthetic',
      merchantId: amazon.id,
      merchant: amazon,
      purchaseUrl: 'https://shop.example.test/synthetic',
      pricePaidMinor: null,
      currency: 'INR',
      purchaseDate: { precision: 'unknown' },
      acquisitionType: 'unknown',
      condition: 'unknown',
      useFrequency: 'unknown',
      tagIds: [],
      categoryId: null,
      subcategoryId: null,
    } as unknown as ItemResponse;
    const draft = draftFrom(base);
    draft.merchantId = null;
    expect(sectionChanges('purchase', draft, base).changes).toEqual({ merchantId: null });
    draft.purchaseUrl = '';
    expect(sectionChanges('purchase', draft, base).changes).toEqual({
      merchantId: null,
      purchaseUrl: null,
    });
    draft.purchaseUrl = 'javascript:alert(1)';
    expect(sectionChanges('purchase', draft, base).errors).toHaveProperty('purchaseUrl');
  });
  it('describes source changes without rendering history URLs', () => {
    const entry = describeEvent({
      id: amazon.id,
      eventType: 'details_updated',
      occurredAt: amazon.createdAt,
      createdAt: amazon.createdAt,
      metadata: {
        fields: ['merchantId', 'purchaseUrl'],
        purchaseUrl: 'https://shop.example.test/synthetic',
      },
    });
    expect(JSON.stringify(entry)).toContain('purchase merchant');
    expect(JSON.stringify(entry)).toContain('purchase URL');
    expect(JSON.stringify(entry)).not.toContain('https://');
  });
});
