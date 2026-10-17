import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import type {
  CreateReviewRequest,
  Desire,
  DesireMatch,
  DesireMatchesPage,
  ItemResponse,
  ReviewEvent,
  ReviewHistoryPage,
} from '@havefolio/contracts';
import type * as DesiresClient from '../components/desires-client';
import type * as ItemsClient from '../components/items-client';
import { DesireCompare } from '../components/desire-compare';
import {
  getDesire,
  getDesireMatches,
  readReviews,
  recordReview,
  reviewItems,
  DesireRequestError,
} from '../components/desires-client';
import { readItem } from '../components/items-client';

vi.mock('../components/desires-client', async (importOriginal) => {
  const actual = await importOriginal<typeof DesiresClient>();
  return {
    ...actual,
    getDesire: vi.fn(),
    getDesireMatches: vi.fn(),
    readReviews: vi.fn(),
    recordReview: vi.fn(),
    reviewItems: vi.fn(),
  };
});

vi.mock('../components/items-client', async (importOriginal) => {
  const actual = await importOriginal<typeof ItemsClient>();
  return {
    ...actual,
    readItem: vi.fn(),
  };
});

const sampleDesire: Desire = {
  id: 'd1000000-0000-4000-a000-000000000001',
  name: 'Noise-canceling headphones',
  classification: 'want',
  likelyPriceMinor: '1499900',
  currency: 'INR',
  productUrl: 'https://example.com/headphones',
  reason: 'For quiet work during travel and flights.',
  status: 'considering',
  effectiveState: 'considering',
  waitingStartedAt: null,
  reviewAt: null,
  photo: null,
  revision: 2,
  createdAt: '2026-10-10T00:00:00.000Z',
  updatedAt: '2026-10-10T00:00:00.000Z',
};

const sampleReviewHistory: ReviewHistoryPage = {
  items: [],
  nextBefore: null,
  currentEventId: null,
  estimatedNotSpentMinor: null,
  currency: null,
};

const sampleItem1: ItemResponse = {
  isDemo: false,
  id: 'i1000000-0000-4000-a000-000000000001',
  name: 'Everyday wired earphones',
  ownershipStatus: 'owned',
  currency: 'INR',
  pricePaidMinor: '249900',
  purchaseDate: {
    precision: 'exact',
    year: 2024,
    month: 10,
    day: 15,
  },
  acquisitionType: 'bought',
  condition: 'working',
  useFrequency: 'often',
  categoryId: 'c1000000-0000-4000-a000-000000000001',
  subcategoryId: null,
  tagIds: [],
  brand: 'AudioTech',
  model: 'AT-100',
  description: 'Good everyday earphones.',
  notes: null,
  specifications: null,
  revision: 1,
  createdAt: '2024-10-15T00:00:00.000Z',
  updatedAt: '2024-10-15T00:00:00.000Z',
  originalEntry: {},
  originalSource: 'manual',
};

const sampleMatch1: DesireMatch = {
  id: 'm1000000-0000-4000-a000-000000000001',
  desireId: sampleDesire.id,
  itemId: sampleItem1.id,
  reason: 'Similar audio accessory used daily.',
  relevance: 'relevant',
  source: 'manual',
  item: {
    id: sampleItem1.id,
    name: sampleItem1.name,
    brand: sampleItem1.brand,
    model: sampleItem1.model,
    ownershipStatus: 'owned',
    condition: 'working',
    useFrequency: 'often',
    categoryId: sampleItem1.categoryId,
    categoryName: 'Electronics',
    subcategoryId: null,
    subcategoryName: null,
    tags: ['audio'],
    cover: null,
    isUsableAlternative: true,
  },
  hints: {
    categoryHint: 'Same category: Electronics',
    usageHint: 'Usage: Often used',
    conditionHint: 'Condition: Working',
    traitHints: ['audio'],
  },
  createdAt: '2026-10-11T00:00:00.000Z',
  updatedAt: '2026-10-11T00:00:00.000Z',
};

const sampleItem2NeedsRepair: ItemResponse = {
  isDemo: false,
  id: 'i2000000-0000-4000-a000-000000000002',
  name: 'Old wireless headset',
  ownershipStatus: 'owned',
  currency: 'INR',
  pricePaidMinor: null, // Unknown price
  purchaseDate: {
    precision: 'year',
    year: 2023,
    month: null,
    day: null,
  },
  acquisitionType: 'gift',
  condition: 'needs_repair',
  useFrequency: 'rarely',
  categoryId: 'c1000000-0000-4000-a000-000000000001',
  subcategoryId: null,
  tagIds: [],
  brand: 'SoundPro',
  model: 'BT-50',
  description: 'Loose headband and battery needs replacement.',
  notes: null,
  specifications: null,
  revision: 1,
  createdAt: '2023-01-01T00:00:00.000Z',
  updatedAt: '2023-01-01T00:00:00.000Z',
  originalEntry: {},
  originalSource: 'manual',
};

const sampleMatch2: DesireMatch = {
  id: 'm2000000-0000-4000-a000-000000000002',
  desireId: sampleDesire.id,
  itemId: sampleItem2NeedsRepair.id,
  reason: 'Wireless audio headset that could be repaired.',
  relevance: 'relevant',
  source: 'manual',
  item: {
    id: sampleItem2NeedsRepair.id,
    name: sampleItem2NeedsRepair.name,
    brand: sampleItem2NeedsRepair.brand,
    model: sampleItem2NeedsRepair.model,
    ownershipStatus: 'owned',
    condition: 'needs_repair',
    useFrequency: 'rarely',
    categoryId: sampleItem2NeedsRepair.categoryId,
    categoryName: 'Electronics',
    subcategoryId: null,
    subcategoryName: null,
    tags: ['wireless'],
    cover: null,
    isUsableAlternative: true,
  },
  hints: {
    categoryHint: 'Same category: Electronics',
    usageHint: 'Usage: Rarely used',
    conditionHint: 'Condition: Needs repair',
    traitHints: ['wireless'],
  },
  createdAt: '2026-10-12T00:00:00.000Z',
  updatedAt: '2026-10-12T00:00:00.000Z',
};

const sampleMatchesPage: DesireMatchesPage = {
  items: [sampleMatch1, sampleMatch2],
  nextCursor: null,
  hasMore: false,
  totalCount: 2,
};

const recordedReviewResult: ReviewEvent = {
  id: 'e1000000-0000-4000-a000-000000000001',
  sequence: 3,
  outcome: 'used_owned',
  occurredAt: '2026-10-17T08:00:00.000Z',
  note: 'Will use my existing earphones for now.',
  linkedItemId: sampleItem1.id,
  linkedItemName: sampleItem1.name,
  reviewAt: null,
  supersedesEventId: null,
  estimatedNotSpentMinor: null,
  currency: null,
};

beforeEach(() => {
  vi.mocked(getDesire).mockResolvedValue(sampleDesire);
  vi.mocked(getDesireMatches).mockResolvedValue(sampleMatchesPage);
  vi.mocked(readReviews).mockResolvedValue(sampleReviewHistory);
  vi.mocked(readItem).mockImplementation((id: string) => {
    if (id === sampleItem1.id) return Promise.resolve(sampleItem1);
    if (id === sampleItem2NeedsRepair.id) return Promise.resolve(sampleItem2NeedsRepair);
    return Promise.reject(new DesireRequestError(404, 'ITEM_NOT_FOUND', 'Item not found'));
  });
  vi.mocked(recordReview).mockResolvedValue(recordedReviewResult);
  vi.mocked(reviewItems).mockResolvedValue({ items: [], nextCursor: null, hasMore: false });
});

afterEach(() => {
  vi.resetAllMocks();
});

describe('PER-26: Compare-before-buying decision screen', () => {
  it('renders loading state, accessible title, and announces loaded comparison', async () => {
    render(<DesireCompare desireId={sampleDesire.id} />);
    expect(screen.getByRole('status', { name: 'Loading comparison' })).toBeInTheDocument();

    await screen.findByRole('heading', { name: sampleDesire.name });
    expect(screen.getByText(/Likely price: ₹14,999/)).toBeInTheDocument();
    expect(screen.getByText('For quiet work during travel and flights.')).toBeInTheDocument();
  });

  it('handles load failures and supports recovery with retry button', async () => {
    vi.mocked(getDesire).mockRejectedValueOnce(
      new DesireRequestError(
        503,
        'DESIRES_UNAVAILABLE',
        'The desires service is temporarily unavailable.',
      ),
    );

    render(<DesireCompare desireId={sampleDesire.id} />);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('The desires service is temporarily unavailable.');

    const retryBtn = screen.getByRole('button', { name: /Retry loading/i });
    await userEvent.click(retryBtn);

    await screen.findByRole('heading', { name: sampleDesire.name });
  });

  it('displays neutral comparison guidance without assuming category implies unneeded', async () => {
    render(<DesireCompare desireId={sampleDesire.id} />);
    await screen.findByRole('heading', { name: sampleDesire.name });

    expect(
      screen.getByText(
        /Owning something in the same category does not mean this purchase is unnecessary/,
      ),
    ).toBeInTheDocument();
  });

  it('represents prices honestly, handling gifts and unknown amounts without inventing data', async () => {
    render(<DesireCompare desireId={sampleDesire.id} />);
    await screen.findByRole('heading', { name: sampleDesire.name });

    // Item 1 has known price
    expect(screen.getAllByText('Everyday wired earphones').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('₹2,499')).toBeInTheDocument();

    // Item 2 is a gift with unknown amount -> shows Gift, no amount
    expect(screen.getAllByText('Old wireless headset').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/Gift, no amount/i)).toBeInTheDocument();
  });

  it('represents purchase dates honestly with exact and year-only precision, never inventing days', async () => {
    render(<DesireCompare desireId={sampleDesire.id} />);
    await screen.findByRole('heading', { name: sampleDesire.name });

    // Item 1 has exact date: 15 Oct 2024
    expect(screen.getByText(/15 Oct 2024/i)).toBeInTheDocument();

    // Item 2 has year-only date: 2023 -> shows "2023 · about" without exact day or month
    expect(screen.getByText(/2023 · about/i)).toBeInTheDocument();
  });

  it('prompts what the desired product would do differently', async () => {
    render(<DesireCompare desireId={sampleDesire.id} />);
    await screen.findByRole('heading', { name: sampleDesire.name });

    expect(screen.getByLabelText(/What would this product do differently\?/i)).toBeInTheDocument();
  });

  it('records decision: "Use something already owned" with linked item and reflection note', async () => {
    render(<DesireCompare desireId={sampleDesire.id} />);
    await screen.findByRole('heading', { name: sampleDesire.name });

    // Type reflection note
    const noteInput = screen.getByLabelText(/What would this product do differently\?/i);
    await userEvent.type(noteInput, 'My wired earphones work well enough for now.');

    // Select "Use something already owned" action
    const useActionRadio = screen.getByLabelText(/Use something already owned/i);
    await userEvent.click(useActionRadio);

    // Click submit
    const submitBtn = screen.getByRole('button', { name: /^Record decision$/i });
    await userEvent.click(submitBtn);

    await waitFor(() => {
      expect(recordReview).toHaveBeenCalledWith(
        sampleDesire.id,
        expect.objectContaining({
          outcome: 'used_owned',
          linkedItemId: sampleItem1.id,
          note: 'My wired earphones work well enough for now.',
          revision: sampleDesire.revision,
          commandId: expect.any(String),
        }),
      );
    });

    // Check success confirmation
    expect(
      (await screen.findAllByText(/Decision recorded: used_owned/i)).length,
    ).toBeGreaterThanOrEqual(1);
  });

  it('records decision: "Repair an owned item" with repair prefix and linked item', async () => {
    render(<DesireCompare desireId={sampleDesire.id} />);
    await screen.findByRole('heading', { name: sampleDesire.name });

    // Select "Repair an owned item"
    const repairRadio = screen.getByLabelText(/Repair an owned item/i);
    await userEvent.click(repairRadio);

    // Select the broken headset
    const item2Btn = screen.getByRole('button', { name: /Old wireless headset/i });
    await userEvent.click(item2Btn);

    // Type reflection note
    const noteInput = screen.getByLabelText(/What would this product do differently\?/i);
    await userEvent.type(noteInput, 'Replacing the battery is much cheaper.');

    // Submit
    const submitBtn = screen.getByRole('button', { name: /^Record decision$/i });
    await userEvent.click(submitBtn);

    await waitFor(() => {
      expect(recordReview).toHaveBeenCalledWith(
        sampleDesire.id,
        expect.objectContaining({
          outcome: 'used_owned',
          linkedItemId: sampleItem2NeedsRepair.id,
          note: expect.stringContaining('Repair decision: Replacing the battery is much cheaper.'),
        }),
      );
    });
  });

  it('records decision: "Replace an owned item" with replacement prefix and bought outcome', async () => {
    render(<DesireCompare desireId={sampleDesire.id} />);
    await screen.findByRole('heading', { name: sampleDesire.name });

    // Select "Replace an owned item"
    const replaceRadio = screen.getByLabelText(/Replace an owned item/i);
    await userEvent.click(replaceRadio);

    // Select item 2 as the item being replaced
    const item2Btn = screen.getByRole('button', { name: /Old wireless headset/i });
    await userEvent.click(item2Btn);

    const submitBtn = screen.getByRole('button', { name: /^Record decision$/i });
    await userEvent.click(submitBtn);

    await waitFor(() => {
      expect(recordReview).toHaveBeenCalledWith(
        sampleDesire.id,
        expect.objectContaining({
          outcome: 'bought',
          linkedItemId: sampleItem2NeedsRepair.id,
          note: expect.stringContaining(
            'Replacement decision: Buying to replace an existing possession.',
          ),
        }),
      );
    });
  });

  it('records decision: "Wait and choose another review date" with future date validation', async () => {
    render(<DesireCompare desireId={sampleDesire.id} />);
    await screen.findByRole('heading', { name: sampleDesire.name });

    // Select "Wait and choose another review date"
    const waitRadio = screen.getByLabelText(/Wait and choose another review date/i);
    await userEvent.click(waitRadio);

    // Click 7 days preset
    const preset7d = screen.getByRole('button', { name: '7 days' });
    await userEvent.click(preset7d);

    const submitBtn = screen.getByRole('button', { name: /^Record decision$/i });
    await userEvent.click(submitBtn);

    await waitFor(() => {
      expect(recordReview).toHaveBeenCalledWith(
        sampleDesire.id,
        expect.objectContaining({
          outcome: 'delayed',
          reviewAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/),
        }),
      );
    });
  });

  it('records decision: "Buy intentionally"', async () => {
    render(<DesireCompare desireId={sampleDesire.id} />);
    await screen.findByRole('heading', { name: sampleDesire.name });

    // Select "Buy intentionally"
    const buyRadio = screen.getByLabelText(/Buy intentionally/i);
    await userEvent.click(buyRadio);

    const submitBtn = screen.getByRole('button', { name: /^Record decision$/i });
    await userEvent.click(submitBtn);

    await waitFor(() => {
      expect(recordReview).toHaveBeenCalledWith(
        sampleDesire.id,
        expect.objectContaining({
          outcome: 'bought',
        }),
      );
    });
  });

  it('records decision: "Pass on this purchase"', async () => {
    render(<DesireCompare desireId={sampleDesire.id} />);
    await screen.findByRole('heading', { name: sampleDesire.name });

    // Select "Pass on this purchase"
    const passRadio = screen.getByLabelText(/Pass on this purchase/i);
    await userEvent.click(passRadio);

    const submitBtn = screen.getByRole('button', { name: /^Record decision$/i });
    await userEvent.click(submitBtn);

    await waitFor(() => {
      expect(recordReview).toHaveBeenCalledWith(
        sampleDesire.id,
        expect.objectContaining({
          outcome: 'declined',
        }),
      );
    });
  });

  it('protects against duplicate clicks while submission is in-flight', async () => {
    let resolveReview: (val: ReviewEvent) => void;
    vi.mocked(recordReview).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveReview = resolve;
        }),
    );

    render(<DesireCompare desireId={sampleDesire.id} />);
    await screen.findByRole('heading', { name: sampleDesire.name });

    const passRadio = screen.getByLabelText(/Pass on this purchase/i);
    await userEvent.click(passRadio);

    const submitBtn = screen.getByRole('button', { name: /^Record decision$/i });
    await userEvent.click(submitBtn);

    // Button becomes disabled while in-flight
    expect(screen.getByRole('button', { name: /Recording decision…/i })).toBeDisabled();
    expect(recordReview).toHaveBeenCalledTimes(1);

    // Resolve in-flight request
    resolveReview!(recordedReviewResult);
    await waitFor(() => {
      expect(screen.getAllByText(/Decision recorded/i).length).toBeGreaterThanOrEqual(1);
    });
  });

  it('retains stable commandId on ambiguous network error for idempotent retry protection', async () => {
    vi.mocked(recordReview).mockRejectedValueOnce(
      new DesireRequestError(
        0,
        'NETWORK',
        'Unable to connect. Check your connection and try again.',
      ),
    );

    render(<DesireCompare desireId={sampleDesire.id} />);
    await screen.findByRole('heading', { name: sampleDesire.name });

    const passRadio = screen.getByLabelText(/Pass on this purchase/i);
    await userEvent.click(passRadio);

    const submitBtn = screen.getByRole('button', { name: /^Record decision$/i });
    await userEvent.click(submitBtn);

    // Alert shown
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/Unable to connect/i);

    // Get the first commandId
    const firstCallCommandId = (
      vi.mocked(recordReview).mock.calls[0]![1] as CreateReviewRequest
    ).commandId;

    // Retry button is shown
    const retryBtn = screen.getByRole('button', { name: /Retry recording decision/i });
    await userEvent.click(retryBtn);

    // Second call must use the EXACT same commandId
    expect(recordReview).toHaveBeenCalledTimes(2);
    const secondCallCommandId = (
      vi.mocked(recordReview).mock.calls[1]![1] as CreateReviewRequest
    ).commandId;
    expect(secondCallCommandId).toBe(firstCallCommandId);
  });

  it('corrects an already resolved decision by including supersedesEventId', async () => {
    const resolvedDesire: Desire = {
      ...sampleDesire,
      status: 'declined',
      effectiveState: 'declined',
    };
    const resolvedHistory: ReviewHistoryPage = {
      items: [
        {
          id: 'prev-event-id',
          sequence: 2,
          outcome: 'declined',
          occurredAt: '2026-10-15T00:00:00.000Z',
          note: null,
          linkedItemId: null,
          linkedItemName: null,
          reviewAt: null,
          supersedesEventId: null,
          estimatedNotSpentMinor: '1499900',
          currency: 'INR',
        },
      ],
      nextBefore: null,
      currentEventId: 'prev-event-id',
      estimatedNotSpentMinor: '1499900',
      currency: 'INR',
    };

    vi.mocked(getDesire).mockResolvedValue(resolvedDesire);
    vi.mocked(readReviews).mockResolvedValue(resolvedHistory);

    render(<DesireCompare desireId={resolvedDesire.id} />);
    await screen.findByRole('heading', { name: resolvedDesire.name });

    // Warning about corrective decision is displayed
    expect(screen.getByText(/This want already has a recorded decision/i)).toBeInTheDocument();

    const buyRadio = screen.getByLabelText(/Buy intentionally/i);
    await userEvent.click(buyRadio);

    const submitBtn = screen.getByRole('button', { name: /^Record decision$/i });
    await userEvent.click(submitBtn);

    await waitFor(() => {
      expect(recordReview).toHaveBeenCalledWith(
        resolvedDesire.id,
        expect.objectContaining({
          outcome: 'bought',
          supersedesEventId: 'prev-event-id',
        }),
      );
    });
  });

  it('renders gracefully when there are no connected matches and does not block decision', async () => {
    vi.mocked(getDesireMatches).mockResolvedValue({
      items: [],
      nextCursor: null,
      hasMore: false,
      totalCount: 0,
    });

    render(<DesireCompare desireId={sampleDesire.id} />);
    await screen.findByRole('heading', { name: sampleDesire.name });

    expect(screen.getByText('No possessions connected yet')).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: /Search and connect possessions/i }),
    ).toBeInTheDocument();

    // Decisions still work completely
    const passRadio = screen.getByLabelText(/Pass on this purchase/i);
    await userEvent.click(passRadio);

    const submitBtn = screen.getByRole('button', { name: /^Record decision$/i });
    await userEvent.click(submitBtn);

    await waitFor(() => {
      expect(recordReview).toHaveBeenCalledWith(
        sampleDesire.id,
        expect.objectContaining({
          outcome: 'declined',
        }),
      );
    });
  });
});
