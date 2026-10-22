import {
  init,
  globalHandlersIntegration,
  dedupeIntegration,
  browserTracingIntegration,
  captureRouterTransitionStart,
  captureException,
} from '@sentry/nextjs';
import { monitoringConfig, monitoringOptions, normalizeRoute } from '@havefolio/monitoring';
const config = monitoringConfig({
  GLITCHTIP_ENABLED: process.env.NEXT_PUBLIC_GLITCHTIP_ENABLED,
  GLITCHTIP_DSN: process.env.NEXT_PUBLIC_GLITCHTIP_DSN,
  GLITCHTIP_TRACE_SAMPLE_RATE: process.env.NEXT_PUBLIC_GLITCHTIP_TRACE_SAMPLE_RATE,
  LOG_RELEASE: process.env.NEXT_PUBLIC_MONITORING_RELEASE,
  NODE_ENV: process.env.NODE_ENV,
});
if (config.enabled) {
  try {
    init({
      ...monitoringOptions(config, 'web-browser'),
      integrations: [
        globalHandlersIntegration(),
        dedupeIntegration(),
        browserTracingIntegration({
          traceFetch: false,
          traceXHR: false,
          enableHTTPTimings: false,
          beforeStartSpan: (options) => ({
            ...options,
            name: normalizeRoute(options.name),
            attributes: {},
          }),
        }),
      ],
      tracePropagationTargets: [],
    });
  } catch {
    /* Never prevent hydration. */
  }
}
export function onRouterTransitionStart(
  ...args: Parameters<typeof captureRouterTransitionStart>
): void {
  if (!config.enabled) return;
  try {
    captureRouterTransitionStart(...args);
  } catch {
    /* Monitoring cannot block navigation. */
  }
}
const captured = new WeakSet<Error>();
export function captureRenderError(error: Error & { digest?: string }): void {
  // Next server errors have already been reported by onRequestError.
  if (!config.enabled || error.digest || captured.has(error)) return;
  try {
    captured.add(error);
    captureException(error, { tags: { code: 'RENDER_FAILED', operation: 'render' } });
  } catch {
    /* Retain the user-friendly boundary. */
  }
}
