const sensitive =
  /password|passwd|cookie|authorization|token|session|apikey|api_key|dsn|secret|credential|url|filename|receipt|warranty|image|notes?|multipart|body|payload|sql|parameters?|environment|envvars|path/i;
const token = /^[A-Za-z][A-Za-z0-9_.-]{0,79}$/;
const fields = new Set([
  'event',
  'component',
  'operation',
  'method',
  'route',
  'status',
  'durationMs',
  'requestId',
  'correlationId',
  'causationId',
  'jobId',
  'attempt',
  'category',
  'code',
  'error',
  'completed',
  'failed',
]);

export function boundedString(value: string): string {
  // eslint-disable-next-line no-control-regex -- Remove control characters to prevent log forging.
  return value.replace(/[\u0000-\u001f\u007f-\u009f]/g, '').slice(0, 256);
}

/** Defensive copying only. Unknown fields are still excluded at the event boundary. */
export function redact(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (depth > 5) return '[TRUNCATED]';
  if (typeof value === 'string')
    return boundedString(value).replace(
      /(?:https?:\/\/|\/Users\/|\/home\/|\/opt\/|\/app\/|[A-Za-z]:\\)[^\s]*/g,
      '[REDACTED]',
    );
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value !== 'object') return undefined;
  if (value instanceof Error) return safeError(value);
  if (seen.has(value)) return '[CIRCULAR]';
  seen.add(value);
  if (Array.isArray(value)) return value.slice(0, 16).map((v) => redact(v, depth + 1, seen));
  const result: Record<string, unknown> = {};
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value)).slice(
    0,
    32,
  )) {
    if (!('value' in descriptor)) continue; // Never execute getters while logging.
    result[boundedString(key)] = sensitive.test(key.replace(/[-\s]/g, ''))
      ? '[REDACTED]'
      : redact(descriptor.value, depth + 1, seen);
  }
  return result;
}

export function safeError(value: unknown): Record<string, unknown> {
  if (!(value instanceof Error)) return { type: 'UnknownError' };
  const knownTypes = new Set([
    'Error',
    'TypeError',
    'RangeError',
    'SyntaxError',
    'HttpException',
    'BadRequestException',
    'UnauthorizedException',
    'ForbiddenException',
    'ServiceUnavailableException',
  ]);
  const result: Record<string, unknown> = {
    type: knownTypes.has(value.name) ? value.name : 'Error',
  };
  const code = Object.getOwnPropertyDescriptor(value, 'code')?.value as unknown;
  if (typeof code === 'string' && /^(E[A-Z]{2,24}|[0-9]{5})$/.test(code)) result.code = code;
  // Messages may contain SQL, credentials or parser bodies. Keep only frame line/column,
  // excluding paths and function names (which can also be caller-controlled).
  if (typeof value.stack === 'string')
    result.stack = value.stack
      .split('\n')
      .slice(1, 9)
      .map((line) => {
        const location = /:(\d{1,7}):(\d{1,7})\)?$/.exec(line);
        return location ? `at [frame]:${location[1]}:${location[2]}` : 'at [frame]';
      });
  return result;
}

/** No raw message, bindings, DTO, request, response or provider object reaches a sink. */
export function safeEvent(input: unknown): Record<string, unknown> {
  if (typeof input === 'string' && input.length < 2048 && input.startsWith('{')) {
    try {
      input = JSON.parse(input) as unknown;
    } catch {
      input = undefined;
    }
  }
  if (!input || typeof input !== 'object') return { event: 'framework' };
  const result: Record<string, unknown> = {};
  for (const key of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (!descriptor || !('value' in descriptor)) continue;
    const value: unknown = descriptor.value;
    if (key === 'error') {
      result.error = safeError(value);
      continue;
    }
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
      result[key] = Math.min(value, 1e12);
      continue;
    }
    if (typeof value !== 'string') continue;
    if (key === 'route') {
      // Accept registered templates only. Middleware supplies these, never caller URLs.
      if (/^\/[A-Za-z0-9_/:.*{}-]{0,200}$/.test(value)) result[key] = value;
    } else if (['requestId', 'correlationId', 'causationId', 'jobId'].includes(key)) {
      if (/^[A-Za-z0-9_-]{1,64}$/.test(value)) result[key] = value;
    } else if (token.test(value)) result[key] = value;
  }
  if (!result.event) result.event = 'framework';
  return result;
}
