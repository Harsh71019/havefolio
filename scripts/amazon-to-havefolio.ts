import { chromium, type BrowserContext, type Page } from 'playwright';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { parseArgs } from 'node:util';
import { createInterface } from 'node:readline/promises';
import {
  amazonProduct,
  imageCandidates,
  jpegImage,
  NetworkError,
  retry,
  type Product,
} from './lib/amazon/core.js';
import { Havefolio, uploadImages } from './lib/amazon/havefolio.js';

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const delay = (): Promise<void> => sleep(1000 + Math.random() * 2000);
async function manualWall(page: Page): Promise<void> {
  const body = (await page.locator('body').innerText({ timeout: 10000 })).slice(0, 30000);
  const wall =
    /\/ap\/signin|\/validateCaptcha/i.test(page.url()) ||
    /enter the characters|type the characters|robot check|verify you are human/i.test(body) ||
    (await page.locator('input#captchacharacters, form[name="signIn"]').count()) > 0;
  if (!wall) return;
  console.log(
    'Amazon CAPTCHA/sign-in wall detected. Clear it manually in the open Chrome window. No solving or bypass will be attempted.',
  );
  if (!process.stdin.isTTY)
    throw new Error(
      'Manual interaction required: rerun in an interactive terminal, clear the wall and press Enter.',
    );
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  try {
    await terminal.question('Press Enter after the product page is visible: ');
  } finally {
    terminal.close();
  }
}
async function ready(page: Page): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    await manualWall(page);
    try {
      await page.locator('span#productTitle').waitFor({ state: 'visible', timeout: 15000 });
      await page.locator('#landingImage').waitFor({ state: 'visible', timeout: 15000 });
      return;
    } catch {
      await manualWall(page);
      if (attempt === 2)
        throw new Error('Amazon product title/landing image unavailable after manual checks.');
    }
  }
}
async function download(context: BrowserContext, url: string): Promise<Buffer> {
  return retry(async () => {
    let response;
    try {
      response = await context.request.get(url, { timeout: 30000, maxRedirects: 0 });
    } catch {
      throw new NetworkError('Amazon image request failed.');
    }
    try {
      if ([408, 429, 500, 502, 503, 504].includes(response.status()))
        throw new NetworkError(`Amazon image HTTP ${response.status()}.`);
      if (!response.ok()) throw new Error(`Amazon image HTTP ${response.status()}.`);
      if (Number(response.headers()['content-length'] ?? 0) > 20 * 1024 * 1024)
        throw new Error('Download exceeds 20 MiB.');
      return await jpegImage(await response.body(), response.headers()['content-type'] ?? '');
    } finally {
      await response.dispose();
    }
  });
}
export interface DownloadedProduct {
  title: string;
  asin: string;
  productUrl: string;
  imageUrls: string[];
  files: string[];
}
export async function downloadProduct(
  context: BrowserContext,
  page: Page,
  product: Product,
  directory: string,
  onStage: (step: string) => void = () => undefined,
): Promise<DownloadedProduct> {
  onStage('open Amazon');
  console.log(`Opening ${product.url}`);
  await delay();
  await retry(async () => {
    try {
      await page.goto(product.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    } catch {
      throw new NetworkError('Amazon navigation failed.');
    }
  });
  await ready(page);
  // Never silently scrape images from a redirected, different product.
  if (amazonProduct(page.url()).asin !== product.asin)
    throw new Error('Amazon redirected to a different ASIN.');
  onStage('extract');
  await delay();
  const title = (await page.locator('span#productTitle').innerText()).replace(/\s+/g, ' ').trim();
  if (!title) throw new Error('Empty product title.');
  const sources = await page.evaluate(() => ({
    scripts: Array.from(document.scripts)
      .map((s) => s.textContent ?? '')
      .filter((s) => s.includes('colorImages')),
    hires: document.querySelector('#landingImage')?.getAttribute('data-old-hires') ?? null,
    dynamic: document.querySelector('#landingImage')?.getAttribute('data-a-dynamic-image') ?? null,
    thumbnails: Array.from(document.querySelectorAll('#altImages li.imageThumbnail img'))
      .filter(
        (img) =>
          !img.closest('.videoThumbnail, .a-video, .videoBlock') &&
          !/video|360|spin|sprite|placeholder|grey|gray/i.test(
            (img.getAttribute('alt') ?? '') + ' ' + (img.parentElement?.className ?? ''),
          ),
      )
      .map((img) => img.getAttribute('src') ?? ''),
  }));
  const candidates = imageCandidates(sources);
  if (!candidates.length) throw new Error('No eligible Amazon product images found.');
  onStage('download');
  const files: string[] = [],
    urls: string[] = [];
  for (const candidate of candidates) {
    if (files.length === 3) break;
    await delay();
    try {
      const bytes = await download(context, candidate);
      const file = join(directory, `${product.asin}-${files.length + 1}.jpg`);
      await writeFile(file, bytes, { mode: 0o600 });
      files.push(file);
      urls.push(candidate);
    } catch (error) {
      console.warn(
        `Rejected image candidate: ${error instanceof Error ? error.message : 'validation failed'}`,
      );
    }
  }
  if (!files.length) throw new Error('No candidate passed image download/validation.');
  if (files.length < 3)
    console.warn(
      `Only ${files.length} valid product image(s) found; continuing with available images.`,
    );
  console.log(
    JSON.stringify(
      { title, asin: product.asin, productUrl: product.url, imageUrls: urls, files },
      null,
      2,
    ),
  );
  return { title, asin: product.asin, productUrl: product.url, imageUrls: urls, files };
}
export async function main(): Promise<void> {
  try {
    process.loadEnvFile(resolve('.env'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('Cannot read .env.');
  }
  const args = parseArgs({
    allowPositionals: true,
    options: {
      item: { type: 'string' },
      'dry-run': { type: 'boolean' },
      keep: { type: 'boolean' },
      help: { type: 'boolean' },
    },
  });
  if (args.values.help) {
    console.log(
      'Usage: npx tsx scripts/amazon-to-havefolio.ts <amazon-url> [--item <uuid>] [--dry-run] [--keep]',
    );
    return;
  }
  if (args.positionals.length !== 1)
    throw new Error('Supply exactly one Amazon product URL. Use --help for usage.');
  const product = amazonProduct(args.positionals[0]!);
  const directory = resolve('tmp', product.asin);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const profile = process.env.HAVEFOLIO_SCRAPER_PROFILE
    ? resolve(process.env.HAVEFOLIO_SCRAPER_PROFILE)
    : join(homedir(), '.havefolio-scraper-profile');
  await mkdir(profile, { recursive: true, mode: 0o700 });
  const lock = join(profile, 'havefolio-import.lock');
  let locked = false,
    context: BrowserContext | undefined,
    page: Page | undefined,
    api: Havefolio | undefined;
  let stage = 'startup';
  try {
    await mkdir(lock, { mode: 0o700 }).catch(() => {
      throw new Error(
        `Another import may be running. Inspect ${lock} before removing a stale lock.`,
      );
    });
    locked = true;
    if (!args.values['dry-run']) api = await Havefolio.connect();
    context = await chromium.launchPersistentContext(profile, {
      channel: 'chrome',
      headless: false,
      viewport: { width: 1440, height: 1000 },
      locale: 'en-IN',
    });
    page = context.pages()[0] ?? (await context.newPage());
    const downloaded = await downloadProduct(context, page, product, directory, (step) => {
      stage = step;
    });
    const { title, files } = downloaded;
    if (args.values['dry-run']) {
      console.log('Dry run complete. No Havefolio requests or writes were made; files retained.');
      return;
    }
    stage = 'upload';
    await uploadImages(api!, product, title, files, args.values.item);
    if (!args.values.keep) await rm(directory, { recursive: true, force: true });
  } catch (error) {
    const debug = join(directory, 'debug');
    await mkdir(debug, { recursive: true, mode: 0o700 });
    if (page) {
      await page
        .screenshot({ path: join(debug, 'failure.png'), fullPage: true, timeout: 10000 })
        .catch(() => undefined);
      await writeFile(
        join(debug, 'page.html'),
        await page.content().catch(() => '<html><body>Page unavailable</body></html>'),
        { mode: 0o600 },
      );
    }
    await writeFile(join(debug, 'failure.txt'), `Failed step: ${stage}\n`, { mode: 0o600 });
    console.error(`Failed during ${stage}. Private diagnostics: ${debug}`);
    // Do not print Playwright request errors: they can contain authorization headers.
    if (
      error instanceof Error &&
      !/apiRequestContext|extraHTTPHeaders|Cookie:|HAVEFOLIO_TOKEN=/i.test(error.message)
    )
      console.error(error.message);
    throw new Error(`Amazon image import failed during ${stage}.`);
  } finally {
    await api?.close().catch(() => undefined);
    await context?.close().catch(() => undefined);
    if (locked) await rm(lock, { recursive: true, force: true });
  }
}
if (process.argv[1] && /amazon-to-havefolio\.(?:ts|js)$/.test(process.argv[1])) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'Import failed.');
    process.exitCode = 1;
  });
}
