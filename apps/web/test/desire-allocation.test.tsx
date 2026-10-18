import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AllocationGoal, DesireAllocationState } from '@havefolio/contracts';
import { DesireAllocationFlow } from '../components/desire-allocation';
import * as api from '../components/allocations-client';
import { DesireRequestError } from '../components/desires-client';
vi.mock('../components/allocations-client', () => ({
  allocationState: vi.fn(),
  allocationGoals: vi.fn(),
  allocationHistory: vi.fn(),
  confirmAllocation: vi.fn(),
  correctAllocation: vi.fn(),
}));
const goal: AllocationGoal = {
  id: 'goal',
  name: 'Synthetic trip',
  targetMinor: '4000000',
  progressMinor: '0',
  currency: 'INR',
  status: 'active',
  revision: 1,
};
const initial: DesireAllocationState = {
  currentReviewEventId: 'event',
  estimatedNotSpentMinor: '800000',
  currency: 'INR',
  allocation: null,
};
const entry = {
  id: 'entry',
  sequence: 2,
  kind: 'contribution',
  amountMinor: '800000',
  currency: 'INR',
  supersedesId: null,
  note: null,
  createdAt: '2026-10-18T01:00:00Z',
};
const allocated: DesireAllocationState = {
  ...initial,
  allocation: {
    sourceReviewEventId: 'event',
    sourceChanged: false,
    goal: { ...goal, revision: 2, progressMinor: '800000' },
    rootContributionId: 'entry',
    currentContribution: entry,
  },
};
beforeEach(() => {
  vi.mocked(api.allocationState).mockResolvedValue(initial);
  vi.mocked(api.allocationGoals).mockResolvedValue({ items: [goal], nextAfter: null });
  vi.mocked(api.confirmAllocation).mockResolvedValue(allocated);
  vi.mocked(api.allocationHistory).mockResolvedValue({ items: [entry], nextBefore: null });
});
afterEach(() => vi.resetAllMocks());
describe('PER-31 desire-side owner confirmation', () => {
  it('loads, previews 20% and leaves progress unchanged until explicit confirmation', async () => {
    const user = userEvent.setup();
    render(<DesireAllocationFlow desireId="source" />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading allocation');
    await user.click(await screen.findByRole('radio', { name: /Synthetic trip/ }));
    expect(screen.getByText(/could cover 20%/)).toHaveTextContent('Confirmed progress remains ₹0');
    expect(api.confirmAllocation).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Allocate' }));
    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveTextContent('No bank transfer, deposit or investment occurs');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(api.confirmAllocation).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Allocate' }));
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Confirm allocation' }),
    );
    expect(await screen.findByText(/allocated to Synthetic trip/)).toBeInTheDocument();
    expect(api.confirmAllocation).toHaveBeenCalledWith(
      'source',
      expect.objectContaining({
        confirmed: true,
        goalRevision: 1,
        reviewEventId: 'event',
        goalId: 'goal',
      }),
    );
  });
  it('retains the exact command after ambiguous failure and disables edits while saving', async () => {
    const user = userEvent.setup();
    vi.mocked(api.confirmAllocation).mockRejectedValueOnce(
      new DesireRequestError(0, 'NETWORK', 'Unable to connect.'),
    );
    render(<DesireAllocationFlow desireId="source" />);
    await user.click(await screen.findByRole('radio', { name: /Synthetic trip/ }));
    await user.click(screen.getByRole('button', { name: 'Allocate' }));
    await user.click(screen.getByRole('button', { name: 'Confirm allocation' }));
    const retry = await screen.findByRole('button', { name: 'Retry confirmation' });
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    const body = vi.mocked(api.confirmAllocation).mock.calls[0]![1];
    await user.click(retry);
    expect(vi.mocked(api.confirmAllocation).mock.calls[1]![1]).toEqual(body);
    expect(await screen.findByText(/allocated to Synthetic trip/)).toBeInTheDocument();
  });
  it('explains zero targets without division and disables mismatched/archived goals', async () => {
    const user = userEvent.setup();
    vi.mocked(api.allocationGoals).mockResolvedValue({
      items: [
        { ...goal, targetMinor: '0' },
        { ...goal, id: 'usd', name: 'Dollar goal', currency: 'USD' },
        { ...goal, id: 'archive', name: 'Archived goal', status: 'archived' },
      ],
      nextAfter: null,
    });
    render(<DesireAllocationFlow desireId="source" />);
    await user.click(await screen.findByRole('radio', { name: /Synthetic trip/ }));
    expect(screen.getByText(/zero target. No percentage/)).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Dollar goal/ })).toBeDisabled();
    expect(screen.getByRole('radio', { name: /Archived goal/ })).toBeDisabled();
    expect(screen.queryByText(/NaN|Infinity/)).not.toBeInTheDocument();
  });
  it.each([null, '0'])('keeps unknown and explicit zero estimates safe (%s)', async (amount) => {
    vi.mocked(api.allocationState).mockResolvedValue({
      ...initial,
      estimatedNotSpentMinor: amount,
    });
    render(<DesireAllocationFlow desireId="source" />);
    await screen.findByText('Estimated amount not spent');
    expect(screen.getByRole('button', { name: 'Allocate' })).toBeDisabled();
    expect(
      screen.getByText(
        amount === null
          ? 'No known current declined estimate'
          : 'The estimate is explicitly zero. There is no positive amount to allocate.',
      ),
    ).toBeInTheDocument();
  });
  it('supports explicit correction, reversal and auditable history while flagging changed decisions', async () => {
    const user = userEvent.setup();
    vi.mocked(api.allocationState).mockResolvedValue({
      ...allocated,
      allocation: { ...allocated.allocation!, sourceChanged: true },
    });
    render(<DesireAllocationFlow desireId="source" />);
    await screen.findByText(/source decision changed/);
    await user.click(screen.getByRole('button', { name: 'View allocation history' }));
    expect(await screen.findByRole('list', { name: 'Allocation history' })).toHaveTextContent(
      'Initial confirmation',
    );
    await user.click(screen.getByRole('button', { name: 'Correct amount' }));
    const amount = screen.getByLabelText('Replacement amount (INR)');
    await user.clear(amount);
    await user.type(amount, '5000.01');
    await user.click(screen.getByRole('button', { name: 'Confirm correction' }));
    await screen.findByText(
      'Confirmation recorded. No money was transferred, deposited or invested.',
    );
    expect(api.correctAllocation).toHaveBeenCalledWith(
      'goal',
      expect.objectContaining({
        kind: 'correction',
        amountMinor: '500001',
        supersedesId: 'entry',
        revision: 2,
      }),
    );
    await user.click(screen.getByRole('button', { name: 'Reverse allocation' }));
    await user.click(screen.getByRole('button', { name: 'Confirm reversal' }));
    expect(api.correctAllocation).toHaveBeenLastCalledWith(
      'goal',
      expect.objectContaining({ kind: 'reversal', amountMinor: '0' }),
    );
  });
  it('preserves archived and explicitly deleted goal states', async () => {
    vi.mocked(api.allocationState).mockResolvedValue({
      ...allocated,
      allocation: {
        ...allocated.allocation!,
        goal: { ...allocated.allocation!.goal!, status: 'archived' },
      },
    });
    const mounted = render(<DesireAllocationFlow desireId="source" />);
    await screen.findByText(/This goal is archived/);
    expect(screen.queryByRole('button', { name: 'Reverse allocation' })).not.toBeInTheDocument();
    mounted.unmount();
    vi.mocked(api.allocationState).mockResolvedValue({
      ...allocated,
      allocation: {
        ...allocated.allocation!,
        goal: null,
        currentContribution: null,
        rootContributionId: null,
      },
    });
    render(<DesireAllocationFlow desireId="source" />);
    expect(await screen.findByText(/allocated goal was explicitly deleted/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Allocate' })).not.toBeInTheDocument();
  });
  it('offers reload after load failure and ignores private server details', async () => {
    const user = userEvent.setup();
    vi.mocked(api.allocationState).mockRejectedValueOnce(new Error('private transport detail'));
    render(<DesireAllocationFlow desireId="source" />);
    expect(await screen.findByRole('alert')).not.toHaveTextContent('private transport detail');
    await user.click(screen.getByRole('button', { name: 'Reload latest details' }));
    expect(await screen.findByText('Estimated amount not spent')).toBeInTheDocument();
  });
});
