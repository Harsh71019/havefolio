import { itemPhotoLimits } from '@havefolio/contracts';

/**
 * PER-47: HEIC/HEIF photos are converted on the device, never on the server or by a third party.
 * The API's Sharp build has no HEVC decoder, so it keeps rejecting HEIC. Browsers with a native
 * HEIC decoder (Safari/WebKit) draw it to a canvas and re-encode JPEG, which drops the source
 * metadata (GPS, camera, timestamps) before upload. WebKit's encoder may add a minimal EXIF block
 * (colour space and pixel size only); the API still validates, re-encodes and strips everything.
 */
export const conversionLimits = {
  inputBytes: itemPhotoLimits.maxFileBytes,
  outputBytes: itemPhotoLimits.maxFileBytes,
  // The API stores at most a 4096px master, and 4096² is within iOS canvas memory limits.
  maxEdge: 4096,
  timeoutMs: 15_000,
  quality: 0.9,
} as const;

/** Guidance with a working alternative; shown whenever this browser cannot convert. */
export const heicGuidance =
  'This browser can’t convert HEIC/HEIF photos. On iPhone, open the photo from your library (it is shared as JPEG), or set Camera › Formats to Most Compatible. Elsewhere, export it as JPEG, PNG or WebP. You can also save the item now and add photos later.';

// 2×2 synthetic grey HEIC generated for this probe; contains no metadata or personal content.
const probe =
  'data:image/heic;base64,AAAAJGZ0eXBoZWljAAAAAG1pZjFNaVBybWlhZk1pSEJoZWljAAABxG1ldGEAAAAAAAAAIWhkbHIAAAAAAAAAAHBpY3QAAAAAAAAAAAAAAAAAAAAAJGRpbmYAAAAcZHJlZgAAAAAAAAABAAAADHVybCAAAAABAAAADnBpdG0AAAAAAAEAAAA4aWluZgAAAAAAAgAAABVpbmZlAgAAAAABAABodmMxAAAAABVpbmZlAgAAAQACAABFeGlmAAAAABppcmVmAAAAAAAAAA5jZHNjAAIAAQABAAAA52lwcnAAAADGaXBjbwAAABNjb2xybmNseAACAAIABoAAAAAMY2xsaQDLAEAAAAAUaXNwZQAAAAAAAAACAAAAAgAAAAlpcm90AAAAABBwaXhpAAAAAAMICAgAAAByaHZjQwEDcAAAALAAAAAAAB7wAPz9+PgAAAsDoAABABdAAQwB//8DcAAAAwCwAAADAAADAB5wJKEAAQAkQgEBA3AAAAMAsAAAAwAAAwAeoBQgQcChBBiHuRZVNwICBgCAogABAAlEAcBhcshAUyQAAAAZaXBtYQAAAAAAAAABAAEGgQIDBYaEAAAALGlsb2MAAAAARAAAAgABAAAAAQAAAkQAAAAlAAIAAAABAAAB+AAAAEwAAAABbWRhdAAAAAAAAACBAAAABkV4aWYAAE1NACoAAAAIAAMBGgAFAAAAAQAAADIBGwAFAAAAAQAAADoBKAADAAAAAQACAAAAAAAAAAAAGQAAAAEAAAAZAAAAAQAAACEoAa+ifEfrWHi+RE0TP/hZ63HMr+hCO7b/4WadMdyQB1g=';

const brands = /heic|heix|hevc|hevx|heim|heis|mif1|msf1/;

/** Mirrors the API's ISO-BMFF brand check so unlabeled or mislabeled files are still caught. */
export async function isHeic(file: File): Promise<boolean> {
  if (/^image\/hei[cf]/i.test(file.type) || /\.(heic|heif)$/i.test(file.name)) return true;
  if (/^image\/(jpeg|png|webp)$/i.test(file.type)) return false;
  try {
    const head = new Uint8Array(await file.slice(0, 64).arrayBuffer());
    const text = String.fromCharCode(...head);
    return text.slice(4, 8) === 'ftyp' && brands.test(text.slice(8));
  } catch {
    return false;
  }
}

function within<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error('decode'));
      },
    );
  });
}

let support: Promise<boolean> | undefined;

/** Feature test with a tiny embedded HEIC; cached for the page lifetime. */
export function canConvertHeic(): Promise<boolean> {
  support ??= (async () => {
    if (typeof Image === 'undefined' || typeof document === 'undefined') return false;
    try {
      const image = new Image();
      image.src = probe;
      await within(image.decode(), 3000);
      return image.naturalWidth > 0;
    } catch {
      return false;
    }
  })();
  return support;
}

/** Test seam only. */
export function resetHeicSupport(): void {
  support = undefined;
}

export type ConversionResult = { ok: true; file: File } | { ok: false; message: string };

export async function convertHeic(file: File): Promise<ConversionResult> {
  if (file.size === 0 || file.size > conversionLimits.inputBytes)
    return { ok: false, message: 'Choose a HEIC photo smaller than 10 MiB.' };
  if (!(await canConvertHeic())) return { ok: false, message: heicGuidance };
  const url = URL.createObjectURL(file);
  const canvas = document.createElement('canvas');
  try {
    const image = new Image();
    image.src = url;
    await within(image.decode(), conversionLimits.timeoutMs);
    const { naturalWidth: width, naturalHeight: height } = image;
    if (!width || !height) throw new Error('empty');
    const scale = Math.min(1, conversionLimits.maxEdge / Math.max(width, height));
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('canvas');
    // Browsers apply the EXIF orientation when drawing; source metadata never reaches the canvas.
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await within(
      new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, 'image/jpeg', conversionLimits.quality),
      ),
      conversionLimits.timeoutMs,
    );
    if (!blob?.size) throw new Error('encode');
    if (blob.size > conversionLimits.outputBytes)
      return { ok: false, message: 'The converted photo is larger than 10 MiB. ' + heicGuidance };
    const name = (file.name.replace(/\.(heic|heif)$/i, '') || 'photo') + '.jpg';
    return {
      ok: true,
      file: new File([blob], name, { type: 'image/jpeg', lastModified: file.lastModified }),
    };
  } catch {
    return {
      ok: false,
      message: 'This HEIC photo could not be converted safely on this device. ' + heicGuidance,
    };
  } finally {
    URL.revokeObjectURL(url);
    // Release canvas memory promptly on memory-constrained phones.
    canvas.width = 0;
    canvas.height = 0;
  }
}
