import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import busboy from 'busboy';
import type { Request } from 'express';
import { PHOTO_LIMITS, type PhotoInput } from './photo-processing.js';
export async function readPhotos(req: Request): Promise<PhotoInput[]> {
  if (Number(req.headers['content-length'] ?? 0) > PHOTO_LIMITS.requestBytes)
    throw new PayloadTooLargeException('PHOTO_REQUEST_SIZE');
  return new Promise((resolve, reject) => {
    let parser: ReturnType<typeof busboy>;
    try {
      parser = busboy({
        headers: req.headers,
        limits: {
          files: PHOTO_LIMITS.files,
          fileSize: PHOTO_LIMITS.fileBytes + 1,
          fields: 0,
          parts: PHOTO_LIMITS.files + 1,
          headerPairs: 32,
        },
      });
    } catch {
      reject(new BadRequestException('PHOTO_MULTIPART_REQUIRED'));
      return;
    }
    const files: PhotoInput[] = [];
    const buffers: Buffer[][] = [];
    let received = 0;
    let error: Error | undefined;
    const fail = (reason: Error): void => {
      error ??= reason;
    };
    const onData = (chunk: Buffer): void => {
      received += chunk.length;
      if (received > PHOTO_LIMITS.requestBytes) {
        fail(new PayloadTooLargeException('PHOTO_REQUEST_SIZE'));
        req.unpipe(parser);
        parser.destroy();
      }
    };
    const onAborted = (): void => {
      fail(new BadRequestException('PHOTO_REQUEST_ABORTED'));
      parser.destroy();
    };
    const timer = setTimeout(() => {
      fail(new BadRequestException('PHOTO_REQUEST_TIMEOUT'));
      req.unpipe(parser);
      parser.destroy();
    }, 30_000);
    req.on('data', onData);
    req.once('aborted', onAborted);
    parser.on('file', (field, stream, info) => {
      const chunks: Buffer[] = [];
      const file: PhotoInput = {
        bytes: Buffer.alloc(0),
        filename: info.filename,
        mimeType: info.mimeType,
      };
      files.push(file);
      buffers.push(chunks);
      if (field !== 'photos') fail(new BadRequestException('PHOTO_UNEXPECTED_FIELD'));
      stream.on('limit', () => fail(new PayloadTooLargeException('PHOTO_FILE_SIZE')));
      stream.on('data', (chunk: Buffer) => {
        if (!error) chunks.push(chunk);
      });
      stream.on('end', () => {
        if (!error) file.bytes = Buffer.concat(chunks);
        chunks.length = 0;
      });
      stream.on('error', () => fail(new BadRequestException('PHOTO_INVALID_MULTIPART')));
    });
    parser.on('fieldsLimit', () => fail(new BadRequestException('PHOTO_UNEXPECTED_FIELD')));
    for (const event of ['filesLimit', 'partsLimit'] as const)
      parser.on(event, () => fail(new PayloadTooLargeException('PHOTO_FILE_COUNT')));
    parser.on('error', () => fail(new BadRequestException('PHOTO_INVALID_MULTIPART')));
    parser.on('close', () => {
      clearTimeout(timer);
      req.off('data', onData);
      req.off('aborted', onAborted);
      req.unpipe(parser);
      req.resume();
      buffers.forEach((b) => (b.length = 0));
      if (error || !files.length) {
        files.forEach((f) => f.bytes.fill(0));
        req.res?.setHeader('Connection', 'close');
        reject(error ?? new BadRequestException('PHOTO_FILE_REQUIRED'));
      } else resolve(files);
    });
    req.pipe(parser);
  });
}
