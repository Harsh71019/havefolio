import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
export const PHOTO_LIMITS = {
  fileBytes: 10 * 1024 * 1024,
  requestBytes: 21 * 1024 * 1024,
  files: 4,
  pixels: 24_000_000,
  dimension: 8192,
  timeoutMs: 10_000,
} as const;
export interface PhotoInput {
  bytes: Buffer;
  mimeType: string;
  filename: string;
}
export interface ProcessedPhoto {
  variant: 'original' | 'display' | 'thumbnail';
  bytes: Buffer;
  width: number;
  height: number;
  checksum: string;
}
// A separate process makes the wall-clock deadline enforceable even inside a native decoder.
const program = `
const { default: sharp } = await import(process.argv[1]);
sharp.cache(false); sharp.concurrency(1);
const chunks=[]; for await (const chunk of process.stdin) chunks.push(chunk);
const bytes=Buffer.concat(chunks); chunks.length=0;
const options={failOn:'warning',limitInputPixels:24000000,limitInputChannels:4};
const meta=await sharp(bytes,options).metadata();
if(!['jpeg','png','webp'].includes(meta.format)||!meta.width||!meta.height||meta.width>8192||meta.height>8192||meta.width*meta.height>24000000||(meta.pages??1)!==1) process.exit(2);
const outputs=[];
for(const [variant,size] of [['original',4096],['display',1600],['thumbnail',320]]) {
 const {data,info}=await sharp(bytes,options).rotate().resize({width:size,height:size,fit:'inside',withoutEnlargement:true}).webp({quality:85}).timeout({seconds:8}).toBuffer({resolveWithObject:true});
 if(data.length>10485760) process.exit(2);
 outputs.push({variant,data:data.toString('base64'),width:info.width,height:info.height});
}
process.stdout.write(JSON.stringify(outputs));
`;
export function validatePhoto(input: PhotoInput): void {
  const b = input.bytes;
  if (!b.length || b.length > PHOTO_LIMITS.fileBytes)
    throw new BadRequestException('PHOTO_FILE_SIZE');
  if (
    b.subarray(4, 8).toString() === 'ftyp' &&
    /heic|heix|hevc|hevx|heim|heis|mif1|msf1/.test(
      b.subarray(8, Math.min(b.length, 64)).toString('ascii'),
    )
  )
    throw new BadRequestException('PHOTO_HEIC_UNSUPPORTED');
  let format: string | undefined;
  if (
    b[0] === 255 &&
    b[1] === 216 &&
    b[2] === 255 &&
    b.subarray(-2).equals(Buffer.from([255, 217]))
  )
    format = 'jpeg';
  if (
    b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
    b.subarray(-12).equals(Buffer.from([0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130]))
  )
    format = 'png';
  if (
    b.subarray(0, 4).toString() === 'RIFF' &&
    b.subarray(8, 12).toString() === 'WEBP' &&
    b.length >= 12 &&
    b.readUInt32LE(4) + 8 === b.length
  )
    format = 'webp';
  const ext = input.filename.split('.').at(-1)?.toLowerCase();
  if (
    !format ||
    input.mimeType !== `image/${format}` ||
    !(format === 'jpeg' ? ['jpg', 'jpeg'].includes(ext ?? '') : ext === format)
  )
    throw new BadRequestException('PHOTO_FORMAT_MISMATCH');
  // PNG animation is not always exposed as pages by libvips.
  if (format === 'png') {
    for (let offset = 8; offset + 12 <= b.length;) {
      const length = b.readUInt32BE(offset),
        type = b.subarray(offset + 4, offset + 8).toString();
      if (type === 'acTL') throw new BadRequestException('PHOTO_ANIMATION_UNSUPPORTED');
      if (length > b.length - offset - 12) throw new BadRequestException('PHOTO_INVALID');
      offset += length + 12;
    }
  }
}
@Injectable()
export class PhotoProcessor {
  private active = false;
  async process(input: PhotoInput): Promise<ProcessedPhoto[]> {
    validatePhoto(input);
    if (this.active) throw new ServiceUnavailableException('PHOTO_PROCESSING_BUSY');
    this.active = true;
    try {
      return await new Promise<ProcessedPhoto[]>((resolve, reject) => {
        const sharpPath = createRequire(import.meta.url).resolve('sharp');
        const child = spawn(
          process.execPath,
          ['--max-old-space-size=128', '--input-type=module', '-e', program, sharpPath],
          {
            stdio: ['pipe', 'pipe', 'ignore'],
            env: {
              PATH: process.env.PATH ?? '',
              TMPDIR: process.env.TMPDIR ?? '/tmp',
              UV_THREADPOOL_SIZE: '1',
              OMP_NUM_THREADS: '1',
            },
          },
        );
        let size = 0;
        const chunks: Buffer[] = [];
        let failed = false;
        const timeout = setTimeout(() => {
          failed = true;
          child.kill('SIGKILL');
        }, PHOTO_LIMITS.timeoutMs);
        child.stdout.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > 43 * 1024 * 1024) {
            failed = true;
            child.kill('SIGKILL');
          } else chunks.push(chunk);
        });
        child.stdin.on('error', () => undefined);
        child.on('error', () => {
          clearTimeout(timeout);
          reject(new BadRequestException('PHOTO_PROCESSING_FAILED'));
        });
        child.on('close', (code) => {
          clearTimeout(timeout);
          try {
            if (failed || code !== 0) throw new Error();
            const rows = JSON.parse(Buffer.concat(chunks).toString()) as {
              variant: ProcessedPhoto['variant'];
              data: string;
              width: number;
              height: number;
            }[];
            resolve(
              rows.map((r) => {
                const bytes = Buffer.from(r.data, 'base64');
                return {
                  variant: r.variant,
                  width: r.width,
                  height: r.height,
                  bytes,
                  checksum: createHash('sha256').update(bytes).digest('hex'),
                };
              }),
            );
          } catch {
            reject(new BadRequestException(failed ? 'PHOTO_PROCESSING_TIMEOUT' : 'PHOTO_INVALID'));
          } finally {
            chunks.length = 0;
          }
        });
        child.stdin.end(input.bytes);
      });
    } finally {
      this.active = false;
    }
  }
}
