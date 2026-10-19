import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomId } from '../components/random-id';

const v4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('randomId (PER-66)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
  it('uses crypto.randomUUID when the context is secure', () => {
    const spy = vi.spyOn(crypto, 'randomUUID');
    expect(randomId()).toMatch(v4);
    expect(spy).toHaveBeenCalledOnce();
  });
  it('builds a distinct version 4 UUID over plain HTTP, where randomUUID is absent', () => {
    const secure = crypto;
    vi.stubGlobal('crypto', {
      getRandomValues: (array: Uint8Array<ArrayBuffer>) => secure.getRandomValues(array),
    });
    const ids = new Set(Array.from({ length: 50 }, randomId));
    expect(ids.size).toBe(50);
    for (const id of ids) expect(id).toMatch(v4);
  });
});
