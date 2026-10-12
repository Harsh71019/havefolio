import * as Sentry from '@sentry/nextjs';
import { monitoringConfig, monitoringOptions } from '@havefolio/monitoring';
const config = monitoringConfig(process.env);
if (config.enabled) {
  try {
    Sentry.init({ ...monitoringOptions(config, 'web-edge'), integrations: [] });
  } catch {
    /* Never prevent edge startup. */
  }
}
