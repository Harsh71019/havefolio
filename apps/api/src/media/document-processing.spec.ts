import { describe, expect, it, jest } from '@jest/globals';
import { PDF, PdfName, PdfDict, PdfString, PdfStream, PdfArray } from '@libpdf/core';
import sharp from 'sharp';
import { deflateSync } from 'node:zlib';
import { DocumentProcessor, DOCUMENT_LIMITS, pdfMemoryOverBudget } from './document-processing.js';
import { PhotoProcessor } from './photo-processing.js';
jest.setTimeout(30000);
const processor = new DocumentProcessor(new PhotoProcessor());
const pdfBytes = async (pages = 1): Promise<Buffer> => {
  const pdf = PDF.create();
  for (let i = 0; i < pages; i++) pdf.addPage();
  return Buffer.from(await pdf.save());
};
const input = (bytes: Buffer): { bytes: Buffer; mimeType: string; filename: string } => ({
  bytes,
  mimeType: 'application/pdf',
  filename: 'synthetic.pdf',
});
// Complete synthetic xref-stream PDF with a compressed indirect dictionary.
function objectStreamPdf(unsafe: boolean): Buffer {
  const data = deflateSync(Buffer.from(`5 0 << /${unsafe ? 'J#53' : 'Fixture'} (synthetic) >>`));
  const bodies = [
    Buffer.from('<< /Type /Catalog /Pages 2 0 R /Synthetic 5 0 R >>'),
    Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
    Buffer.from('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] >>'),
    Buffer.concat([
      Buffer.from(
        `<< /Type /ObjStm /N 1 /First 4 /Filter /FlateDecode /Length ${data.length} >>\nstream\n`,
      ),
      data,
      Buffer.from('\nendstream'),
    ]),
  ];
  const chunks = [Buffer.from('%PDF-1.7\n')];
  const offsets = [0];
  let length = chunks[0]!.length;
  bodies.forEach((body, i) => {
    offsets.push(length);
    const object = Buffer.concat([
      Buffer.from(`${i + 1} 0 obj\n`),
      body,
      Buffer.from('\nendobj\n'),
    ]);
    chunks.push(object);
    length += object.length;
  });
  const xref = Buffer.alloc(7 * 7);
  for (let n = 0; n < 7; n++) {
    const at = n * 7;
    xref[at] = n === 0 ? 0 : n === 5 ? 2 : 1;
    xref.writeUInt32BE(n === 5 ? 4 : n === 6 ? length : (offsets[n] ?? 0), at + 1);
    xref.writeUInt16BE(n === 0 ? 65535 : 0, at + 5);
  }
  chunks.push(
    Buffer.from(
      `6 0 obj\n<< /Type /XRef /Size 7 /Root 1 0 R /W [1 4 2] /Length ${xref.length} >>\nstream\n`,
    ),
    xref,
    Buffer.from(`\nendstream\nendobj\nstartxref\n${length}\n%%EOF\n`),
  );
  return Buffer.concat(chunks);
}
describe('bounded private document processing', () => {
  it.each(['jpeg', 'png', 'webp'] as const)(
    'decodes %s and strips EXIF/GPS through PER-13',
    async (format) => {
      const bytes = await sharp({
        create: { width: 20, height: 30, channels: 3, background: '#abcdef' },
      })
        .withExif({
          IFD0: { Artist: 'Synthetic private marker' },
          IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '1/1 2/1 3/1' },
        })
        .toFormat(format)
        .toBuffer();
      const result = await processor.process({
        bytes,
        mimeType: `image/${format}`,
        filename: `synthetic.${format}`,
      });
      expect(result.mimeType).toBe('image/webp');
      expect(result.resourceType).toBe('image');
      const meta = await sharp(result.bytes).metadata();
      expect(meta.exif).toBeUndefined();
      expect(result.bytes.toString()).not.toContain('marker');
    },
  );
  it('parses a synthetic bounded PDF', async () => {
    const bytes = await pdfBytes();
    const out = await processor.process(input(bytes));
    expect(out.bytes).toEqual(bytes);
    expect(out.resourceType).toBe('raw');
  });
  it.each(['mime', 'extension', 'truncation', 'malformed', 'size', 'pages'])(
    'rejects %s safely',
    async (fault) => {
      let bytes = await pdfBytes(fault === 'pages' ? DOCUMENT_LIMITS.pages + 1 : 1);
      const file = input(bytes);
      if (fault === 'mime') file.mimeType = 'image/png';
      if (fault === 'extension') file.filename = 'spoof.png';
      if (fault === 'truncation') file.bytes = bytes.subarray(0, -30);
      if (fault === 'malformed') {
        bytes = Buffer.from('%PDF-1.7\nmalformed\nstartxref\n0\n%%EOF');
        file.bytes = bytes;
      }
      if (fault === 'size')
        file.bytes = Buffer.concat([bytes, Buffer.alloc(DOCUMENT_LIMITS.pdfBytes)]);
      await expect(processor.process(file)).rejects.toThrow(/DOCUMENT_/);
    },
  );
  it.each([
    'JavaScript',
    'OpenAction',
    'AA',
    'EmbeddedFiles',
    'Launch',
    'URI',
    'XFA',
    'AcroForm',
    'RichMedia',
    'F',
  ])('rejects unsafe parsed feature %s without executing it', async (feature) => {
    const pdf = PDF.create();
    pdf.addPage();
    pdf.context.catalog
      .getDict()
      .set(
        feature,
        PdfDict.of({ S: PdfName.of('JavaScript'), JS: PdfString.fromString('synthetic') }),
      );
    await expect(processor.process(input(Buffer.from(await pdf.save())))).rejects.toThrow(
      'DOCUMENT_INVALID',
    );
  });
  it('rejects encrypted PDF even with empty user password', async () => {
    const pdf = PDF.create();
    pdf.addPage();
    pdf.setProtection({ ownerPassword: 'synthetic-only' });
    await expect(processor.process(input(Buffer.from(await pdf.save())))).rejects.toThrow(
      'DOCUMENT_INVALID',
    );
  });
  it.each(['bad\r\nHeader.pdf', '../receipt.pdf', 'folder\\receipt.pdf'])(
    'rejects unsafe filename %s',
    async (filename) => {
      await expect(processor.process({ ...input(await pdfBytes()), filename })).rejects.toThrow(
        'DOCUMENT_FILENAME_INVALID',
      );
    },
  );
  it('serializes PDF work', async () => {
    const bytes = await pdfBytes();
    const first = processor.process(input(bytes));
    await expect(processor.process(input(bytes))).rejects.toThrow('DOCUMENT_PROCESSING_BUSY');
    await first;
  });
  it('parses ordinary text and scanned image PDFs', async () => {
    const pdf = PDF.create();
    const page = pdf.addPage();
    page.drawText('Synthetic warranty', { x: 20, y: 700, size: 12 });
    const jpeg = await sharp({
      create: { width: 60, height: 40, channels: 3, background: '#abcdef' },
    })
      .jpeg()
      .toBuffer();
    page.drawImage(pdf.embedJpeg(jpeg), { x: 20, y: 100, width: 60, height: 40 });
    await expect(processor.process(input(Buffer.from(await pdf.save())))).resolves.toMatchObject({
      format: 'pdf',
    });
  });
  it('rejects decoded stream work above the aggregate budget', async () => {
    const pdf = PDF.create();
    pdf.addPage();
    const stream = new PdfStream(undefined, Buffer.alloc(DOCUMENT_LIMITS.decodedBytes + 1, 32));
    pdf.context.catalog.getDict().set('SyntheticStream', pdf.context.registry.register(stream));
    await expect(processor.process(input(Buffer.from(await pdf.save())))).rejects.toThrow(
      'DOCUMENT_INVALID',
    );
  });
  it('rejects excessive indirect-object work', async () => {
    const pdf = PDF.create();
    pdf.addPage();
    const refs = new PdfArray();
    for (let n = 0; n < DOCUMENT_LIMITS.objects; n++)
      refs.push(pdf.context.registry.register(PdfDict.of({ Synthetic: PdfName.of('Fixture') })));
    pdf.context.catalog.getDict().set('SyntheticObjects', refs);
    await expect(processor.process(input(Buffer.from(await pdf.save())))).rejects.toThrow(
      'DOCUMENT_INVALID',
    );
  });
  it('resolves compressed object streams and escaped unsafe names', async () => {
    await expect(processor.process(input(objectStreamPdf(false)))).resolves.toMatchObject({
      format: 'pdf',
    });
    await expect(processor.process(input(objectStreamPdf(true)))).rejects.toThrow(
      'DOCUMENT_INVALID',
    );
  });
  it('kills PDF processing when its wall-clock deadline expires', async () => {
    const bytes = await pdfBytes();
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    const pending = processor.process(input(bytes));
    const assertion = expect(pending).rejects.toThrow('DOCUMENT_INVALID');
    jest.advanceTimersByTime(DOCUMENT_LIMITS.timeoutMs);
    jest.useRealTimers();
    await assertion;
  });
  it('does not reject a Linux parser whose address space has exited; excess RSS stays closed', () => {
    expect(pdfMemoryOverBudget('State:\tZ (zombie)\n')).toBe(false);
    expect(pdfMemoryOverBudget('State:\tR (running)\nVmRSS:\t80000 kB\n')).toBe(false);
    expect(pdfMemoryOverBudget('State:\tR (running)\n')).toBe(false);
    expect(
      pdfMemoryOverBudget(`State:\tR (running)\nVmRSS:\t${DOCUMENT_LIMITS.rssKiB + 1} kB\n`),
    ).toBe(true);
  });
});
