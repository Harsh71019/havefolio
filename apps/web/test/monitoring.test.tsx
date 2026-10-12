import { describe, it, expect, vi, beforeEach } from 'vitest';
const sdk = vi.hoisted(() => ({
  init: vi.fn(),
  getClient: vi.fn(() => ({ getOptions: () => ({ enabled: true }) })),
  captureException: vi.fn(),
  globalHandlersIntegration: vi.fn(),
  dedupeIntegration: vi.fn(),
  browserTracingIntegration: vi.fn(),
  captureRouterTransitionStart: vi.fn(),
}));
vi.mock('@sentry/nextjs', () => sdk);
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});
describe('browser monitoring', () => {
  it('disabled monitoring does not initialize or capture', async () => {
    vi.stubEnv('NEXT_PUBLIC_GLITCHTIP_ENABLED', 'false');
    const { captureRenderError } = await import('../instrumentation-client');
    captureRenderError(new Error('private'));
    expect(sdk.init).not.toHaveBeenCalled();
    expect(sdk.captureException).not.toHaveBeenCalled();
  });
  it('captures client rendering while avoiding duplicate server-boundary reports', async () => {
    vi.stubEnv('NEXT_PUBLIC_GLITCHTIP_ENABLED', 'true');
    vi.stubEnv('NEXT_PUBLIC_GLITCHTIP_DSN', 'http://' + 'a'.repeat(32) + '@127.0.0.1/1');
    vi.stubEnv('NEXT_PUBLIC_MONITORING_RELEASE', 'per49-web-test');
    const { captureRenderError } = await import('../instrumentation-client');
    const error = new Error('private');
    captureRenderError(error);
    captureRenderError(error);
    captureRenderError(Object.assign(new Error('server'), { digest: 'server-digest' }));
    expect(sdk.init).toHaveBeenCalledOnce();
    expect(sdk.captureException).toHaveBeenCalledOnce();
    expect(sdk.init.mock.calls[0]?.[0]).toMatchObject({
      sendDefaultPii: false,
      release: 'per49-web-test',
      tracePropagationTargets: [],
      enableLogs: false,
    });
  });
  it('SDK failure preserves boundary behaviour', async () => {
    vi.stubEnv('NEXT_PUBLIC_GLITCHTIP_ENABLED', 'true');
    vi.stubEnv('NEXT_PUBLIC_GLITCHTIP_DSN', 'http://' + 'a'.repeat(32) + '@127.0.0.1/1');
    sdk.init.mockImplementationOnce(() => {
      throw new Error('offline');
    });
    const { captureRenderError } = await import('../instrumentation-client');
    sdk.captureException.mockImplementationOnce(() => {
      throw new Error('offline');
    });
    expect(() => captureRenderError(new Error('private'))).not.toThrow();
  });
  it('Next request errors use route templates and safe correlation only', async () => {
    const { onRequestError } = await import('../instrumentation');
    await onRequestError(
      new Error('private'),
      {
        path: '/items/private?password=secret',
        method: 'GET',
        headers: {
          'x-request-id': 'request_123456789',
          'x-correlation-id': 'correlation_12345',
          authorization: 'secret',
        },
      },
      {
        routerKind: 'App Router',
        routePath: '/items/[itemId]',
        routeType: 'render',
        revalidateReason: undefined,
      },
    );
    expect(sdk.captureException.mock.calls[0]?.[1]).toEqual({
      tags: {
        code: 'RENDER_FAILED',
        operation: 'render',
        requestId: 'request_123456789',
        correlationId: 'correlation_12345',
        route: '/items/:itemId',
      },
    });
  });
});
