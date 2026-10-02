import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import busboy from 'busboy';
import type { Request } from 'express';
import type { PhotoInput } from './photo-processing.js';
import { DOCUMENT_LIMITS } from './document-processing.js';
export type DocumentKind = 'receipt' | 'warranty';
export async function readDocument(
  req: Request,
): Promise<{ kind: DocumentKind; file: PhotoInput }> {
  if (Number(req.headers['content-length'] ?? 0) > DOCUMENT_LIMITS.requestBytes)
    throw new PayloadTooLargeException('DOCUMENT_REQUEST_SIZE');
  return new Promise((resolve, reject) => {
    let parser: ReturnType<typeof busboy>;
    try {
      parser = busboy({
        headers: req.headers,
        limits: {
          files: 1,
          fileSize: DOCUMENT_LIMITS.pdfBytes + 1,
          fields: 1,
          fieldSize: 16,
          parts: 3,
          headerPairs: 32,
        },
      });
    } catch {
      reject(new BadRequestException('DOCUMENT_MULTIPART_REQUIRED'));
      return;
    }
    let kind: string | undefined,
      file: PhotoInput | undefined,
      error: Error | undefined,
      received = 0;
    const chunks: Buffer[] = [];
    const fail = (e: Error): void => {
      error ??= e;
    };
    const stop = (): void => {
      req.unpipe(parser);
      parser.destroy();
    };
    const onData = (chunk: Buffer): void => {
      received += chunk.length;
      if (received > DOCUMENT_LIMITS.requestBytes) {
        fail(new PayloadTooLargeException('DOCUMENT_REQUEST_SIZE'));
        stop();
      }
    };
    const onAborted = (): void => {
      fail(new BadRequestException('DOCUMENT_REQUEST_ABORTED'));
      stop();
    };
    const timer = setTimeout(() => {
      fail(new BadRequestException('DOCUMENT_REQUEST_TIMEOUT'));
      stop();
    }, 30000);
    req.on('data', onData);
    req.once('aborted', onAborted);
    parser.on('field', (name, value, info) => {
      if (
        name !== 'kind' ||
        kind !== undefined ||
        info.valueTruncated ||
        !['receipt', 'warranty'].includes(value)
      )
        fail(new BadRequestException('DOCUMENT_KIND_REQUIRED'));
      else kind = value;
    });
    parser.on('file', (name, stream, info) => {
      if (name !== 'document' || file) fail(new BadRequestException('DOCUMENT_UNEXPECTED_FIELD'));
      file = { bytes: Buffer.alloc(0), filename: info.filename, mimeType: info.mimeType };
      stream.on('limit', () => fail(new PayloadTooLargeException('DOCUMENT_FILE_SIZE')));
      stream.on('data', (chunk: Buffer) => {
        if (!error) chunks.push(chunk);
      });
      stream.on('end', () => {
        if (!error && file) file.bytes = Buffer.concat(chunks);
        chunks.forEach((c) => c.fill(0));
        chunks.length = 0;
      });
      stream.on('error', () => fail(new BadRequestException('DOCUMENT_INVALID_MULTIPART')));
    });
    parser.on('fieldsLimit', () => fail(new BadRequestException('DOCUMENT_UNEXPECTED_FIELD')));
    for (const event of ['filesLimit', 'partsLimit'] as const)
      parser.on(event, () => fail(new PayloadTooLargeException('DOCUMENT_FILE_COUNT')));
    parser.on('error', () => fail(new BadRequestException('DOCUMENT_INVALID_MULTIPART')));
    parser.on('close', () => {
      clearTimeout(timer);
      req.off('data', onData);
      req.off('aborted', onAborted);
      req.unpipe(parser);
      req.resume();
      chunks.forEach((c) => c.fill(0));
      chunks.length = 0;
      if (error || !file || !kind) {
        file?.bytes.fill(0);
        req.res?.setHeader('Connection', 'close');
        reject(error ?? new BadRequestException('DOCUMENT_KIND_REQUIRED'));
      } else resolve({ kind: kind as DocumentKind, file });
    });
    req.pipe(parser);
  });
}
