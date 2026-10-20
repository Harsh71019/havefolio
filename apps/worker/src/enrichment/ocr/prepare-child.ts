/**
 * Sandboxed child: decode one sanitized private original and emit a bounded greyscale PNG
 * for recognition. Input arrives on stdin only; nothing is written to disk or logged.
 */
import sharp from 'sharp';
import { ocrImageLimits, readBoundedStdin } from './ocr-limits.js';

sharp.cache(false);
sharp.concurrency(1);
const input = await readBoundedStdin(ocrImageLimits.inputBytes);
const image = sharp(input, {
  failOn: 'warning',
  limitInputPixels: ocrImageLimits.inputPixels,
  sequentialRead: true,
  animated: false,
}).timeout({ seconds: 8 });
const { width, height } = await image.metadata();
if (!width || !height) process.exit(2);
// Bound both axis and area: OCR memory grows with pixels, not with the stored file size.
const scale = Math.min(
  1,
  ocrImageLimits.maxWidth / width,
  ocrImageLimits.maxHeight / height,
  Math.sqrt(ocrImageLimits.recognitionPixels / (width * height)),
);
// Stored originals are already orientation-normalised and stripped (PER-13), so no rotate:
// that also keeps libvips shrink-on-load available, which bounds decode memory.
const output = await image
  .resize({
    width: Math.max(1, Math.floor(width * scale)),
    height: Math.max(1, Math.floor(height * scale)),
    fit: 'fill',
  })
  .grayscale()
  .normalise()
  .toColourspace('b-w')
  .png({ compressionLevel: 1 })
  .toBuffer();
input.fill(0);
process.stdout.write(output);
