import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PhotoCapture } from '../components/photo-capture';
const revoke = vi.fn();
beforeEach(() => {
  revoke.mockClear();
  URL.createObjectURL = vi.fn(() => 'blob:synthetic');
  URL.revokeObjectURL = revoke;
});
afterEach(() => vi.restoreAllMocks());
describe('private photo capture', () => {
  it('offers separate camera and multiple gallery inputs and safe return navigation', () => {
    render(<PhotoCapture itemId="test-item" />);
    expect(screen.getByLabelText('Take a photo')).toHaveAttribute('capture', 'environment');
    expect(screen.getByLabelText('Choose from gallery or files')).toHaveAttribute('multiple');
    expect(screen.getByRole('link', { name: 'Back to item' })).toHaveAttribute(
      'href',
      '/items/test-item',
    );
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
    expect(screen.getByText('Choose JPEG, PNG or WebP. HEIC/HEIF is not supported.')).toBeVisible();
    expect(screen.getByText('Choose a photo smaller than 10 MiB.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Upload or retry unsaved photos' })).toBeDisabled();
  });
});
