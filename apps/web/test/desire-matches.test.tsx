import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  Desire,
  DesireMatch,
  DesireMatchesPage,
  MatchCandidateItem,
  MatchCandidatesPage,
} from '@havefolio/contracts';
import { DesireMatches } from '../components/desire-matches';
import { DesireCard } from '../components/desire-card';
import { formatLikelyPrice } from '../components/desire-presentation';

const mockPush = vi.fn();
const mockRefresh = vi.fn();
const mockReplace = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
    refresh: mockRefresh,
    replace: mockReplace,
  }),
}));

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const mockDesire: Desire = {
  id: 'd1000000-0000-4000-a000-000000000001',
  name: 'Espresso Machine',
  classification: 'want',
  likelyPriceMinor: '2500000',
  currency: 'INR',
  productUrl: 'https://example.com/espresso-pro',
  reason: 'Brew better espresso at home.',
  status: 'waiting',
  effectiveState: 'waiting',
  waitingStartedAt: '2026-10-16T10:00:00.000Z',
  reviewAt: '2026-10-23T10:00:00.000Z',
  photo: null,
  revision: 1,
  createdAt: '2026-10-16T10:00:00.000Z',
  updatedAt: '2026-10-16T10:00:00.000Z',
};

const mockMatch1: DesireMatch = {
  id: 'm1000000-0000-4000-a000-000000000001',
  desireId: mockDesire.id,
  itemId: 'i1000000-0000-4000-a000-000000000001',
  reason: 'Aeropress brews great coffee; serves morning caffeine needs well.',
  relevance: 'relevant',
  source: 'manual',
  item: {
    id: 'i1000000-0000-4000-a000-000000000001',
    name: 'AeroPress Coffee Maker',
    brand: 'AeroPress',
    model: 'Original',
    ownershipStatus: 'owned',
    condition: 'working',
    useFrequency: 'often',
    categoryId: 'c1000000-0000-4000-a000-000000000001',
    categoryName: 'Kitchen Appliances',
    subcategoryId: null,
    subcategoryName: null,
    tags: ['coffee', 'manual'],
    cover: null,
    isUsableAlternative: true,
  },
  hints: {
    categoryHint: 'Category: Kitchen Appliances',
    usageHint: 'Frequency: often',
    conditionHint: 'Condition: working',
    traitHints: ['coffee', 'manual'],
  },
  createdAt: '2026-10-16T12:00:00.000Z',
  updatedAt: '2026-10-16T12:00:00.000Z',
};

const mockMatch2Unavailable: DesireMatch = {
  id: 'm2000000-0000-4000-a000-000000000002',
  desireId: mockDesire.id,
  itemId: 'i2000000-0000-4000-a000-000000000002',
  reason: 'Previous espresso machine, sold last year.',
  relevance: 'irrelevant',
  source: 'manual',
  item: {
    id: 'i2000000-0000-4000-a000-000000000002',
    name: 'Old DeLonghi Dedica',
    brand: 'DeLonghi',
    model: 'EC680',
    ownershipStatus: 'sold',
    condition: 'working',
    useFrequency: 'unknown',
    categoryId: 'c1000000-0000-4000-a000-000000000001',
    categoryName: 'Kitchen Appliances',
    subcategoryId: null,
    subcategoryName: null,
    tags: ['espresso'],
    cover: null,
    isUsableAlternative: false,
  },
  hints: {
    categoryHint: 'Category: Kitchen Appliances',
    usageHint: null,
    conditionHint: 'Condition: working',
    traitHints: ['espresso'],
  },
  createdAt: '2026-10-16T12:05:00.000Z',
  updatedAt: '2026-10-16T12:05:00.000Z',
};

const mockCandidate1: MatchCandidateItem = {
  ...mockMatch1.item,
  isAlreadyMatched: true,
  suggestedReason: 'Selected from Kitchen Appliances as a potential alternative possession.',
  hints: mockMatch1.hints,
};

const mockCandidate2: MatchCandidateItem = {
  id: 'i3000000-0000-4000-a000-000000000003',
  name: 'French Press',
  brand: 'Bodum',
  model: 'Chambord',
  ownershipStatus: 'owned',
  condition: 'working',
  useFrequency: 'sometimes',
  categoryId: 'c1000000-0000-4000-a000-000000000001',
  categoryName: 'Kitchen Appliances',
  subcategoryId: null,
  subcategoryName: null,
  tags: ['glass', 'coffee'],
  cover: null,
  isUsableAlternative: true,
  isAlreadyMatched: false,
  suggestedReason: 'Selected from Kitchen Appliances as a potential alternative possession.',
  hints: {
    categoryHint: 'Category: Kitchen Appliances',
    usageHint: 'Frequency: sometimes',
    conditionHint: 'Condition: working',
    traitHints: ['glass', 'coffee'],
  },
};

describe('DesireMatches component', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('renders desire details and empty state when there are no matches', async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes(`/api/v1/desires/${mockDesire.id}/matches/candidates`)) {
        return Promise.resolve(
          jsonResponse({
            items: [mockCandidate2],
            nextCursor: null,
            hasMore: false,
          } satisfies MatchCandidatesPage),
        );
      }
      if (url.includes(`/api/v1/desires/${mockDesire.id}/matches`)) {
        return Promise.resolve(
          jsonResponse({
            items: [],
            nextCursor: null,
            hasMore: false,
            totalCount: 0,
          } satisfies DesireMatchesPage),
        );
      }
      if (url.includes(`/api/v1/desires/${mockDesire.id}`)) {
        return Promise.resolve(jsonResponse(mockDesire));
      }
      return Promise.reject(new Error(`Unhandled fetch: ${url}`));
    });

    render(<DesireMatches desireId={mockDesire.id} />);

    // Desire header details
    expect(await screen.findByText('Espresso Machine')).toBeInTheDocument();
    expect(
      screen.getByText(formatLikelyPrice(mockDesire.likelyPriceMinor, mockDesire.currency)),
    ).toBeInTheDocument();
    expect(screen.getByText('Waiting')).toBeInTheDocument();

    // Empty matches state
    expect(await screen.findByText('No possessions connected yet')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Search your inventory below to link possessions that might fulfill this need, or proceed without connecting any.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('Continue without matching')).toBeInTheDocument();

    // Inventory candidates section
    expect(screen.getByRole('heading', { name: 'Search your inventory' })).toBeInTheDocument();
    expect(await screen.findByText('French Press')).toBeInTheDocument();
    expect(screen.getByText('Bodum • Chambord')).toBeInTheDocument();
  });

  it('renders connected matches with hints, usability, and plain-language explanation', async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes(`/api/v1/desires/${mockDesire.id}/matches/candidates`)) {
        return Promise.resolve(
          jsonResponse({
            items: [mockCandidate1, mockCandidate2],
            nextCursor: null,
            hasMore: false,
          } satisfies MatchCandidatesPage),
        );
      }
      if (url.includes(`/api/v1/desires/${mockDesire.id}/matches`)) {
        return Promise.resolve(
          jsonResponse({
            items: [mockMatch1, mockMatch2Unavailable],
            nextCursor: null,
            hasMore: false,
            totalCount: 2,
          } satisfies DesireMatchesPage),
        );
      }
      if (url.includes(`/api/v1/desires/${mockDesire.id}`)) {
        return Promise.resolve(jsonResponse(mockDesire));
      }
      return Promise.reject(new Error(`Unhandled fetch: ${url}`));
    });

    render(<DesireMatches desireId={mockDesire.id} />);

    // Matched item 1 (owned, usable)
    const aeroItems = await screen.findAllByText('AeroPress Coffee Maker');
    expect(aeroItems.length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Usable alternative')).toBeInTheDocument();
    expect(screen.getAllByText('Category: Kitchen Appliances')).toHaveLength(2);
    expect(screen.getByText('Frequency: often')).toBeInTheDocument();
    expect(screen.getByText('#coffee')).toBeInTheDocument();
    expect(
      screen.getByText('“Aeropress brews great coffee; serves morning caffeine needs well.”'),
    ).toBeInTheDocument();

    // Matched item 2 (sold, unavailable)
    expect(screen.getByText('Old DeLonghi Dedica')).toBeInTheDocument();
    expect(screen.getByText('Unavailable (sold)')).toBeInTheDocument();
    expect(screen.getByText('Marked irrelevant')).toBeInTheDocument();
  });

  it('discloses a worn-out match as still owned, not a usable alternative', async () => {
    const user = userEvent.setup();
    const candidateUrls: string[] = [];
    const wornMatch: DesireMatch = {
      ...mockMatch1,
      item: { ...mockMatch1.item, condition: 'worn_out', isUsableAlternative: false },
      hints: { ...mockMatch1.hints, conditionHint: 'Condition: worn out' },
    };
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes(`/api/v1/desires/${mockDesire.id}/matches/candidates`)) {
        candidateUrls.push(url);
        return Promise.resolve(
          jsonResponse({
            items: [mockCandidate2],
            nextCursor: null,
            hasMore: false,
          } satisfies MatchCandidatesPage),
        );
      }
      if (url.includes(`/api/v1/desires/${mockDesire.id}/matches`)) {
        return Promise.resolve(
          jsonResponse({
            items: [wornMatch],
            nextCursor: null,
            hasMore: false,
            totalCount: 1,
          } satisfies DesireMatchesPage),
        );
      }
      if (url.includes(`/api/v1/desires/${mockDesire.id}`)) {
        return Promise.resolve(jsonResponse(mockDesire));
      }
      return Promise.reject(new Error(`Unhandled fetch: ${url}`));
    });

    render(<DesireMatches desireId={mockDesire.id} />);

    expect(await screen.findByText('Worn out · still owned')).toBeInTheDocument();
    expect(screen.queryByText('Usable alternative')).toBeNull();
    expect(screen.queryByText('Unavailable (owned)')).toBeNull();
    expect(screen.getByText('Condition: worn out')).toBeInTheDocument();
    // Only a worn-out match is connected; the decision paths stay open.
    expect(screen.getByRole('link', { name: 'Compare before buying' })).toHaveAttribute(
      'href',
      `/wants/${mockDesire.id}/compare`,
    );
    expect(screen.getByRole('link', { name: 'Done / Continue' })).toHaveAttribute('href', '/wants');

    const toggle = screen.getByRole('checkbox', {
      name: 'Include unavailable or worn-out possessions (sold, donated, disposed, lost, returned, worn out)',
    });
    toggle.focus();
    await user.keyboard(' ');
    await waitFor(() =>
      expect(candidateUrls.some((u) => u.includes('includeUnavailable=true'))).toBe(true),
    );
  });

  it('allows toggling relevance feedback (mark irrelevant and relevant)', async () => {
    const user = userEvent.setup();
    const patchCalls: Array<{ url: string; body: unknown }> = [];

    global.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method === 'PATCH') {
        patchCalls.push({ url, body: JSON.parse(init.body as string) });
        const updated = {
          ...mockMatch1,
          relevance: 'irrelevant' as const,
        };
        return Promise.resolve(jsonResponse(updated));
      }
      if (url.includes(`/api/v1/desires/${mockDesire.id}/matches/candidates`)) {
        return Promise.resolve(
          jsonResponse({
            items: [],
            nextCursor: null,
            hasMore: false,
          } satisfies MatchCandidatesPage),
        );
      }
      if (url.includes(`/api/v1/desires/${mockDesire.id}/matches`)) {
        return Promise.resolve(
          jsonResponse({
            items: [mockMatch1],
            nextCursor: null,
            hasMore: false,
            totalCount: 1,
          } satisfies DesireMatchesPage),
        );
      }
      if (url.includes(`/api/v1/desires/${mockDesire.id}`)) {
        return Promise.resolve(jsonResponse(mockDesire));
      }
      return Promise.reject(new Error(`Unhandled fetch: ${url}`));
    });

    render(<DesireMatches desireId={mockDesire.id} />);

    const markIrrelevantBtn = await screen.findByRole('button', {
      name: /Mark AeroPress Coffee Maker as irrelevant alternative/i,
    });
    await user.click(markIrrelevantBtn);

    await waitFor(() => {
      expect(patchCalls).toHaveLength(1);
    });
    expect(patchCalls[0]?.body).toEqual({ relevance: 'irrelevant' });
    expect(
      await screen.findByText('Marked as not an alternative for this want.'),
    ).toBeInTheDocument();
  });

  it('allows editing and saving an explanation reason', async () => {
    const user = userEvent.setup();
    const patchCalls: Array<{ url: string; body: unknown }> = [];

    global.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method === 'PATCH') {
        patchCalls.push({ url, body: JSON.parse(init.body as string) });
        const updated = {
          ...mockMatch1,
          reason: 'Updated reason: already makes wonderful morning espresso-style shots.',
        };
        return Promise.resolve(jsonResponse(updated));
      }
      if (url.includes(`/api/v1/desires/${mockDesire.id}/matches/candidates`)) {
        return Promise.resolve(
          jsonResponse({
            items: [],
            nextCursor: null,
            hasMore: false,
          } satisfies MatchCandidatesPage),
        );
      }
      if (url.includes(`/api/v1/desires/${mockDesire.id}/matches`)) {
        return Promise.resolve(
          jsonResponse({
            items: [mockMatch1],
            nextCursor: null,
            hasMore: false,
            totalCount: 1,
          } satisfies DesireMatchesPage),
        );
      }
      if (url.includes(`/api/v1/desires/${mockDesire.id}`)) {
        return Promise.resolve(jsonResponse(mockDesire));
      }
      return Promise.reject(new Error(`Unhandled fetch: ${url}`));
    });

    render(<DesireMatches desireId={mockDesire.id} />);

    const editBtn = await screen.findByRole('button', {
      name: /Edit explanation for AeroPress Coffee Maker/i,
    });
    await user.click(editBtn);

    const textarea = screen.getByLabelText(
      /Explain why this possession may serve the same purpose:/i,
    );
    expect(textarea).toBeInTheDocument();

    await user.clear(textarea);
    await user.type(
      textarea,
      'Updated reason: already makes wonderful morning espresso-style shots.',
    );

    const saveBtn = screen.getByRole('button', { name: /Save reason/i });
    await user.click(saveBtn);

    await waitFor(() => {
      expect(patchCalls).toHaveLength(1);
    });
    expect(patchCalls[0]?.body).toEqual({
      reason: 'Updated reason: already makes wonderful morning espresso-style shots.',
    });
    expect(await screen.findByText('Explanation updated.')).toBeInTheDocument();
  });

  it('allows removing a match with confirmation dialog', async () => {
    const user = userEvent.setup();
    const deleteCalls: string[] = [];

    global.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method === 'DELETE') {
        deleteCalls.push(url);
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      if (url.includes(`/api/v1/desires/${mockDesire.id}/matches/candidates`)) {
        return Promise.resolve(
          jsonResponse({
            items: [],
            nextCursor: null,
            hasMore: false,
          } satisfies MatchCandidatesPage),
        );
      }
      if (url.includes(`/api/v1/desires/${mockDesire.id}/matches`)) {
        return Promise.resolve(
          jsonResponse({
            items: [mockMatch1],
            nextCursor: null,
            hasMore: false,
            totalCount: 1,
          } satisfies DesireMatchesPage),
        );
      }
      if (url.includes(`/api/v1/desires/${mockDesire.id}`)) {
        return Promise.resolve(jsonResponse(mockDesire));
      }
      return Promise.reject(new Error(`Unhandled fetch: ${url}`));
    });

    render(<DesireMatches desireId={mockDesire.id} />);

    const removeTrigger = await screen.findByRole('button', {
      name: /Remove match with AeroPress Coffee Maker/i,
    });
    await user.click(removeTrigger);

    // Alert dialog opens
    expect(screen.getByText('Remove connected possession?')).toBeInTheDocument();
    expect(
      screen.getByText(/This will disconnect “AeroPress Coffee Maker” from “Espresso Machine”/i),
    ).toBeInTheDocument();

    const confirmBtn = screen.getByRole('button', { name: /Remove connection/i });
    await user.click(confirmBtn);

    await waitFor(() => {
      expect(deleteCalls).toHaveLength(1);
    });
    expect(deleteCalls[0]).toContain(`/api/v1/desires/${mockDesire.id}/matches/${mockMatch1.id}`);

    // Empty state appears after deletion
    expect(await screen.findByText('No possessions connected yet')).toBeInTheDocument();
  });

  it('allows connecting a possession from search candidates', async () => {
    const user = userEvent.setup();
    const postCalls: Array<{ url: string; body: unknown }> = [];

    const newlyCreatedMatch: DesireMatch = {
      id: 'm3000000-0000-4000-a000-000000000003',
      desireId: mockDesire.id,
      itemId: mockCandidate2.id,
      reason: 'Can make rich morning coffee without needing espresso.',
      relevance: 'relevant',
      source: 'manual',
      item: {
        ...mockCandidate2,
      },
      hints: mockCandidate2.hints,
      createdAt: '2026-10-16T12:10:00.000Z',
      updatedAt: '2026-10-16T12:10:00.000Z',
    };

    global.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        postCalls.push({ url, body: JSON.parse(init.body as string) });
        return Promise.resolve(jsonResponse(newlyCreatedMatch, 201));
      }
      if (url.includes(`/api/v1/desires/${mockDesire.id}/matches/candidates`)) {
        return Promise.resolve(
          jsonResponse({
            items: [mockCandidate2],
            nextCursor: null,
            hasMore: false,
          } satisfies MatchCandidatesPage),
        );
      }
      if (url.includes(`/api/v1/desires/${mockDesire.id}/matches`)) {
        return Promise.resolve(
          jsonResponse({
            items: [],
            nextCursor: null,
            hasMore: false,
            totalCount: 0,
          } satisfies DesireMatchesPage),
        );
      }
      if (url.includes(`/api/v1/desires/${mockDesire.id}`)) {
        return Promise.resolve(jsonResponse(mockDesire));
      }
      return Promise.reject(new Error(`Unhandled fetch: ${url}`));
    });

    render(<DesireMatches desireId={mockDesire.id} />);

    expect(await screen.findByText('French Press')).toBeInTheDocument();

    const reasonInput = screen.getByLabelText(/Explanation \/ why it may serve this purpose:/i);
    await user.clear(reasonInput);
    await user.type(reasonInput, 'Can make rich morning coffee without needing espresso.');

    const connectBtn = screen.getByRole('button', {
      name: /Connect French Press as a potential alternative/i,
    });
    await user.click(connectBtn);

    await waitFor(() => {
      expect(postCalls).toHaveLength(1);
    });
    expect(postCalls[0]?.body).toEqual({
      itemId: mockCandidate2.id,
      reason: 'Can make rich morning coffee without needing espresso.',
    });

    // Match appears in connected possessions
    expect(
      await screen.findByText('“Can make rich morning coffee without needing espresso.”'),
    ).toBeInTheDocument();
  });
});

describe('DesireCard with Matches link', () => {
  it('renders a link to the matches page for the desire', () => {
    const onDeleted = vi.fn();
    render(<DesireCard desire={mockDesire} onDeleted={onDeleted} />);

    const matchesLink = screen.getByRole('link', { name: /Matches/i });
    expect(matchesLink).toBeInTheDocument();
    expect(matchesLink).toHaveAttribute('href', `/wants/${mockDesire.id}/matches`);
  });
});
