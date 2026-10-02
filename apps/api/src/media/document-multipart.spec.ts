import { describe, expect, it } from '@jest/globals';
import { PassThrough } from 'node:stream';
import type { Request } from 'express';
import { readDocument } from './document-multipart.js';
const stream = (): PassThrough & { headers: Record<string, string> } =>
  Object.assign(new PassThrough(), {
    headers: { 'content-type': 'multipart/form-data; boundary=synthetic' },
  });
describe('document multipart fail-closed boundaries', () => {
  it('rejects malformed/aborted multipart and removes listeners', async () => {
    for (const abort of [false, true]) {
      const req = stream(),
        result = readDocument(req as unknown as Request);
      const assertion = expect(result).rejects.toThrow(/DOCUMENT_/);
      if (abort) {
        req.write(
          '--synthetic\r\nContent-Disposition: form-data; name="document"; filename="synthetic.pdf"\r\nContent-Type: application/pdf\r\n\r\n',
        );
        req.emit('aborted');
      } else req.end('broken');
      await assertion;
      expect(req.listenerCount('aborted')).toBe(0);
      expect(req.listenerCount('data')).toBe(0);
    }
  });
  it('limits chunked request bytes without Content-Length before PDF work', async () => {
    const req = stream(),
      result = readDocument(req as unknown as Request),
      assertion = expect(result).rejects.toThrow('DOCUMENT_REQUEST_SIZE');
    req.write(
      '--synthetic\r\nContent-Disposition: form-data; name="document"; filename="synthetic.pdf"\r\nContent-Type: application/pdf\r\n\r\n',
    );
    req.end(Buffer.alloc(22 * 1024 * 1024));
    await assertion;
  });
});
