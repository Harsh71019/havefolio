import { describe, expect, it, jest } from '@jest/globals';
import sharp from 'sharp';
import { PhotoProcessor, validatePhoto } from './photo-processing.js';
const fixture = (): ReturnType<typeof sharp> =>
  sharp({ create: { width: 640, height: 480, channels: 3, background: '#abcdef' } });
describe('photo decoding and sanitization', () => {
  for (const format of ['jpeg', 'png', 'webp'] as const)
    it(`decodes ${format} into sanitized variants`, async () => {
      const bytes = await fixture()[format]().toBuffer();
      const outputs = await new PhotoProcessor().process({
        bytes,
        mimeType: `image/${format}`,
        filename: `synthetic.${format}`,
      });
      expect(outputs.map((o) => o.variant)).toEqual(['original', 'display', 'thumbnail']);
      expect(outputs.map((o) => [o.width, o.height])).toEqual([
        [640, 480],
        [640, 480],
        [320, 240],
      ]);
      for (const o of outputs) {
        const meta = await sharp(o.bytes).metadata();
        expect(meta.format).toBe('webp');
        expect(meta.exif).toBeUndefined();
        expect(meta.icc).toBeUndefined();
        expect(o.checksum).toMatch(/^[a-f0-9]{64}$/);
      }
    });
  it('rotates EXIF orientation and strips GPS', async () => {
    const bytes = await fixture()
      .withMetadata({ orientation: 6 })
      .withExifMerge({
        IFD0: { Artist: 'Synthetic' },
        IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '1/1 2/1 3/1' },
      })
      .jpeg()
      .toBuffer();
    const out = await new PhotoProcessor().process({
      bytes,
      mimeType: 'image/jpeg',
      filename: 'synthetic.jpg',
    });
    expect([out[0]!.width, out[0]!.height]).toEqual([480, 640]);
    expect((await sharp(out[0]!.bytes).metadata()).exif).toBeUndefined();
  });
  it('rejects MIME, extension, malformed, truncated and trailing payloads', async () => {
    const bytes = await fixture().png().toBuffer();
    for (const input of [
      { bytes, mimeType: 'image/jpeg', filename: 'synthetic.png' },
      { bytes, mimeType: 'image/png', filename: 'synthetic.jpg' },
      { bytes: bytes.subarray(0, -20), mimeType: 'image/png', filename: 'synthetic.png' },
      {
        bytes: Buffer.concat([bytes, Buffer.from('payload')]),
        mimeType: 'image/png',
        filename: 'synthetic.png',
      },
    ])
      expect(() => validatePhoto(input)).toThrow();
    const corrupt = Buffer.from(bytes);
    corrupt.fill(0, 50, 100);
    await expect(
      new PhotoProcessor().process({
        bytes: corrupt,
        mimeType: 'image/png',
        filename: 'synthetic.png',
      }),
    ).rejects.toThrow('PHOTO_INVALID');
  });
  it('detects HEIF brands independently of MIME and extension', () => {
    for (const brand of ['heic', 'heix', 'mif1', 'msf1'])
      expect(() =>
        validatePhoto({
          bytes: Buffer.concat([
            Buffer.from([0, 0, 0, 24]),
            Buffer.from(`ftyp${brand}\0\0\0\0${brand}`),
          ]),
          mimeType: 'image/jpeg',
          filename: 'fake.jpg',
        }),
      ).toThrow('PHOTO_HEIC_UNSUPPORTED');
  });
  it('rejects file size and dimension/pixel bombs', async () => {
    expect(() =>
      validatePhoto({
        bytes: Buffer.alloc(10 * 1024 * 1024 + 1),
        mimeType: 'image/png',
        filename: 'big.png',
      }),
    ).toThrow('PHOTO_FILE_SIZE');
    for (const [width, height] of [
      [8193, 1],
      [6000, 5000],
    ] as const) {
      const bytes = await sharp({ create: { width, height, channels: 3, background: '#ffffff' } })
        .png()
        .toBuffer();
      await expect(
        new PhotoProcessor().process({ bytes, mimeType: 'image/png', filename: 'big.png' }),
      ).rejects.toThrow('PHOTO_INVALID');
    }
  });
  it('rejects PNG animation control and unsupported containers', async () => {
    const bytes = await fixture().png().toBuffer();
    const chunk = Buffer.concat([Buffer.from([0, 0, 0, 8]), Buffer.from('acTL'), Buffer.alloc(12)]);
    expect(() =>
      validatePhoto({
        bytes: Buffer.concat([bytes.subarray(0, -12), chunk, bytes.subarray(-12)]),
        mimeType: 'image/png',
        filename: 'synthetic.png',
      }),
    ).toThrow('PHOTO_ANIMATION_UNSUPPORTED');
    expect(() =>
      validatePhoto({
        bytes: Buffer.from('GIF89a synthetic'),
        mimeType: 'image/gif',
        filename: 'synthetic.gif',
      }),
    ).toThrow('PHOTO_FORMAT_MISMATCH');
  });
  it('rejects successfully decoded animated WebP', async () => {
    const frame = await fixture().png().toBuffer();
    const bytes = await sharp([frame, frame], { join: { animated: true } })
      .webp({ loop: 0, delay: [100, 100] })
      .toBuffer();
    expect((await sharp(bytes).metadata()).pages).toBe(2);
    await expect(
      new PhotoProcessor().process({ bytes, mimeType: 'image/webp', filename: 'synthetic.webp' }),
    ).rejects.toThrow('PHOTO_INVALID');
  });
  it('kills the decoder at the wall-clock deadline and releases admission', async () => {
    const bytes = await fixture().png().toBuffer();
    const processor = new PhotoProcessor();
    jest.useFakeTimers();
    try {
      const result = processor.process({ bytes, mimeType: 'image/png', filename: 'synthetic.png' });
      const assertion = expect(result).rejects.toThrow('PHOTO_PROCESSING_TIMEOUT');
      jest.advanceTimersByTime(10_000);
      await assertion;
    } finally {
      jest.useRealTimers();
    }
    await expect(
      processor.process({ bytes, mimeType: 'image/png', filename: 'synthetic.png' }),
    ).resolves.toHaveLength(3);
  });
  it('rejects parallel native processing and releases admission after failure', async () => {
    const p = new PhotoProcessor();
    const bytes = await fixture().png().toBuffer();
    const first = p.process({ bytes, mimeType: 'image/png', filename: 'test.png' });
    await expect(p.process({ bytes, mimeType: 'image/png', filename: 'test.png' })).rejects.toThrow(
      'PHOTO_PROCESSING_BUSY',
    );
    await first;
    await expect(
      p.process({ bytes, mimeType: 'image/png', filename: 'test.png' }),
    ).resolves.toHaveLength(3);
  });
});
