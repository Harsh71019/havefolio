import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Desire, Goal, GoalContribution } from '@havefolio/contracts';
import * as api from '../components/goals-client';
import type * as DesiresClient from '../components/desires-client';
import { DesireRequestError, getDesire } from '../components/desires-client';
import { fetchOwnerPreferences } from '../components/settings-client';
import { GoalDetail } from '../components/goal-detail';
import { GoalForm } from '../components/goal-form';
import { GoalsList } from '../components/goals-list';
import { DesireGoalComparison } from '../components/desire-goal-comparison';
import {
  comparePriceWithGoal,
  effectiveEntryIds,
  exactPercent,
  goalProgressSummary,
  isCalendarDate,
  type PriceComparison,
} from '../components/goal-presentation';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
vi.mock('../components/goals-client', () => ({
  listGoals: vi.fn(),
  getGoal: vi.fn(),
  createGoal: vi.fn(),
  updateGoal: vi.fn(),
  deleteGoal: vi.fn(),
  goalContributions: vi.fn(),
  recordContribution: vi.fn(),
}));
vi.mock('../components/settings-client', () => ({ fetchOwnerPreferences: vi.fn() }));
vi.mock('../components/desires-client', async (original) => ({
  ...(await original<typeof DesiresClient>()),
  getDesire: vi.fn(),
}));

const ID = 'a1000000-0000-4000-a000-000000000032';
const goal: Goal = {
  id: ID,
  name: 'Synthetic trip',
  targetMinor: '4000000',
  currency: 'INR',
  targetDate: '2027-03-01',
  notes: null,
  status: 'active',
  revision: 3,
  progressMinor: '1000000',
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
};
const entry = (over: Partial<GoalContribution>): GoalContribution => ({
  id: 'c1',
  sequence: 2,
  kind: 'contribution',
  amountMinor: '1000000',
  currency: 'INR',
  supersedesId: null,
  note: null,
  createdAt: '2026-10-02T00:00:00Z',
  ...over,
});
const desire: Desire = {
  id: 'd1000000-0000-4000-a000-000000000032',
  name: 'Synthetic headphones',
  classification: null,
  likelyPriceMinor: '800000',
  currency: 'INR',
  productUrl: null,
  reason: null,
  status: 'active' as Desire['status'],
  effectiveState: 'considering',
  waitingStartedAt: null,
  reviewAt: null,
  photo: null,
  revision: 1,
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
};

beforeEach(() => {
  vi.mocked(api.listGoals).mockResolvedValue({ items: [goal], nextAfter: null });
  vi.mocked(api.getGoal).mockResolvedValue(goal);
  vi.mocked(api.goalContributions).mockResolvedValue({ items: [entry({})], nextBefore: null });
  vi.mocked(getDesire).mockResolvedValue(desire);
  vi.mocked(fetchOwnerPreferences).mockResolvedValue({
    defaultCurrency: 'INR',
    notifyInApp: true,
    notifyNtfy: false,
    revision: 1,
    updatedAt: '2026-10-01T00:00:00Z',
  });
});
afterEach(() => {
  vi.resetAllMocks();
  push.mockReset();
});

describe('PER-32 exact goal presentation', () => {
  it('formats exact large and over-target progress without floating point', () => {
    const huge = '92233720368547758070000'; // beyond bigint range: the API allows exact SUMs
    const view = goalProgressSummary({ progressMinor: huge, targetMinor: '100', currency: 'INR' });
    expect(view.bar).toBe(100);
    expect(view.text).toContain('₹92,23,37,20,36,85,47,75,80,700');
    expect(view.remaining).toMatch(/^Target amount reached, ₹/);
    expect(exactPercent(1n, 3n)).toBe('33.33');
    expect(exactPercent(9223372036854775807n, 1n)).toBe('92,23,37,20,36,85,47,75,80,700');
  });
  it('handles zero targets and exact remaining amounts', () => {
    expect(
      goalProgressSummary({ progressMinor: '500', targetMinor: '0', currency: 'INR' }),
    ).toEqual({ bar: null, text: '₹5 confirmed · no target amount set', remaining: null });
    expect(goalProgressSummary(goal)).toMatchObject({
      bar: 25,
      text: '₹10,000 of ₹40,000 confirmed (25%)',
      remaining: '₹30,000 still to go',
    });
  });
  it('compares only matching currencies with safe unknown and zero cases', () => {
    const p = (minor: string | null, currency: string | null = 'INR'): PriceComparison =>
      comparePriceWithGoal({ minor, currency }, goal);
    expect(p('800000')).toEqual({
      kind: 'percent',
      ofTarget: '20',
      coversTarget: false,
      ofRemaining: '26.66',
      remaining: '₹30,000',
    });
    expect(p('800000', 'USD')).toMatchObject({ kind: 'mismatch' });
    expect(p(null, null)).toEqual({ kind: 'unknown' });
    expect(p('0')).toEqual({ kind: 'zero-price' });
    expect(
      comparePriceWithGoal({ minor: '1', currency: 'INR' }, { ...goal, targetMinor: '0' }),
    ).toEqual({ kind: 'zero-target' });
    expect(p('5000000')).toMatchObject({ ofTarget: '125', coversTarget: true });
  });
  it('identifies effective ledger leaves and validates calendar dates', () => {
    const rows = [
      entry({ id: 'r', sequence: 4, kind: 'reversal', amountMinor: '0', supersedesId: 'k' }),
      entry({ id: 'k', sequence: 3, kind: 'correction', supersedesId: 'c1' }),
      entry({ id: 'other', sequence: 2 }),
      entry({}),
    ];
    expect([...effectiveEntryIds(rows)]).toEqual(['r', 'other']);
    expect(isCalendarDate('2028-02-29')).toBe(true);
    expect(isCalendarDate('2027-02-29')).toBe(false);
    expect(isCalendarDate('0000-01-01')).toBe(false);
  });
});

describe('PER-32 goal list', () => {
  it('shows text equivalents, filters by status and paginates', async () => {
    const user = userEvent.setup();
    vi.mocked(api.listGoals)
      .mockResolvedValueOnce({ items: [goal], nextAfter: ID })
      .mockResolvedValueOnce({ items: [{ ...goal, id: 'g2', name: 'Course' }], nextAfter: null })
      .mockResolvedValueOnce({ items: [], nextAfter: null });
    render(<GoalsList />);
    const bar = await screen.findByRole('progressbar');
    expect(bar).toHaveAccessibleName('Synthetic trip: ₹10,000 of ₹40,000 confirmed (25%)');
    await user.click(screen.getByRole('button', { name: 'Load more goals' }));
    expect(await screen.findByText('Course')).toBeInTheDocument();
    expect(api.listGoals).toHaveBeenLastCalledWith({ after: ID, status: null });
    await user.click(screen.getByRole('button', { name: 'Archived' }));
    expect(await screen.findByText('No archived goals.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Archived' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });
  it('offers a first action when empty and retries after offline errors', async () => {
    const user = userEvent.setup();
    vi.mocked(api.listGoals)
      .mockRejectedValueOnce(new DesireRequestError(0, 'NETWORK', 'Unable to connect.'))
      .mockResolvedValueOnce({ items: [], nextAfter: null });
    render(<GoalsList />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to connect.');
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('link', { name: 'Create your first goal' })).toHaveAttribute(
      'href',
      '/goals/new',
    );
  });
});

describe('PER-32 goal form', () => {
  it('creates with exact minor units and allows a zero target', async () => {
    const user = userEvent.setup();
    vi.mocked(api.createGoal).mockResolvedValue(goal);
    render(<GoalForm />);
    await user.type(screen.getByLabelText('Goal name'), '  Emergency fund ');
    await user.type(screen.getByLabelText('Target amount'), '0.015');
    await user.click(screen.getByRole('button', { name: 'Create goal' }));
    expect(screen.getByLabelText('Target amount')).toHaveAttribute('aria-invalid', 'true');
    expect(api.createGoal).not.toHaveBeenCalled();
    await user.clear(screen.getByLabelText('Target amount'));
    await user.type(screen.getByLabelText('Target amount'), '0');
    await user.click(screen.getByRole('button', { name: 'Create goal' }));
    expect(api.createGoal).toHaveBeenCalledWith({
      name: 'Emergency fund',
      targetMinor: '0',
      currency: 'INR',
      targetDate: null,
      notes: null,
    });
    expect(push).toHaveBeenCalledWith(`/goals/${ID}`);
  });
  it('keeps input and warns about duplicates after an ambiguous create failure', async () => {
    const user = userEvent.setup();
    vi.mocked(api.createGoal).mockRejectedValue(
      new DesireRequestError(0, 'NETWORK', 'Unable to connect.'),
    );
    render(<GoalForm />);
    await user.type(screen.getByLabelText('Goal name'), 'Trip');
    await user.type(screen.getByLabelText('Target amount'), '92233720368547758.08');
    await user.click(screen.getByRole('button', { name: 'Create goal' }));
    expect(screen.getByText('That amount is larger than Havefolio can store.')).toBeInTheDocument();
    await user.clear(screen.getByLabelText('Target amount'));
    await user.type(screen.getByLabelText('Target amount'), '92233720368547758.07');
    await user.click(screen.getByRole('button', { name: 'Create goal' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('may already have been created');
    expect(api.createGoal).toHaveBeenCalledWith(
      expect.objectContaining({ targetMinor: '9223372036854775807' }),
    );
    expect(screen.getByLabelText('Goal name')).toHaveValue('Trip');
  });
  it('locks currency after contributions and keeps edits through a stale revision', async () => {
    const user = userEvent.setup();
    const latest = { ...goal, revision: 5, name: 'Renamed elsewhere' };
    vi.mocked(api.getGoal).mockResolvedValueOnce(goal).mockResolvedValueOnce(latest);
    vi.mocked(api.updateGoal)
      .mockRejectedValueOnce(
        new DesireRequestError(409, 'STALE_GOAL_REVISION', 'The goal changed.'),
      )
      .mockResolvedValueOnce(latest);
    render(<GoalForm goalId={ID} />);
    expect(await screen.findByLabelText('Goal name')).toHaveValue('Synthetic trip');
    expect(screen.getByRole('combobox', { name: 'Currency' })).toBeDisabled();
    expect(screen.getByLabelText('Target amount')).toHaveValue('40000.00');
    await user.clear(screen.getByLabelText('Target amount'));
    await user.type(screen.getByLabelText('Target amount'), '50000');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Renamed elsewhere');
    expect(screen.getByLabelText('Target amount')).toHaveValue('50000');
    await user.click(screen.getByRole('button', { name: 'Save my edits over it' }));
    await waitFor(() => expect(api.updateGoal).toHaveBeenCalledTimes(2));
    const second = vi.mocked(api.updateGoal).mock.calls[1]![1];
    expect(second).toMatchObject({ revision: 5, targetMinor: '5000000' });
    expect(second).not.toHaveProperty('currency');
  });
});

describe('PER-32 goal detail and ledger', () => {
  it('records a contribution only after confirmation and retries the identical command', async () => {
    const user = userEvent.setup();
    vi.mocked(api.recordContribution)
      .mockRejectedValueOnce(new DesireRequestError(503, 'GOALS_UNAVAILABLE', 'Unavailable.'))
      .mockResolvedValueOnce(entry({ id: 'new' }));
    render(<GoalDetail goalId={ID} />);
    expect(await screen.findByRole('progressbar')).toHaveAccessibleName(
      '₹10,000 of ₹40,000 confirmed (25%)',
    );
    await user.click(screen.getByRole('button', { name: 'Record a contribution' }));
    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveTextContent('No transfer, deposit or investment happens');
    await user.type(within(dialog).getByLabelText(/Amount/), '2500.50');
    await user.click(within(dialog).getByRole('button', { name: 'Confirm' }));
    expect(await within(dialog).findByRole('button', { name: 'Retry' })).toBeEnabled();
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(within(dialog).getByLabelText(/Amount/)).toBeDisabled();
    await user.click(within(dialog).getByRole('button', { name: 'Retry' }));
    const [a, b] = vi.mocked(api.recordContribution).mock.calls;
    expect(b).toEqual(a);
    expect(a![1]).toMatchObject({
      kind: 'contribution',
      amountMinor: '250050',
      currency: 'INR',
      revision: 3,
    });
    expect(await screen.findByRole('status')).toHaveTextContent('no money was moved');
  });
  it('appends corrections and reversals to the effective leaf, keeping history', async () => {
    const user = userEvent.setup();
    vi.mocked(api.goalContributions).mockResolvedValue({
      items: [
        entry({
          id: 'k',
          sequence: 3,
          kind: 'correction',
          amountMinor: '600000',
          supersedesId: 'c1',
        }),
        entry({}),
      ],
      nextBefore: 2,
    });
    vi.mocked(api.recordContribution).mockResolvedValue(entry({ id: 'r' }));
    render(<GoalDetail goalId={ID} />);
    const list = await screen.findByRole('list', { name: 'Contribution history' });
    const items = within(list).getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('Counts toward progress');
    expect(items[1]).toHaveTextContent('Replaced');
    expect(within(items[1]!).queryByRole('button')).not.toBeInTheDocument();
    await user.click(within(items[0]!).getByRole('button', { name: 'Reverse' }));
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(api.recordContribution).toHaveBeenCalledWith(
      ID,
      expect.objectContaining({ kind: 'reversal', amountMinor: '0', supersedesId: 'k' }),
    );
    await user.click(await screen.findByRole('button', { name: 'Load earlier entries' }));
    expect(api.goalContributions).toHaveBeenLastCalledWith(ID, { before: 2 });
  });
  it('reloads the revision after a stale ledger write and keeps the typed amount', async () => {
    const user = userEvent.setup();
    vi.mocked(api.recordContribution).mockRejectedValueOnce(
      new DesireRequestError(409, 'STALE_GOAL_REVISION', 'The goal changed.'),
    );
    vi.mocked(api.getGoal)
      .mockResolvedValueOnce(goal)
      .mockResolvedValue({ ...goal, revision: 4 });
    render(<GoalDetail goalId={ID} />);
    await user.click(await screen.findByRole('button', { name: 'Record a contribution' }));
    await user.type(screen.getByLabelText(/Amount/), '100');
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(await screen.findByText(/review and confirm again/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Amount/)).toHaveValue('100');
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    const [first, second] = vi.mocked(api.recordContribution).mock.calls;
    expect(second![1].revision).toBe(4);
    expect(second![1].commandId).not.toBe(first![1].commandId);
  });
  it('pauses ledger writes for archived goals and offers restore', async () => {
    const user = userEvent.setup();
    vi.mocked(api.getGoal).mockResolvedValue({ ...goal, status: 'archived' });
    vi.mocked(api.updateGoal).mockResolvedValue({ ...goal, revision: 4 });
    render(<GoalDetail goalId={ID} />);
    expect(await screen.findByText(/Restore this goal to record/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Record a contribution' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reverse' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Restore' }));
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Restore' }),
    );
    expect(api.updateGoal).toHaveBeenCalledWith(ID, { revision: 3, status: 'active' });
    expect(
      await screen.findByRole('button', { name: 'Record a contribution' }),
    ).toBeInTheDocument();
  });
  it('archives or deletes only after explicit confirmation', async () => {
    const user = userEvent.setup();
    vi.mocked(api.deleteGoal).mockResolvedValue(undefined);
    render(<GoalDetail goalId={ID} />);
    await user.click(await screen.findByRole('button', { name: 'Delete goal' }));
    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveTextContent('archive the goal instead');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(api.deleteGoal).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Delete goal' }));
    await user.click(screen.getByRole('button', { name: 'Delete permanently' }));
    expect(api.deleteGoal).toHaveBeenCalledWith(ID, 3);
    expect(push).toHaveBeenCalledWith('/goals');
  });
  it('treats a foreign or deleted goal as unavailable', async () => {
    vi.mocked(api.getGoal).mockRejectedValue(
      new DesireRequestError(
        404,
        'GOAL_NOT_FOUND',
        'This goal is unavailable. It may have been deleted.',
      ),
    );
    render(<GoalDetail goalId={ID} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('This goal is unavailable');
    expect(screen.getByRole('link', { name: 'Back to Goals' })).toBeInTheDocument();
  });
});

describe('PER-32 desire-side money alternatives', () => {
  it('compares a likely price hypothetically without implying a saving', async () => {
    const user = userEvent.setup();
    vi.mocked(api.listGoals).mockResolvedValue({
      items: [
        goal,
        { ...goal, id: 'usd', name: 'Dollar goal', currency: 'USD' },
        { ...goal, id: 'zero', name: 'Open-ended', targetMinor: '0' },
        { ...goal, id: 'arch', name: 'Old goal', status: 'archived' },
      ],
      nextAfter: null,
    });
    render(<DesireGoalComparison desireId={desire.id} />);
    expect(await screen.findByRole('radio', { name: /Dollar goal/ })).toBeDisabled();
    expect(screen.getByRole('radio', { name: /Old goal/ })).toBeDisabled();
    await user.click(screen.getByRole('radio', { name: /Synthetic trip/ }));
    const text = screen.getByText(/could cover 20% of the ₹40,000 target/);
    expect(text).toHaveTextContent('26.66% of the ₹30,000 still to go');
    expect(screen.getByText(/This is a possibility, not a saving/)).toHaveTextContent(
      'stays at ₹10,000',
    );
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: /Open-ended/ }));
    expect(screen.getByText(/no target amount, so no percentage/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/NaN|Infinity|saved ₹|you saved/i);
    expect(api.recordContribution).not.toHaveBeenCalled();
  });
  it('handles unknown prices and links declined wants to explicit allocation', async () => {
    vi.mocked(getDesire).mockResolvedValue({
      ...desire,
      likelyPriceMinor: null,
      currency: null,
      effectiveState: 'declined',
    });
    render(<DesireGoalComparison desireId={desire.id} />);
    expect(await screen.findByText('No likely price recorded')).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('radio', { name: /Synthetic trip/ }));
    expect(screen.getByText(/No likely price is recorded/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Review goal allocation' })).toHaveAttribute(
      'href',
      `/wants/${desire.id}/allocate`,
    );
  });
});
