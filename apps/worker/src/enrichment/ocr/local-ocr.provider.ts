import { createHash, timingSafeEqual } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ocrCandidates,
  type EnrichmentCandidate,
  type EnrichmentContext,
  type EnrichmentInput,
  type EnrichmentProvider,
  type OcrLine,
} from '@havefolio/domain';
import type { EnrichmentStore } from '@havefolio/db';
import type { PrivateImageReader } from './media-reader.js';
import { ocrImageLimits } from './ocr-limits.js';
import { runSandboxed } from './sandbox.js';

export interface OcrRunner {
  prepare(image: Buffer, signal: AbortSignal): Promise<Buffer>;
  recognize(prepared: Buffer, signal: AbortSignal): Promise<OcrLine[]>;
}

/** Directory holding a dependency, resolved through pnpm symlinks to its real location. */
function packageRoot(name: string): string {
  const require = createRequire(import.meta.url);
  // Some packages do not export package.json, so walk up from the resolved main entry.
  let directory = dirname(realpathSync(require.resolve(name)));
  const suffix = `${sep}node_modules${sep}${name.split('/').join(sep)}`;
  while (!directory.endsWith(suffix)) {
    const parent = dirname(directory);
    if (parent === directory) throw new Error('OCR_DEPENDENCY_MISSING');
    directory = parent;
  }
  return directory;
}
/** The dependency store holding `path`: pnpm's `node_modules/.pnpm`, else `node_modules`. */
function storeRoot(path: string): string {
  const pnpm = `${sep}node_modules${sep}.pnpm${sep}`;
  const index = path.indexOf(pnpm);
  if (index !== -1) return path.slice(0, index + pnpm.length - 1);
  const modules = `${sep}node_modules${sep}`;
  return path.slice(0, path.lastIndexOf(modules) + modules.length - 1);
}

/** Children may read only their own compiled code, the worker manifest and dependencies. */
export function sandboxReadPaths(): string[] {
  const here = dirname(fileURLToPath(import.meta.url));
  const workerRoot = dirname(dirname(dirname(here)));
  const stores = new Set(
    // Transitive packages (tesseract.js-core, @img/sharp-*) live in the same store.
    ['sharp', 'tesseract.js', '@tesseract.js-data/eng'].map((name) => storeRoot(packageRoot(name))),
  );
  return [here, `${workerRoot}${sep}package.json`, `${workerRoot}${sep}node_modules`, ...stores];
}

export class SandboxedOcrRunner implements OcrRunner {
  private readonly directory = dirname(fileURLToPath(import.meta.url));
  private readonly allowRead = sandboxReadPaths();
  prepare(image: Buffer, signal: AbortSignal): Promise<Buffer> {
    return runSandboxed(
      `${this.directory}${sep}prepare-child.js`,
      image,
      this.allowRead,
      { ...ocrImageLimits.prepare, addons: true },
      signal,
    );
  }
  async recognize(prepared: Buffer, signal: AbortSignal): Promise<OcrLine[]> {
    const output = await runSandboxed(
      `${this.directory}${sep}recognize-child.js`,
      prepared,
      this.allowRead,
      { ...ocrImageLimits.recognize, worker: true },
      signal,
    );
    try {
      const parsed: unknown = JSON.parse(output.toString('utf8'));
      const lines =
        parsed && typeof parsed === 'object' && 'lines' in parsed && Array.isArray(parsed.lines)
          ? (parsed.lines as unknown[])
          : null;
      if (!lines || lines.length > ocrImageLimits.lines) throw new Error();
      return lines.map((line) => {
        const l = line as Partial<OcrLine>;
        if (
          typeof l.text !== 'string' ||
          l.text.length > ocrImageLimits.lineLength ||
          typeof l.confidence !== 'number' ||
          typeof l.height !== 'number'
        )
          throw new Error();
        return { text: l.text, confidence: l.confidence, height: l.height };
      });
    } catch {
      throw new Error('OCR_RESULT_INVALID');
    } finally {
      output.fill(0);
    }
  }
}

/**
 * PER-45 local photo/receipt adapter. Every step is owner-scoped to the claimed work and
 * runs on this worker: no external OCR provider, fetch of other URLs, prompt or upload.
 * Recognised text exists only in memory for this call; only bounded suggestions return.
 */
export class LocalOcrProvider implements EnrichmentProvider {
  readonly id = 'local-ocr';
  readonly kinds = ['photo', 'receipt'] as const;
  readonly timeoutMs = ocrImageLimits.totalMs;
  constructor(
    private readonly store: Pick<EnrichmentStore, 'readyImage'>,
    private readonly reader: PrivateImageReader,
    private readonly runner: OcrRunner = new SandboxedOcrRunner(),
    private readonly today: () => string = () => new Date().toISOString().slice(0, 10),
  ) {}
  async suggest(
    input: EnrichmentInput,
    signal: AbortSignal,
    context?: EnrichmentContext,
  ): Promise<EnrichmentCandidate[]> {
    if ((input.kind !== 'photo' && input.kind !== 'receipt') || !context)
      throw new Error('OCR_INPUT_UNSUPPORTED');
    const media = await this.store.readyImage(
      context.ownerId,
      context.itemId,
      input.attachmentId,
      input.kind,
    );
    if (!media) throw new Error('OCR_MEDIA_UNAVAILABLE');
    let image: Buffer | undefined, prepared: Buffer | undefined;
    try {
      image = await this.reader.read(media.objectKey, media.format, media.byteSize, signal);
      const digest = createHash('sha256').update(image).digest();
      const expected = Buffer.from(media.checksum, 'hex');
      if (expected.length !== digest.length || !timingSafeEqual(digest, expected))
        throw new Error('OCR_MEDIA_CHECKSUM');
      prepared = await this.runner.prepare(image, signal);
      image.fill(0);
      const lines = await this.runner.recognize(prepared, signal);
      return ocrCandidates(input.kind, lines, this.id, this.today());
    } finally {
      image?.fill(0);
      prepared?.fill(0);
    }
  }
}
