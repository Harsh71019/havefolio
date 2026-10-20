/**
 * PER-45 synthetic OCR evaluation set. Every store, item, amount and date is invented; no
 * real receipt, person, address or identifier is used. Rendering depends on host fonts, so
 * the generated WebP files are committed and this script is only rerun deliberately:
 *   node apps/worker/test/fixtures/ocr/generate.mjs
 * Output matches stored originals: sanitized WebP, quality 85, at most 4096 on either axis.
 */
import sharp from 'sharp';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const escape = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function receipt(
  name,
  lines,
  { font = 'Menlo', size = 26, width = 900, degrade = false } = {},
) {
  const lh = Math.round(size * 1.7);
  const height = lines.length * lh + 100;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#fbfaf6"/>${lines
    .map(
      (l, i) =>
        `<text x="40" y="${70 + i * lh}" font-family="${font}" font-size="${size}" fill="#1b1b1b" xml:space="preserve">${escape(l)}</text>`,
    )
    .join('')}</svg>`;
  let image = sharp(Buffer.from(svg));
  if (degrade) {
    // A phone photo of paper: slight rotation, blur, uneven grey background and noise.
    const paper = await image.png().toBuffer();
    const W = width + 700,
      H = height + 600;
    const noise = await sharp({
      create: {
        width: W,
        height: H,
        channels: 3,
        noise: { type: 'gaussian', mean: 120, sigma: 22 },
      },
    })
      .png()
      .toBuffer();
    image = sharp({ create: { width: W, height: H, channels: 3, background: '#77736b' } })
      .composite([
        {
          input: await sharp(paper).rotate(2.5, { background: '#77736b' }).blur(0.9).toBuffer(),
          left: 300,
          top: 260,
        },
        { input: noise, blend: 'soft-light' },
      ])
      .png();
    image = sharp(await image.toBuffer()).linear(0.8, 20);
  }
  await image.webp({ quality: 85 }).toFile(join(here, `${name}.webp`));
}

async function label(name, parts, { background = '#e9eef2' } = {}) {
  const W = 1600,
    H = 1200;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="100%" height="100%" fill="${background}"/>${parts
    .map(
      (p) =>
        `<text x="${p.x}" y="${p.y}" font-family="${p.font ?? 'Helvetica'}" font-weight="${p.weight ?? 400}" font-size="${p.size}" fill="#202428">${escape(p.text)}</text>`,
    )
    .join('')}</svg>`;
  await sharp(Buffer.from(svg))
    .webp({ quality: 85 })
    .toFile(join(here, `${name}.webp`));
}

await receipt('receipt-multi-clean', [
  'GREEN LEAF HOME STORE',
  'Synthetic Road, Testville',
  'Date: 14/08/2026  Time 18:42',
  'Item                    Qty   Amount',
  'Steel Water Bottle 1L    1   Rs 899.00',
  'Cotton Bath Towel        2   Rs 1,198.00',
  'Bamboo Cutting Board     1   Rs 649.00',
  'Subtotal                     Rs 2,746.00',
  'GST 5%                       Rs 137.30',
  'TOTAL                        Rs 2,883.30',
  'Paid by UPI',
]);
await receipt('receipt-single-total', [
  'POTTERS LANE CRAFTS',
  'Invoice date 2026-09-03',
  'Ceramic Teapot           1,450.00',
  'Delivery                    60.00',
  'Grand Total         INR 1,510.00',
]);
await receipt('receipt-ambiguous-date', [
  'CORNER LAMP HOUSE',
  'Date 03/04/2026',
  'Brass Desk Lamp       Rs 2,350.00',
  'Lamp Shade Linen      Rs 780.00',
  'Total                 Rs 3,130.00',
]);
await receipt('receipt-textual-date', [
  'NORTHWIND BOOKS',
  '12 Sep 2026',
  'Hardcover Atlas       Rs 1,299.00',
  'Total                 Rs 1,299.00',
]);
await receipt('receipt-month-only', [
  'STATEMENT FOR AUG 2026',
  'Wool Throw Blanket    Rs 3,400.00',
  'Amount Payable        Rs 3,400.00',
]);
await receipt('receipt-dollar', [
  'HARBOR GOODS',
  'Canvas Tote      $24.50',
  'Water Flask      $18.00',
  'Total            $42.50',
]);
await receipt(
  'receipt-long',
  [
    'MARKET SQUARE HOMEWARE',
    'Bill Date 21/07/2026',
    'Item              Qty   Amount',
    'Glass Tumbler      1   Rs 120.00',
    'Steel Spoon Set    1   Rs 240.00',
    'Cotton Napkins     1   Rs 310.00',
    'Clay Planter       1   Rs 450.00',
    'Jute Doormat       1   Rs 520.00',
    'Wooden Tray        1   Rs 640.00',
    'Copper Bottle      1   Rs 780.00',
    'Total                  Rs 3,060.00',
  ],
  { size: 22 },
);
await receipt(
  'receipt-noisy',
  [
    'GREEN LEAF HOME STORE',
    'Date: 14/08/2026',
    'Steel Water Bottle 1L   Rs 899.00',
    'Cotton Bath Towel       Rs 1,198.00',
    'TOTAL                   Rs 2,097.00',
  ],
  { size: 30, degrade: true },
);
await receipt('receipt-indian-grouping', [
  'COOLHOME APPLIANCES',
  'Bill Date 05/06/2026',
  'Double Door Refrigerator',
  'Refrigerator 340L   Rs 1,19,800.00',
  'Net Payable         Rs 1,19,800.00',
]);
await receipt('receipt-no-items', [
  'CARD SLIP',
  '2026-08-30 11:02',
  'SALE',
  'Amount Paid  Rs 4,500.00',
  'APPROVED',
]);
await receipt(
  'receipt-proportional-font',
  [
    'BLUE DOOR STUDIO',
    'Date: 19/09/2026',
    'Linen Cushion Cover   Rs 1,150.00',
    'Total   Rs 1,150.00',
  ],
  { font: 'Helvetica', size: 28 },
);
// Held-out set: added after the first evaluation run and never used to tune the interpreter.
await receipt(
  'heldout-courier-multiply',
  [
    'RIVERSIDE KITCHEN SUPPLY',
    'Sept 3, 2026',
    'Enamel Mug 2 x 225.00   450.00',
    'Tea Strainer            180.00',
    'Discount                -50.00',
    'Total Rs                580.00',
  ],
  { font: 'Courier', size: 26 },
);
await receipt(
  'heldout-noisy-single',
  [
    'SUNRISE ELECTRONICS',
    'Invoice Date: 28-08-2026',
    'Table Fan 400mm   Rs 2,799.00',
    'GST incl.',
    'Amount Paid  Rs 2,799.00',
  ],
  { size: 30, degrade: true },
);
await receipt(
  'heldout-euro',
  ['CAFE MOBILIARIO', '2026-07-15', 'Oak Side Table   EUR 189.00', 'Total   EUR 189.00'],
  {
    font: 'Helvetica',
    size: 26,
  },
);
await label('heldout-photo-plain', [
  { text: 'Model: KX-90 Pro', x: 240, y: 520, size: 64 },
  { text: 'Made in Testland', x: 240, y: 640, size: 48 },
]);
await label('photo-label-model', [
  { text: 'AURORA', x: 200, y: 360, size: 180, weight: 700 },
  { text: 'Model No: AX-200', x: 210, y: 560, size: 56 },
  { text: 'Brand: Aurora Home', x: 210, y: 660, size: 56 },
  { text: 'S/N 7700112233', x: 210, y: 760, size: 44 },
]);
await label('photo-no-text', []);
console.log('generated');
