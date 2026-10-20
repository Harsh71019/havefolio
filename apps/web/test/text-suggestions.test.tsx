import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type {
  EnrichmentPage,
  EnrichmentReview,
  EnrichmentReviewEvent,
  EnrichmentWork,
  ItemResponse,
} from '@havefolio/contracts';
import { formatOcrReference } from '@havefolio/domain';
import { TextSuggestions, type TextSuggestionsApi } from '../components/text-suggestions';
import { SuggestionRequestError } from '../components/text-suggestions-client';

const uuid = (n: number): string => `00000000-0000-4000-a000-${String(n).padStart(12, '0')}`;
const itemId = uuid(1);
const receiptId = uuid(401);
const pdfId = uuid(402);
const photoId = uuid(501);

const item = (overrides: Partial<ItemResponse> = {}): ItemResponse =>
  ({
    id: itemId,
    name: 'Kettle',
    ownershipStatus: 'owned',
    currency: 'INR',
    pricePaidMinor: null,
    purchaseDate: { precision: 'unknown', year: null, month: null, day: null },
    acquisitionType: 'bought',
    brand: null,
    model: null,
    description: null,
    revision: 3,
    isDemo: false,
    ...overrides,
  }) as ItemResponse;

const ref = (line: number, flags: string[], text: string): string =>
  formatOcrReference({ line, flags: flags as never, text });
const source = (
  reference: string,
): EnrichmentWork['candidates'][number]['fields'][number]['source'] => ({
  provider: 'local-ocr',
  inputKind: 'receipt',
  reference,
});

const succeeded: EnrichmentWork = {
  id: uuid(701),
  itemId,
  inputKind: 'receipt',
  attachmentId: receiptId,
  baseRevision: 3,
  state: 'succeeded',
  attempts: 1,
  failureCode: null,
  createdAt: '2026-10-20T08:00:00.000Z',
  candidates: [
    {
      id: 'receipt-line-2',
      fields: [
        {
          field: 'name',
          value: '<b>Steel Kettle</b>',
          confidence: 0.9,
          source: source(ref(2, [], 'Steel Kettle Rs 1,299.00')),
        },
        {
          field: 'pricePaid',
          value: 'INR 129900',
          confidence: 0.79,
          source: source(ref(2, ['line-amount'], 'Steel Kettle Rs 1,299.00')),
        },
        {
          field: 'purchaseDate',
          value: '2026',
          confidence: 0.55,
          source: source(ref(4, ['date-order-unclear'], 'Date 03/04/2026')),
        },
      ],
    },
    {
      id: 'receipt-line-3',
      fields: [
        {
          field: 'name',
          value: 'Towel',
          confidence: 0.9,
          source: source(ref(3, [], 'Towel Rs 500.00')),
        },
      ],
    },
  ],
};

interface Fake {
  api: TextSuggestionsApi;
  reviews: EnrichmentReview[];
  requests: unknown[];
}

function fakeApi(
  options: {
    page?: EnrichmentPage;
    decisions?: EnrichmentReviewEvent[];
    current?: ItemResponse;
    review?: (r: EnrichmentReview) => Promise<EnrichmentReviewEvent>;
  } = {},
): Fake {
  const reviews: EnrichmentReview[] = [];
  const requests: unknown[] = [];
  let page: EnrichmentPage = options.page ?? {
    providerStatus: 'available',
    availableKinds: ['photo', 'receipt'],
    items: [succeeded],
    nextBefore: null,
  };
  const api: TextSuggestionsApi = {
    readItem: vi.fn(() => Promise.resolve(options.current ?? item())),
    fetchPhotos: vi.fn(() =>
      Promise.resolve({
        revision: 3,
        photos: [
          {
            id: photoId,
            position: 0,
            cover: true,
            width: 800,
            height: 600,
            byteSize: 1000,
            mimeType: 'image/webp' as const,
            altText: null,
            decorative: false,
          },
        ],
      }),
    ),
    fetchDocuments: vi.fn(() =>
      Promise.resolve({
        revision: 3,
        documents: [
          {
            id: receiptId,
            kind: 'receipt' as const,
            mimeType: 'image/webp' as const,
            byteSize: 9000,
            width: 900,
            height: 1200,
          },
          {
            id: pdfId,
            kind: 'receipt' as const,
            mimeType: 'application/pdf' as const,
            byteSize: 9000,
            width: null,
            height: null,
          },
          {
            id: uuid(403),
            kind: 'warranty' as const,
            mimeType: 'image/webp' as const,
            byteSize: 9000,
            width: 1,
            height: 1,
          },
        ],
      }),
    ),
    readSuggestions: vi.fn(() => Promise.resolve(page)),
    requestReading: vi.fn((_id, input) => {
      requests.push(input);
      const work: EnrichmentWork = {
        ...succeeded,
        id: uuid(702),
        state: 'pending',
        candidates: [],
      };
      page = { ...page, items: [work, ...page.items] };
      return Promise.resolve(work);
    }),
    reviewSuggestion: vi.fn((_id, _work, review) => {
      reviews.push(review);
      if (options.review) return options.review(review);
      return Promise.resolve({} as EnrichmentReviewEvent);
    }),
    readDecisions: vi.fn(() => Promise.resolve(options.decisions ?? [])),
  };
  return { api, reviews, requests };
}

describe('PER-45 photo and receipt suggestions', () => {
  it('explains local processing, lists readable sources and never offers PDFs or warranties', async () => {
    const { api, requests } = fakeApi();
    const user = userEvent.setup();
    const storage = vi.spyOn(Storage.prototype, 'setItem');
    render(<TextSuggestions itemId={itemId} api={api} pollMs={10} />);
    expect(await screen.findByText('Read privately, changed only by you')).toBeInTheDocument();
    expect(screen.getByText(/never sent to another service/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Read text from Receipt 2' })).toBeDisabled();
    expect(screen.getByText('PDF — can’t be read yet')).toBeInTheDocument();
    expect(screen.queryByText(/Warranty/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Read text from Receipt 1' }));
    expect(requests[0]).toMatchObject({ revision: 3, kind: 'receipt', attachmentId: receiptId });
    expect(await screen.findByText(/Reading… This usually takes/)).toBeInTheDocument();
    // Status polling stays bounded and nothing private is written to browser storage.
    await waitFor(() =>
      expect(vi.mocked(api.readSuggestions).mock.calls.length).toBeGreaterThan(2),
    );
    expect(storage).not.toHaveBeenCalled();
  });

  it('shows confidence, caveats and line evidence; untrusted text renders as plain text', async () => {
    const { api } = fakeApi();
    const { container } = render(<TextSuggestions itemId={itemId} api={api} />);
    await screen.findByText('Receipt line 2');
    expect(screen.getByText(/This receipt lists more than one thing/)).toBeInTheDocument();
    expect(screen.getByText('₹1,299 (INR)', { exact: false })).toHaveTextContent(
      'Suggested price paid: ₹1,299 (INR)',
    );
    expect(screen.getByText(/may not include tax, discounts or delivery/)).toBeInTheDocument();
    expect(screen.getByText(/only the year is suggested/)).toBeInTheDocument();
    expect(
      screen.getByText('Unclear — compare it with the image before using it.'),
    ).toBeInTheDocument();
    expect(screen.getAllByText('Check this').length).toBeGreaterThan(0);
    expect(screen.getByText('Date 03/04/2026')).toBeInTheDocument();
    expect(screen.getByText('<b>Steel Kettle</b>')).toBeInTheDocument();
    expect(container.querySelector('b')).toBeNull();
  });

  it('accepts, rejects and corrects one field at a time with exact canonical values', async () => {
    const { api, reviews } = fakeApi();
    const user = userEvent.setup();
    render(<TextSuggestions itemId={itemId} api={api} />);
    await screen.findByText('Receipt line 2');
    const [nameUse] = screen.getAllByRole('button', { name: 'Use suggested name' });
    await user.click(nameUse!);
    expect(reviews[0]).toMatchObject({
      revision: 3,
      candidateId: 'receipt-line-2',
      field: 'name',
      decision: 'accept',
    });
    expect(reviews[0]).not.toHaveProperty('value');
    await user.click(await screen.findByRole('button', { name: 'Keep current purchase date' }));
    expect(reviews[1]).toMatchObject({ field: 'purchaseDate', decision: 'reject' });
    await user.click(
      screen.getByRole('button', { name: 'Edit suggested price paid before using it' }),
    );
    const amount = screen.getByLabelText('Amount paid');
    expect(amount).toHaveValue('1299.00');
    await user.clear(amount);
    await user.type(amount, '1,299.505');
    await user.click(screen.getByRole('button', { name: 'Save correction' }));
    expect(await screen.findByText(/cannot have more than 2 decimal places/)).toBeInTheDocument();
    expect(reviews).toHaveLength(2);
    await user.clear(amount);
    await user.type(amount, '1,249.50');
    await user.click(screen.getByRole('button', { name: 'Save correction' }));
    await waitFor(() =>
      expect(reviews[2]).toMatchObject({
        field: 'pricePaid',
        decision: 'correct',
        value: 'INR 124950',
      }),
    );
  });

  it('corrects a date at the precision the owner knows, never inventing a day', async () => {
    const { api, reviews } = fakeApi();
    const user = userEvent.setup();
    render(<TextSuggestions itemId={itemId} api={api} />);
    await screen.findByText('Receipt line 2');
    await user.click(
      screen.getByRole('button', { name: 'Edit suggested purchase date before using it' }),
    );
    expect(screen.getByRole('radio', { name: 'Year only' })).toBeChecked();
    await user.click(screen.getByRole('radio', { name: 'Month and year' }));
    await user.click(screen.getByRole('button', { name: 'Save correction' }));
    expect(
      await screen.findByText(/Enter a real date at the precision you know/),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('combobox', { name: 'Month' }));
    await user.click(await screen.findByRole('option', { name: 'April' }));
    await user.click(screen.getByRole('button', { name: 'Save correction' }));
    await waitFor(() =>
      expect(reviews[0]).toMatchObject({ field: 'purchaseDate', value: '2026-04' }),
    );
  });

  it('out-of-date suggestions cannot be applied and offer a fresh reading', async () => {
    const { api } = fakeApi({ current: item({ revision: 5 }) });
    render(<TextSuggestions itemId={itemId} api={api} />);
    expect(await screen.findByText('These suggestions are out of date')).toBeInTheDocument();
    for (const button of screen.getAllByRole('button', { name: /^Use suggested/ }))
      expect(button).toBeDisabled();
    expect(screen.getAllByRole('button', { name: 'Read it again' })[0]).toBeEnabled();
  });

  it('keeps history of previous and confirmed values and reports API refusals plainly', async () => {
    const decisions: EnrichmentReviewEvent[] = [
      {
        id: uuid(801),
        workId: succeeded.id,
        commandId: uuid(901),
        revision: 3,
        candidateId: 'receipt-line-2',
        field: 'pricePaid',
        decision: 'correct',
        value: 'INR 124950',
        previousValue: null,
        confirmedValue: 'INR 124950',
        resultingRevision: 4,
        createdAt: '2026-10-20T09:00:00.000Z',
      },
    ];
    const { api } = fakeApi({
      decisions,
      current: item({ revision: 4, pricePaidMinor: '124950' }),
      review: () =>
        Promise.reject(
          new SuggestionRequestError(
            409,
            'STALE_ENRICHMENT_REVISION',
            'This item changed after these suggestions were made.',
          ),
        ),
    });
    const user = userEvent.setup();
    render(<TextSuggestions itemId={itemId} api={api} />);
    const history = await screen.findByRole('region', { name: 'Your decisions' });
    expect(within(history).getByText('Price paid: corrected')).toBeInTheDocument();
    expect(
      within(history).getByText(/Before: Not recorded · After: ₹1,249.50 \(INR\)/),
    ).toBeInTheDocument();
    expect(screen.getByText('You corrected it to ₹1,249.50 (INR).')).toBeInTheDocument();
    const [use] = screen.getAllByRole('button', { name: 'Use suggested name' });
    await user.click(use!);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This item changed after these suggestions were made.',
    );
  });

  it('is honest when reading is off, failed, set aside or found nothing', async () => {
    const work = (state: EnrichmentWork['state'], n: number): EnrichmentWork => ({
      ...succeeded,
      id: uuid(710 + n),
      state,
      candidates: [],
    });
    const { api } = fakeApi({
      page: {
        providerStatus: 'unconfigured',
        availableKinds: [],
        items: [work('failed', 1), work('stale', 2), work('succeeded', 3), work('unconfigured', 4)],
        nextBefore: null,
      },
    });
    render(<TextSuggestions itemId={itemId} api={api} />);
    expect(await screen.findByText('Reading text isn’t turned on')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Read text from Receipt 1' })).toBeDisabled();
    expect(screen.getByText(/couldn’t be read. Your item is unchanged/)).toBeInTheDocument();
    expect(screen.getByText(/set aside without suggestions/)).toBeInTheDocument();
    expect(screen.getByText(/No item details could be read clearly/)).toBeInTheDocument();
    expect(screen.getByText(/Reading wasn’t available for this request/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Read it again' })).not.toBeInTheDocument();
  });
});
