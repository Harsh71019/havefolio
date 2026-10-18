import type { NodeOptions } from '@sentry/node';
import { createTransport, type BaseTransportOptions, type Transport } from '@sentry/core';
import type { Event, EventHint, Breadcrumb, ErrorEvent, TransactionEvent } from '@sentry/core';
import { TelemetryBudget } from '@havefolio/logging/budget';

export interface MonitoringConfig {
  enabled: boolean;
  invalid: boolean;
  dsn?: string;
  release: string;
  environment: string;
  sampleRate: number;
}
const identifier = /^[A-Za-z0-9_-]{16,64}$/;
const releases = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/;
export function monitoringConfig(env: Record<string, unknown>): MonitoringConfig {
  const environment = ['production', 'development', 'test'].includes(String(env.NODE_ENV))
    ? String(env.NODE_ENV)
    : 'development';
  const release =
    typeof env.LOG_RELEASE === 'string' && releases.test(env.LOG_RELEASE)
      ? env.LOG_RELEASE
      : 'local';
  const enabled = env.GLITCHTIP_ENABLED === 'true';
  const sampleRate =
    env.GLITCHTIP_TRACE_SAMPLE_RATE === undefined || env.GLITCHTIP_TRACE_SAMPLE_RATE === ''
      ? 0.01
      : Number(env.GLITCHTIP_TRACE_SAMPLE_RATE);
  let dsn: string | undefined;
  try {
    const url = new URL(String(env.GLITCHTIP_DSN));
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.password ||
      url.search ||
      url.hash ||
      !/^[a-f0-9]{32}$/i.test(url.username) ||
      !/^\/\d+$/.test(url.pathname) ||
      /example|placeholder|replace_with/i.test(url.hostname)
    )
      throw new Error();
    dsn = url.toString();
  } catch {
    /* Invalid monitoring configuration disables only monitoring. */
  }
  const invalid =
    enabled &&
    (!dsn ||
      !Number.isFinite(sampleRate) ||
      sampleRate < 0 ||
      sampleRate > 0.1 ||
      (/^(latest|local|unknown|REPLACE_WITH_.*)$/i.test(release) && environment === 'production'));
  return {
    enabled: enabled && !invalid,
    invalid,
    ...(dsn ? { dsn } : {}),
    release,
    environment,
    sampleRate:
      Number.isFinite(sampleRate) && sampleRate >= 0 && sampleRate <= 0.1 ? sampleRate : 0,
  };
}

/** Known routes only: no query values, UUIDs, provider IDs or arbitrary user path segments. */
export function normalizeRoute(input: unknown): string {
  if (typeof input !== 'string' || input.length > 2048) return '/unmatched';
  let path =
    input.replace(/^(GET|POST|PATCH|PUT|DELETE|HEAD|OPTIONS)\s+/, '').split(/[?#]/)[0] ?? '';
  if (/^https?:\/\//.test(path)) {
    try {
      path = new URL(path).pathname;
    } catch {
      return '/unmatched';
    }
  }
  path = path.replace(/\/\([^/]+\)/g, '').replace(/\/(?:page|route)$/, '');
  if (/^\/api\/v1\/merchants(?:\/[^/]+)?$/.test(path))
    return path === '/api/v1/merchants' ? path : '/api/v1/merchants/:id';
  if (path === '/api/v1/spending' || path === '/api/v1/home') return path;
  if (/^\/api\/v1\/goals(?:\/[^/]+(?:\/contributions)?)?$/.test(path)) {
    return path.replace(/(\/goals)\/[^/]+/, '$1/:id');
  }
  if (/^\/api\/v1\/onboarding(?:\/(actions|demo))?$/.test(path)) return path;
  if (/^\/api\/v1\/health(?:\/|$)/.test(path)) return '/api/v1/health';
  if (/^\/(?:login|store|wants|goals|settings\/taxonomy)?\/?$/.test(path))
    return path.replace(/\/$/, '') || '/';
  if (/^\/api\/v1\/auth\/(login|logout|logout-all|me|register)$/.test(path)) return path;
  if (
    /^\/api\/v1\/taxonomy(?:\/(?:defaults|categories|subcategories|tags)(?:\/[^/]+)?)?$/.test(path)
  ) {
    return path.replace(
      /\/(categories|subcategories|tags)\/([^/]+)$/,
      (_match: string, domain: string, id: string): string =>
        '/' + domain + '/' + (id === 'order' ? 'order' : ':id'),
    );
  }
  const item = /^\/(api\/v1\/)?items(?:\/([^/]+))?(?:\/(actions|history))?$/.exec(path);
  if (item)
    return (
      '/' +
      (item[1] ?? '') +
      'items' +
      (item[2] ? '/' + (item[2] === 'new' ? 'new' : ':itemId') : '') +
      (item[3] ? '/' + item[3] : '')
    );
  const media =
    /^\/(api\/v1\/)?items\/[^/]+\/(photos|documents)(?:\/([^/]+)(?:\/(access|content|download)(?:\/[^/]+)?)?)?$/.exec(
      path,
    );
  if (media)
    return (
      '/' +
      (media[1] ?? '') +
      'items/:itemId/' +
      media[2] +
      (media[3] ? '/' + (['new', 'order'].includes(media[3]) ? media[3] : ':attachmentId') : '') +
      (media[4]
        ? '/' + media[4] + (['access', 'content'].includes(media[4]) ? '/:variant' : '')
        : '')
    );
  return '/unmatched';
}
export function traceRate(name: unknown, rate: number): number {
  if (name === 'system.noop') return rate;
  const route = normalizeRoute(name);
  return route === '/unmatched' || route === '/api/v1/health' ? 0 : rate;
}
const safeCodes = new Set([
  'REQUEST_FAILED',
  'AUTH_UNAVAILABLE',
  'ITEMS_UNAVAILABLE',
  'MEDIA_STORAGE_UNAVAILABLE',
  'DOCUMENT_UPLOAD_UNAVAILABLE',
  'UNSUPPORTED_OPERATION',
  'WORKER_FAILURE',
  'WORKER_CONNECTION_FAILURE',
  'STARTUP_FAILED',
  'RENDER_FAILED',
]);
const types = new Set([
  'Error',
  'TypeError',
  'RangeError',
  'SyntaxError',
  'HttpException',
  'ServiceUnavailableException',
]);
function frameFile(input: unknown): string | undefined {
  if (typeof input !== 'string' || input.length > 1024) return undefined;
  // Browser hashed chunks retain their source-map identity without host/query/local paths.
  const chunk =
    /(?:^|\/)(_next\/static\/(?:chunks|[A-Za-z0-9_-]+)\/[A-Za-z0-9_./-]+\.js)(?:[?#].*)?$/.exec(
      input,
    );
  if (chunk && !chunk[1]?.includes('..')) return '~/' + chunk[1];
  const nextServer = /(?:^|\/)(\.next\/server\/(?:app|chunks)\/[A-Za-z0-9_./()[\]-]+\.js)$/.exec(
    input,
  );
  if (nextServer && !nextServer[1]?.includes('..')) return 'app:///' + nextServer[1];
  // Only immutable application build files; dependencies and machine paths are discarded.
  const build = /(?:^|\/)(dist\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_.-]+\.js)$/.exec(input);
  if (build && !build[1]?.includes('..')) return 'app:///' + build[1];
  return undefined;
}
export function safeTags(input: Record<string, unknown>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const key of ['requestId', 'correlationId', 'causationId', 'jobId']) {
    const value = input[key];
    if (typeof value === 'string' && identifier.test(value)) result[key] = value;
  }
  const attempt =
    typeof input.attempt === 'string' && /^\d{1,5}$/.test(input.attempt)
      ? Number(input.attempt)
      : input.attempt;
  if (typeof attempt === 'number' && Number.isInteger(attempt))
    result.attempt = String(Math.min(10000, Math.max(1, attempt)));
  if (safeCodes.has(String(input.code))) result.code = String(input.code);
  if (['api', 'worker', 'web-browser', 'web-server', 'web-edge'].includes(String(input.service)))
    result.service = String(input.service);
  if (
    ['system.noop', 'unsupported', 'system', 'render', 'bootstrap'].includes(
      String(input.operation),
    )
  )
    result.operation = String(input.operation);
  if (input.route) result.route = normalizeRoute(input.route);
  return result;
}

/** Reconstruct an event, rather than recursively trusting SDK or provider context. */
export function scrubEvent(event: Event, _hint?: EventHint): Event | null {
  void _hint;
  try {
    const result: Event = {};
    if (event.event_id && /^[a-f0-9]{32}$/.test(event.event_id)) result.event_id = event.event_id;
    if (event.release && releases.test(event.release)) result.release = event.release;
    if (['production', 'development', 'test'].includes(event.environment ?? ''))
      result.environment = event.environment!;
    if (typeof event.timestamp === 'number' && Number.isFinite(event.timestamp))
      result.timestamp = event.timestamp;
    result.platform = event.platform === 'node' ? 'node' : 'javascript';
    result.tags = safeTags(event.tags ?? {});
    if (event.exception?.values)
      result.exception = {
        values: event.exception.values.slice(0, 3).map((value) => ({
          type: types.has(value.type ?? '') ? value.type! : 'Error',
          value: safeCodes.has(String(result.tags?.code))
            ? String(result.tags?.code)
            : 'Unexpected application failure',
          ...(value.mechanism
            ? { mechanism: { type: 'generic', handled: value.mechanism.handled !== false } }
            : {}),
          ...(value.stacktrace
            ? {
                stacktrace: {
                  frames: (value.stacktrace.frames ?? []).slice(-16).map((frame) => ({
                    ...(frameFile(frame.filename) ? { filename: frameFile(frame.filename)! } : {}),
                    ...(typeof frame.lineno === 'number' && frame.lineno > 0
                      ? { lineno: Math.min(frame.lineno, 1e7) }
                      : {}),
                    ...(typeof frame.colno === 'number' && frame.colno > 0
                      ? { colno: Math.min(frame.colno, 1e7) }
                      : {}),
                    in_app: Boolean(frameFile(frame.filename)),
                  })),
                },
              }
            : {}),
        })),
      };
    // Retain only the debug-ID association needed to resolve immutable build artifacts.
    if (event.debug_meta?.images)
      result.debug_meta = {
        images: event.debug_meta.images.slice(0, 16).flatMap((image) => {
          const file = frameFile(image.code_file);
          return image.type === 'sourcemap' && file && /^[a-f0-9-]{36}$/i.test(image.debug_id ?? '')
            ? [{ type: 'sourcemap' as const, code_file: file, debug_id: image.debug_id }]
            : [];
        }),
      };
    if (event.type === 'transaction') {
      const route =
        event.transaction === 'system.noop' ? 'system.noop' : normalizeRoute(event.transaction);
      if (route === '/unmatched' || route === '/api/v1/health') return null;
      result.type = 'transaction';
      result.transaction = route;
      if (typeof event.start_timestamp === 'number') result.start_timestamp = event.start_timestamp;
      result.spans = []; // No DB/HTTP resource spans, SQL, URLs or attributes.
      const trace = event.contexts?.trace;
      if (
        trace &&
        /^[a-f0-9]{32}$/.test(String(trace.trace_id)) &&
        /^[a-f0-9]{16}$/.test(String(trace.span_id))
      )
        result.contexts = {
          trace: { trace_id: trace.trace_id, span_id: trace.span_id, op: 'application' },
        };
    } else if (!result.exception) return null;
    // No user, request, extra, breadcrumbs, logentry, free-form messages or source context.
    return new TextEncoder().encode(JSON.stringify(result)).byteLength <= 16384 ? result : null;
  } catch {
    return null;
  }
}
export function scrubBreadcrumb(_breadcrumb: Breadcrumb): null {
  void _breadcrumb;
  return null;
}
export function monitoringOptions(
  config: MonitoringConfig,
  service: string,
): NodeOptions & {
  autoSessionTracking: boolean;
  sendDefaultPii: boolean;
  enableLogs: boolean;
  transportOptions: { bufferSize: number };
} {
  return {
    ...(config.dsn ? { dsn: config.dsn } : {}),
    enabled: config.enabled,
    sampleRate: 1, // Errors are retained within the transport budget; traces sample independently.
    release: config.release,
    environment: config.environment,
    traceLifecycle: 'static' as const,
    sendDefaultPii: false,
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      graphQL: { document: false, variables: false },
      genAI: { inputs: false, outputs: false },
      databaseQueryData: false,
      queues: false,
      stackFrameVariables: false,
      frameContextLines: 0,
    },
    includeServerName: false,
    tracePropagationTargets: [],
    beforeSendLog: () => null,
    beforeSendMetric: () => null,
    maxBreadcrumbs: 0,
    maxValueLength: 256,
    defaultIntegrations: false as const,
    autoSessionTracking: false,
    sendClientReports: false,
    enableLogs: false,
    beforeSend: (event: ErrorEvent, hint: EventHint) =>
      scrubEvent(event, hint) as ErrorEvent | null,
    beforeSendTransaction: (event: TransactionEvent) =>
      scrubEvent(event) as TransactionEvent | null,
    beforeBreadcrumb: scrubBreadcrumb,
    tracesSampler: (context: { name: string }) => traceRate(context.name, config.sampleRate),
    initialScope: { tags: { service } },
    transport: boundedTransport,
    transportOptions: { bufferSize: 32 },
  };
}

/** Bounded queue, single one-second attempt, no request/job waits or retries. */
export function boundedTransport(options: BaseTransportOptions): Transport {
  const errors = new TelemetryBudget(20, 20);
  const traces = new TelemetryBudget(60, 60);
  const bytes = new TelemetryBudget(256 * 1024, 256 * 1024);
  return createTransport({ ...options, bufferSize: 32 }, async (request) => {
    if (typeof request.body !== 'string' || request.body.length > 24576) return { statusCode: 413 };
    let body: string;
    let error = false;
    try {
      const lines = request.body.trimEnd().split('\n');
      if (lines.length !== 3) return { statusCode: 413 };
      const item = JSON.parse(lines[1]!) as { type?: string };
      if (!['event', 'transaction'].includes(item.type ?? '')) return { statusCode: 413 };
      error = item.type === 'event';
      const event = scrubEvent(JSON.parse(lines[2]!) as Event);
      if (!event) return { statusCode: 413 };
      // SDK envelope trace metadata may contain a raw transaction name. Drop it too.
      body =
        JSON.stringify({ event_id: event.event_id, sent_at: new Date().toISOString() }) +
        '\n' +
        JSON.stringify({ type: item.type }) +
        '\n' +
        JSON.stringify(event);
    } catch {
      return { statusCode: 413 };
    }
    const size = new TextEncoder().encode(body).byteLength;
    if (size > 24576) return { statusCode: 413 };
    if (!(error ? errors : traces).take() || !bytes.take(size)) {
      options.recordDroppedEvent('ratelimit_backoff', error ? 'error' : 'transaction');
      return { statusCode: 200 }; // Local drop; do not rate-limit the other event category.
    }
    try {
      const response = await fetch(options.url, {
        method: 'POST',
        body,
        signal: AbortSignal.timeout(1000),
        headers: { 'Content-Type': 'application/x-sentry-envelope' },
        credentials: 'omit',
      });
      return {
        statusCode: response.status,
        headers: {
          'x-sentry-rate-limits': response.headers.get('x-sentry-rate-limits'),
          'retry-after': response.headers.get('retry-after'),
        },
      };
    } catch {
      return { statusCode: 503 };
    }
  });
}
