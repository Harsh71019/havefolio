import { v2 as cloudinary, type ConfigOptions } from 'cloudinary';
import { ocrImageLimits } from './ocr-limits.js';

export interface PrivateImageReader {
  read(
    key: string,
    format: 'jpg' | 'png' | 'webp',
    byteSize: number,
    signal: AbortSignal,
  ): Promise<Buffer>;
}

export interface MediaReaderOptions {
  NODE_ENV: string;
  CLOUDINARY_CLOUD_NAME: string;
  CLOUDINARY_API_KEY: string;
  CLOUDINARY_API_SECRET: string;
}

/**
 * PER-45 read-only access to an exact authenticated image original. It mirrors the API's
 * PER-12 bounded read: a 60-second signed download URL is generated in-process only, never
 * persisted, queued, logged or returned. Redirects, size mismatches and slow reads fail.
 * The worker has no upload or delete path.
 */
export class CloudinaryImageReader implements PrivateImageReader {
  private readonly prefix: string;
  constructor(private readonly options: MediaReaderOptions) {
    this.prefix = `havefolio/${options.NODE_ENV}/`;
  }
  async read(
    key: string,
    format: 'jpg' | 'png' | 'webp',
    byteSize: number,
    signal: AbortSignal,
  ): Promise<Buffer> {
    if (
      !key.startsWith(this.prefix) ||
      !/^[a-f0-9-]{36}$/.test(key.slice(this.prefix.length)) ||
      !['jpg', 'png', 'webp'].includes(format) ||
      !Number.isSafeInteger(byteSize) ||
      byteSize < 1 ||
      byteSize > ocrImageLimits.inputBytes
    )
      throw new Error('OCR_MEDIA_INVALID');
    const credentials: ConfigOptions = {
      cloud_name: this.options.CLOUDINARY_CLOUD_NAME,
      api_key: this.options.CLOUDINARY_API_KEY,
      api_secret: this.options.CLOUDINARY_API_SECRET,
      secure: true,
      signature_algorithm: 'sha256',
    };
    const url = cloudinary.utils.private_download_url(key, format, {
      ...credentials,
      resource_type: 'image',
      type: 'authenticated',
      expires_at: Math.floor(Date.now() / 1000) + 60,
      attachment: true,
    });
    const chunks: Buffer[] = [];
    try {
      const response = await fetch(url, {
        redirect: 'error',
        signal: AbortSignal.any([signal, AbortSignal.timeout(ocrImageLimits.readMs)]),
      });
      if (!response.ok || !response.body) throw new Error();
      const declared = response.headers.get('content-length');
      if (declared && Number(declared) !== byteSize) {
        await response.body.cancel();
        throw new Error();
      }
      let size = 0;
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > byteSize) throw new Error();
        chunks.push(Buffer.from(chunk));
      }
      if (size !== byteSize) throw new Error();
      return Buffer.concat(chunks);
    } catch {
      throw new Error('OCR_MEDIA_UNAVAILABLE');
    } finally {
      chunks.forEach((c) => c.fill(0));
    }
  }
}
