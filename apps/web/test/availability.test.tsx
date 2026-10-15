import { describe, expect, it, vi } from 'vitest';
import { GET } from '../app/healthz/route';

describe('Next.js web availability route (GET /healthz)', () => {
  it('returns 200 with minimal web availability contract', async () => {
    const response = GET();
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data).toEqual({
      status: 'ok',
      service: 'havefolio-web',
    });
  });

  it('sets cache-prevention headers', () => {
    const response = GET();
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(response.headers.get('cache-control')).toBe('no-store, no-cache, must-revalidate');
    expect(response.headers.get('pragma')).toBe('no-cache');
  });

  it('does not call fetch or require external API dependencies', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const response = GET();
    expect(response.status).toBe(200);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('does not leak environment variables or build internals', async () => {
    const response = GET();
    const text = await response.text();

    expect(text).not.toContain('NODE_ENV');
    expect(text).not.toContain('API_BASE_URL');
    expect(text).not.toContain('SECRET');
    expect(text).not.toContain('PASSWORD');
    expect(text).not.toContain('KEY');
    expect(text).not.toContain('http://');
    expect(text).not.toContain('https://');
  });

  it('does not perform redirects or require authentication headers', () => {
    const response = GET();
    expect(response.status).not.toBe(302);
    expect(response.status).not.toBe(307);
    expect(response.status).not.toBe(401);
    expect(response.headers.get('location')).toBeNull();
  });
});
