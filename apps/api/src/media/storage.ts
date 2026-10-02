export type ResourceType = 'image' | 'raw';
export type Format = 'jpg' | 'png' | 'webp' | 'pdf';
export interface StoredAsset {
  assetId: string;
  version: number;
  width: number | null;
  height: number | null;
}
export interface StoreInput {
  key: string;
  bytes: Buffer;
  resourceType: ResourceType;
  format: Format;
  checksum: string;
}

// This port is internal only. Authorised services own metadata and access decisions.
export abstract class PrivateMediaStorage {
  abstract read(
    key: string,
    resourceType: ResourceType,
    format: Format,
    byteSize: number,
  ): Promise<Buffer>;
  abstract put(input: StoreInput): Promise<StoredAsset>;
  abstract delete(key: string, resourceType: ResourceType): Promise<void>;
  abstract download(key: string, resourceType: ResourceType, format: Format): string;
}
