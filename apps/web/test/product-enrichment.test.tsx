import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import type { EnrichmentWork, ItemResponse } from '@havefolio/contracts';
import { ProductEnrichment } from '../components/product-enrichment';
import { BarcodeCamera } from '../components/barcode-camera';
const item = {
  id: '00000000-0000-4000-a000-000000000001',
  name: 'Original kettle',
  revision: 1,
  purchaseUrl: null,
  specifications: {},
  isDemo: false,
} as unknown as ItemResponse;
const work: EnrichmentWork = {
  id: 'work',
  itemId: item.id,
  inputKind: 'url',
  attachmentId: null,
  baseRevision: 1,
  state: 'succeeded',
  attempts: 1,
  failureCode: null,
  createdAt: '2026-10-20T08:00:00Z',
  candidates: [
    {
      id: 'a',
      fields: [
        {
          field: 'name',
          value: 'Suggested kettle',
          confidence: 0.5,
          source: {
            provider: 'public-product-metadata',
            inputKind: 'url',
            reference: 'https://shop.example.org/product',
          },
        },
      ],
    },
    {
      id: 'b',
      fields: [
        {
          field: 'image',
          value: 'https://images.example.org/a.png',
          confidence: 0.5,
          source: {
            provider: 'public-product-metadata',
            inputKind: 'url',
            reference: 'https://shop.example.org/product',
          },
        },
      ],
    },
  ],
};
function fixture(): {
  api: Record<'list' | 'request' | 'review' | 'history', ReturnType<typeof vi.fn>>;
  loadItem: ReturnType<typeof vi.fn>;
  user: ReturnType<typeof userEvent.setup>;
} {
  const api = {
    list: vi
      .fn()
      .mockResolvedValue({ providerStatus: 'available', items: [work], nextBefore: null }),
    request: vi.fn().mockResolvedValue({ ...work, state: 'pending', candidates: [] }),
    review: vi.fn().mockResolvedValue({
      id: 'event',
      workId: 'work',
      field: 'name',
      decision: 'accept',
      previousValue: 'Original kettle',
      confirmedValue: 'Suggested kettle',
      resultingRevision: 2,
      createdAt: work.createdAt,
    }),
    history: vi.fn().mockResolvedValue({ items: [], nextBefore: null }),
  };
  const loadItem = vi.fn().mockResolvedValue(item);
  render(<ProductEnrichment itemId={item.id} api={api} loadItem={loadItem} />);
  return { api, loadItem, user: userEvent.setup() };
}
describe('PER-44 source-specific review', () => {
  it('does not request suggestions or fetch saved links on opening; discloses barcode transfer', async () => {
    const { api } = fixture();
    await screen.findByText(item.name);
    expect(api.request).not.toHaveBeenCalled();
    expect(api.list).not.toHaveBeenCalled();
    expect(screen.getByText(/Requesting sends this barcode to Open Food Facts/)).toBeVisible();
  });
  it('keeps merged receipt OCR work on its own review page', async () => {
    const { api, user } = fixture();
    api.list.mockResolvedValue({
      providerStatus: 'available',
      items: [{ ...work, id: 'receipt-work', inputKind: 'receipt' }, work],
      nextBefore: null,
    });
    await screen.findByText(item.name);
    await user.click(screen.getByRole('button', { name: 'Refresh suggestions' }));
    await screen.findByText(/Choose the matching product/);
    expect(screen.getAllByText(/Choose the matching product/)).toHaveLength(1);
  });
  it('sends only an explicit product URL after owner request', async () => {
    const { api, user } = fixture();
    await screen.findByText(item.name);
    await user.type(
      screen.getByLabelText('Public product URL'),
      'https://shop.example.org/product',
    );
    await user.click(screen.getByRole('button', { name: 'Request link suggestions' }));
    await waitFor(() =>
      expect(api.request).toHaveBeenCalledWith(
        item.id,
        expect.objectContaining({
          kind: 'url',
          revision: 1,
          url: 'https://shop.example.org/product',
        }),
      ),
    );
  });
  it('requires candidate choice and accepts one field; no image hotlink is rendered', async () => {
    const { api, user } = fixture();
    await screen.findByText(item.name);
    await user.click(screen.getByRole('button', { name: 'Refresh suggestions' }));
    await screen.findByText(/Choose the matching product/);
    expect(screen.queryByRole('button', { name: 'Accept Name' })).toBeNull();
    await user.click(screen.getByRole('radio', { name: /Candidate 1/ }));
    await user.click(screen.getByRole('button', { name: 'Accept Name' }));
    await waitFor(() =>
      expect(api.review).toHaveBeenCalledWith(
        item.id,
        'work',
        expect.objectContaining({ candidateId: 'a', field: 'name', decision: 'accept' }),
      ),
    );
    await user.click(screen.getByRole('radio', { name: /Candidate 2/ }));
    expect(screen.getByRole('button', { name: 'Import private image' })).toBeVisible();
    expect(screen.queryByRole('img')).toBeNull();
  });
  it('rejects malformed barcode without sending; manual entry works without camera support', async () => {
    const { api, user } = fixture();
    await screen.findByText(item.name);
    await user.type(screen.getByLabelText('Barcode number'), '123');
    await user.click(screen.getByRole('button', { name: 'Request food barcode suggestions' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('check digit');
    expect(api.request).not.toHaveBeenCalled();
    await user.clear(screen.getByLabelText('Barcode number'));
    await user.type(screen.getByLabelText('Barcode number'), '3017620422003');
    await user.click(screen.getByRole('button', { name: 'Request food barcode suggestions' }));
    await waitFor(() =>
      expect(api.request).toHaveBeenCalledWith(
        item.id,
        expect.objectContaining({ kind: 'barcode', barcode: '3017620422003' }),
      ),
    );
  });
  it('refreshes a newly submitted job even when UUID ordering puts it on a later page', async () => {
    const { api, user } = fixture();
    await screen.findByText(item.name);
    await user.type(
      screen.getByLabelText('Public product URL'),
      'https://shop.example.org/product',
    );
    await user.click(screen.getByRole('button', { name: 'Request link suggestions' }));
    await screen.findByText(/Request saved/);
    api.list
      .mockResolvedValueOnce({
        providerStatus: 'available',
        items: [{ ...work, id: 'higher-uuid', candidates: [] }],
        nextBefore: 'cursor',
      })
      .mockResolvedValueOnce({ providerStatus: 'available', items: [work], nextBefore: null });
    await user.click(screen.getByRole('button', { name: 'Refresh suggestions' }));
    await screen.findByText(/Choose the matching product/);
    expect(api.list).toHaveBeenCalledWith(item.id, 'cursor');
  });
  it('preserves command identity when a request response is lost', async () => {
    const { api, user } = fixture();
    api.request.mockRejectedValueOnce(new Error('Offline'));
    await screen.findByText(item.name);
    await user.type(
      screen.getByLabelText('Public product URL'),
      'https://shop.example.org/product',
    );
    await user.click(screen.getByRole('button', { name: 'Request link suggestions' }));
    await screen.findByRole('alert');
    await user.click(screen.getByRole('button', { name: 'Request link suggestions' }));
    await waitFor(() => expect(api.request).toHaveBeenCalledTimes(2));
    expect(api.request.mock.calls[0]![1]).toEqual(api.request.mock.calls[1]![1]);
  });
  it('shows no-match and failed states while leaving manual navigation usable', async () => {
    const { api, user } = fixture();
    api.list.mockResolvedValueOnce({
      providerStatus: 'available',
      items: [
        { ...work, candidates: [] },
        { ...work, id: 'failed', state: 'failed', candidates: [] },
      ],
      nextBefore: null,
    });
    await screen.findByText(item.name);
    await user.click(screen.getByRole('button', { name: 'Refresh suggestions' }));
    expect(await screen.findByText(/No matching product found/)).toBeVisible();
    expect(screen.getByRole('link', { name: 'Back to item' })).toHaveAttribute(
      'href',
      `/items/${item.id}`,
    );
  });
});
describe('PER-44 native barcode camera', () => {
  it('provides explicit unsupported-context guidance without requesting camera access', async () => {
    const choose = vi.fn();
    render(<BarcodeCamera onChoose={choose} />);
    await userEvent.click(screen.getByRole('button', { name: 'Scan barcode' }));
    expect(screen.getByRole('status')).toHaveTextContent('Camera scanning is unavailable here');
    expect(choose).not.toHaveBeenCalled();
  });
  it('keeps ambiguous camera codes local until chosen and stops tracks', async () => {
    const stop = vi.fn(),
      choose = vi.fn(),
      getUserMedia = vi.fn().mockResolvedValue({ getTracks: () => [{ stop }] });
    vi.stubGlobal('isSecureContext', true);
    vi.stubGlobal(
      'BarcodeDetector',
      class {
        static getSupportedFormats(): Promise<string[]> {
          return Promise.resolve(['ean_13']);
        }
        detect(): Promise<Array<{ rawValue: string }>> {
          return Promise.resolve([{ rawValue: '3017620422003' }, { rawValue: '036000291452' }]);
        }
      },
    );
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getUserMedia },
      configurable: true,
    });
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
    const { unmount } = render(<BarcodeCamera onChoose={choose} />);
    await userEvent.click(screen.getByRole('button', { name: 'Scan barcode' }));
    await screen.findByRole('button', { name: 'Use 3017620422003' });
    expect(choose).not.toHaveBeenCalled();
    expect(stop).toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Use 036000291452' }));
    expect(choose).toHaveBeenCalledWith('036000291452');
    unmount();
    play.mockRestore();
    vi.unstubAllGlobals();
  });
});
