import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { PublicFetcher, publicAddress, publicUrl, directTransport } from '../dist/index.js';
const address = { address: '93.184.216.34', family: 4 };
const html = { status: 200, mime: 'text/html', bytes: Buffer.from('safe') };
const signal = () => AbortSignal.timeout(1000);
test('rejects unsafe URL syntax and every special address family including mapped private forms', () => {
  for (const value of [
    'file:///etc/passwd',
    'data:text/html,hi',
    'ftp://example.org',
    'https://user:secret@example.org',
    'http://example.org:8080',
    'http://localhost',
    'http://127.1',
    'http://0x7f000001',
    'http://2130706433',
    'http://[::1]',
    'http://[::ffff:192.168.1.1]',
    'http://metadata.google.internal',
    'https://example.org\n',
  ])
    assert.throws(() => publicUrl(value), value);
  for (const ip of [
    '0.0.0.0',
    '10.1.2.3',
    '127.0.0.1',
    '169.254.169.254',
    '100.64.0.1',
    '172.16.0.1',
    '192.168.0.1',
    '192.0.0.9',
    '192.0.2.1',
    '198.18.1.2',
    '198.51.100.1',
    '203.0.113.1',
    '224.1.1.1',
    '240.1.1.1',
    '255.255.255.255',
    '::',
    '::1',
    'fe80::1',
    'fc00::1',
    '::ffff:8.8.8.8',
    '64:ff9b::a00:1',
    '2001:db8::1',
    '2002:0808:0808::1',
  ])
    assert.equal(publicAddress(ip), false, ip);
  assert.equal(publicAddress('8.8.8.8'), true);
  assert.equal(publicAddress('2606:4700:4700::1111'), true);
});
test('validates all DNS answers and never connects for a mixed public/private answer', async () => {
  let calls = 0;
  const fetcher = new PublicFetcher(
    async () => [address, { address: '127.0.0.1', family: 4 }],
    async () => {
      calls++;
      return html;
    },
  );
  await assert.rejects(fetcher.fetch('https://shop.example.org', ['text/html'], 100, signal()));
  assert.equal(calls, 0);
});
test('pins connection address; revalidates each redirect and never reconnects after private rebinding', async () => {
  const calls = [];
  let queries = 0;
  const fetcher = new PublicFetcher(
    async () => (++queries === 1 ? [address] : [{ address: '10.0.0.1', family: 4 }]),
    async (url, target) => {
      calls.push([url.href, target]);
      return { status: 302, location: '/second', bytes: Buffer.alloc(0), mime: '' };
    },
  );
  await assert.rejects(fetcher.fetch('https://shop.example.org', ['text/html'], 100, signal()));
  assert.deepEqual(calls, [['https://shop.example.org/', address]]);
});
test('rejects redirect loops, unsafe destinations, downgrade and empty DNS without transport escape', async () => {
  for (const location of [
    'http://127.0.0.1',
    'http://shop.example.org',
    'https://user:pw@shop.example.org',
    'file:///etc/passwd',
    '/loop',
  ]) {
    let calls = 0;
    const fetcher = new PublicFetcher(
      async () => [address],
      async () => {
        calls++;
        return { status: 302, location, bytes: Buffer.alloc(0), mime: '' };
      },
    );
    await assert.rejects(fetcher.fetch('https://shop.example.org', ['text/html'], 100, signal()));
    assert.ok(calls <= 4);
  }
  await assert.rejects(
    new PublicFetcher(
      async () => [],
      async () => html,
    ).fetch('https://shop.example.org', ['text/html'], 100, signal()),
  );
});
test('rejects oversize, MIME and status errors from even a controlled transport', async () => {
  for (const hop of [
    { ...html, bytes: Buffer.alloc(101) },
    { ...html, mime: 'application/pdf' },
    { ...html, status: 500 },
  ])
    await assert.rejects(
      new PublicFetcher(
        async () => [address],
        async () => hop,
      ).fetch('https://shop.example.org', ['text/html'], 100, signal()),
    );
});
test('cancellation during DNS prevents late connections and bounds outstanding resolver slots', async () => {
  let release,
    calls = 0;
  const resolver = () =>
    new Promise((r) => {
      release = r;
    });
  const abort = new AbortController();
  const fetcher = new PublicFetcher(resolver, async () => {
    calls++;
    return html;
  });
  const work = fetcher.fetch('https://shop.example.org', ['text/html'], 100, abort.signal);
  abort.abort();
  await assert.rejects(work);
  release([address]);
  await new Promise((r) => setImmediate(r));
  assert.equal(calls, 0);
});
test('direct socket transport sends only fixed headers and enforces compression, stream size and timeout', async () => {
  const seen = [];
  const server = createServer((req, res) => {
    seen.push(req.headers);
    res.setHeader('Content-Type', 'text/html');
    if (req.url === '/compressed') res.setHeader('Content-Encoding', 'gzip');
    if (req.url === '/slow') return;
    res.end(req.url === '/big' ? 'x'.repeat(100) : 'ok');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://shop.example.org:${server.address().port}`;
  try {
    const result = await directTransport(
      new URL(base),
      { address: '127.0.0.1', family: 4 },
      signal(),
      10,
      ['text/html'],
    );
    assert.equal(result.bytes.toString(), 'ok');
    for (const path of ['/compressed', '/big', '/slow'])
      await assert.rejects(
        directTransport(
          new URL(base + path),
          { address: '127.0.0.1', family: 4 },
          AbortSignal.timeout(50),
          10,
          ['text/html'],
        ),
      );
    assert.equal(seen[0].host, new URL(base).host);
    assert.equal(seen[0]['accept-encoding'], 'identity');
    assert.equal(seen[0].cookie, undefined);
    assert.equal(seen[0].authorization, undefined);
    assert.equal(seen[0].referer, undefined);
  } finally {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }
});

test('hung DNS work retains the two bounded slots after cancellation', async () => {
  const releases = [],
    controllers = [new AbortController(), new AbortController()];
  let connections = 0;
  const fetcher = new PublicFetcher(
    () => new Promise((resolve) => releases.push(resolve)),
    async () => {
      connections++;
      return html;
    },
  );
  const works = controllers.map((controller) =>
    fetcher.fetch('https://shop.example.org', ['text/html'], 100, controller.signal),
  );
  controllers.forEach((controller) => controller.abort());
  await Promise.all(works.map((work) => assert.rejects(work)));
  await assert.rejects(fetcher.fetch('https://shop.example.org', ['text/html'], 100, signal()));
  releases.forEach((resolve) => resolve([address]));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(connections, 0);
  assert.equal(
    (
      await new PublicFetcher(
        async () => [address],
        async () => html,
      ).fetch('https://shop.example.org', ['text/html'], 100, signal())
    ).bytes.toString(),
    'safe',
  );
});
