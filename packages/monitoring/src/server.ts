import * as Sentry from '@sentry/node';
import { logContext } from '@havefolio/logging';
import { monitoringConfig, monitoringOptions, safeTags } from './index.js';
let enabled = false;
const captured = new WeakSet<object>();
export function initializeMonitoring(service: 'api' | 'worker', env = process.env): void {
  const config = monitoringConfig(env);
  enabled = false;
  if (config.invalid)
    process.stderr.write(
      JSON.stringify({ event: 'monitoring_configuration_rejected', service }) + '\n',
    );
  if (!config.enabled) return;
  try {
    Sentry.init({
      ...monitoringOptions(config, service),
      integrations: [
        Sentry.onUncaughtExceptionIntegration(),
        Sentry.onUnhandledRejectionIntegration(),
      ],
      shutdownTimeout: 1000,
      enableRuntimeChannelInjection: false,
      enableOpenTelemetrySetup: false,
    });
    enabled = true;
  } catch {
    /* Optional telemetry cannot prevent startup. */
  }
}
export function captureFailure(
  error: unknown,
  context: Record<string, unknown> = {},
): string | undefined {
  if (!enabled) return undefined;
  try {
    if (error && typeof error === 'object') {
      if (captured.has(error)) return undefined;
      captured.add(error);
    }
    return Sentry.captureException(error, {
      tags: safeTags({ ...logContext.getStore(), ...context }),
    });
  } catch {
    return undefined;
  }
}
export async function flushMonitoring(): Promise<void> {
  try {
    if (enabled) await Sentry.flush(1000);
  } catch {
    /* Best effort only. */
  }
}

/** A span never becomes a dependency of the request or job. */
export function startOperation(route: string): (template?: string) => void {
  if (!enabled) return () => {};
  try {
    // Every request/job gets an independent sampling decision and safe correlation.
    const span = Sentry.startNewTrace(() =>
      Sentry.withScope((scope) => {
        scope.setTags(safeTags(logContext.getStore() ?? {}));
        return Sentry.startInactiveSpan({
          name: route,
          op: 'application',
          forceTransaction: true,
        });
      }),
    );
    return (template) => {
      try {
        if (template) span.updateName(template);
        span.end();
      } catch {
        /* Optional. */
      }
    };
  } catch {
    return () => {};
  }
}
export async function closeMonitoring(): Promise<void> {
  enabled = false;
  try {
    await Sentry.close(1000);
  } catch {
    /* Best effort shutdown. */
  }
}
