import type { DestinationStream } from 'pino';
import { safeEvent } from './sanitize.js';

export interface SeqOptions {
  endpoint?: string | undefined;
  apiKey?: string | undefined;
  enabled: boolean;
}
export function seqEndpoint(options: SeqOptions): string | undefined {
  if (!options.enabled || !options.apiKey || options.apiKey.startsWith('REPLACE_WITH_'))
    return undefined;
  try {
    const url = new URL(options.endpoint ?? '');
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !['/', '/ingest/clef'].includes(url.pathname)
    )
      return undefined;
    url.pathname = '/ingest/clef';
    return url.toString();
  } catch {
    return undefined;
  }
}

/** One in-flight batch, <=256 queued events, <=64KiB/batch; drops after two attempts.
 * Console is written first. No await or transport exception enters application work.
 */
export class LogDestination implements DestinationStream {
  private queue: string[] = [];
  private queuedBytes = 0;
  private inFlight = false;
  private closed = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private controller: AbortController | undefined;
  private readonly endpoint: string | undefined;
  constructor(
    private readonly options: SeqOptions,
    private readonly console: DestinationStream = process.stdout,
    private readonly send: typeof fetch = fetch,
  ) {
    this.endpoint = seqEndpoint(options);
  }
  write(line: string): void {
    // Final sink boundary also strips arbitrary pino child bindings.
    try {
      const original = JSON.parse(line) as Record<string, unknown>;
      const event = safeEvent(original);
      const error = original.error as Record<string, unknown> | undefined;
      if (error && typeof error === 'object') {
        event.error = {
          type:
            typeof error.type === 'string' &&
            [
              'Error',
              'UnknownError',
              'TypeError',
              'RangeError',
              'SyntaxError',
              'HttpException',
              'BadRequestException',
              'UnauthorizedException',
              'ForbiddenException',
              'ServiceUnavailableException',
            ].includes(error.type)
              ? error.type
              : 'Error',
          ...(typeof error.code === 'string' && /^(E[A-Z]{2,24}|[0-9]{5})$/.test(error.code)
            ? { code: error.code }
            : {}),
          ...(Array.isArray(error.stack)
            ? {
                stack: error.stack
                  .slice(0, 8)
                  .filter(
                    (v: unknown) =>
                      typeof v === 'string' && /^at \[frame\](?::[0-9]{1,7}:[0-9]{1,7})?$/.test(v),
                  ),
              }
            : {}),
        };
      }
      for (const field of ['application', 'service', 'environment', 'release'] as const) {
        const value = original[field];
        if (typeof value === 'string' && /^[A-Za-z0-9_.-]{1,80}$/.test(value)) event[field] = value;
      }
      line =
        JSON.stringify({
          ...event,
          time: typeof original.time === 'number' ? original.time : Date.now(),
          level: typeof original.level === 'number' ? original.level : 30,
        }) + '\n';
    } catch {
      return;
    }
    try {
      this.console.write(line);
    } catch {
      /* Logging never changes application outcome. */
    }
    if (
      !this.endpoint ||
      this.closed ||
      this.queue.length >= 256 ||
      this.queuedBytes + Buffer.byteLength(line) > 256 * 4096
    )
      return;
    try {
      const event = JSON.parse(line) as Record<string, unknown>;
      const { time, level, ...properties } = event;
      const levels: Record<number, string> = {
        10: 'Verbose',
        20: 'Debug',
        30: 'Information',
        40: 'Warning',
        50: 'Error',
        60: 'Fatal',
      };
      const clef =
        JSON.stringify({
          '@t': new Date(Number(time)).toISOString(),
          '@mt': '{event}',
          '@l': levels[Number(level)] ?? 'Information',
          ...properties,
        }) + '\n';
      if (Buffer.byteLength(clef) > 4096) return;
      this.queue.push(clef);
      this.queuedBytes += Buffer.byteLength(clef);
      this.schedule(100);
    } catch {
      /* Drop malformed telemetry, retain console. */
    }
  }
  private schedule(delay: number): void {
    if (this.timer || this.inFlight || this.closed || !this.queue.length) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.flush();
    }, delay);
    this.timer.unref();
  }
  private async flush(): Promise<void> {
    if (!this.endpoint || this.closed) return;
    this.inFlight = true;
    const batch = this.queue.splice(0, 16);
    const body = batch.join('');
    this.queuedBytes -= Buffer.byteLength(body);
    try {
      for (let attempt = 0; attempt < 2 && !this.closed; attempt++) {
        this.controller = new AbortController();
        const timeout = setTimeout(() => this.controller?.abort(), 1000);
        timeout.unref();
        try {
          const response = await this.send(this.endpoint, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/vnd.serilog.clef',
              'X-Seq-ApiKey': this.options.apiKey ?? '',
            },
            body,
            signal: this.controller.signal,
          });
          await response.body?.cancel();
          if (
            response.ok ||
            (response.status >= 400 && response.status < 500 && response.status !== 429)
          )
            break;
        } catch {
          /* Retry once, then drop. Never log transport responses or errors. */
        } finally {
          clearTimeout(timeout);
        }
      }
    } finally {
      this.controller = undefined;
      this.inFlight = false;
      this.schedule(1000);
    }
  }
  get pendingEvents(): number {
    return this.queue.length;
  }
  close(): void {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    this.controller?.abort();
    this.queue = [];
    this.queuedBytes = 0;
  }
}
