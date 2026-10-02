import { describe, expect, it } from '@jest/globals';
import { PassThrough } from 'node:stream';
import type { Request } from 'express';
import { readPhotos } from './photo-multipart.js';
describe('multipart cleanup', () => {
  it('cleans abort listeners and rejects incomplete request', async () => {
    const stream = Object.assign(new PassThrough(), {
      headers: { 'content-type': 'multipart/form-data; boundary=synthetic' },
    });
    const result = readPhotos(stream as unknown as Request);
    const assertion = expect(result).rejects.toThrow('PHOTO_REQUEST_ABORTED');
    stream.write(
      '--synthetic\r\nContent-Disposition: form-data; name="photos"; filename="synthetic.jpg"\r\nContent-Type: image/jpeg\r\n\r\n',
    );
    stream.emit('aborted');
    await assertion;
    expect(stream.listenerCount('aborted')).toBe(0);
  });
  it('rejects malformed boundaries without retaining buffers', async () => {
    const stream = Object.assign(new PassThrough(), {
      headers: { 'content-type': 'multipart/form-data; boundary=synthetic' },
    });
    const result = readPhotos(stream as unknown as Request);
    const assertion = expect(result).rejects.toThrow('PHOTO_INVALID_MULTIPART');
    stream.end('broken multipart');
    await assertion;
    expect(stream.listenerCount('data')).toBe(0);
  });
});
