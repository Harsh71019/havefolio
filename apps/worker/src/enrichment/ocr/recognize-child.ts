/**
 * Sandboxed child: local Tesseract recognition of one prepared greyscale PNG. Language data
 * is read from the installed package (never the default CDN) and nothing is cached to disk.
 * Only bounded line text, confidence and height leave the process; text is untrusted data.
 */
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { createWorker, OEM, PSM } from 'tesseract.js';
import { ocrImageLimits, readBoundedStdin } from './ocr-limits.js';

const require = createRequire(import.meta.url);
const input = await readBoundedStdin(ocrImageLimits.preparedBytes);
const worker = await createWorker('eng', OEM.LSTM_ONLY, {
  langPath: join(dirname(require.resolve('@tesseract.js-data/eng')), '4.0.0_best_int'),
  cacheMethod: 'none',
  gzip: true,
  logger: () => undefined,
  errorHandler: () => undefined,
});
// One text block keeps each receipt row's item text and amount together. Automatic layout
// analysis also finds display-size logo text, but measured 177–184 MiB on noisy 0.5-CPU
// photos versus at most ~154 MiB here, so it is not used (PER-45 evaluation).
await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK });
const { data } = await worker.recognize(input, {}, { blocks: true, text: false });
input.fill(0);
await worker.terminate();
const lines: Array<{ text: string; confidence: number; height: number }> = [];
for (const block of data.blocks ?? [])
  for (const paragraph of block.paragraphs)
    for (const line of paragraph.lines) {
      if (lines.length >= ocrImageLimits.lines) break;
      lines.push({
        text: line.text.trim().slice(0, ocrImageLimits.lineLength),
        confidence: Math.round(line.confidence),
        height: Math.max(0, line.bbox.y1 - line.bbox.y0),
      });
    }
process.stdout.write(JSON.stringify({ lines }));
