import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Desire, DesiresPage } from '@havefolio/contracts';
import { AddDesireForm } from '../components/add-desire-form';
import { EditDesireForm } from '../components/edit-desire-form';
import { DesiresList } from '../components/desires-list';
import { DesireCard } from '../components/desire-card';
import {
  formatLikelyPrice,
  formatReviewDateTime,
  validateProductUrlString,
} from '../components/desire-presentation';
import { selectionError, waitingPresets } from '../components/desires-client';

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

const mockDesire1: Desire = {
  id: 'd1000000-0000-4000-a000-000000000001',
  name: 'Espresso Machine',
  classification: 'want',
  likelyPriceMinor: '2500000',
  currency: 'INR',
  productUrl: 'https://example.com/espresso-pro',
  reason: 'Make better morning coffee at home.',
  status: 'waiting',
  effectiveState: 'waiting',
  waitingStartedAt: '2026-10-16T10:00:00.000Z',
  reviewAt: '2026-10-23T10:00:00.000Z',
  photo: {
    id: 'p1000000-0000-4000-a000-000000000001',
    byteSize: 124500,
    mimeType: 'image/webp',
    width: 800,
    height: 600,
    altText: 'Espresso Machine',
    decorative: false,
    createdAt: '2026-10-16T10:00:00.000Z',
  },
  revision: 1,
  createdAt: '2026-10-16T10:00:00.000Z',
  updatedAt: '2026-10-16T10:00:00.000Z',
};

const mockDesire2: Desire = {
  id: 'd2000000-0000-4000-a000-000000000002',
  name: 'Winter Running Jacket',
  classification: 'need',
  likelyPriceMinor: null,
  currency: null,
  productUrl: null,
  reason: null,
  status: 'considering',
  effectiveState: 'considering',
  waitingStartedAt: null,
  reviewAt: null,
  photo: null,
  revision: 1,
  createdAt: '2026-10-15T08:00:00.000Z',
  updatedAt: '2026-10-15T08:00:00.000Z',
};

const mockDesire3: Desire = {
  id: 'd3000000-0000-4000-a000-000000000003',
  name: 'High-end Mechanical Keyboard',
  classification: 'greed',
  likelyPriceMinor: '1800000',
  currency: 'INR',
  productUrl: 'https://example.com/custom-keyboard',
  reason: 'Love the click sound, but already have 2 keyboards.',
  status: 'waiting',
  effectiveState: 'ready_for_review',
  waitingStartedAt: '2026-08-02T10:00:00.000Z',
  reviewAt: '2026-09-01T10:00:00.000Z',
  photo: null,
  revision: 2,
  createdAt: '2026-08-02T10:00:00.000Z',
  updatedAt: '2026-08-02T10:00:00.000Z',
};

class FakeXhr {
  static sent: { uploadId: string; file: File; url: string }[] = [];
  static script: (() => { status: number; body: unknown })[] = [];
  upload: { onprogress: ((e: ProgressEvent) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  onabort: (() => void) | null = null;
  timeout = 0;
  status = 201;
  responseText = '';
  private headers: Record<string, string> = {};
  private url = '';

  open(_method: string, url: string): void {
    this.url = url;
  }
  setRequestHeader(name: string, value: string): void {
    this.headers[name] = value;
  }
  abort(): void {}
  send(form: FormData): void {
    FakeXhr.sent.push({
      uploadId: this.headers['Upload-Id'] ?? '',
      file: form.get('photo') as File,
      url: this.url,
    });
    const scripted = FakeXhr.script.shift()?.() ?? {
      status: 201,
      body: mockDesire1.photo,
    };
    this.status = scripted.status;
    this.responseText = JSON.stringify(scripted.body);
    setTimeout(() => {
      this.onload?.();
    }, 0);
  }
}

let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

beforeEach(() => {
  mockPush.mockReset();
  mockRefresh.mockReset();
  mockReplace.mockReset();
  FakeXhr.sent = [];
  FakeXhr.script = [];
  vi.stubGlobal('XMLHttpRequest', FakeXhr);
  URL.createObjectURL = vi.fn(() => 'blob:synthetic-photo');
  URL.revokeObjectURL = vi.fn();

  fetchMock = vi.fn<typeof fetch>().mockImplementation((input, init) => {
    const url = typeof input === 'string' ? input : (input as Request).url;
    const method = init?.method || (typeof input !== 'string' ? (input as Request).method : 'GET');

    // GET /api/v1/desires/:id/photo
    if (url.includes('/photo') && method === 'GET') {
      return Promise.resolve(jsonResponse(mockDesire1.photo));
    }

    // DELETE /api/v1/desires/:id/photo
    if (url.includes('/photo') && method === 'DELETE') {
      return Promise.resolve(jsonResponse({ revision: 3 }));
    }

    // POST /api/v1/desires/:id/photo
    if (url.includes('/photo') && method === 'POST') {
      return Promise.resolve(
        jsonResponse(
          {
            desire: { ...mockDesire1, revision: 2 },
            photo: mockDesire1.photo,
          },
          201,
        ),
      );
    }

    // GET /api/v1/desires/:id
    if (url.match(/\/api\/v1\/desires\/[0-9a-f-]+$/) && method === 'GET') {
      return Promise.resolve(jsonResponse(mockDesire1));
    }

    // PATCH /api/v1/desires/:id
    if (url.match(/\/api\/v1\/desires\/[0-9a-f-]+$/) && method === 'PATCH') {
      return Promise.resolve(jsonResponse({ ...mockDesire1, revision: 2 }));
    }

    // DELETE /api/v1/desires/:id
    if (url.match(/\/api\/v1\/desires\/[0-9a-f-]+$/) && method === 'DELETE') {
      return Promise.resolve(new Response(null, { status: 204 }));
    }

    // GET /api/v1/desires (list)
    if (url.includes('/api/v1/desires') && method === 'GET') {
      const page: DesiresPage = {
        items: [mockDesire1, mockDesire2, mockDesire3],
        nextCursor: null,
        hasMore: false,
      };
      return Promise.resolve(jsonResponse(page));
    }

    // POST /api/v1/desires (create)
    if (url.includes('/api/v1/desires') && method === 'POST') {
      return Promise.resolve(jsonResponse(mockDesire1, 201));
    }

    return Promise.resolve(jsonResponse({}));
  });

  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Desire domain & presentation utilities', () => {
  describe('formatLikelyPrice', () => {
    it('formats known price and currency accurately using minor units', () => {
      expect(formatLikelyPrice('2500000', 'INR')).toContain('25,000');
      expect(formatLikelyPrice('5000', 'JPY')).toContain('5,000');
    });

    it('returns "Price not added" when price or currency is null', () => {
      expect(formatLikelyPrice(null, 'INR')).toBe('Price not added');
      expect(formatLikelyPrice('250000', null)).toBe('Price not added');
      expect(formatLikelyPrice(null, null)).toBe('Price not added');
    });

    it('distinguishes explicit zero price from unknown', () => {
      expect(formatLikelyPrice('0', 'INR')).toContain('0');
      expect(formatLikelyPrice('0', 'INR')).not.toBe('Price not added');
    });
  });

  describe('validateProductUrlString', () => {
    it('accepts valid https and http URLs', () => {
      expect(validateProductUrlString('https://example.com/product/123').ok).toBe(true);
      expect(validateProductUrlString('http://example.com/product').ok).toBe(true);
    });

    it('rejects dangerous protocols and non-urls', () => {
      const jsResult = validateProductUrlString('javascript:alert(1)');
      expect(jsResult.ok).toBe(false);
      if (!jsResult.ok) {
        expect(jsResult.error).toMatch(/http:\/\/ or https:\/\//);
      }

      const ftpResult = validateProductUrlString('ftp://files.example.com');
      expect(ftpResult.ok).toBe(false);

      const relResult = validateProductUrlString('/product/123');
      expect(relResult.ok).toBe(false);

      const invalidResult = validateProductUrlString('not a url');
      expect(invalidResult.ok).toBe(false);
    });
  });

  describe('formatReviewDateTime', () => {
    it('formats valid ISO timestamps', () => {
      const formatted = formatReviewDateTime('2026-10-23T10:00:00.000Z');
      expect(formatted).not.toBe('Invalid date');
      expect(formatted.length).toBeGreaterThan(0);
    });

    it('handles invalid timestamp gracefully', () => {
      expect(formatReviewDateTime('not-a-date')).toBe('');
    });
  });

  describe('waitingPresets', () => {
    it('derives future ISO timestamps for 24h, 7d, and 30d presets', () => {
      const now = Date.now();
      const activePresets = waitingPresets.filter(
        (p) => p.key === '24h' || p.key === '7d' || p.key === '30d',
      );
      for (const preset of activePresets) {
        const iso = preset.deriveReviewAt();
        expect(iso).toBeTruthy();
        const parsed = new Date(iso!).getTime();
        expect(parsed).toBeGreaterThan(now);
      }
    });
  });

  describe('selectionError for photo files', () => {
    it('accepts JPEG, PNG, and WebP under 10 MiB', () => {
      const jpeg = new File(['data'], 'test.jpg', { type: 'image/jpeg' });
      const png = new File(['data'], 'test.png', { type: 'image/png' });
      const webp = new File(['data'], 'test.webp', { type: 'image/webp' });

      expect(selectionError(jpeg)).toBeUndefined();
      expect(selectionError(png)).toBeUndefined();
      expect(selectionError(webp)).toBeUndefined();
    });

    it('rejects unsupported types like GIF, SVG, PDF', () => {
      const gif = new File(['data'], 'test.gif', { type: 'image/gif' });
      const svg = new File(['data'], 'test.svg', { type: 'image/svg+xml' });
      const pdf = new File(['data'], 'test.pdf', { type: 'application/pdf' });

      expect(selectionError(gif)).toMatch(/JPEG, PNG or WebP/);
      expect(selectionError(svg)).toMatch(/JPEG, PNG or WebP/);
      expect(selectionError(pdf)).toMatch(/JPEG, PNG or WebP/);
    });

    it('rejects files larger than 10 MiB', () => {
      const largeFile = new File(['x'], 'huge.jpg', { type: 'image/jpeg' });
      Object.defineProperty(largeFile, 'size', { value: 11 * 1024 * 1024 });

      expect(selectionError(largeFile)).toMatch(/10 MiB/);
    });
  });
});

describe('AddDesireForm component', () => {
  it('submits a minimal desire with only name and shows calm post-save confirmation', async () => {
    const user = userEvent.setup();
    render(<AddDesireForm />);

    const nameInput = screen.getByLabelText(/What are you considering\?/);
    await user.type(nameInput, 'Aeropress Go');

    const submitBtn = screen.getByRole('button', { name: /Save desire/ });
    await user.click(submitBtn);

    await waitFor(() => {
      const postCalls = fetchMock.mock.calls.filter(
        (c) =>
          typeof c[0] === 'string' &&
          c[0].includes('/api/v1/desires') &&
          c[1]?.method === 'POST' &&
          !c[0].includes('/photo'),
      );
      expect(postCalls.length).toBe(1);
      const body = JSON.parse(postCalls[0]?.[1]?.body as string);
      expect(body.name).toBe('Aeropress Go');
    });

    // Displays calm post-save confirmation view
    expect(await screen.findByText(/saved to your wants/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /View all wants/ })).toHaveAttribute('href', '/wants');
  });

  it('allows selecting and clearing Need / Want / Greed classification with neutral explanations', async () => {
    const user = userEvent.setup();
    render(<AddDesireForm />);

    // Expand classification section
    const classificationToggle = screen.getByRole('button', {
      name: /Need \/ Want \/ Greed classification/i,
    });
    await user.click(classificationToggle);

    // Shows non-judgmental explanations in the UI
    expect(
      screen.getByText(/Supports something essential or important for your situation/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Could add enjoyment, convenience or comfort/)).toBeInTheDocument();
    expect(
      screen.getByText(/Feels like more than you need right now, but the decision remains yours/),
    ).toBeInTheDocument();

    // Select "Want"
    const wantRadio = screen.getByRole('radio', { name: /Want/i });
    await user.click(wantRadio);

    // Type name
    await user.type(
      screen.getByLabelText(/What are you considering\?/),
      'Noise Cancelling Headphones',
    );

    // Submit
    await user.click(screen.getByRole('button', { name: /Save desire/ }));

    await waitFor(() => {
      const postCalls = fetchMock.mock.calls.filter(
        (c) =>
          typeof c[0] === 'string' &&
          c[0].includes('/api/v1/desires') &&
          c[1]?.method === 'POST' &&
          !c[0].includes('/photo'),
      );
      expect(postCalls.length).toBe(1);
      const body = JSON.parse(postCalls[0]?.[1]?.body as string);
      expect(body.classification).toBe('want');
    });
  });

  it('submits exact likely price in integer minor units with ISO currency', async () => {
    const user = userEvent.setup();
    render(<AddDesireForm />);

    await user.type(screen.getByLabelText(/What are you considering\?/), 'Curved Monitor');

    // Expand price section
    const priceToggle = screen.getByRole('button', { name: /Likely price/i });
    await user.click(priceToggle);

    // Enter price
    const priceInput = screen.getByLabelText(/Estimated amount/i);
    await user.type(priceInput, '32999.50');

    // Submit
    await user.click(screen.getByRole('button', { name: /Save desire/ }));

    await waitFor(() => {
      const postCalls = fetchMock.mock.calls.filter(
        (c) =>
          typeof c[0] === 'string' &&
          c[0].includes('/api/v1/desires') &&
          c[1]?.method === 'POST' &&
          !c[0].includes('/photo'),
      );
      expect(postCalls.length).toBe(1);
      const body = JSON.parse(postCalls[0]?.[1]?.body as string);
      expect(body).toMatchObject({
        name: 'Curved Monitor',
        likelyPriceMinor: '3299950',
        currency: 'INR',
      });
    });
  });

  it('rejects invalid product URLs on submission with accessible error feedback', async () => {
    const user = userEvent.setup();
    render(<AddDesireForm />);

    await user.type(screen.getByLabelText(/What are you considering\?/), 'Book');

    // Expand link section
    const linkToggle = screen.getByRole('button', { name: /Product link/i });
    await user.click(linkToggle);

    const linkInput = screen.getByPlaceholderText('https://example.com/item');
    await user.type(linkInput, 'javascript:void(0)');

    await user.click(screen.getByRole('button', { name: /Save desire/ }));

    const errorMessages = await screen.findAllByText(/Web link must begin/);
    expect(errorMessages.length).toBeGreaterThanOrEqual(1);
  });

  it('supports selecting a waiting period preset', async () => {
    const user = userEvent.setup();
    render(<AddDesireForm />);

    await user.type(screen.getByLabelText(/What are you considering\?/), 'Tablet');

    // Expand waiting section
    const waitingToggle = screen.getByRole('button', { name: /Waiting period/i });
    await user.click(waitingToggle);

    // Click 7 days preset
    const preset7d = screen.getByRole('button', { name: '7 days' });
    await user.click(preset7d);

    await user.click(screen.getByRole('button', { name: /Save desire/ }));

    await waitFor(() => {
      const postCalls = fetchMock.mock.calls.filter(
        (c) =>
          typeof c[0] === 'string' &&
          c[0].includes('/api/v1/desires') &&
          c[1]?.method === 'POST' &&
          !c[0].includes('/photo'),
      );
      expect(postCalls.length).toBe(1);
      const body = JSON.parse(postCalls[0]?.[1]?.body as string);
      expect(body.waitingPeriod).toBeDefined();
      expect(new Date(body.waitingPeriod.reviewAt).getTime()).toBeGreaterThan(Date.now());
    });
  });

  it('creates desire and uploads photo with stable Upload-Id', async () => {
    const user = userEvent.setup();
    render(<AddDesireForm />);

    await user.type(screen.getByLabelText(/What are you considering\?/), 'Camera Lens');

    // Expand photo section
    const photoToggle = screen.getByRole('button', { name: /Private photo/i });
    await user.click(photoToggle);

    // Select photo file
    const file = new File(['fake-image-bytes'], 'lens.jpg', { type: 'image/jpeg' });
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(fileInput, file);

    expect(screen.getByAltText('Preview for Camera Lens')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Save desire/ }));

    await waitFor(() => {
      expect(FakeXhr.sent.length).toBe(1);
      expect(FakeXhr.sent[0]?.uploadId).toBeTruthy();
      expect(FakeXhr.sent[0]?.file?.name).toBe('lens.jpg');
    });

    expect(await screen.findByText(/saved to your wants/)).toBeInTheDocument();
  });

  it('keeps saved desire when photo upload fails and offers retry without duplicate desire', async () => {
    FakeXhr.script.push(() => ({
      status: 500,
      body: { message: 'Storage error' },
    }));

    const user = userEvent.setup();
    render(<AddDesireForm />);

    await user.type(screen.getByLabelText(/What are you considering\?/), 'Espresso Machine');

    // Expand photo section
    const photoToggle = screen.getByRole('button', { name: /Private photo/i });
    await user.click(photoToggle);

    const file = new File(['image-bytes'], 'machine.png', { type: 'image/png' });
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(fileInput, file);

    await user.click(screen.getByRole('button', { name: /Save desire/ }));

    // Desire was saved, but photo failed banner is shown
    expect(
      await screen.findByText(/Your desire was saved, but the photo could not be uploaded/),
    ).toBeInTheDocument();

    expect(screen.getByRole('button', { name: /Retry photo upload/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /View all wants/ })).toBeInTheDocument();

    // Verify only 1 desire creation POST occurred
    const desireCreateCalls = fetchMock.mock.calls.filter(
      (c) =>
        typeof c[0] === 'string' &&
        c[0].includes('/api/v1/desires') &&
        c[1]?.method === 'POST' &&
        !c[0].includes('/photo'),
    );
    expect(desireCreateCalls.length).toBe(1);
  });
});

describe('DesiresList & DesireCard components', () => {
  it('renders a list of desires with effective states, prices, and classifications', async () => {
    render(<DesiresList />);

    expect(await screen.findByText('Espresso Machine')).toBeInTheDocument();
    expect(screen.getByText('Winter Running Jacket')).toBeInTheDocument();
    expect(screen.getByText('High-end Mechanical Keyboard')).toBeInTheDocument();

    // PER-36: a plain labelled list; role="feed" required article children it never had.
    const feed = screen.getByRole('list', { name: /Desires list/i });
    expect(within(feed).getAllByRole('listitem')).toHaveLength(3);
    expect(within(feed).getAllByRole('heading', { level: 2 })).toHaveLength(3);

    // Check classification badges
    expect(within(feed).getByText('Want')).toBeInTheDocument();
    expect(within(feed).getByText('Need')).toBeInTheDocument();
    expect(within(feed).getByText('Greed')).toBeInTheDocument();

    // Check effective state badges
    expect(within(feed).getByText('Waiting')).toBeInTheDocument();
    expect(within(feed).getByText('Considering')).toBeInTheDocument();
    expect(within(feed).getByText('Ready to review')).toBeInTheDocument();

    // Check prices
    expect(within(feed).getByText(/₹25,000/)).toBeInTheDocument();
    expect(within(feed).getByText('Price not added')).toBeInTheDocument();
  });

  it('filters desires by effective state', async () => {
    const user = userEvent.setup();
    render(<DesiresList />);

    await screen.findByText('Espresso Machine');

    // Click "Waiting" filter
    const waitingFilterBtn = screen.getByRole('button', { name: 'Waiting' });
    await user.click(waitingFilterBtn);

    await waitFor(() => {
      const calls = fetchMock.mock.calls.filter(
        (c) => typeof c[0] === 'string' && c[0].includes('effectiveState=waiting'),
      );
      expect(calls.length).toBeGreaterThan(0);
    });
  });

  it('renders empty collection state when no desires exist', async () => {
    fetchMock.mockImplementation((input) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.includes('/api/v1/desires')) {
        return Promise.resolve(jsonResponse({ items: [], nextCursor: null, hasMore: false }));
      }
      return Promise.resolve(jsonResponse({}));
    });

    render(<DesiresList />);

    expect(await screen.findByText('Nothing is waiting for a decision')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Record your first desire' })).toBeInTheDocument();
  });

  it('confirms and executes desire deletion with AlertDialog', async () => {
    const user = userEvent.setup();
    const handleDeleted = vi.fn();

    render(<DesireCard desire={mockDesire1} onDeleted={handleDeleted} />);

    // Click delete button
    const deleteBtn = screen.getByRole('button', { name: `Delete ${mockDesire1.name}` });
    await user.click(deleteBtn);

    // Dialog opens
    expect(screen.getByText('Delete desire?')).toBeInTheDocument();
    expect(screen.getByText(/permanently remove/)).toBeInTheDocument();

    // Confirm deletion
    const confirmBtn = screen.getByRole('button', { name: 'Delete desire' });
    await user.click(confirmBtn);

    await waitFor(() => {
      const deleteCalls = fetchMock.mock.calls.filter(
        (c) =>
          typeof c[0] === 'string' && c[0].includes(mockDesire1.id) && c[1]?.method === 'DELETE',
      );
      expect(deleteCalls.length).toBe(1);
    });

    expect(handleDeleted).toHaveBeenCalledWith(mockDesire1.id);
  });
});

describe('EditDesireForm component', () => {
  it('loads desire on mount and renders populated fields', async () => {
    render(<EditDesireForm desireId={mockDesire1.id} />);

    expect(await screen.findByDisplayValue('Espresso Machine')).toBeInTheDocument();
    expect(screen.getByDisplayValue('25000.00')).toBeInTheDocument();
    expect(screen.getByDisplayValue('https://example.com/espresso-pro')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Make better morning coffee at home.')).toBeInTheDocument();
  });

  it('sends updated values including likelyPriceMinor: null when price is cleared', async () => {
    const user = userEvent.setup();
    render(<EditDesireForm desireId={mockDesire1.id} />);

    const priceInput = await screen.findByDisplayValue('25000.00');
    await user.clear(priceInput);

    const submitBtn = screen.getByRole('button', { name: /Save changes/ });
    await user.click(submitBtn);

    await waitFor(() => {
      const patchCalls = fetchMock.mock.calls.filter(
        (c) =>
          typeof c[0] === 'string' && c[0].includes(mockDesire1.id) && c[1]?.method === 'PATCH',
      );
      expect(patchCalls.length).toBe(1);
      const body = JSON.parse(patchCalls[0]?.[1]?.body as string);
      expect(body.likelyPriceMinor).toBeNull();
      expect(body.currency).toBeNull();
      expect(body.revision).toBe(1);
    });

    expect(mockPush).toHaveBeenCalledWith('/wants');
  });

  it('handles STALE_DESIRE_REVISION error without overwriting and presents reload option', async () => {
    fetchMock.mockImplementation((input, init) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      const method =
        init?.method || (typeof input !== 'string' ? (input as Request).method : 'GET');

      if (url.includes('/api/v1/desires') && method === 'GET') {
        return Promise.resolve(jsonResponse(mockDesire1));
      }
      if (url.includes('/api/v1/desires') && method === 'PATCH') {
        return Promise.resolve(
          jsonResponse(
            {
              error: {
                code: 'STALE_DESIRE_REVISION',
                message: 'This desire was updated elsewhere.',
              },
            },
            409,
          ),
        );
      }
      return Promise.resolve(jsonResponse({}));
    });

    const user = userEvent.setup();
    render(<EditDesireForm desireId={mockDesire1.id} />);

    await screen.findByDisplayValue('Espresso Machine');

    const submitBtn = screen.getByRole('button', { name: /Save changes/ });
    await user.click(submitBtn);

    expect(await screen.findByText(/This desire was modified elsewhere/)).toBeInTheDocument();

    expect(screen.getByRole('button', { name: /Reload latest version/ })).toBeInTheDocument();
  });

  it('removes existing photo on photo delete action', async () => {
    const user = userEvent.setup();
    render(<EditDesireForm desireId={mockDesire1.id} />);

    await screen.findByDisplayValue('Espresso Machine');

    // Click "Remove photo"
    const removePhotoBtn = screen.getByRole('button', { name: /Remove photo/ });
    await user.click(removePhotoBtn);

    await waitFor(() => {
      const deletePhotoCalls = fetchMock.mock.calls.filter(
        (c) => typeof c[0] === 'string' && c[0].includes('/photo') && c[1]?.method === 'DELETE',
      );
      expect(deletePhotoCalls.length).toBe(1);
    });
  });
});
