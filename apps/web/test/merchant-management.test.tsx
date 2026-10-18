import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Merchant } from '@havefolio/contracts';
import { MerchantManagement } from '../components/merchant-management';

const myntra: Merchant = {
  id: '11111111-1111-4111-8111-111111111111',
  displayName: 'Myntra',
  websiteHost: 'myntra.com',
  state: 'active',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};
const response = (value: unknown, status = 200): Response =>
  new Response(JSON.stringify(value), { status });
let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
beforeEach(() => {
  fetchMock = vi
    .fn<typeof fetch>()
    .mockResolvedValue(response({ merchants: [], hasMore: false, nextCursor: null }));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('merchant management', () => {
  it('creates a saved offline merchant without creating an item', async () => {
    const user = userEvent.setup();
    fetchMock.mockImplementation((_input, init) =>
      Promise.resolve(
        init?.method === 'POST'
          ? response({ ...myntra, websiteHost: null }, 201)
          : response({ merchants: [], hasMore: false, nextCursor: null }),
      ),
    );
    render(<MerchantManagement />);
    await screen.findByText('No saved merchants yet. Add your first merchant above.');
    await user.type(screen.getByLabelText('Merchant name'), 'Myntra');
    await user.click(screen.getByRole('button', { name: 'Add merchant' }));
    await screen.findByText(/Merchant saved/);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/merchants',
      expect.objectContaining({
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        body: JSON.stringify({ displayName: 'Myntra', websiteHost: null }),
      }),
    );
    expect(screen.getByLabelText('Merchant name')).toHaveValue('');
  });

  it('retains a duplicate draft and allows retry with a valid host', async () => {
    const user = userEvent.setup();
    let attempts = 0;
    fetchMock.mockImplementation((_input, init) =>
      Promise.resolve(
        init?.method === 'POST'
          ? ++attempts === 1
            ? response({ message: 'MERCHANT_NAME_EXISTS' }, 409)
            : response(myntra, 201)
          : response({ merchants: [], hasMore: false, nextCursor: null }),
      ),
    );
    render(<MerchantManagement />);
    await user.type(screen.getByLabelText('Merchant name'), 'Myntra');
    await user.type(screen.getByLabelText('Website host (optional)'), 'myntra.com');
    await user.click(screen.getByRole('button', { name: 'Add merchant' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('That name is already reserved');
    expect(screen.getByLabelText('Merchant name')).toHaveValue('Myntra');
    expect(screen.getByLabelText('Website host (optional)')).toHaveValue('myntra.com');
    await user.click(screen.getByRole('button', { name: 'Add merchant' }));
    await screen.findByText(/Merchant saved/);
  });

  it('searches all states on the server, pages results, corrects and restores a merchant', async () => {
    const user = userEvent.setup();
    const retired = { ...myntra, state: 'retired' };
    fetchMock.mockImplementation((input, init) => {
      if (init?.method === 'PATCH') return Promise.resolve(response(myntra));
      const url = new URL(
        typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
        'http://localhost',
      );
      return Promise.resolve(
        response(
          url.searchParams.has('after')
            ? { merchants: [retired], hasMore: false, nextCursor: null }
            : { merchants: [], hasMore: true, nextCursor: 'private-cursor' },
        ),
      );
    });
    render(<MerchantManagement />);
    await user.type(screen.getByLabelText('Search saved merchants'), 'My');
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('q=My&state=all&limit=25'),
        expect.anything(),
      ),
    );
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Load more merchants' })).toBeEnabled(),
    );
    await user.click(screen.getByRole('button', { name: 'Load more merchants' }));
    await user.click(await screen.findByRole('button', { name: 'Edit Myntra' }));
    expect(screen.getByLabelText('Merchant name')).toHaveFocus();
    await user.clear(screen.getByLabelText('Merchant name'));
    await user.type(screen.getByLabelText('Merchant name'), 'Myntra India');
    await user.click(screen.getByRole('button', { name: 'Save merchant changes' }));
    await screen.findByText('Merchant updated. Existing item links are kept.');
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/v1/merchants/${myntra.id}`,
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ displayName: 'Myntra India', websiteHost: 'myntra.com' }),
      }),
    );
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Load more merchants' })).toBeEnabled(),
    );
    await user.click(screen.getByRole('button', { name: 'Load more merchants' }));
    await user.click(await screen.findByRole('button', { name: 'Restore Myntra' }));
    await screen.findByText('Merchant restored. It is available for new items.');
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/v1/merchants/${myntra.id}`,
      expect.objectContaining({ body: '{"state":"active"}' }),
    );
  });

  it('offers retry for a failed list without losing an unsaved form', async () => {
    const user = userEvent.setup();
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    render(<MerchantManagement />);
    await user.type(screen.getByLabelText('Merchant name'), 'Local shop');
    await user.click(await screen.findByRole('button', { name: 'Retry merchants' }));
    await screen.findByText('No saved merchants yet. Add your first merchant above.');
    expect(screen.getByLabelText('Merchant name')).toHaveValue('Local shop');
  });
});
