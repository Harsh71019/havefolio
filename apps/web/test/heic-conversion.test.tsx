import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  canConvertHeic,
  conversionLimits,
  convertHeic,
  heicGuidance,
  isHeic,
  resetHeicSupport,
} from '../components/heic-conversion';

// Synthetic decoder: the probe and every source "decode" to these dimensions.
let size = { width: 4032, height: 3024 };
let decode: () => Promise<void> = () => Promise.resolve();
class FakeImage {
  src = '';
  get naturalWidth(): number {
    return size.width;
  }
  get naturalHeight(): number {
    return size.height;
  }
  decode(): Promise<void> {
    return decode();
  }
}
let drawn: number[] = [];
const revoke = vi.fn();
let output = new Blob([new Uint8Array(2048)], { type: 'image/jpeg' });

beforeEach(() => {
  resetHeicSupport();
  size = { width: 4032, height: 3024 };
  decode = () => Promise.resolve();
  output = new Blob([new Uint8Array(2048)], { type: 'image/jpeg' });
  drawn = [];
  vi.stubGlobal('Image', FakeImage);
  URL.createObjectURL = vi.fn(() => 'blob:synthetic-heic');
  URL.revokeObjectURL = revoke;
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (
    this: HTMLCanvasElement,
  ) {
    return {
      drawImage: (_image: unknown, _x: number, _y: number, w: number, h: number) =>
        drawn.push(w, h),
    } as unknown as CanvasRenderingContext2D;
  } as never);
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((done, type, quality) => {
    expect([type, quality]).toEqual(['image/jpeg', conversionLimits.quality]);
    done(output);
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const heicFile = (bytes: BlobPart[] = ['heic'], name = 'IMG_0001.HEIC'): File =>
  new File(bytes, name, { type: 'image/heic' });

describe('PER-47 on-device HEIC conversion', () => {
  it('recognises HEIC by type, extension or ISO-BMFF brand, but not JPEG/PNG/WebP', async () => {
    const brand = (b: string): Uint8Array<ArrayBuffer> =>
      new Uint8Array([0, 0, 0, 24, ...new TextEncoder().encode(`ftyp${b}`)]);
    expect(await isHeic(new File(['x'], 'a.bin', { type: 'image/heif' }))).toBe(true);
    expect(await isHeic(new File(['x'], 'IMG.HEIF', { type: '' }))).toBe(true);
    expect(await isHeic(new File([brand('heic')], 'upload', { type: '' }))).toBe(true);
    expect(await isHeic(new File([brand('mif1')], 'x', { type: 'application/octet-stream' }))).toBe(
      true,
    );
    expect(await isHeic(new File([brand('isom')], 'clip.mp4', { type: '' }))).toBe(false);
    expect(await isHeic(new File([brand('heic')], 'a.jpg', { type: 'image/jpeg' }))).toBe(false);
  });

  it('reports unsupported browsers and returns actionable guidance', async () => {
    decode = () => Promise.reject(new Error('EncodingError'));
    expect(await canConvertHeic()).toBe(false);
    expect(await convertHeic(heicFile())).toEqual({ ok: false, message: heicGuidance });
    expect(heicGuidance).toMatch(/Most Compatible.*export it as JPEG.*add photos later/);
  });

  it('converts to a metadata-free JPEG, bounded to the stored 4096px master', async () => {
    size = { width: 8064, height: 6048 }; // 48 MP source
    const result = await convertHeic(heicFile());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.file).toMatchObject({ name: 'IMG_0001.jpg', type: 'image/jpeg', size: 2048 });
    expect(drawn).toEqual([4096, 3072]);
    expect(revoke).toHaveBeenCalledWith('blob:synthetic-heic');
  });

  it('does not upscale smaller photos and names extensionless files safely', async () => {
    size = { width: 1200, height: 900 };
    const result = await convertHeic(heicFile(['heic'], '.heic'));
    expect(result.ok && result.file.name).toBe('photo.jpg');
    expect(drawn).toEqual([1200, 900]);
  });

  it('rejects empty, oversized input and oversized output before upload', async () => {
    expect(await convertHeic(heicFile([]))).toMatchObject({ ok: false });
    const big = heicFile();
    Object.defineProperty(big, 'size', { value: conversionLimits.inputBytes + 1 });
    expect(await convertHeic(big)).toEqual({
      ok: false,
      message: 'Choose a HEIC photo smaller than 10 MiB.',
    });
    output = new Blob([new Uint8Array(conversionLimits.outputBytes + 1)]);
    expect(await convertHeic(heicFile())).toMatchObject({
      ok: false,
      message: expect.stringMatching(/larger than 10 MiB/) as string,
    });
  });

  it('treats corrupt or hanging decodes as failures without blocking the page', async () => {
    expect(await canConvertHeic()).toBe(true);
    decode = () => Promise.reject(new Error('corrupt'));
    expect(await convertHeic(heicFile())).toMatchObject({
      ok: false,
      message: expect.stringMatching(/could not be converted safely/) as string,
    });
    vi.useFakeTimers();
    decode = () => new Promise(() => undefined);
    const pending = convertHeic(heicFile());
    await vi.advanceTimersByTimeAsync(conversionLimits.timeoutMs);
    expect(await pending).toMatchObject({ ok: false });
  });
});
