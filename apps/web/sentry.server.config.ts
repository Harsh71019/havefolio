import * as Sentry from '@sentry/nextjs';
import { monitoringConfig, monitoringOptions } from '@havefolio/monitoring';
const config = monitoringConfig(process.env);
if (config.enabled) {
  try {
    Sentry.init({
      ...monitoringOptions(config, 'web-server'),
      integrations: [
        Sentry.onUncaughtExceptionIntegration(),
        Sentry.onUnhandledRejectionIntegration(),
      ],
      shutdownTimeout: 1000,
    });
  } catch {
    /* Never prevent server startup. */
  }
}
