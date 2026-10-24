import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Havefolio, uploadImages } from './havefolio.js';
import { amazonProduct } from './core.js';
const itemId = '12345678-1234-4234-8234-123456789012';
void test('API upload replays lost response safely, preserves existing cover and skips reruns', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'havefolio-amazon-test-'));
  const file = join(dir, 'image.jpg');
  await writeFile(file, Buffer.alloc(6000));
  const priorEnv = { ...process.env };
  const oldPhoto = '12345678-1234-4234-8234-123456789010';
  const newPhoto = '12345678-1234-4234-8234-123456789011';
  let photos = [oldPhoto],
    revision = 1,
    posts = 0,
    lost = false;
  const uploadIds: string[] = [];
  let specifications: Record<string, unknown> = {
    'User detail': 'preserved',
    'Amazon ASIN': 'B07V78GMXS',
  };
  const server = createServer((req, res) => {
    void (async () => {
      assert.equal(req.headers.cookie, 'havefolio_session=' + 'a'.repeat(43));
      assert.equal(req.headers.authorization, undefined);
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(Buffer.from(c as Uint8Array));
      const bytes = Buffer.concat(chunks);
      res.setHeader('Content-Type', 'application/json');
      const path = req.url?.split('?')[0];
      if (path === `/api/v1/items/${itemId}`) {
        if (req.method === 'PATCH') {
          const payload = JSON.parse(bytes.toString()) as {
            revision: number;
            specifications: Record<string, unknown>;
          };
          assert.equal(payload.revision, revision);
          specifications = payload.specifications;
          revision++;
        }
        res.end(
          JSON.stringify({
            id: itemId,
            revision,
            name: 'My original title',
            purchaseUrl: 'https://www.amazon.in/dp/B07V78GMXS',
            specifications,
          }),
        );
        return;
      }
      if (path === `/api/v1/items/${itemId}/photos` && req.method === 'POST') {
        posts++;
        uploadIds.push(String(req.headers['upload-id']));
        assert.match(bytes.toString(), /name="photos"/);
        assert.match(bytes.toString(), /content-type: image\/jpeg/i);
        if (!lost) {
          photos = [...photos, newPhoto];
          revision++;
          lost = true;
          req.socket.destroy();
          return;
        }
        res.statusCode = 201;
        res.end(JSON.stringify({ results: [{ index: 0, photo: { id: newPhoto } }] }));
        return;
      }
      if (path === `/api/v1/items/${itemId}/photos`) {
        res.end(JSON.stringify({ revision, photos: photos.map((id) => ({ id })) }));
        return;
      }
      res.statusCode = 404;
      res.end('{}');
    })().catch(() => {
      res.statusCode = 500;
      res.end('{}');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert(address && typeof address === 'object');
  process.env.HAVEFOLIO_API_URL = `http://127.0.0.1:${address.port}/api/v1`;
  process.env.HAVEFOLIO_TOKEN = 'a'.repeat(43);
  delete process.env.HAVEFOLIO_COOKIE_NAME;
  let api: Havefolio | undefined;
  try {
    api = await Havefolio.connect();
    const product = amazonProduct('https://www.amazon.in/dp/B07V78GMXS');
    assert.equal(
      await uploadImages(api, product, 'Amazon product title', [file], itemId, join(dir, 'state')),
      itemId,
    );
    assert.equal(posts, 2);
    assert.equal(uploadIds[0], uploadIds[1]);
    assert.deepEqual(photos, [oldPhoto, newPhoto]);
    assert.equal(specifications['User detail'], 'preserved');
    assert.equal(specifications['Amazon title'], 'Amazon product title');
    await uploadImages(api, product, 'Amazon product title', [file], itemId, join(dir, 'state'));
    assert.equal(posts, 2);
    await writeFile(file, Buffer.alloc(6001));
    await assert.rejects(
      uploadImages(api, product, 'Amazon product title', [file], itemId, join(dir, 'state')),
      /Images changed/,
    );
    assert.equal(posts, 2);
  } finally {
    await api?.close();
    await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
    process.env = priorEnv;
    await rm(dir, { recursive: true, force: true });
  }
});

void test('automatic creation uses persistent commandId for ambiguous response and unknown price/date', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'havefolio-amazon-create-'));
  const file = join(dir, 'image.jpg');
  await writeFile(file, Buffer.alloc(6000));
  const priorEnv = { ...process.env };
  let created: Record<string, unknown> | undefined,
    command: string | undefined,
    createPosts = 0;
  const photos: string[] = [];
  let revision = 1;
  const server = createServer((req, res) => {
    void (async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk as Uint8Array));
      const body = Buffer.concat(chunks);
      const path = req.url?.split('?')[0];
      res.setHeader('Content-Type', 'application/json');
      if (path === '/api/v1/items' && req.method === 'GET') {
        res.end(JSON.stringify({ items: [], hasMore: false, nextCursor: null }));
        return;
      }
      if (path === '/api/v1/items' && req.method === 'POST') {
        createPosts++;
        const payload = JSON.parse(body.toString()) as Record<string, unknown>;
        assert.equal(payload.pricePaidMinor, null);
        assert.deepEqual(payload.purchaseDate, { precision: 'unknown' });
        assert.equal(payload.currency, 'INR');
        assert.equal(payload.acquisitionType, 'unknown');
        if (!created) {
          command = String(payload.commandId);
          created = { ...payload, id: itemId, revision };
          req.socket.destroy();
          return;
        }
        assert.equal(payload.commandId, command);
        res.statusCode = 201;
        res.end(JSON.stringify(created));
        return;
      }
      if (path === `/api/v1/items/${itemId}`) {
        res.end(JSON.stringify({ ...created, revision }));
        return;
      }
      if (path === `/api/v1/items/${itemId}/photos`) {
        if (req.method === 'POST') {
          photos.push('12345678-1234-4234-8234-123456789011');
          revision++;
          res.statusCode = 201;
          res.end(JSON.stringify({ results: [{ photo: { id: photos[0] } }] }));
          return;
        }
        res.end(JSON.stringify({ revision, photos: photos.map((id) => ({ id })) }));
        return;
      }
      res.statusCode = 404;
      res.end('{}');
    })().catch(() => {
      res.statusCode = 500;
      res.end('{}');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert(address && typeof address === 'object');
  process.env.HAVEFOLIO_API_URL = `http://127.0.0.1:${address.port}/api/v1`;
  process.env.HAVEFOLIO_TOKEN = 'a'.repeat(43);
  delete process.env.HAVEFOLIO_COOKIE_NAME;
  delete process.env.HAVEFOLIO_CURRENCY;
  let api: Havefolio | undefined;
  try {
    api = await Havefolio.connect();
    const product = amazonProduct('https://www.amazon.in/dp/B07V78GMXS');
    await uploadImages(api, product, 'Source title', [file], undefined, join(dir, 'state'));
    assert.equal(createPosts, 2);
    await uploadImages(api, product, 'Source title', [file], undefined, join(dir, 'state'));
    assert.equal(createPosts, 2);
    await uploadImages(api, product, 'Source title', [file], itemId, join(dir, 'state'));
    assert.equal(createPosts, 2);
    assert.equal(photos.length, 1);
  } finally {
    await api?.close();
    await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
    process.env = priorEnv;
    await rm(dir, { recursive: true, force: true });
  }
});
