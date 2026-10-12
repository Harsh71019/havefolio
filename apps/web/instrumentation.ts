import type { Instrumentation } from 'next';
export async function register(): Promise<void> {
  try {
    if (process.env.NEXT_RUNTIME === 'nodejs') await import('./sentry.server.config');
    if (process.env.NEXT_RUNTIME === 'edge') await import('./sentry.edge.config');
  } catch {
    /* Monitoring is optional for rendering and readiness. */
  }
}
const captured = new WeakSet<object>();
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  try {
    const Sentry = await import('@sentry/nextjs');
    if (!Sentry.getClient()?.getOptions().enabled) return;
    if (error && typeof error === 'object') {
      if (captured.has(error)) return;
      captured.add(error);
    }
    const { safeTags } = await import('@havefolio/monitoring');
    const header = (name: string): string | string[] | undefined => request.headers[name];
    Sentry.captureException(error, {
      tags: safeTags({
        code: 'RENDER_FAILED',
        operation: 'render',
        route: context.routePath,
        requestId: header('x-request-id'),
        correlationId: header('x-correlation-id'),
      }),
    });
  } catch {
    /* Never change rendering behaviour. */
  }
};
