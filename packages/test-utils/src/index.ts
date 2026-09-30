export function createTestEnvironment(
  overrides: Readonly<Record<string, string>> = {},
): Record<string, string> {
  return {
    NODE_ENV: 'test',
    ...overrides,
  };
}
