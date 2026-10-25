/**
 * Renders the Qitah mark to the PNG assets Expo needs (app icon, splash, Android adaptive
 * icon, favicon). Uses the pre-installed Playwright Chromium:  node scripts/generate-brand-assets.mjs
 * Geometry mirrors src/brand/Logo.tsx — keep them in sync.
 */
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

// CommonJS require so a globally installed Playwright resolves too.
const { chromium } = createRequire(import.meta.url)('playwright');

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, 'assets/images');
mkdirSync(out, { recursive: true });

const INK = '#121316';
const PAPER = '#FBF9F6';
const ORANGE = '#FF5A1F';

function arc(cx, cy, r, a0, a1) {
  const p = (d) => [cx + r * Math.cos((d * Math.PI) / 180), cy + r * Math.sin((d * Math.PI) / 180)];
  const [x1, y1] = p(a0);
  const [x2, y2] = p(a1);
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 0 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
}

function mark({ disc, cut }) {
  const holes = [0, 72, 144, 216, 288]
    .map((deg) => {
      const r = ((deg - 90) * Math.PI) / 180;
      return `<circle cx="${50 + Math.cos(r) * 22}" cy="${52 + Math.sin(r) * 22}" r="3.4" fill="${cut}"/>`;
    })
    .join('');
  return `<circle cx="50" cy="52" r="34" fill="${disc}"/><circle cx="50" cy="52" r="11" fill="${cut}"/><circle cx="50" cy="52" r="5" fill="${disc}"/>${holes}<path d="${arc(50, 52, 37, -78, 18)}" stroke="${ORANGE}" stroke-width="15" stroke-linecap="round" fill="none"/>`;
}

/**
 * scale: share of the canvas the 100-unit mark occupies. The mark is shifted so the
 * combined rotor + caliper silhouette (not just the rotor) is optically centred.
 */
function svg({ size, bg, scale, tone }) {
  const colors = tone === 'light' ? { disc: PAPER, cut: INK } : { disc: INK, cut: PAPER };
  const s = (size * scale) / 100;
  const offset = (size - 100 * s) / 2;
  const rect = bg ? `<rect width="${size}" height="${size}" fill="${bg}"/>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${rect}<g transform="translate(${offset - 5 * s} ${offset + 3 * s}) scale(${s})">${mark(colors)}</g></svg>`;
}

const assets = [
  { file: 'icon.png', size: 1024, bg: INK, scale: 0.74, tone: 'light' },
  { file: 'splash-icon.png', size: 512, bg: null, scale: 0.92, tone: 'light' },
  { file: 'android-icon-foreground.png', size: 1024, bg: null, scale: 0.5, tone: 'light' },
  { file: 'android-icon-monochrome.png', size: 1024, bg: null, scale: 0.5, tone: 'light' },
  { file: 'favicon.png', size: 96, bg: INK, scale: 0.8, tone: 'light' },
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
