import { withSentryConfig } from '@sentry/nextjs/config';
import { monitoringConfig } from '@havefolio/monitoring';
import { loadEnvConfig } from '@next/env';
import type { NextConfig } from 'next';
import { resolve } from 'node:path';
import { validateWebEnvironment } from '@havefolio/config';

loadEnvConfig(resolve(process.cwd(), '../..'));
validateWebEnvironment(process.env);

const nextConfig: NextConfig = {
  rewrites() {
    const base = (process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001/api/v1').replace(
      /\/$/,
      '',
    );
    return Promise.resolve(
      ['auth', 'taxonomy', 'items'].map((domain) => ({
        source: `/api/v1/${domain}/:path*`,
        destination: `${base}/${domain}/:path*`,
      })),
    );
  },
  output: 'standalone',
  poweredByHeader: false,
  reactStrictMode: true,
  transpilePackages: ['@havefolio/contracts', '@havefolio/domain', '@havefolio/ui'],
};

const upload = process.env.GLITCHTIP_UPLOAD_SOURCE_MAPS === 'true';
const monitoring = monitoringConfig(process.env);
if (
  upload &&
  (!monitoring.enabled ||
    !process.env.SENTRY_AUTH_TOKEN ||
    !process.env.SENTRY_URL ||
    !process.env.SENTRY_ORG ||
    !process.env.SENTRY_PROJECT)
) {
  throw new Error('Source-map upload requires protected configuration and an immutable release');
}
export default withSentryConfig(nextConfig, {
  telemetry: false,
  silent: true,
  // Shared application modules (including financial formatting) live outside app/ chunks.
  widenClientFileUpload: true,
  ...(upload
    ? {
        authToken: process.env.SENTRY_AUTH_TOKEN!,
        sentryUrl: process.env.SENTRY_URL!,
        org: process.env.SENTRY_ORG!,
        project: process.env.SENTRY_PROJECT!,
      }
    : {}),
  release: { name: monitoring.release, create: upload, finalize: upload },
  sourcemaps: { disable: upload ? false : 'disable-upload', deleteSourcemapsAfterUpload: true },
  errorHandler: () => {
    throw new Error('Source-map upload failed; release is blocked');
  },
  webpack: { autoInstrumentServerFunctions: false, autoInstrumentMiddleware: false },
  reactComponentAnnotation: { enabled: false },
});
