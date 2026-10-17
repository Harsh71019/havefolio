import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { boundedTransport } from '../dist/index.js';

test('final envelope removes financial and private metadata; rejects other SDK payload types', async () => {
  const bodies = [];
  const receiver = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      bodies.push(body);
      res.end('{}');
    });
  });
  await new Promise((resolve) => receiver.listen(0, '127.0.0.1', resolve));
  const secret = randomBytes(20).toString('hex');
  const transport = boundedTransport({
    url: `http://127.0.0.1:${receiver.address().port}/`,
    recordDroppedEvent: () => {},
  });
  try {
    await transport.send([
      { trace: { transaction: secret, amountMinor: 987654321 }, dsn: secret },
      [
        [
          { type: 'event' },
          {
            event_id: 'a'.repeat(32),
            exception: { values: [{ type: 'Error', value: secret }] },
            extra: { AMOUNT_MINOR: 987654321 },
            tags: { code: 'REQUEST_FAILED' },
          },
        ],
      ],
    ]);
    await transport.send([{}, [[{ type: 'session' }, { user: secret }]]]);
    await transport.send([{}, [[{ type: 'attachment' }, new Uint8Array([1, 2, 3])]]]);
    await transport.flush(1000);
    assert.equal(bodies.length, 1);
    assert.ok(!bodies[0].includes(secret));
    assert.ok(!bodies[0].includes('987654321'));
    assert.ok(!bodies[0].includes('trace'));
    assert.ok(!bodies[0].includes('dsn'));
  } finally {
    await new Promise((resolve) => receiver.close(resolve));
  }
});

test('a collector that never answers is bounded and cannot hold application work', async () => {
  const receiver = createServer(() => {});
  await new Promise((resolve) => receiver.listen(0, '127.0.0.1', resolve));
  const transport = boundedTransport({
    url: `http://127.0.0.1:${receiver.address().port}/`,
    recordDroppedEvent: () => {},
  });
  const started = performance.now();
  const pending = transport.send([
    {},
    [[{ type: 'event' }, { exception: { values: [{ type: 'Error', value: 'private' }] } }]],
  ]);
  assert.ok(performance.now() - started < 100);
  try {
    await pending;
    assert.ok(performance.now() - started < 1600);
  } finally {
    receiver.closeAllConnections();
    await new Promise((resolve) => receiver.close(resolve));
  }
});

test('error floods are capped independently while sampled traces and application work continue', async () => {
  const received = { event: 0, transaction: 0 };
  const dropped = [];
  const receiver = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      const item = JSON.parse(body.split('\n')[1]);
      received[item.type]++;
      res.end('{}');
    });
  });
  await new Promise((resolve) => receiver.listen(0, '127.0.0.1', resolve));
  const transport = boundedTransport({
    url: `http://127.0.0.1:${receiver.address().port}/`,
    recordDroppedEvent: (...args) => dropped.push(args),
  });
  try {
    for (let i = 0; i < 30; i++) {
      await transport.send([
        {},
        [[{ type: 'event' }, { exception: { values: [{ type: 'Error', value: 'private' }] } }]],
      ]);
    }
    await transport.send([
      {},
      [[{ type: 'transaction' }, { type: 'transaction', transaction: '/store' }]],
    ]);
    await transport.flush(1000);
    assert.equal(received.event, 20);
    assert.equal(received.transaction, 1);
    assert.equal(dropped.filter(([reason]) => reason === 'ratelimit_backoff').length, 10);
  } finally {
    await new Promise((resolve) => receiver.close(resolve));
  }
});
