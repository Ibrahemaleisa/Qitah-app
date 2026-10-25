/**
 * Renders the official Qitah symbol (src/brand/symbol.ts, extracted from Brand Guidelines v3.0)
 * to the PNG assets Expo needs. Uses the pre-installed Playwright Chromium:
 *   node scripts/generate-brand-assets.mjs
 *
 * App icon spec (guidelines p.16): Qitah Blue background, white car, orange piece, symbol at 72% of
 * the icon width, delivered as a 1024px square without corners (the OS applies the mask).
 */
import { mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// CommonJS require so a globally installed Playwright resolves too.
const { chromium } = createRequire(import.meta.url)('playwright');

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, 'assets/images');
mkdirSync(out, { recursive: true });

const source = readFileSync(resolve(root, 'src/brand/symbol.ts'), 'utf8');
const pick = (name) => source.match(new RegExp(`${name} =\\s*'([^']+)'`))[1];
const CAR = pick('CAR_PATH');
const PIECE = pick('PIECE_PATH');
const VB = { w: 395.61, h: 194.88 };

const BLUE = '#022B74';
const ORANGE = '#FE680E';
const WHITE = '#FFFFFF';

/** widthRatio: share of the canvas width taken by the symbol; the symbol is centred. */
function svg({ size, bg, widthRatio, car, piece }) {
  const w = size * widthRatio;
  const s = w / VB.w;
  const x = (size - w) / 2;
  const y = (size - VB.h * s) / 2;
  const rect = bg ? `<rect width="${size}" height="${size}" fill="${bg}"/>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${rect}<g transform="translate(${x} ${y}) scale(${s})"><path d="${CAR}" fill="${car}"/><path d="${PIECE}" fill="${piece}"/></g></svg>`;
}

const assets = [
  { file: 'icon.png', size: 1024, bg: BLUE, widthRatio: 0.72, car: WHITE, piece: ORANGE },
  { file: 'splash-icon.png', size: 600, bg: null, widthRatio: 0.96, car: BLUE, piece: ORANGE },
  // Adaptive icons: keep the symbol inside the 66% safe zone.
  { file: 'android-icon-foreground.png', size: 1024, bg: null, widthRatio: 0.56, car: WHITE, piece: ORANGE },
  { file: 'android-icon-monochrome.png', size: 1024, bg: null, widthRatio: 0.56, car: WHITE, piece: WHITE },
  { file: 'favicon.png', size: 96, bg: BLUE, widthRatio: 0.78, car: WHITE, piece: ORANGE },
];

const browser = await chromium.launch();
const page = await browser.newPage();
for (const a of assets) {
  await page.setViewportSize({ width: a.size, height: a.size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg(a)}</body></html>`);
  await page.locator('svg').screenshot({ path: resolve(out, a.file), omitBackground: true });
  console.log('wrote', a.file);
}
await browser.close();
