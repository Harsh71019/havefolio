import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { HomeDashboard } from '../components/home-dashboard';
import { HomeRequestError, type readHome } from '../components/home-client';
import { goalProgress } from '../components/home-presentation';
import { emptyHomeFixture, homeFixture } from './home-fixture';

const region = (name: string): HTMLElement => screen.getByRole('region', { name });

describe('PER-33 Home dashboard', () => {
  it('summarises every section from one request with explicit, separate money disclosures', async () => {
    const request = vi.fn<typeof readHome>().mockResolvedValue(homeFixture);
    render(<HomeDashboard request={request} />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading your Home summary');
    expect(await screen.findByText('Items you own')).toBeVisible();
    expect(request).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Plus 2 sample items, not counted')).toBeVisible();
    expect(screen.getByText('1 ready to review')).toBeVisible();

    const spending = region('Recorded spending');
    expect(within(spending).getByText('INR 1,84,500.00')).toBeVisible();
    // Unknown-date spending is disclosed separately and never added to the dated amount.
    expect(within(spending).getByText('INR 12,500.00')).toBeVisible();
    expect(within(spending).queryByText('INR 1,97,000.00')).toBeNull();
    expect(within(spending).getByText('USD 129.99')).toBeVisible();
    expect(
      within(spending).getByText(/5 items with no price recorded are not included/),
    ).toBeVisible();
    expect(within(spending).getByRole('link', { name: /See spending insights/ })).toHaveAttribute(
      'href',
      '/insights',
    );

    const rediscover = region('Rediscover something you own');
    expect(within(rediscover).getByText('Yoga mat')).toBeVisible();
    expect(within(rediscover).getByText('Rarely')).toBeVisible();
    expect(within(rediscover).getByText('Needs repair')).toBeVisible();
    expect(within(rediscover).getByRole('link', { name: /Open this item/ })).toHaveAttribute(
      'href',
      `/items/${homeFixture.rediscovery.item!.id}`,
    );
    expect(within(rediscover).getByRole('link', { name: /See rarely used items/ })).toHaveAttribute(
      'href',
      '/store?useFrequency=rarely',
    );

    const recent = region('Recently added');
    expect(within(recent).getAllByRole('listitem')).toHaveLength(4);
    expect(within(recent).getByText('Sample')).toBeVisible();

    const wants = region('Active wants');
    expect(within(wants).getByRole('link', { name: 'Air fryer' })).toHaveAttribute(
      'href',
      '/wants/00000000-0000-4000-a000-000000003311/compare',
    );
    expect(within(wants).getByText('Ready to review')).toBeVisible();

    const goals = region('Goals');
    const bar = within(goals).getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '20');
    expect(bar).toHaveAccessibleName('Goa trip: INR 8,000.00 of INR 40,000.00 confirmed (20%)');
    // A zero target has a text equivalent and no misleading bar.
    expect(within(goals).getAllByRole('progressbar')).toHaveLength(1);
    expect(within(goals).getByText(/INR 2,500.00 confirmed · no target amount set/)).toBeVisible();
  });

  it('links each empty section to its first action', async () => {
    render(
      <HomeDashboard request={vi.fn<typeof readHome>().mockResolvedValue(emptyHomeFixture)} />,
    );
    await screen.findByText('Items you own');
    for (const [section, name, href] of [
      ['Rediscover something you own', /Add your first item/, '/items/new'],
      ['Recorded spending', /Record a purchase/, '/items/new'],
      ['Recently added', /Add an item/, '/items/new'],
      ['Active wants', /Add a want/, '/wants/new'],
      ['Goals', /Open Goals/, '/goals'],
    ] as const)
      expect(within(region(section)).getByRole('link', { name })).toHaveAttribute('href', href);
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('explains when owned items exist but none are eligible to rediscover', async () => {
    render(
      <HomeDashboard
        request={vi.fn<typeof readHome>().mockResolvedValue({
          ...emptyHomeFixture,
          inventory: { ownedCount: 3, sampleOwnedCount: 0 },
        })}
      />,
    );
    const rediscover = await screen.findByRole('region', { name: 'Rediscover something you own' });
    expect(
      within(rediscover).getByText(/Broken and worn-out items are never suggested/),
    ).toBeVisible();
    expect(within(rediscover).getByRole('link', { name: /Open My Store/ })).toHaveAttribute(
      'href',
      '/store',
    );
  });

  it('recovers from offline errors and asks expired sessions to sign in', async () => {
    const request = vi
      .fn<typeof readHome>()
      .mockRejectedValueOnce(new HomeRequestError(0, 'Unable to connect. You may be offline.'))
      .mockResolvedValueOnce(homeFixture);
    render(<HomeDashboard request={request} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to connect');
    expect(screen.getByRole('link', { name: /Add an item/ })).toHaveAttribute('href', '/items/new');
    await userEvent.click(screen.getByRole('button', { name: 'Retry Home summary' }));
    expect(await screen.findByText('Items you own')).toBeVisible();

    render(
      <HomeDashboard
        request={vi.fn<typeof readHome>().mockRejectedValue(new HomeRequestError(401, 'Sign in.'))}
      />,
    );
    expect(await screen.findByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login');
  });

  it('computes exact goal progress without floating-point money', () => {
    expect(goalProgress('9223372036854775807', '9223372036854775807', 'INR').percent).toBe(100);
    expect(goalProgress('1', '3', 'INR')).toEqual({
      percent: 33,
      text: 'INR 0.01 of INR 0.03 confirmed (33%)',
    });
    expect(goalProgress('500', '100', 'USD').percent).toBe(100);
    expect(goalProgress('500', '100', 'USD').text).toContain('(500%)');
  });
});
