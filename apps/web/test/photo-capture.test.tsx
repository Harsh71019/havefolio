import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PhotoCapture } from '../components/photo-capture';
import * as heic from '../components/heic-conversion';

vi.mock('../components/heic-conversion', async (original) => {
  const actual = await original<typeof heic>();
  return { ...actual, canConvertHeic: vi.fn(), convertHeic: vi.fn() };
});

class FakeXhr {
  static sent: { uploadId: string; file: File }[] = [];
  static outcomes: ('error' | 'hold' | number)[] = [];
  static live: FakeXhr[] = [];
  upload: { onprogress: ((e: ProgressEvent) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  onabort: (() => void) | null = null;
  timeout = 0;
  status = 0;
  responseText = '';
  private uploadId = '';
  open(): void {}
  setRequestHeader(name: string, value: string): void {
    if (name === 'Upload-Id') this.uploadId = value;
  }
  abort(): void {
    this.onabort?.();
  }
  send(form: FormData): void {
    FakeXhr.sent.push({ uploadId: this.uploadId, file: form.get('photos') as File });
    const outcome = FakeXhr.outcomes.shift() ?? 201;
    if (outcome === 'hold') FakeXhr.live.push(this);
    else if (outcome === 'error') queueMicrotask(() => this.onerror?.());
    else
      queueMicrotask(() => {
        this.status = outcome;
        this.responseText = JSON.stringify(
          outcome === 201
            ? {
                results: [
                  {
                    index: 0,
                    photo: { id: 'p1', position: 0, width: 1, height: 1, altText: null },
                  },
                ],
              }
            : { message: 'AUTH_REQUIRED' },
        );
        this.onload?.();
      });
  }
}

const revoke = vi.fn();
beforeEach(async () => {
  const actual = await vi.importActual<typeof heic>('../components/heic-conversion');
  vi.mocked(heic.canConvertHeic).mockImplementation(actual.canConvertHeic);
  vi.mocked(heic.convertHeic).mockImplementation(actual.convertHeic);
  FakeXhr.sent = [];
  FakeXhr.outcomes = [];
  FakeXhr.live = [];
  vi.stubGlobal('XMLHttpRequest', FakeXhr);
  revoke.mockClear();
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(Response.json({ revision: 1, photos: [] }))),
  );
  URL.createObjectURL = vi.fn(() => 'blob:synthetic');
  URL.revokeObjectURL = revoke;
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
describe('private photo capture', () => {
  it('offers separate camera and multiple gallery inputs and safe return navigation', () => {
    render(<PhotoCapture itemId="test-item" />);
    expect(screen.getByLabelText('Take a photo')).toHaveAttribute('capture', 'environment');
    expect(screen.getByLabelText('Choose from gallery or files')).toHaveAttribute('multiple');
    expect(screen.getByRole('link', { name: 'Back to item' })).toHaveAttribute(
      'href',
      '/items/test-item',
    );
    expect(screen.getByRole('link', { name: 'Manage photos' })).toHaveAttribute(
      'href',
      '/items/test-item/photos',
    );
  });
  it('limits new selections to the free slots reported by the API', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          Response.json({
            revision: 3,
            photos: Array.from({ length: 7 }, (_, position) => ({ id: `p${position}`, position })),
          }),
        ),
      ),
    );
    render(<PhotoCapture itemId="test-item" />);
    expect(await screen.findByText(/This item already has 7 of 8\./)).toBeVisible();
    fireEvent.change(screen.getByLabelText('Choose from gallery or files'), {
      target: {
        files: [
          new File(['a'], 'a.jpg', { type: 'image/jpeg' }),
          new File(['b'], 'b.jpg', { type: 'image/jpeg' }),
        ],
      },
    });
    expect(screen.getByRole('alert')).toHaveTextContent('Select up to 1 more photo.');
    expect(screen.queryByRole('img')).toBeNull();
  });
  it('previews and removes selection, revoking temporary URL', async () => {
    render(<PhotoCapture itemId="test-item" />);
    fireEvent.change(screen.getByLabelText('Choose from gallery or files'), {
      target: { files: [new File(['synthetic'], 'photo.jpg', { type: 'image/jpeg' })] },
    });
    expect(await screen.findByRole('img')).toHaveAttribute('src', 'blob:synthetic');
    fireEvent.click(screen.getByRole('button', { name: 'Remove photo 1' }));
    expect(screen.queryByRole('img')).toBeNull();
    expect(revoke).toHaveBeenCalledWith('blob:synthetic');
  });
  it('shows per-file unsupported format and size errors before upload', async () => {
    render(<PhotoCapture itemId="test-item" />);
    fireEvent.change(screen.getByLabelText('Choose from gallery or files'), {
      target: {
        files: [
          new File(['heic'], 'photo.heic', { type: 'image/heic' }),
          new File([], 'empty.png', { type: 'image/png' }),
        ],
      },
    });
    // jsdom has no HEIC decoder: the owner gets guidance and working alternatives.
    expect(await screen.findByText(heic.heicGuidance)).toBeVisible();
    expect(screen.getByText('Choose a photo smaller than 10 MiB.')).toBeVisible();
    // Rejected files are never presented as pending or partially uploaded.
    expect(screen.getAllByText('Not uploaded')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Upload photos' })).toBeDisabled();
  });
  it('converts HEIC once on this device and retries the identical bytes with one Upload-Id', async () => {
    vi.mocked(heic.canConvertHeic).mockResolvedValue(true);
    const converted = new File(['jpeg-bytes'], 'IMG_0001.jpg', { type: 'image/jpeg' });
    vi.mocked(heic.convertHeic).mockResolvedValue({ ok: true, file: converted });
    FakeXhr.outcomes = ['error', 201];
    render(<PhotoCapture itemId="test-item" />);
    await waitFor(() =>
      expect(screen.getByLabelText('Choose from gallery or files')).toHaveAttribute(
        'accept',
        'image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif',
      ),
    );
    // The camera input keeps JPEG-only capture.
    expect(screen.getByLabelText('Take a photo')).toHaveAttribute(
      'accept',
      'image/jpeg,image/png,image/webp',
    );
    expect(screen.getByText(/converted to JPEG on this device before upload/)).toBeVisible();
    fireEvent.change(screen.getByLabelText('Choose from gallery or files'), {
      target: { files: [new File(['heic'], 'IMG_0001.HEIC', { type: '' })] },
    });
    expect(await screen.findByText('Converted from HEIC to JPEG · Ready to upload')).toBeVisible();
    expect(screen.getByText('IMG_0001.HEIC')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Upload photos' }));
    expect(
      await screen.findByText('Connection interrupted. Retry this photo to check its saved state.'),
    ).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Upload or retry unsaved photos' }));
    expect(await screen.findByText('Saved privately')).toBeVisible();
    expect(heic.convertHeic).toHaveBeenCalledTimes(1);
    expect(FakeXhr.sent).toHaveLength(2);
    expect(FakeXhr.sent[0]!.file).toBe(converted);
    expect(FakeXhr.sent[1]!.file).toBe(converted);
    expect(FakeXhr.sent[1]!.uploadId).toBe(FakeXhr.sent[0]!.uploadId);
  });
  it('detects unlabeled HEIC by signature and rejects failed conversion with guidance', async () => {
    vi.mocked(heic.convertHeic).mockResolvedValue({ ok: false, message: heic.heicGuidance });
    render(<PhotoCapture itemId="test-item" />);
    const bytes = new Uint8Array([0, 0, 0, 24, ...new TextEncoder().encode('ftypheic')]);
    fireEvent.change(screen.getByLabelText('Choose from gallery or files'), {
      target: { files: [new File([bytes], 'upload.jpg', { type: '' })] },
    });
    expect(await screen.findByText(heic.heicGuidance)).toBeVisible();
    expect(screen.getByText('Not uploaded')).toBeVisible();
    expect(FakeXhr.sent).toHaveLength(0);
  });
  it('cancels an in-flight upload and keeps it retryable with the same Upload-Id', async () => {
    FakeXhr.outcomes = ['hold', 201];
    render(<PhotoCapture itemId="test-item" />);
    fireEvent.change(screen.getByLabelText('Choose from gallery or files'), {
      target: { files: [new File(['synthetic'], 'photo.jpg', { type: 'image/jpeg' })] },
    });
    await screen.findByRole('img');
    await userEvent.click(screen.getByRole('button', { name: 'Upload photos' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel upload' }));
    expect(
      await screen.findByText('Upload cancelled. Retry to check its saved state.'),
    ).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Upload or retry unsaved photos' }));
    expect(await screen.findByText('Saved privately')).toBeVisible();
    expect(FakeXhr.sent[1]!.uploadId).toBe(FakeXhr.sent[0]!.uploadId);
  });
  it('explains session expiry and offline state without claiming a save', async () => {
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    FakeXhr.outcomes = [401];
    render(<PhotoCapture itemId="test-item" />);
    expect(
      screen.getByText(/You.re offline\. Selected photos stay on this page only/),
    ).toBeVisible();
    act(() => {
      online.mockReturnValue(true);
      window.dispatchEvent(new Event('online'));
    });
    expect(screen.queryByText(/You.re offline/)).toBeNull();
    fireEvent.change(screen.getByLabelText('Choose from gallery or files'), {
      target: { files: [new File(['synthetic'], 'photo.jpg', { type: 'image/jpeg' })] },
    });
    await screen.findByRole('img');
    await userEvent.click(screen.getByRole('button', { name: 'Upload photos' }));
    expect(
      await screen.findByText(
        'Your session has expired, so this photo was not saved. Sign in again, then add it.',
      ),
    ).toBeVisible();
    online.mockRestore();
  });
});
