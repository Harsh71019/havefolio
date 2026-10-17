import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  SpendingBucket,
  SpendingReport,
  SpendingQuery,
  TaxonomySnapshot,
} from '@havefolio/contracts';
import { formatAggregate, spendingGroupName } from '../components/spending-presentation';
import {
  changeSpendingQuery,
  readSpendingQuery,
  reconcileSpendingTaxonomy,
  spendingQueryParams,
} from '../components/spending-query';
import { readSpending, SpendingRequestError } from '../components/spending-client';
import { SpendingInsights } from '../components/spending-insights';
import { spendingItemQuery } from '../components/spending-drilldown';
import { inventoryQueryParams } from '../components/inventory-query-state';

const category = '00000000-0000-4000-a000-000000000021';
const child = '00000000-0000-4000-a000-000000000022';
const other = '00000000-0000-4000-a000-000000000023';
const taxonomy: TaxonomySnapshot = {
  categories: [
    { id: category, name: 'Kitchen', position: 0, isDemo: false, retiredAt: null, itemCount: 6 },
    {
      id: other,
      name: 'Old books',
      position: 1,
      isDemo: false,
      retiredAt: '2025-01-01',
      itemCount: 1,
    },
  ],
  subcategories: [
    {
      id: child,
      categoryId: category,
      name: 'Cookware',
      position: 0,
      isDemo: false,
      retiredAt: null,
      itemCount: 3,
    },
  ],
  tags: [],
  defaultsSeeded: true,
};
const bucket = (patch: Partial<SpendingBucket> = {}): SpendingBucket => ({
  currency: 'INR',
  key: null,
  dateBucket: 'dated',
  grossMinor: '12500',
  refundedMinor: '2500',
  netMinor: '10000',
  totalItemCount: 6,
  pricedItemCount: 3,
  unknownPriceCount: 2,
  notSpendingCount: 1,
  explicitZeroCount: 1,
  knownDateCount: 6,
  unknownDateCount: 0,
  missingMerchantCount: 0,
  ...patch,
});
const report = (q: SpendingQuery, buckets: SpendingBucket[]): SpendingReport => ({
  scope: q.scope,
  grouping: q.grouping ?? 'overall',
  basis: 'purchase-date',
  purchasedFrom: q.purchasedFrom ?? null,
  purchasedTo: q.purchasedTo ?? null,
  buckets,
});
const response = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const requestUrl = (input: string | URL | Request): string =>
  typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
const fetcher = vi.fn<typeof fetch>();
function fixture(
  options: { empty?: boolean; status?: number; code?: string; taxonomyFails?: boolean } = {},
): void {
  fetcher.mockImplementation((input) => {
    const u = new URL(requestUrl(input), 'http://localhost');
    if (u.pathname === '/api/v1/taxonomy')
      return Promise.resolve(
        response(options.taxonomyFails ? {} : taxonomy, options.taxonomyFails ? 503 : 200),
      );
    if (options.status)
      return Promise.resolve(
        response({ message: options.code ?? 'private SQL secret' }, options.status),
      );
    const q = readSpendingQuery(u.searchParams);
    const rows = options.empty
      ? []
      : [
          bucket({
            key:
              q.grouping === 'category'
                ? category
                : q.grouping === 'subcategory'
                  ? child
                  : q.grouping === 'year'
                    ? '2024'
                    : q.grouping === 'merchant'
                      ? '00000000-0000-4000-a000-000000000031'
                      : null,
            merchant:
              q.grouping === 'merchant'
                ? {
                    id: '00000000-0000-4000-a000-000000000031',
                    displayName: 'Amazon India',
                    websiteHost: 'amazon.in',
                    state: 'active',
                  }
                : undefined,
          }),
          bucket({
            currency: 'USD',
            grossMinor: '5000',
            refundedMinor: '0',
            netMinor: '5000',
            key:
              q.grouping === 'category'
                ? other
                : q.grouping === 'year'
                  ? '2025'
                  : q.grouping === 'merchant'
                    ? '00000000-0000-4000-a000-000000000032'
                    : null,
            merchant:
              q.grouping === 'merchant'
                ? {
                    id: '00000000-0000-4000-a000-000000000032',
                    displayName: 'Local Bookstore',
                    websiteHost: null,
                    state: 'retired',
                  }
                : undefined,
          }),
          bucket({
            dateBucket: 'unknownDate',
            unknownDateCount: 6,
            knownDateCount: 0,
            missingMerchantCount: 6,
            key: null,
            merchant: null,
          }),
          bucket({ dateBucket: 'spanningRange' }),
        ];
    return Promise.resolve(response(report(q, rows)));
  });
}
beforeEach(() => {
  window.history.replaceState(null, '', '/insights');
  vi.stubGlobal('fetch', fetcher);
  fetcher.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

describe('exact aggregate presentation', () => {
  it.each([
    ['12505', 'INR', 'INR 125.05'],
    ['12505', 'USD', 'USD 125.05'],
    ['12505', 'JPY', 'JPY 12,505'],
    ['12505', 'KWD', 'KWD 12.505'],
    ['0', 'KWD', 'KWD 0.000'],
    ['0', 'INR', 'INR 0.00'],
    ['0', 'JPY', 'JPY 0'],
    ['9007199254740993', 'USD', 'USD 9,00,71,99,25,47,409.93'],
    ['18446744073709551614', 'INR', 'INR 1,84,46,74,40,73,70,95,516.14'],
  ])('formats %s %s exactly', (v, c, want) => expect(formatAggregate(v, c)).toBe(want));
  it('names unassigned, retired and unavailable taxonomy without exposing IDs', () => {
    expect(spendingGroupName(bucket(), 'category', taxonomy)).toBe('Unassigned category');
    expect(spendingGroupName(bucket(), 'subcategory', taxonomy)).toBe('Unassigned subcategory');
    expect(spendingGroupName(bucket({ key: other }), 'category', taxonomy)).toBe(
      'Old books (retired)',
    );
    expect(spendingGroupName(bucket({ key: child }), 'subcategory', taxonomy)).toBe('Cookware');
    expect(spendingGroupName(bucket({ key: other }), 'category')).toBe('Category name unavailable');
  });
  it('names recorded, retired, not recorded and unavailable merchants', () => {
    expect(spendingGroupName(bucket(), 'merchant')).toBe('Not recorded');
    expect(
      spendingGroupName(
        bucket({
          key: '00000000-0000-4000-a000-000000000031',
          merchant: {
            id: '00000000-0000-4000-a000-000000000031',
            displayName: 'Amazon India',
            websiteHost: 'amazon.in',
            state: 'active',
          },
        }),
        'merchant',
      ),
    ).toBe('Amazon India');
    expect(
      spendingGroupName(
        bucket({
          key: '00000000-0000-4000-a000-000000000032',
          merchant: {
            id: '00000000-0000-4000-a000-000000000032',
            displayName: 'Local Bookstore',
            websiteHost: null,
            state: 'retired',
          },
        }),
        'merchant',
      ),
    ).toBe('Local Bookstore (retired)');
    expect(
      spendingGroupName(
        bucket({
          key: '00000000-0000-4000-a000-000000000033',
          merchant: null,
        }),
        'merchant',
      ),
    ).toBe('Merchant unavailable');
  });
});
describe('validated URL and API state', () => {
  it('normalizes malformed, repeated and unsupported input; always requires a scope', () => {
    expect(
      readSpendingQuery(
        new URLSearchParams(
          'scope=bogus&currency=xxx&categoryId=bad&subcategoryId=' +
            child +
            '&purchasedFrom=2023-02-29&grouping=month&netMinor=123',
        ),
      ),
    ).toEqual({ scope: 'current-owned', grouping: 'category' });
    expect(
      readSpendingQuery(new URLSearchParams('scope=all-history&scope=current-owned')).scope,
    ).toBe('current-owned');
    expect(
      readSpendingQuery(
        new URLSearchParams('currency=usd&purchasedFrom=2025-12-01&purchasedTo=2024-01-01'),
      ),
    ).toEqual({ scope: 'current-owned', grouping: 'category', currency: 'USD' });
  });
  it('clears child when parent changes and reconciles a mismatched URL child', () => {
    const q = {
      scope: 'all-history',
      grouping: 'subcategory',
      categoryId: category,
      subcategoryId: child,
    } as const;
    expect(changeSpendingQuery(q, { categoryId: other }).subcategoryId).toBeUndefined();
    expect(changeSpendingQuery(q, { currency: undefined }).scope).toBe('all-history');
    expect(
      reconcileSpendingTaxonomy({ ...q, categoryId: other }, taxonomy).subcategoryId,
    ).toBeUndefined();
  });
  it('serializes supported query fields only and uses private same-origin no-store requests', async () => {
    fixture();
    const q = {
      scope: 'all-history',
      grouping: 'year',
      currency: 'INR',
      categoryId: category,
      subcategoryId: child,
      purchasedFrom: '2024-01-01',
      purchasedTo: '2024-12-31',
    } as const;
    await readSpending(q);
    expect(fetcher).toHaveBeenCalledWith(
      '/api/v1/spending?' + spendingQueryParams(q).toString(),
      expect.objectContaining({ credentials: 'same-origin', cache: 'no-store' }),
    );
    expect(spendingQueryParams({ ...q, netMinor: 'secret' } as SpendingQuery).has('netMinor')).toBe(
      false,
    );
  });
  it.each([
    [400, 'INVALID_SPENDING_QUERY', 'Reset filters'],
    [400, 'SPENDING_BUCKET_LIMIT', 'Narrow'],
    [400, 'SPENDING_PRECISION_UNREPRESENTABLE', 'yearly view'],
    [401, 'private', 'session has ended'],
    [503, 'private', 'temporarily unavailable'],
  ])('maps status %s and %s to fixed prose', async (status, code, message) => {
    fixture({ status: Number(status), code: String(code) });
    await expect(readSpending({ scope: 'current-owned' })).rejects.toThrow(String(message));
  });
  it('redacts network exceptions', async () => {
    fetcher.mockRejectedValue(new Error('secret SQL'));
    await expect(readSpending({ scope: 'all-history' })).rejects.toEqual(
      new SpendingRequestError(
        0,
        'Unable to connect. You may be offline. Check your connection and retry.',
      ),
    );
  });
});
describe('recorded spending experience', () => {
  it('announces loading, then separates currency summaries, refunds, unknown, gifts and zero counts', async () => {
    fixture();
    render(<SpendingInsights />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading recorded spending');
    const summary = await screen.findByRole('region', { name: 'Recorded spending summary' });
    const inr = within(summary).getByRole('region', { name: 'INR Dated purchases summary' });
    expect(within(inr).getByText('INR 125.00')).toBeVisible();
    expect(within(inr).getByText('INR 25.00')).toBeVisible();
    expect(within(inr).getByText('INR 100.00')).toBeVisible();
    for (const label of [
      'Total items',
      'Unknown prices',
      'Gifts / other non-spending',
      'Explicit zero amounts',
      'Unknown purchase dates',
    ])
      expect(within(inr).getByText(label)).toBeVisible();
    expect(within(inr).getByText('Unknown prices').nextElementSibling).toHaveTextContent('2');
    expect(within(inr).getByText('Explicit zero amounts').nextElementSibling).toHaveTextContent(
      '1',
    );
    expect(within(summary).getByRole('region', { name: 'USD · Currently owned' })).toBeVisible();
    expect(screen.queryByText(/grand total/i)).toBeNull();
    expect(
      within(summary).getByRole('region', { name: 'INR Purchase date unknown summary' }),
    ).toHaveTextContent('separate disclosures');
    expect(
      within(summary).getByRole('region', { name: 'INR Overlapping the selected range summary' }),
    ).toHaveTextContent('not part of the dated amount');
    expect(screen.getAllByRole('table').length).toBeGreaterThan(0);
    expect(await screen.findByText('Kitchen', { selector: 'span.font-medium' })).toBeVisible();
  });
  it('preserves incoming filters after hydration and applies server groupings/scopes', async () => {
    window.history.replaceState(null, '', '/insights?scope=all-history&grouping=year&currency=INR');
    fixture();
    render(<SpendingInsights />);
    await screen.findByRole('heading', { name: 'Yearly trend' });
    expect(window.location.search).toContain('all-history');
    expect(screen.getAllByText('2024').length).toBeGreaterThan(0);
    expect(
      fetcher.mock.calls.some(
        ([url]) =>
          requestUrl(url).includes('grouping=year') &&
          requestUrl(url).includes('scope=all-history'),
      ),
    ).toBe(true);
  });
  it('provides subcategory names, keyboard controls, parent reset and URL reset', async () => {
    window.history.replaceState(
      null,
      '',
      '/insights?scope=current-owned&grouping=subcategory&categoryId=' +
        category +
        '&subcategoryId=' +
        child,
    );
    fixture();
    render(<SpendingInsights />);
    await screen.findByText('Cookware', { selector: 'span.font-medium' });
    const user = userEvent.setup();
    await user.click(screen.getByRole('combobox', { name: /^Category$/ }));
    await user.click(screen.getByRole('option', { name: 'Old books (retired)' }));
    await waitFor(() => expect(window.location.search).not.toContain('subcategoryId'));
    await user.click(screen.getByRole('button', { name: 'Reset filters' }));
    expect(window.location.search).toBe('?scope=current-owned&grouping=category');
    screen.getByRole('combobox', { name: 'Ownership scope' }).focus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('listbox')).toBeVisible();
    await user.keyboard('{Escape}');
  });
  it('does not hide money or leak IDs when taxonomy fails and can retry names', async () => {
    fixture({ taxonomyFails: true });
    render(<SpendingInsights />);
    await screen.findByText('Category names unavailable');
    await screen.findByRole('region', { name: 'Recorded spending summary' });
    expect(screen.getAllByText('Category name unavailable')[0]).toBeVisible();
    expect(document.body.textContent).not.toContain(category);
    fixture();
    await userEvent.click(screen.getByRole('button', { name: 'Retry category names' }));
    expect(await screen.findByText('Kitchen', { selector: 'span.font-medium' })).toBeVisible();
  });
  it('shows empty inventory and filtered empty states', async () => {
    fixture({ empty: true });
    const view = render(<SpendingInsights />);
    await screen.findByText('No recorded purchases in this scope');
    view.unmount();
    window.history.replaceState(null, '', '/insights?currency=JPY');
    render(<SpendingInsights />);
    await screen.findByText('No records match these filters');
  });
  it('handles offline, retry, API errors and expiry without echoing private errors', async () => {
    fetcher.mockImplementation((url) =>
      requestUrl(url).includes('/taxonomy')
        ? Promise.resolve(response(taxonomy))
        : Promise.reject(new Error('private SQL')),
    );
    render(<SpendingInsights />);
    await screen.findByRole('alert');
    expect(document.body.textContent).toContain('offline');
    expect(document.body.textContent).not.toContain('SQL');
    fixture();
    await userEvent.click(screen.getByRole('button', { name: 'Retry spending' }));
    await screen.findByRole('region', { name: 'Recorded spending summary' });
    fixture({ status: 401 });
    await userEvent.click(screen.getByRole('button', { name: 'Reset filters' }));
    expect(await screen.findByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login');
    expect(screen.queryByRole('region', { name: 'Recorded spending summary' })).toBeNull();
  });
  it('prevents an older request from replacing newer filter results', async () => {
    const pending: ((r: Response) => void)[] = [];
    fetcher.mockImplementation((url) =>
      requestUrl(url).includes('/taxonomy')
        ? Promise.resolve(response(taxonomy))
        : new Promise<Response>((resolve) => pending.push(resolve)),
    );
    render(<SpendingInsights />);
    await waitFor(() => expect(pending.length).toBeGreaterThanOrEqual(2));
    fixture();
    act(() => {
      window.history.pushState(null, '', '/insights?scope=all-history&grouping=year');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await screen.findByRole('heading', { name: 'Yearly trend' });
    act(() => {
      pending.forEach((resolve) =>
        resolve(
          response(
            report({ scope: 'current-owned', grouping: 'category' }, [
              bucket({ grossMinor: '99999' }),
            ]),
          ),
        ),
      );
    });
    expect(screen.getByRole('heading', { name: 'Yearly trend' })).toBeVisible();
    expect(document.body.textContent).not.toContain('INR 999.99');
  });
  it('does not persist private results or send totals in URLs', async () => {
    const storage = vi.spyOn(Storage.prototype, 'setItem');
    fixture();
    render(<SpendingInsights />);
    await screen.findByRole('region', { name: 'Recorded spending summary' });
    expect(storage).not.toHaveBeenCalled();
    expect(window.location.search).not.toMatch(/12500|netMinor|grossMinor/);
    expect(fetcher.mock.calls.every(([, init]) => !init?.body)).toBe(true);
  });
  it('rejects reversed dates, allows replacing both bounds and resets an unapplied draft', async () => {
    window.history.replaceState(
      null,
      '',
      '/insights?scope=current-owned&grouping=category&purchasedFrom=2024-01-01&purchasedTo=2024-01-31',
    );
    fixture();
    render(<SpendingInsights />);
    await screen.findByRole('region', { name: 'Recorded spending summary' });
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2024-02-29' } });
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2024-02-01' } });
    await userEvent.click(screen.getByRole('button', { name: 'Apply date range' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('From date must be on or before');
    expect(window.location.search).toContain('purchasedTo=2024-01-31');
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2024-02-29' } });
    await userEvent.click(screen.getByRole('button', { name: 'Apply date range' }));
    expect(window.location.search).toContain('purchasedFrom=2024-02-29');
    await userEvent.click(screen.getByRole('button', { name: 'Reset filters' }));
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2025-01-01' } });
    await userEvent.click(screen.getByRole('button', { name: 'Reset filters' }));
    expect(screen.getByLabelText('From')).toHaveValue('');
  });
  it('applies inclusive date bounds and clears the date controls on reset', async () => {
    fixture();
    render(<SpendingInsights />);
    await screen.findByText('Kitchen', { selector: 'span.font-medium' });
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2024-02-01' } });
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2024-02-29' } });
    await userEvent.click(screen.getByRole('button', { name: 'Apply date range' }));
    expect(window.location.search).toContain('purchasedTo=2024-02-29');
    await userEvent.click(screen.getByRole('button', { name: 'Reset filters' }));
    expect(screen.getByLabelText('From')).toHaveValue('');
  });
});
describe('exact bounded inventory drill-down', () => {
  it('serializes original range and exact relation, scope and category', () => {
    const q = {
      scope: 'all-history',
      grouping: 'category',
      purchasedFrom: '2024-02-29',
      purchasedTo: '2024-02-29',
    } as const;
    expect(
      spendingItemQuery(q, bucket({ key: category, dateBucket: 'spanningRange' }), taxonomy),
    ).toEqual({
      spendingScope: 'all-history',
      spendingDateBucket: 'spanningRange',
      currency: 'INR',
      categoryId: category,
      purchasedFrom: '2024-02-29',
      purchasedTo: '2024-02-29',
      limit: 25,
    });
    expect(
      inventoryQueryParams(spendingItemQuery(q, bucket({ key: category }), taxonomy)!).get(
        'spendingScope',
      ),
    ).toBe('all-history');
  });
  it('handles null assignments, years and unknown dates without inventing components', () => {
    expect(
      spendingItemQuery({ scope: 'current-owned', grouping: 'category' }, bucket())
        ?.spendingUnassigned,
    ).toBe('category');
    expect(
      spendingItemQuery(
        { scope: 'current-owned', grouping: 'subcategory' },
        bucket({ key: child }),
        taxonomy,
      ),
    ).toMatchObject({ categoryId: category, subcategoryId: child });
    expect(
      spendingItemQuery({ scope: 'current-owned', grouping: 'year' }, bucket({ key: '2024' }))
        ?.spendingYear,
    ).toBe('2024');
    expect(
      spendingItemQuery(
        { scope: 'all-history', grouping: 'year' },
        bucket({ dateBucket: 'unknownDate' }),
      ),
    ).not.toHaveProperty('spendingYear');
    expect(
      spendingItemQuery({ scope: 'all-history', grouping: 'subcategory' }, bucket({ key: child })),
    ).toBeNull();
    expect(
      spendingItemQuery(
        { scope: 'current-owned', grouping: 'merchant' },
        bucket({ key: '00000000-0000-4000-a000-000000000031' }),
      ),
    ).toMatchObject({
      spendingScope: 'current-owned',
      merchantId: '00000000-0000-4000-a000-000000000031',
    });
    expect(
      spendingItemQuery({ scope: 'all-history', grouping: 'merchant' }, bucket({ key: null })),
    ).toMatchObject({
      spendingScope: 'all-history',
      spendingUnassigned: 'merchant',
    });
  });
});
