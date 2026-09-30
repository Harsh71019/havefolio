export function createTestEnvironment(
  overrides: Readonly<Record<string, string>> = {},
): Record<string, string> {
  return {
    NODE_ENV: 'test',
    ...overrides,
  };
}

export { IntegrationRun, integrationConfiguration } from './integration.js';
export type { IntegrationConfiguration } from './integration.js';
