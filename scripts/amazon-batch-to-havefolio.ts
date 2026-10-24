import { chromium, type BrowserContext, type Page } from 'playwright';
import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';
import { parseArgs } from 'node:util';
import { downloadProduct, type DownloadedProduct } from './amazon-to-havefolio.js';
import { Havefolio, uploadImages } from './lib/amazon/havefolio.js';
import { planBatch, executeBatch, batchSummary, type BatchState } from './lib/amazon/batch.js';
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
export async function main(): Promise<void> {
  try {
    process.loadEnvFile(resolve('.env'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('Cannot read .env.');
  }
  const args = parseArgs({
    options: {
      apply: { type: 'boolean' },
      report: { type: 'string' },
      keep: { type: 'boolean' },
      help: { type: 'boolean' },
    },
  });
  if (args.values.help) {
    console.log(
      'Usage: npx tsx scripts/amazon-batch-to-havefolio.ts [--apply] [--report tmp/amazon-batch/report.json] [--keep]. Default: read-only preview.',
    );
    return;
  }
  const directory = resolve('tmp', 'amazon-batch');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const report = resolve(args.values.report ?? join(directory, 'report.json'));
  await mkdir(resolve(report, '..'), { recursive: true, mode: 0o700 });
  const api = await Havefolio.connect();
  let context: BrowserContext | undefined, page: Page | undefined, profileLock: string | undefined;
  const reportLock = report + '.lock';
  await mkdir(reportLock, { mode: 0o700 }).catch(() => {
    throw new Error('Batch report is already locked; inspect existing run before retrying.');
  });
  let state: BatchState | undefined;
  const save = async (): Promise<void> => {
    if (!state) return;
    state.updatedAt = new Date().toISOString();
    await writeFile(report + '.new', JSON.stringify(state, null, 2), { mode: 0o600 });
    await rename(report + '.new', report);
  };
  try {
    try {
      state = JSON.parse(await readFile(report, 'utf8')) as BatchState;
      if (state.version !== 1 || state.base !== api.base || !Array.isArray(state.entries))
        throw new Error('Batch report does not match API target.');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      console.log('Scanning private inventory and existing photo snapshots...');
      state = await planBatch(api, api.base);
      await save();
    }
    console.log(JSON.stringify(batchSummary(state)));
    console.log('Private report: ' + report);
    if (!args.values.apply) {
      console.log(
        'Preview only; no Amazon requests or Havefolio writes. Pass --apply to execute this plan.',
      );
      return;
    }
    const profile = process.env.HAVEFOLIO_SCRAPER_PROFILE
      ? resolve(process.env.HAVEFOLIO_SCRAPER_PROFILE)
      : join(homedir(), '.havefolio-scraper-profile');
    await mkdir(profile, { recursive: true, mode: 0o700 });
    const lock = join(profile, 'havefolio-import.lock');
    await mkdir(lock, { mode: 0o700 }).catch(() => {
      throw new Error('Another importer is using the Chrome profile.');
    });
    profileLock = lock;
    context = await chromium.launchPersistentContext(profile, {
      channel: 'chrome',
      headless: false,
      viewport: { width: 1440, height: 1000 },
      locale: 'en-IN',
    });
    page = context.pages()[0] ?? (await context.newPage());
    const cache = new Map<string, DownloadedProduct>();
    let lastUpload = 0;
    const pace = async (): Promise<void> => {
      const wait = 4500 - (Date.now() - lastUpload);
      if (wait > 0) await sleep(wait);
      lastUpload = Date.now();
    };
    await executeBatch(state, {
      api,
      save,
      progress: console.log,
      upload: async (entry) => {
        const product = entry.product;
        if (!product) throw new Error('Missing Amazon product source.');
        const productDir = join(directory, product.asin);
        await mkdir(productDir, { recursive: true, mode: 0o700 });
        let downloaded = cache.get(product.asin);
        if (!downloaded) {
          try {
            downloaded = await downloadProduct(context!, page!, product, productDir);
            cache.set(product.asin, downloaded);
          } catch (error) {
            const debug = join(productDir, 'debug');
            await mkdir(debug, { recursive: true, mode: 0o700 });
            await page!
              .screenshot({ path: join(debug, 'failure.png'), fullPage: true, timeout: 10000 })
              .catch(() => undefined);
            await writeFile(
              join(debug, 'page.html'),
              await page!.content().catch(() => '<html>Page unavailable</html>'),
              { mode: 0o600 },
            );
            throw error;
          }
        }
        await uploadImages(
          api,
          product,
          downloaded.title,
          downloaded.files,
          entry.id,
          undefined,
          pace,
        );
      },
      content: async (entry, photos) => {
        for (const photo of photos.photos) await api.verifyPhoto(entry.id, photo.id);
      },
    });
    // Verify protected pre-existing media and all completed records again against live API state.
    for (const entry of state.entries) {
      const current = await api.photos(entry.id);
      if (entry.originalPhotoIds.some((id) => !current.photos.some((p) => p.id === id)))
        throw new Error('Pre-existing photo verification failed.');
      if (
        entry.status === 'success' &&
        JSON.stringify(current.photos.map((p) => p.id)) !== JSON.stringify(entry.photoIds)
      )
        throw new Error('Final imported photo order differs from the checkpoint.');
    }
    await save();
    console.log('Final batch result: ' + JSON.stringify(batchSummary(state)));
    if (!args.values.keep)
      for (const asin of cache.keys())
        await rm(join(directory, asin), { recursive: true, force: true });
    if (state.entries.some((e) => e.status === 'failed')) process.exitCode = 1;
  } finally {
    await save();
    await context?.close().catch(() => undefined);
    if (profileLock) await rm(profileLock, { recursive: true, force: true });
    await rm(reportLock, { recursive: true, force: true });
    await api.close();
  }
}
if (process.argv[1] && /amazon-batch-to-havefolio\.(?:ts|js)$/.test(process.argv[1]))
  main().catch((error) => {
    console.error(error instanceof Error ? error.message.split('\n')[0] : 'Batch failed.');
    process.exitCode = 1;
  });
