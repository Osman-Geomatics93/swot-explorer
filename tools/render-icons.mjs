/**
 * Render the logo SVGs (assets/logo) to the PNG icon sizes Chrome uses, with the Geist
 * font loaded so the lettering is exact. WXT picks up public/icon/<size>.png automatically.
 * Usage: node tools/render-icons.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const font = pathToFileURL(resolve('node_modules/@fontsource-variable/geist/files/geist-latin-wght-normal.woff2')).href;
const logo = (name) => readFileSync(resolve(`assets/logo/hrc-${name}.svg`), 'utf8');

// Each size uses the level of detail that stays legible at that size.
const targets = [
  { size: 16, svg: 'small', out: 'public/icon/16.png' },
  { size: 32, svg: 'small', out: 'public/icon/32.png' },
  { size: 48, svg: 'medium', out: 'public/icon/48.png' },
  { size: 128, svg: 'full', out: 'public/icon/128.png' },
  { size: 64, svg: 'small', out: 'public/logo-mark.png' }, // header mark, shown at 32 px (2x)
  { size: 512, svg: 'full', out: 'assets/logo/hrc-512.png' }, // store listing / documents
];

mkdirSync(resolve('public/icon'), { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage();
for (const t of targets) {
  await page.setViewportSize({ width: t.size, height: t.size });
  await page.setContent(`<!doctype html><style>
    @font-face { font-family: 'Geist Variable'; src: url('${font}') format('woff2'); font-weight: 100 900; }
    html, body { margin: 0; background: transparent; }
    svg { display: block; width: ${t.size}px; height: ${t.size}px; }
  </style>${logo(t.svg)}`);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: resolve(t.out), omitBackground: true });
  console.log(`${t.out} (${t.size}px, ${t.svg})`);
}
await browser.close();
