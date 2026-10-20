import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { validateWorkerEnvironment } from '@havefolio/config';
import { ocrLimits, parseOcrReference, validateEnrichmentCandidates } from '@havefolio/domain';
import { EnrichmentWorkerService } from '../dist/enrichment/enrichment.service.js';
import { LocalOcrProvider } from '../dist/enrichment/ocr/local-ocr.provider.js';
import { CloudinaryImageReader } from '../dist/enrichment/ocr/media-reader.js';
import { ocrImageLimits } from '../dist/enrichment/ocr/ocr-limits.js';
import { rssOver, runSandboxed } from '../dist/enrichment/ocr/sandbox.js';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'sandbox');
const limits = { heapMiB: 32, rssKiB: 160 * 1024, timeoutMs: 5000, outputBytes: 4096 };
const run = (name, overrides = {}, signal = new AbortController().signal, input = 'in') =>
  runSandboxed(
    join(fixtures, name),
    Buffer.from(input),
    [fixtures],
    { ...limits, ...overrides },
    signal,
  );

test('sandbox denies writes, child processes, parent environment and unrelated reads; env is empty', async () => {
  const result = JSON.parse(
    (await run('probe.mjs', {}, undefined, 'PRIVATE_IMAGE_BYTES')).toString(),
  );
  assert.equal(result.echo, 'PRIVATE_IMAGE_BYTES');
  assert.deepEqual(result.env, []);
  assert.equal(result.write, 'denied');
  assert.equal(result.spawn, 'denied');
  assert.equal(result.parentEnviron, 'denied');
  assert.equal(result.passwd, 'denied');
  assert.equal(existsSync(join(tmpdir(), 'havefolio-ocr-sandbox-probe')), false);
});

test('sandbox kills on deadline, memory, output flood, abort and failure without echoing output', async () => {
  await assert.rejects(run('hang.mjs', { timeoutMs: 300 }), { code: 'OCR_SANDBOX_LIMIT' });
  await assert.rejects(run('memory.mjs', { rssKiB: 96 * 1024 }), { code: 'OCR_SANDBOX_LIMIT' });
  await assert.rejects(run('flood.mjs'), { code: 'OCR_SANDBOX_LIMIT' });
  const abort = new AbortController();
  const pending = run('hang.mjs', {}, abort.signal);
  setTimeout(() => abort.abort(), 100);
  await assert.rejects(pending, { code: 'OCR_ABORTED' });
  await assert.rejects(run('hang.mjs', {}, AbortSignal.abort()), { code: 'OCR_ABORTED' });
  await assert.rejects(run('fail.mjs'), (error) => {
    assert.equal(error.code, 'OCR_SANDBOX_FAILED');
    assert.equal(String(error.message).includes('PRIVATE'), false);
    return true;
  });
});

test('RSS sampling treats an exiting process without VmRSS as finished, not over budget', () => {
  assert.equal(rssOver('Name:\tnode\nVmRSS:\t  200000 kB\n', 100000), true);
  assert.equal(rssOver('Name:\tnode\nVmRSS:\t  90000 kB\n', 100000), false);
  assert.equal(rssOver('Name:\tnode\nState:\tZ (zombie)\n', 100000), false);
});

test('child limits mirror the domain bounds and stay inside the work lease', () => {
  assert.equal(ocrImageLimits.lines, ocrLimits.lines);
  assert.equal(ocrImageLimits.lineLength, ocrLimits.lineLength);
  assert.ok(
    ocrImageLimits.readMs + ocrImageLimits.prepare.timeoutMs + ocrImageLimits.recognize.timeoutMs >=
      ocrImageLimits.totalMs,
  );
  assert.ok(ocrImageLimits.totalMs < 30000);
  // Worker baseline (57–63 MiB documented) plus the larger child threshold stays below 256 MiB.
  assert.ok(64 * 1024 + ocrImageLimits.recognize.rssKiB + 16 * 1024 < 256 * 1024);
});

const image = Buffer.from('synthetic-image-bytes');
const checksum = createHash('sha256').update(image).digest('hex');
function fakes({
  media = { objectKey: 'k', format: 'webp', byteSize: image.length, checksum },
  lines,
} = {}) {
  const calls = { lookups: [], prepared: [], read: [] };
  const store = {
    readyImage: async (...args) => {
      calls.lookups.push(args);
      return media;
    },
  };
  const reader = {
    read: async (...args) => {
      calls.read.push(args);
      return Buffer.from(image);
    },
  };
  const runner = {
    prepare: async (bytes) => {
      calls.prepared.push(bytes);
      return Buffer.from('prepared');
    },
    recognize: async () =>
      lines ?? [
        { text: 'Kettle Rs 1,299.00', confidence: 95, height: 20 },
        { text: 'Total Rs 1,299.00', confidence: 95, height: 20 },
      ],
  };
  return { store, reader, runner, calls };
}

test('provider resolves media only inside the claimed owner and item, verifies checksum and scrubs buffers', async () => {
  const { store, reader, runner, calls } = fakes();
  const provider = new LocalOcrProvider(store, reader, runner, () => '2026-10-20');
  const signal = new AbortController().signal;
  const result = await provider.suggest({ kind: 'receipt', attachmentId: 'a1' }, signal, {
    ownerId: 'owner',
    itemId: 'item',
  });
  assert.deepEqual(calls.lookups, [['owner', 'item', 'a1', 'receipt']]);
  assert.deepEqual(validateEnrichmentCandidates(result, 'local-ocr', 'receipt'), result);
  assert.equal(result[0].fields.find((f) => f.field === 'pricePaid').value, 'INR 129900');
  assert.ok(parseOcrReference(result[0].fields[0].source.reference));
  assert.ok(
    calls.prepared[0].every((byte) => byte === 0),
    'source image is zeroed after use',
  );
  await assert.rejects(
    provider.suggest({ kind: 'receipt', attachmentId: 'a1' }, signal),
    /OCR_INPUT_UNSUPPORTED/,
  );
  await assert.rejects(
    provider.suggest({ kind: 'name', name: 'x' }, signal, { ownerId: 'o', itemId: 'i' }),
  );
});

test('missing, foreign or altered media fails before any image processing', async () => {
  const absent = fakes({ media: null });
  await assert.rejects(
    new LocalOcrProvider(absent.store, absent.reader, absent.runner).suggest(
      { kind: 'photo', attachmentId: 'a' },
      new AbortController().signal,
      { ownerId: 'o', itemId: 'i' },
    ),
    /OCR_MEDIA_UNAVAILABLE/,
  );
  assert.equal(absent.calls.read.length, 0);
  const altered = fakes({
    media: { objectKey: 'k', format: 'webp', byteSize: 1, checksum: 'a'.repeat(64) },
  });
  await assert.rejects(
    new LocalOcrProvider(altered.store, altered.reader, altered.runner).suggest(
      { kind: 'photo', attachmentId: 'a' },
      new AbortController().signal,
      { ownerId: 'o', itemId: 'i' },
    ),
    /OCR_MEDIA_CHECKSUM/,
  );
  assert.equal(altered.calls.prepared.length, 0);
});

test('worker passes claim scope to the adapter and logs only fixed tokens when OCR fails', async () => {
  const events = [],
    outcomes = [];
  const { store, reader } = fakes();
  const provider = new LocalOcrProvider(store, reader, {
    prepare: async () => {
      throw new Error('PRIVATE receipt text Rs 1,299.00 /private/path');
    },
    recognize: async () => [],
  });
  const service = new EnrichmentWorkerService(
    {
      store: {
        claim: async () => ({
          ownerId: 'owner',
          itemId: 'item',
          input: { kind: 'receipt', attachmentId: 'a1' },
        }),
        finish: async (_c, outcome) => outcomes.push(outcome),
      },
    },
    [provider],
    { emit: (_level, event) => events.push(event) },
  );
  await service.process('work');
  assert.deepEqual(outcomes, ['failed']);
  const text = JSON.stringify(events);
  for (const secret of ['PRIVATE', '1,299', '/private', 'a1', 'owner'])
    assert.equal(text.includes(secret), false);
  assert.ok(events.every((e) => e.code === 'ENRICHMENT_PROVIDER_FAILED'));
});

test('media reader validates keys before signing and enforces exact bounded reads without redirects', async () => {
  const reader = new CloudinaryImageReader({
    NODE_ENV: 'test',
    CLOUDINARY_CLOUD_NAME: 'synthetic',
    CLOUDINARY_API_KEY: 'key',
    CLOUDINARY_API_SECRET: 'secret',
  });
  const key = 'havefolio/test/11111111-2222-4333-8444-555555555555';
  const signal = new AbortController().signal;
  for (const [k, format, size] of [
    ['havefolio/production/11111111-2222-4333-8444-555555555555', 'webp', 4],
    [key + '.pdf', 'webp', 4],
    [key, 'pdf', 4],
    [key, 'webp', ocrImageLimits.inputBytes + 1],
  ])
    await assert.rejects(reader.read(k, format, size, signal), /OCR_MEDIA_INVALID/);
  const original = globalThis.fetch;
  const requests = [];
  try {
    globalThis.fetch = async (url, init) => {
      requests.push({ url: String(url), redirect: init.redirect });
      return new Response('abcd', { headers: { 'content-length': '4' } });
    };
    assert.equal((await reader.read(key, 'webp', 4, signal)).toString(), 'abcd');
    assert.equal(requests[0].redirect, 'error');
    assert.match(requests[0].url, /^https:\/\/api\.cloudinary\.com\//);
    await assert.rejects(reader.read(key, 'webp', 3, signal), /OCR_MEDIA_UNAVAILABLE/);
    globalThis.fetch = async () => new Response('abcdef');
    await assert.rejects(reader.read(key, 'webp', 4, signal), /OCR_MEDIA_UNAVAILABLE/);
    globalThis.fetch = async () => new Response('x', { status: 404 });
    await assert.rejects(reader.read(key, 'webp', 1, signal), /OCR_MEDIA_UNAVAILABLE/);
  } finally {
    globalThis.fetch = original;
  }
});

test('OCR is opt-in and requires media access plus the runtime database', () => {
  assert.equal(validateWorkerEnvironment({ NODE_ENV: 'test' }).OCR_ENABLED, false);
  assert.throws(() => validateWorkerEnvironment({ NODE_ENV: 'test', OCR_ENABLED: 'true' }));
  assert.equal(
    validateWorkerEnvironment({
      NODE_ENV: 'test',
      OCR_ENABLED: 'true',
      DATABASE_URL: 'postgres://havefolio_runtime@localhost/havefolio_test',
      CLOUDINARY_CLOUD_NAME: 'synthetic',
      CLOUDINARY_API_KEY: 'key',
      CLOUDINARY_API_SECRET: 'secret',
    }).OCR_ENABLED,
    true,
  );
});
