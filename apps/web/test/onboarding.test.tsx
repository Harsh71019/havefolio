import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { OnboardingStatus } from '@havefolio/contracts';
import { onboardingRequest } from '../components/onboarding-client';
import { Onboarding } from '../components/onboarding';
import { DemoItemDetails } from '../components/demo-item-details';
import type { ItemResponse } from '@havefolio/contracts';
const initial: OnboardingStatus = {
  state: 'not_started',
  genuineItemCount: 0,
  demoItemCount: 0,
  browsedStore: false,
  reviewedItem: false,
  triedDemo: false,
  removedDemo: false,
};
const makeRequest = (
  overrides: Partial<OnboardingStatus> = {},
): ReturnType<typeof vi.fn<typeof onboardingRequest>> => {
  let status = { ...initial, ...overrides };
  return vi.fn<typeof onboardingRequest>(async (action = 'read') => {
    await Promise.resolve();
    if (action === 'demo')
      status = { ...status, state: 'active', demoItemCount: 6, triedDemo: true };
    if (action === 'remove') status = { ...status, demoItemCount: 0, removedDemo: true };
    if (action === 'skip') status = { ...status, state: 'skipped' };
    if (action === 'complete') status = { ...status, state: 'completed' };
    if (action === 'revisit') status = { ...status, state: 'active' };
    return status;
  });
};
describe('private welcome experience', () => {
  it('keeps manual entry primary, demo optional and every disclosure explicit', async () => {
    const request = makeRequest();
    render(<Onboarding request={request} />);
    expect(await screen.findByRole('link', { name: 'Add my first item' })).toHaveAttribute(
      'href',
      '/items/new',
    );
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith('read');
    expect(
      screen.getByText(/fictional, read-only examples, excluded from real spending/),
    ).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Explore optional demo inventory' }));
    expect(request).toHaveBeenCalledWith('demo');
    expect(screen.getByRole('link', { name: 'Add my first item' })).toBeVisible();
    expect(
      within(screen.getByRole('list', { name: 'Welcome checklist' })).getByText(
        /○ Add a genuine item/,
      ),
    ).toBeVisible();
  });
  it('persists skip, offers deliberate revisiting and keeps the genuine first-item prompt', async () => {
    const request = makeRequest();
    render(<Onboarding request={request} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Skip for now' }));
    expect(
      screen.queryByRole('heading', { name: 'Make yourself at home' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Add your first genuine item' })).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Revisit welcome help' }));
    expect(await screen.findByRole('heading', { name: 'Make yourself at home' })).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss checklist' }));
    expect(request).toHaveBeenCalledWith('complete');
  });
  it('confirms remove-all with keyboard, announces success and never sends a genuine delete', async () => {
    const request = makeRequest({
      demoItemCount: 6,
      genuineItemCount: 1,
      triedDemo: true,
      state: 'active',
    });
    render(<Onboarding store request={request} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Remove all demo data' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/genuine items and categories will stay/)).toBeVisible();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Keep demos' }));
    expect(request).not.toHaveBeenCalledWith('remove');
    await userEvent.click(screen.getByRole('button', { name: 'Remove all demo data' }));
    within(screen.getByRole('dialog')).getByRole('button', { name: 'Remove demos' }).focus();
    await userEvent.keyboard('{Enter}');
    expect(
      await screen.findByText('Demo inventory removed. Your genuine items are unchanged.'),
    ).toBeVisible();
    expect(request).toHaveBeenCalledWith('remove');
    expect(screen.queryByRole('button', { name: 'Remove all demo data' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Add an item' })).toBeVisible();
  });
  it('retains an independent manual path on network failure', async () => {
    const request = vi.fn().mockRejectedValue(new Error('offline'));
    render(<Onboarding request={request} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Manual entry is available');
    expect(screen.getByRole('link', { name: 'Add an item' })).toHaveAttribute('href', '/items/new');
  });
  it('shows honest read-only example details with no lifecycle, editing, refund or upload actions', () => {
    const item = {
      isDemo: true,
      name: 'Sample kettle',
      pricePaidMinor: '10000',
      currency: 'INR',
      acquisitionType: 'bought',
      ownershipStatus: 'owned',
      purchaseDate: { precision: 'unknown' },
      condition: 'working',
      useFrequency: 'often',
    } as ItemResponse;
    render(<DemoItemDetails item={item} returnTo="/store" />);
    expect(screen.getByText('Demo · read-only example')).toBeVisible();
    expect(screen.getByText('Example amount')).toBeVisible();
    expect(screen.getByText(/No photos, receipts or warranties/)).toBeVisible();
    expect(
      screen.queryByRole('button', { name: /Edit|Delete|Refund|Upload/ }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Add my own item' })).toHaveAttribute(
      'href',
      '/items/new',
    );
  });
});
