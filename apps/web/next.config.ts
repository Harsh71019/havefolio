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

export default nextConfig;
