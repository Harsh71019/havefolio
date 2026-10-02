import {
  BadRequestException,
  Injectable,
  PayloadTooLargeException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { spawn, execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { PhotoProcessor, type PhotoInput } from './photo-processing.js';
import type { Format, ResourceType } from './storage.js';
export const DOCUMENT_LIMITS = {
  imageBytes: 10 * 1024 * 1024,
  pdfBytes: 20 * 1024 * 1024,
  requestBytes: 21 * 1024 * 1024,
  files: 1,
  perItem: 16,
  pages: 100,
  objects: 20_000,
  decodedBytes: 64 * 1024 * 1024,
  timeoutMs: 10_000,
  rssKiB: 256 * 1024,
} as const;
export interface ProcessedDocument {
  bytes: Buffer;
  checksum: string;
  format: Format;
  resourceType: ResourceType;
  mimeType: string;
  width: number | null;
  height: number | null;
}
// Strict parsing and a decoded object walk catch escaped names and compressed object streams.
// No rendering, action execution, extraction, URL fetches, credentials or file access.
const program = `
const {PDF,PdfRef,PdfDict,PdfArray,PdfName,PdfStream}=await import(process.argv[1]);
const chunks=[]; for await(const c of process.stdin) chunks.push(c);
const bytes=Buffer.concat(chunks); chunks.length=0;
const pdf=await PDF.load(bytes,{lenient:false});
if(pdf.isEncrypted||pdf.recoveredViaBruteForce) process.exit(2);
const count=pdf.getPageCount(); if(count<1||count>100) process.exit(2);
const registry=pdf.context.registry;
if(registry.nextObjectNumber>20000) process.exit(2);
const forbidden=new Set(['Encrypt','JS','JavaScript','A','AA','OpenAction','Launch','URI','URL','GoToR','GoToE','SubmitForm','ImportData','Rendition','RichMedia','Movie','Sound','EmbeddedFiles','EmbeddedFile','Filespec','FileAttachment','EF','AF','XFA','AcroForm','Collection','F','FFilter','FDecodeParms','PS','PostScript','Ref']);
const seen=new Set(); let nodes=0, decoded=0;
function walk(obj,depth=0) {
 if(!obj||depth>128||++nodes>100000) throw Error();
 if(obj instanceof PdfRef) { const value=registry.resolve(obj); if(!value) throw Error(); return walk(value,depth+1); }
 if(seen.has(obj)) return; seen.add(obj);
 if(obj instanceof PdfName && forbidden.has(obj.value)) throw Error();
 if(obj instanceof PdfArray) { for(const value of obj) walk(value,depth+1); }
 if(obj instanceof PdfDict) {
  for(const [key,value] of obj) { if(forbidden.has(key.value)) throw Error(); walk(value,depth+1); }
 }
 if(obj instanceof PdfStream) {
  // Decoding verifies compression and stream syntax. Whole-process memory/deadline guards
  // also cover parser-internal object-stream decoding before this walk.
  const data=obj.getDecodedData(); decoded+=data.length; if(decoded>67108864) throw Error();
 }
}
walk(pdf.context.info.trailer); walk(pdf.context.catalog.getDict());
for(let n=1;n<registry.nextObjectNumber;n++) {const obj=registry.resolve(PdfRef.of(n,0)); if(obj) walk(obj);}
for(const page of pdf.getPages()) if(!Number.isFinite(page.width)||!Number.isFinite(page.height)||page.width<=0||page.height<=0||page.width>14400||page.height>14400) process.exit(2);
if(pdf.warnings.length||registry.warnings.length) process.exit(2);
process.stdout.write('valid');
`;
export function validateDocumentFilename(filename: string): void {
  if (
    !filename ||
    filename.length > 255 ||
    /[/\\]/.test(filename) ||
    [...filename].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)
  )
    throw new BadRequestException('DOCUMENT_FILENAME_INVALID');
}
@Injectable()
export class DocumentProcessor {
  private active = false;
  constructor(private readonly photos: PhotoProcessor) {}
  async process(input: PhotoInput): Promise<ProcessedDocument> {
    validateDocumentFilename(input.filename);
    if (this.active) throw new ServiceUnavailableException('DOCUMENT_PROCESSING_BUSY');
    this.active = true;
    try {
      if (
        input.bytes.subarray(0, 5).toString('ascii') === '%PDF-' ||
        input.mimeType === 'application/pdf'
      ) {
        if (input.bytes.length > DOCUMENT_LIMITS.pdfBytes)
          throw new PayloadTooLargeException('DOCUMENT_FILE_SIZE');
        if (
          input.mimeType !== 'application/pdf' ||
          input.filename.split('.').at(-1)?.toLowerCase() !== 'pdf' ||
          !/^%PDF-(1\.[0-7]|2\.0)[\r\n]/.test(input.bytes.subarray(0, 10).toString('ascii')) ||
          !/startxref\s+\d+\s+%%EOF\s*$/.test(input.bytes.subarray(-1024).toString('latin1'))
        )
          throw new BadRequestException('DOCUMENT_INVALID');
        await this.validatePdf(input.bytes);
        const bytes = Buffer.from(input.bytes);
        return {
          bytes,
          checksum: createHash('sha256').update(bytes).digest('hex'),
          format: 'pdf',
          resourceType: 'raw',
          mimeType: 'application/pdf',
          width: null,
          height: null,
        };
      }
      if (input.bytes.length > DOCUMENT_LIMITS.imageBytes)
        throw new PayloadTooLargeException('DOCUMENT_FILE_SIZE');
      const outputs = await this.photos.process(input);
      const original = outputs[0]!;
      outputs.slice(1).forEach((o) => o.bytes.fill(0));
      return { ...original, format: 'webp', resourceType: 'image', mimeType: 'image/webp' };
    } finally {
      this.active = false;
    }
  }
  private async validatePdf(bytes: Buffer): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [
          '--max-old-space-size=128',
          '--input-type=module',
          '-e',
          program,
          createRequire(import.meta.url).resolve('@libpdf/core'),
        ],
        {
          stdio: ['pipe', 'pipe', 'ignore'],
          env: { PATH: process.env.PATH ?? '' },
        },
      );
      let output = '',
        failed = false,
        monitoring = false;
      const kill = (): void => {
        failed = true;
        child.kill('SIGKILL');
      };
      const deadline = setTimeout(kill, DOCUMENT_LIMITS.timeoutMs);
      // RSS bounds include typed-array/decompressor allocations outside the V8 heap.
      const memory = setInterval(() => {
        if (monitoring || !child.pid) return;
        monitoring = true;
        if (process.platform === 'linux') {
          void readFile(`/proc/${child.pid}/status`, 'utf8')
            .then((status) => {
              const rss = /^VmRSS:\s+(\d+)/m.exec(status);
              if (!rss || Number(rss[1]) > DOCUMENT_LIMITS.rssKiB) kill();
            })
            .catch(() => kill())
            .finally(() => {
              monitoring = false;
            });
          return;
        }
        execFile(
          '/bin/ps',
          ['-o', 'rss=', '-p', String(child.pid)],
          { timeout: 1000 },
          (error, stdout) => {
            monitoring = false;
            if (
              error ||
              !Number.isFinite(Number(stdout.trim())) ||
              Number(stdout.trim()) > DOCUMENT_LIMITS.rssKiB
            )
              kill();
          },
        );
      }, 100);
      const clear = (): void => {
        clearTimeout(deadline);
        clearInterval(memory);
      };
      child.stdin.on('error', () => undefined);
      child.stdout.on('data', (chunk: Buffer) => {
        output += chunk.toString();
        if (output.length > 32) kill();
      });
      child.on('error', () => {
        clear();
        reject(new BadRequestException('DOCUMENT_INVALID'));
      });
      child.on('close', (code) => {
        clear();
        if (failed || code !== 0 || output !== 'valid')
          reject(new BadRequestException('DOCUMENT_INVALID'));
        else resolve();
      });
      child.stdin.end(bytes);
    });
  }
}
