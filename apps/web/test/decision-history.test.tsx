import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import type { Desire, ReviewEvent, ReviewHistoryPage, ItemListEntry } from '@havefolio/contracts';
import type * as DesiresClient from '../components/desires-client';
import { DecisionHistory } from '../components/decision-history';
import {
  getConversion,
  getDesire,
  readReviews,
  recordReview,
  reviewItems,
  DesireRequestError,
} from '../components/desires-client';
vi.mock('../components/desires-client', async (importOriginal) => {
  const actual = await importOriginal<typeof DesiresClient>();
  return {
    ...actual,
    getDesire: vi.fn(),
    readReviews: vi.fn(),
    recordReview: vi.fn(),
    reviewItems: vi.fn(),
    getConversion: vi.fn(),
  };
});
const d: Desire = {
  id: 'd1000000-0000-4000-a000-000000000001',
  name: 'Synthetic desire',
  classification: null,
  likelyPriceMinor: '101',
  currency: 'INR',
  productUrl: null,
  reason: null,
  status: 'considering',
  effectiveState: 'considering',
  waitingStartedAt: null,
  reviewAt: null,
  photo: null,
  revision: 1,
  createdAt: '2026-10-17T00:00:00.000Z',
  updatedAt: '2026-10-17T00:00:00.000Z',
};
const empty: ReviewHistoryPage = {
  items: [],
  nextBefore: null,
  currentEventId: null,
  estimatedNotSpentMinor: null,
  currency: null,
};
const event: ReviewEvent = {
  id: 'e1000000-0000-4000-a000-000000000001',
  sequence: 2,
  outcome: 'declined',
  occurredAt: '2026-10-17T08:00:00.000Z',
  note: null,
  linkedItemId: null,
  linkedItemName: null,
  reviewAt: null,
  supersedesEventId: null,
  estimatedNotSpentMinor: '101',
  currency: 'INR',
};
const load = async (): Promise<void> => {
  render(<DecisionHistory desireId={d.id} />);
  await screen.findByRole('heading', { name: 'Decision history' });
};
beforeEach(() => {
  vi.mocked(getDesire).mockResolvedValue(d);
  vi.mocked(readReviews).mockResolvedValue(empty);
  vi.mocked(recordReview).mockResolvedValue(event);
  vi.mocked(reviewItems).mockResolvedValue({ items: [], hasMore: false, nextCursor: null });
  vi.mocked(getConversion).mockRejectedValue(new Error('not requested in PER-28 tests'));
});
afterEach(() => vi.resetAllMocks());
describe('PER-29 optional inventory offer', () => {
  it('offers conversion after bought without blocking history, and links an existing item', async () => {
    vi.mocked(getDesire).mockResolvedValue({ ...d, status: 'bought', effectiveState: 'bought' });
    vi.mocked(getConversion).mockResolvedValueOnce({
      desireId: d.id,
      eligibility: 'eligible',
      boughtEventId: event.id,
      suggestions: {
        name: d.name,
        notes: null,
        productUrl: null,
        photo: null,
        likelyPriceMinor: null,
        likelyCurrency: null,
      },
      conversion: null,
    });
    const { unmount } = render(<DecisionHistory desireId={d.id} />);
    expect(
      await screen.findByRole('link', { name: 'Add to inventory (optional)' }),
    ).toHaveAttribute('href', `/wants/${d.id}/convert`);
    expect(screen.getByText(/bought decision is complete on its own/)).toBeInTheDocument();
    unmount();
    vi.mocked(getConversion).mockResolvedValueOnce({
      desireId: d.id,
      eligibility: 'converted',
      boughtEventId: null,
      suggestions: {
        name: d.name,
        notes: null,
        productUrl: null,
        photo: null,
        likelyPriceMinor: null,
        likelyCurrency: null,
      },
      conversion: {
        id: 'c1000000-0000-4000-a000-000000000001',
        desireId: d.id,
        itemId: 'i1000000-0000-4000-a000-000000000001',
        itemName: 'Synthetic owned item',
        boughtEventId: event.id,
        boughtOutcomeCurrent: false,
        photo: 'not_requested',
        createdAt: event.occurredAt,
      },
    });
    render(<DecisionHistory desireId={d.id} />);
    expect(await screen.findByRole('link', { name: 'Synthetic owned item' })).toHaveAttribute(
      'href',
      '/items/i1000000-0000-4000-a000-000000000001',
    );
  });
});
describe('PER-28 accessible decision history', () => {
  it('announces loading and empty history without inventing estimates', async () => {
    render(<DecisionHistory desireId={d.id} />);
    expect(screen.getByRole('status', { name: 'Loading decision history' })).toBeInTheDocument();
    await screen.findByText('No decisions recorded yet.');
    expect(screen.getByText('No current declined estimate')).toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: 'Outcome' })).toBeInTheDocument();
    expect(screen.getByLabelText('Private note (optional)')).toBeInTheDocument();
  });
  it('shows error and supports recovery from the initial load', async () => {
    vi.mocked(readReviews).mockRejectedValueOnce(new Error('unavailable'));
    render(<DecisionHistory desireId={d.id} />);
    await screen.findByRole('alert');
    // PER-36: the failed page keeps its level-one heading and a 44 px way back.
    expect(screen.getByRole('heading', { level: 1, name: 'Decision history' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to Wants' })).toHaveAttribute('href', '/wants');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByText('No decisions recorded yet.');
  });
  it('validates delayed dates before submitting', async () => {
    await load();
    const input = screen.getByLabelText('Next review (local date and time)');
    await userEvent.type(input, '2000-01-01T12:00');
    await userEvent.click(screen.getByRole('button', { name: 'Record decision' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('future');
    expect(recordReview).not.toHaveBeenCalled();
  });
  it.each(['Bought', 'Declined'])('submits %s without a purchase amount', async (label) => {
    await load();
    await userEvent.click(screen.getByRole('radio', { name: label }));
    await userEvent.type(screen.getByLabelText('Private note (optional)'), 'Private reflection');
    await userEvent.click(screen.getByRole('button', { name: 'Record decision' }));
    await screen.findByText('Decision recorded.');
    expect(recordReview).toHaveBeenCalledWith(
      d.id,
      expect.objectContaining({
        revision: 1,
        outcome: label.toLowerCase(),
        note: 'Private reflection',
        commandId: expect.any(String),
      }),
    );
    expect(vi.mocked(recordReview).mock.calls[0]![1]).not.toHaveProperty('likelyPriceMinor');
  });
  it('submits a delayed review with an explicit UTC timestamp', async () => {
    await load();
    await userEvent.type(
      screen.getByLabelText('Next review (local date and time)'),
      '2099-01-01T12:00',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Record decision' }));
    await screen.findByText('Decision recorded.');
    expect(recordReview).toHaveBeenCalledWith(
      d.id,
      expect.objectContaining({
        outcome: 'delayed',
        reviewAt: new Date('2099-01-01T12:00').toISOString(),
      }),
    );
  });
  it('submits use-owned with a selected owned item', async () => {
    vi.mocked(reviewItems).mockResolvedValue({
      items: [{ id: 'owned-item', name: 'Existing pair' } as ItemListEntry],
      hasMore: false,
      nextCursor: null,
    });
    await load();
    await userEvent.click(screen.getByRole('radio', { name: 'Using something already owned' }));
    await userEvent.click(screen.getByRole('button', { name: 'Choose from owned items' }));
    await userEvent.click(await screen.findByRole('radio', { name: 'Existing pair' }));
    await userEvent.click(screen.getByRole('button', { name: 'Record decision' }));
    await screen.findByText('Decision recorded.');
    expect(recordReview).toHaveBeenCalledWith(
      d.id,
      expect.objectContaining({ outcome: 'used_owned', linkedItemId: 'owned-item' }),
    );
  });
  it('keeps an uncertain command identical and locks its fields until retry resolves it', async () => {
    vi.mocked(recordReview).mockRejectedValueOnce(
      new DesireRequestError(0, 'NETWORK', 'Connection interrupted.'),
    );
    await load();
    await userEvent.click(screen.getByRole('radio', { name: 'Declined' }));
    await userEvent.click(screen.getByRole('button', { name: 'Record decision' }));
    await screen.findByText('Connection interrupted.');
    expect(screen.getByLabelText('Private note (optional)')).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Retry same decision' }));
    await screen.findByText('Decision recorded.');
    expect(vi.mocked(recordReview).mock.calls[0]).toEqual(vi.mocked(recordReview).mock.calls[1]);
  });
  it('reads corrections, missing linked items and estimates without adding snapshots', async () => {
    vi.mocked(getDesire).mockResolvedValue({
      ...d,
      status: 'declined',
      effectiveState: 'declined',
      revision: 3,
    });
    vi.mocked(readReviews).mockResolvedValue({
      ...empty,
      items: [
        {
          ...event,
          id: 'correction',
          sequence: 3,
          supersedesEventId: event.id,
          linkedItemId: 'missing',
        },
        event,
      ],
      currentEventId: 'correction',
      estimatedNotSpentMinor: '101',
      currency: 'INR',
    });
    await load();
    expect(screen.getByRole('list', { name: 'Decision timeline' })).toBeInTheDocument();
    expect(screen.getByText('Linked item: Item unavailable')).toBeInTheDocument();
    expect(screen.getByText(/Correction of event 2/)).toBeInTheDocument();
    expect(screen.getByText(/estimated not spent/)).toHaveTextContent('1.01');
    await userEvent.click(screen.getByRole('button', { name: 'Correct latest decision' }));
    await userEvent.click(screen.getByRole('radio', { name: 'Bought' }));
    await userEvent.click(screen.getByRole('button', { name: 'Record correction' }));
    await waitFor(() =>
      expect(recordReview).toHaveBeenCalledWith(
        d.id,
        expect.objectContaining({
          supersedesEventId: 'correction',
          revision: 3,
          outcome: 'bought',
        }),
      ),
    );
  });
  it('requires an owned item for use-owned and explains an empty owned inventory', async () => {
    await load();
    await userEvent.click(screen.getByRole('radio', { name: 'Using something already owned' }));
    await userEvent.click(screen.getByRole('button', { name: 'Record decision' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Choose an owned item');
    expect(recordReview).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Choose from owned items' }));
    await screen.findByText('No owned items on this page.');
  });
  it('loads older decisions on demand using the bounded sequence cursor', async () => {
    vi.mocked(readReviews)
      .mockResolvedValueOnce({ ...empty, items: [event], nextBefore: 2, currentEventId: event.id })
      .mockResolvedValueOnce(empty);
    await load();
    await userEvent.click(screen.getByRole('button', { name: 'Load earlier decisions' }));
    await waitFor(() => expect(readReviews).toHaveBeenLastCalledWith(d.id, 2));
  });
});
