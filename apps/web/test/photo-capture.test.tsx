import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PhotoCapture } from '../components/photo-capture';
const revoke = vi.fn();
beforeEach(() => {
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
  it('previews and removes selection, revoking temporary URL', () => {
    render(<PhotoCapture itemId="test-item" />);
    fireEvent.change(screen.getByLabelText('Choose from gallery or files'), {
      target: { files: [new File(['synthetic'], 'photo.jpg', { type: 'image/jpeg' })] },
    });
    expect(screen.getByRole('img')).toHaveAttribute('src', 'blob:synthetic');
    fireEvent.click(screen.getByRole('button', { name: 'Remove photo 1' }));
    expect(screen.queryByRole('img')).toBeNull();
    expect(revoke).toHaveBeenCalledWith('blob:synthetic');
  });
  it('shows per-file unsupported format and size errors before upload', () => {
    render(<PhotoCapture itemId="test-item" />);
    fireEvent.change(screen.getByLabelText('Choose from gallery or files'), {
      target: {
        files: [
          new File(['heic'], 'photo.heic', { type: 'image/heic' }),
          new File([], 'empty.png', { type: 'image/png' }),
        ],
      },
    });
    expect(
      screen.getByText(
        'HEIC/HEIF is not supported yet. Export this photo as JPEG, PNG or WebP and try again.',
      ),
    ).toBeVisible();
    expect(screen.getByText('Choose a photo smaller than 10 MiB.')).toBeVisible();
    // Rejected files are never presented as pending or partially uploaded.
    expect(screen.getAllByText('Not uploaded')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Upload photos' })).toBeDisabled();
  });
});
