import { loadEnvConfig } from '@next/env';
import type { NextConfig } from 'next';
import { resolve } from 'node:path';
import { validateWebEnvironment } from '@havefolio/config';

loadEnvConfig(resolve(process.cwd(), '../..'));
validateWebEnvironment(process.env);

const nextConfig: NextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  reactStrictMode: true,
  transpilePackages: ['@havefolio/contracts', '@havefolio/ui'],
};

export default nextConfig;
