import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary, type UploadApiOptions, type UploadApiResponse } from 'cloudinary';
import {
  PrivateMediaStorage,
  type Format,
  type ResourceType,
  type StoreInput,
  type StoredAsset,
} from './storage.js';

@Injectable()
export class CloudinaryStorage extends PrivateMediaStorage {
  private readonly options: UploadApiOptions;
  private readonly prefix: string;
  private readonly enabled: boolean;

  constructor(config: ConfigService) {
    super();
    this.enabled = config.get<boolean>('MEDIA_STORAGE_ENABLED', false);
    this.prefix = `havefolio/${config.get<string>('NODE_ENV', 'development')}/`;
    this.options = {
      cloud_name: config.get<string>('CLOUDINARY_CLOUD_NAME'),
      api_key: config.get<string>('CLOUDINARY_API_KEY'),
      api_secret: config.get<string>('CLOUDINARY_API_SECRET'),
      secure: true,
      timeout: 30_000,
      signature_algorithm: 'sha256',
    };
  }

  private assertKey(key: string, resourceType: ResourceType): void {
    if (!this.enabled) throw new ServiceUnavailableException('MEDIA_STORAGE_DISABLED');
    const suffix = key.slice(this.prefix.length);
    if (
      !key.startsWith(this.prefix) ||
      !/^[a-f0-9-]{36}(\.pdf)?$/.test(suffix) ||
      (resourceType === 'raw') !== key.endsWith('.pdf')
    ) {
      throw new BadRequestException('INVALID_MEDIA_KEY');
    }
  }

  async put(input: StoreInput): Promise<StoredAsset> {
    this.assertKey(input.key, input.resourceType);
    try {
      const result = await new Promise<UploadApiResponse>((resolve, reject) => {
        let settled = false;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const stream = cloudinary.uploader.upload_stream(
          {
            ...this.options,
            public_id: input.key,
            resource_type: input.resourceType,
            type: 'authenticated',
            overwrite: false,
            use_filename: false,
            unique_filename: false,
            discard_original_filename: true,
            context: { hf_checksum: input.checksum },
          },
          (error, response) => {
            settled = true;
            clearTimeout(timer);
            if (error || !response) reject(new Error());
            else resolve(response);
          },
        );
        stream.on('error', () => {
          clearTimeout(timer);
          reject(new Error());
        });
        if (!settled)
          timer = setTimeout(() => {
            stream.destroy();
            reject(new Error());
          }, 30_000);
        stream.end(input.bytes);
      });
      const assetId: unknown = result.asset_id;
      if (
        result.public_id !== input.key ||
        result.resource_type !== input.resourceType ||
        result.type !== 'authenticated' ||
        result.bytes !== input.bytes.length ||
        typeof assetId !== 'string' ||
        !assetId ||
        !Number.isSafeInteger(result.version) ||
        result.version < 1 ||
        (input.resourceType === 'image' && result.format !== input.format)
      )
        throw new Error();
      const width = input.resourceType === 'image' ? result.width : null;
      const height = input.resourceType === 'image' ? result.height : null;
      if (
        input.resourceType === 'image' &&
        (!Number.isInteger(width) ||
          !Number.isInteger(height) ||
          !width ||
          !height ||
          width < 1 ||
          height < 1 ||
          width > 8192 ||
          height > 8192 ||
          width * height > 24_000_000)
      )
        throw new Error();
      return { assetId, version: result.version, width, height };
    } catch {
      // Keep pending metadata for ambiguous provider writes; never surface SDK details.
      throw new ServiceUnavailableException('MEDIA_STORAGE_UNAVAILABLE');
    }
  }

  async delete(key: string, resourceType: ResourceType): Promise<void> {
    this.assertKey(key, resourceType);
    try {
      const result: unknown = await cloudinary.uploader.destroy(key, {
        ...this.options,
        resource_type: resourceType,
        type: 'authenticated',
        invalidate: true,
      });
      if (
        !result ||
        typeof result !== 'object' ||
        !('result' in result) ||
        typeof result.result !== 'string' ||
        !['ok', 'not found'].includes(result.result)
      )
        throw new Error();
    } catch {
      throw new ServiceUnavailableException('MEDIA_STORAGE_UNAVAILABLE');
    }
  }

  download(key: string, resourceType: ResourceType, format: Format): string {
    this.assertKey(key, resourceType);
    try {
      return cloudinary.utils.private_download_url(key, format, {
        ...this.options,
        resource_type: resourceType,
        type: 'authenticated',
        expires_at: Math.floor(Date.now() / 1000) + 60,
        attachment: true,
      });
    } catch {
      throw new ServiceUnavailableException('MEDIA_STORAGE_UNAVAILABLE');
    }
  }
}
