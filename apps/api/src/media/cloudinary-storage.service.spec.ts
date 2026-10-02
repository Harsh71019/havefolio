import { jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import {
  v2 as cloudinary,
  type UploadApiResponse,
  type UploadApiOptions,
  type UploadResponseCallback,
} from 'cloudinary';
import { Writable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { CloudinaryStorage } from './cloudinary-storage.service.js';

const config = {
  NODE_ENV: 'test',
  MEDIA_STORAGE_ENABLED: true,
  CLOUDINARY_CLOUD_NAME: 'fixture-cloud',
  CLOUDINARY_API_KEY: 'fixture-key',
  CLOUDINARY_API_SECRET: 'fixture-secret',
};
const input = {
  key: `havefolio/test/${randomUUID()}`,
  resourceType: 'image' as const,
  format: 'jpg' as const,
  bytes: Buffer.from([255, 216, 255, 217]),
  checksum: 'a'.repeat(64),
};

describe('Cloudinary private storage contract', () => {
  afterEach(() => jest.restoreAllMocks());
  async function setup(enabled = true): Promise<CloudinaryStorage> {
    const module = await Test.createTestingModule({
      providers: [
        CloudinaryStorage,
        {
          provide: ConfigService,
          useValue: {
            get: (key: keyof typeof config) =>
              key === 'MEDIA_STORAGE_ENABLED' ? enabled : config[key],
          },
        },
      ],
    }).compile();
    return module.get(CloudinaryStorage);
  }
  function upload(
    response: Partial<UploadApiResponse>,
    fail = false,
  ): jest.SpiedFunction<typeof cloudinary.uploader.upload_stream> {
    return jest
      .spyOn(cloudinary.uploader, 'upload_stream')
      .mockImplementation(
        (
          options?: UploadApiOptions | UploadResponseCallback,
          callback?: UploadResponseCallback,
        ) => {
          const onUpload = typeof options === 'function' ? options : callback;
          const stream = new Writable({
            write(_chunk, _encoding, done) {
              done();
            },
          });
          stream.on('finish', () =>
            onUpload?.(
              fail
                ? { message: 'sensitive provider error', http_code: 500, name: 'fixture' }
                : undefined,
              response as UploadApiResponse,
            ),
          );
          return stream as ReturnType<typeof cloudinary.uploader.upload_stream>;
        },
      );
  }

  it('uses authenticated assets, immutable opaque keys and no original filename; validates returned identity', async () => {
    const storage = await setup();
    const spy = upload({
      public_id: input.key,
      resource_type: 'image',
      type: 'authenticated',
      format: 'jpg',
      bytes: input.bytes.length,
      asset_id: 'opaque-provider-id',
      version: 123,
      width: 2,
      height: 2,
    });
    expect(await storage.put(input)).toEqual({
      assetId: 'opaque-provider-id',
      version: 123,
      width: 2,
      height: 2,
    });
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'authenticated',
        overwrite: false,
        public_id: input.key,
        resource_type: 'image',
        discard_original_filename: true,
        timeout: 30_000,
        context: { hf_checksum: input.checksum },
      }),
      expect.any(Function),
    );
    spy.mockRestore();
    upload({
      public_id: input.key,
      resource_type: 'image',
      type: 'upload',
      format: 'jpg',
      bytes: 4,
      asset_id: 'wrong-public-response',
      version: 123,
      width: 2,
      height: 2,
    });
    await expect(storage.put(input)).rejects.toMatchObject({
      message: 'MEDIA_STORAGE_UNAVAILABLE',
    });
  });

  it('does not send invalid keys or disabled storage to Cloudinary and redacts provider errors', async () => {
    const storage = await setup();
    const spy = upload({}, true);
    for (const key of ['../escape', `havefolio/production/${randomUUID()}`, `${input.key}/other`]) {
      await expect(storage.put({ ...input, key })).rejects.toMatchObject({
        message: 'INVALID_MEDIA_KEY',
      });
    }
    expect(spy).not.toHaveBeenCalled();
    await expect(storage.put(input)).rejects.toMatchObject({
      message: 'MEDIA_STORAGE_UNAVAILABLE',
    });
    const disabled = await setup(false);
    await expect(disabled.put(input)).rejects.toMatchObject({ message: 'MEDIA_STORAGE_DISABLED' });
  });

  it('handles raw PDFs without public delivery and deletes idempotently with invalidation', async () => {
    const storage = await setup();
    const pdf = {
      ...input,
      key: `${input.key}.pdf`,
      resourceType: 'raw' as const,
      format: 'pdf' as const,
    };
    upload({
      public_id: pdf.key,
      resource_type: 'raw',
      type: 'authenticated',
      bytes: 4,
      asset_id: 'raw-id',
      version: 123,
    });
    expect(await storage.put(pdf)).toEqual({
      assetId: 'raw-id',
      version: 123,
      width: null,
      height: null,
    });
    const deletion = jest
      .spyOn(cloudinary.uploader, 'destroy')
      .mockResolvedValue({ result: 'not found' });
    await storage.delete(pdf.key, 'raw');
    expect(deletion).toHaveBeenCalledWith(
      pdf.key,
      expect.objectContaining({ type: 'authenticated', resource_type: 'raw', invalidate: true }),
    );
    deletion.mockResolvedValueOnce({ result: 'unexpected' });
    await expect(storage.delete(pdf.key, 'raw')).rejects.toMatchObject({
      message: 'MEDIA_STORAGE_UNAVAILABLE',
    });
  });

  it('creates a 60-second authenticated signed download with server credentials only', async () => {
    const storage = await setup();
    const now = Math.floor(Date.now() / 1000);
    const url = new URL(storage.download(input.key, 'image', 'jpg'));
    expect(url.origin).toBe('https://api.cloudinary.com');
    expect(url.pathname).toBe('/v1_1/fixture-cloud/image/download');
    expect(url.searchParams.get('type')).toBe('authenticated');
    expect(url.searchParams.get('attachment')).toBe('true');
    expect(Number(url.searchParams.get('expires_at'))).toBeGreaterThanOrEqual(now + 60);
    expect(Number(url.searchParams.get('expires_at'))).toBeLessThanOrEqual(now + 61);
    expect(url.searchParams.get('signature')).toMatch(/^[a-f0-9]{64}$/);
    expect(url.toString()).not.toContain('fixture-secret');
    const raw = new URL(storage.download(`${input.key}.pdf`, 'raw', 'pdf'));
    expect(raw.pathname).toBe('/v1_1/fixture-cloud/raw/download');
    expect(raw.searchParams.get('public_id')).toBe(`${input.key}.pdf`);
  });
  it('buffers server-only authenticated document access with byte bounds and a deadline', async () => {
    const storage = await setup();
    const bytes = Buffer.from('synthetic document');
    const fetcher = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(bytes, { headers: { 'content-length': String(bytes.length) } }),
      );
    expect(await storage.read(`${input.key}.pdf`, 'raw', 'pdf', bytes.length)).toEqual(bytes);
    expect(fetcher).toHaveBeenCalledWith(
      expect.stringContaining('/raw/download?'),
      expect.objectContaining({ redirect: 'error', signal: expect.any(AbortSignal) }),
    );
    const signed = new URL(fetcher.mock.calls[0]![0] as string);
    expect(signed.searchParams.get('type')).toBe('authenticated');
    expect(Number(signed.searchParams.get('expires_at'))).toBeGreaterThan(
      Math.floor(Date.now() / 1000),
    );
    for (const response of [
      new Response('wrong'),
      new Response(bytes, { status: 403 }),
      new Response(bytes, { headers: { 'content-length': '99999' } }),
    ]) {
      fetcher.mockResolvedValueOnce(response);
      await expect(storage.read(`${input.key}.pdf`, 'raw', 'pdf', bytes.length)).rejects.toThrow(
        'MEDIA_STORAGE_UNAVAILABLE',
      );
    }
    fetcher.mockRejectedValueOnce(new Error('credential and private path'));
    await expect(storage.read(`${input.key}.pdf`, 'raw', 'pdf', bytes.length)).rejects.toThrow(
      'MEDIA_STORAGE_UNAVAILABLE',
    );
    await expect(
      storage.read(`${input.key}.pdf`, 'raw', 'pdf', 20 * 1024 * 1024 + 1),
    ).rejects.toThrow('INVALID_MEDIA');
  });
});
