/**
 * PER-45 resource policy, measured on Linux at the worker's 0.5 CPU / 256 MiB limits with
 * the synthetic set and a noisy 4096×3072 photo: preparation peaked at 98 MiB RSS and
 * recognition at about 154 MiB. Children run one after another, so the documented 57–63 MiB
 * worker plus one child at its kill threshold stays below the container limit.
 * See docs/architecture/photo-receipt-ocr.md.
 */
export const ocrImageLimits = {
  /** Existing stored-image bound (PER-13); larger originals are never read. */
  inputBytes: 10 * 1024 * 1024,
  /** Existing upload decode bound; originals are at most 4096 on either axis. */
  inputPixels: 24_000_000,
  maxWidth: 1600,
  maxHeight: 2400,
  recognitionPixels: 3_200_000,
  /** Uncompressed 8-bit greyscale of the bounded image plus PNG overhead. */
  preparedBytes: 8 * 1024 * 1024,
  // Equal to the domain `ocrLimits`; children import no workspace packages (tested).
  lines: 200,
  lineLength: 300,
  prepare: { heapMiB: 64, rssKiB: 112 * 1024, timeoutMs: 10_000, outputBytes: 8 * 1024 * 1024 },
  recognize: { heapMiB: 64, rssKiB: 168 * 1024, timeoutMs: 15_000, outputBytes: 128 * 1024 },
  /** Whole adapter deadline including the private read; below the 30-second work lease. */
  totalMs: 25_000,
  readMs: 10_000,
} as const;

/** Reads at most `limit` bytes from stdin; a larger input exits instead of buffering. */
export async function readBoundedStdin(limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of process.stdin as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > limit) process.exit(3);
    chunks.push(chunk);
  }
  const input = Buffer.concat(chunks);
  chunks.forEach((c) => c.fill(0));
  return input;
}
