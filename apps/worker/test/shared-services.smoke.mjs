// Credentials arrive through protected stdin, never argv, environment output or logs.
import { readFileSync } from 'node:fs';
import { Queue, QueueEvents, Worker } from 'bullmq';

const { api, worker: workerCredentials, queueName, prefix } = JSON.parse(readFileSync(0, 'utf8'));
const connection = (credentials) => ({
  host: 'shared-redis',
  port: 6379,
  db: 0,
  username: credentials.username,
  password: credentials.password,
  maxRetriesPerRequest: null,
  connectTimeout: 5000,
});
const queue = new Queue(queueName, { connection: connection(api), prefix });
const events = new QueueEvents(queueName, { connection: connection(api), prefix });
const worker = new Worker(queueName, async () => 'verified', {
  connection: connection(workerCredentials),
  prefix,
});
let failed = false;
const classify = (error) => {
  const message = String(error?.message ?? '');
  return (
    [
      'NOPERM',
      'WRONGPASS',
      'NOAUTH',
      'EAI_AGAIN',
      'EAI_FAIL',
      'ECONNRESET',
      'ECONNREFUSED',
      'ENOTFOUND',
      'EACCES',
      'timeout',
      'module',
    ].find((hint) => message.includes(hint)) ??
    String(error?.code ?? error?.name).match(/^[A-Z_]+$/)?.[0] ??
    'unclassified'
  );
};
for (const instance of [queue, events, worker]) {
  instance.on('error', (error) => {
    failed = true;
    console.error(`Probe error category: ${classify(error)}`);
  });
}
const deadline = setTimeout(() => {
  console.error('FAIL: BullMQ smoke timed out; service details withheld.');
  process.exit(1);
}, 30000);
try {
  await Promise.all([queue.waitUntilReady(), events.waitUntilReady(), worker.waitUntilReady()]);
  const job = await queue.add('per3-isolation', {}, { removeOnComplete: true, removeOnFail: true });
  const result = await job.waitUntilFinished(events, 15000);
  if (result !== 'verified' || failed) throw new Error('Probe failed');
  console.log(
    'PASS: pinned BullMQ producer/worker completed a job using separate test ACL identities.',
  );
} catch (error) {
  console.error(`FAIL: BullMQ smoke failed (${classify(error)}); service details withheld.`);
  process.exitCode = 1;
} finally {
  await Promise.allSettled([worker.close(true), events.close(), queue.close()]);
  clearTimeout(deadline);
}
