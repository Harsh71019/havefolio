import { execFile, spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';

export interface SandboxLimits {
  /** V8 heap only; native/WebAssembly memory is bounded by `rssKiB`. */
  heapMiB: number;
  /** Resident set kill threshold, sampled every 100 ms. */
  rssKiB: number;
  timeoutMs: number;
  outputBytes: number;
  /** Native addons (sharp/libvips) are outside the permission model; keep the env empty. */
  addons?: boolean;
  /** tesseract.js runs its WebAssembly core on a worker thread. */
  worker?: boolean;
}

/** Fixed failure tokens only: never child output, paths or image content. */
export class SandboxError extends Error {
  constructor(readonly code: 'OCR_SANDBOX_FAILED' | 'OCR_SANDBOX_LIMIT' | 'OCR_ABORTED') {
    super(code);
    this.name = 'SandboxError';
  }
}

export function rssOver(status: string, limitKiB: number): boolean {
  const match = /^VmRSS:\s+(\d+)/m.exec(status);
  // A missing VmRSS means the kernel has detached the address space while the process exits
  // (as in the PER-14 PDF sandbox); close then validates its exit code and output.
  return match !== null && Number(match[1]) > limitKiB;
}

/**
 * Runs one disposable child under Node's permission model: no file writes, child processes
 * or reads outside `allowRead` (so no parent `/proc/<pid>/environ`), an empty environment,
 * stdin-only input, bounded stdout and suppressed stderr. Any limit, abort or non-zero exit
 * kills the child and rejects without surfacing what it printed.
 */
export function runSandboxed(
  script: string,
  input: Buffer,
  allowRead: readonly string[],
  limits: SandboxLimits,
  signal: AbortSignal,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new SandboxError('OCR_ABORTED'));
      return;
    }
    const child = spawn(
      process.execPath,
      [
        `--max-old-space-size=${limits.heapMiB}`,
        '--permission',
        ...allowRead.map((path) => `--allow-fs-read=${path}`),
        ...(limits.addons ? ['--allow-addons'] : []),
        ...(limits.worker ? ['--allow-worker'] : []),
        script,
      ],
      { stdio: ['pipe', 'pipe', 'ignore'], env: {} },
    );
    const chunks: Buffer[] = [];
    let size = 0,
      failure: SandboxError | undefined,
      monitoring = false;
    const kill = (code: SandboxError['code']): void => {
      // A child that already exited is not reported as killed; close validates its result.
      if (child.exitCode === null && child.kill('SIGKILL')) failure ??= new SandboxError(code);
    };
    const onAbort = (): void => kill('OCR_ABORTED');
    signal.addEventListener('abort', onAbort, { once: true });
    const deadline = setTimeout(() => kill('OCR_SANDBOX_LIMIT'), limits.timeoutMs);
    const memory = setInterval(() => {
      if (monitoring || !child.pid) return;
      monitoring = true;
      if (process.platform === 'linux') {
        void readFile(`/proc/${child.pid}/status`, 'utf8')
          .then((status) => {
            if (rssOver(status, limits.rssKiB)) kill('OCR_SANDBOX_LIMIT');
          })
          .catch((error: NodeJS.ErrnoException) => {
            if (error.code !== 'ENOENT') kill('OCR_SANDBOX_LIMIT');
          })
          .finally(() => {
            monitoring = false;
          });
        return;
      }
      execFile('/bin/ps', ['-o', 'rss=', '-p', String(child.pid)], { timeout: 1000 }, (e, out) => {
        monitoring = false;
        const kib = Number(out.trim());
        if (
          (e && e.code !== 1) ||
          (!e && (!out.trim() || !Number.isFinite(kib) || kib > limits.rssKiB))
        )
          kill('OCR_SANDBOX_LIMIT');
      });
    }, 100);
    const clear = (): void => {
      clearTimeout(deadline);
      clearInterval(memory);
      signal.removeEventListener('abort', onAbort);
    };
    child.stdin.on('error', () => undefined);
    child.stdout.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limits.outputBytes) {
        kill('OCR_SANDBOX_LIMIT');
        return;
      }
      chunks.push(chunk);
    });
    child.on('error', () => {
      clear();
      reject(new SandboxError('OCR_SANDBOX_FAILED'));
    });
    child.on('close', (code) => {
      clear();
      const output = Buffer.concat(chunks);
      chunks.forEach((c) => c.fill(0));
      if (failure || code !== 0 || !output.length) {
        output.fill(0);
        reject(failure ?? new SandboxError('OCR_SANDBOX_FAILED'));
      } else resolve(output);
    });
    child.stdin.end(input);
  });
}
