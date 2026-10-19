import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MerchantSpendingReport } from '@havefolio/contracts';
import { MerchantSpending } from '../components/merchant-spending';

const response = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const fetcher = vi.fn<typeof fetch>();
const report: MerchantSpendingReport = {
  scope: 'all-history',
  rows: [
    {
      currency: 'INR',
      merchant: { id: 'a', displayName: 'Amazon', websiteHost: 'amazon.in', state: 'active' },
      grossMinor: '5000000',
      refundedMinor: '200000',
      netMinor: '4800000',
      pricedItemCount: 4,
      unknownPriceCount: 1,
      totalItemCount: 5,
    },
    {
      currency: 'INR',
      merchant: { id: 'f', displayName: 'Flipkart', websiteHost: null, state: 'retired' },
      grossMinor: '1200000',
      refundedMinor: '0',
      netMinor: '1200000',
      pricedItemCount: 1,
      unknownPriceCount: 0,
      totalItemCount: 1,
    },
    {
      currency: 'INR',
      merchant: null,
      grossMinor: '30000',
      refundedMinor: '0',
      netMinor: '30000',
      pricedItemCount: 2,
      unknownPriceCount: 0,
      totalItemCount: 2,
    },
  ],
};
beforeEach(() => {
  vi.stubGlobal('fetch', fetcher);
  fetcher.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

describe('lifetime spend by merchant', () => {
  it('lists merchants in ranked order with exact net amounts from one private request', async () => {
    fetcher.mockResolvedValue(response(report));
    render(<MerchantSpending />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading merchant spending');
    const list = await screen.findByRole('list', { name: 'Merchants by INR spend' });
    const items = within(list).getAllByRole('listitem');
    expect(items.map((li) => li.querySelector('p')?.textContent)).toEqual([
      'Amazon',
      'Flipkart (retired)',
      'No merchant recorded',
    ]);
    expect(items[0]).toHaveTextContent('INR 48,000.00');
    expect(items[0]).toHaveTextContent('5 items · 1 without a price');
    expect(items[1]).toHaveTextContent('1 item');
    expect(fetcher).toHaveBeenCalledWith(
      '/api/v1/spending/merchants',
      expect.objectContaining({ credentials: 'same-origin', cache: 'no-store' }),
    );
  });
  it('shows an empty state when nothing has been recorded', async () => {
    fetcher.mockResolvedValue(response({ scope: 'all-history', rows: [] }));
    render(<MerchantSpending />);
    expect(await screen.findByText(/No purchases recorded yet/)).toBeInTheDocument();
  });
  it('redacts server errors and retries', async () => {
    fetcher.mockResolvedValueOnce(response({ message: 'private SQL secret' }, 500));
    fetcher.mockResolvedValueOnce(response(report));
    render(<MerchantSpending />);
    const alert = await screen.findByRole('alert');
    expect(alert).not.toHaveTextContent('private');
    await userEvent.click(within(alert).getByRole('button', { name: 'Retry merchant spending' }));
    expect(await screen.findByRole('list', { name: 'Merchants by INR spend' })).toBeInTheDocument();
  });
});
