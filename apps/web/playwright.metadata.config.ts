import { defineConfig } from '@playwright/test';
import base from './playwright.config';

// Keep real persistence verification isolated from other worktrees' smoke server.
export default defineConfig({
  ...base,
  testMatch: 'collapsed-metadata.spec.ts',
  use: { ...base.use, baseURL: 'http://127.0.0.1:31773' },
  webServer: {
    command: 'pnpm exec next start --hostname 127.0.0.1 --port 31773',
    url: 'http://127.0.0.1:31773',
    reuseExistingServer: false,
    timeout: 60000,
  },
});
