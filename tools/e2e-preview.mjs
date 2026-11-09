/**
 * End-to-end check of search → preview → feature popup with real SWOT data.
 * Needs the Earthdata token in the Windows user environment variable EDL_TOKEN (never printed).
 * Usage: node tools/e2e-preview.mjs <outDir>
 */
import { execSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const out = resolve(process.argv[2] ?? 'tools/out/e2e');
mkdirSync(out, { recursive: true });
const token =
  process.env.EDL_TOKEN ??
  /EDL_TOKEN\s+REG_\w+\s+(\S+)/.exec(execSync('reg query HKCU\\Environment /v EDL_TOKEN', { encoding: 'utf8' }))?.[1];
if (!token) throw new Error('EDL_TOKEN not set');

const ext = resolve('dist/chrome-mv3');
const ctx = await chromium.launchPersistentContext('', {
  channel: 'chromium',
  headless: true,
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
});
let [sw] = ctx.serviceWorkers();
sw ??= await ctx.waitForEvent('serviceworker');
const id = new URL(sw.url()).host;

const area = {
  id: 'gerd-drawn',
  name: 'GERD drawn polygon',
  source: 'polygon',
  bufferKm: 0,
  geometry: { type: 'Polygon', coordinates: [[[35.0, 10.7], [35.45, 10.75], [35.3, 11.25], [35.05, 11.2], [35.0, 10.7]]] },
};
await sw.evaluate(
  ([a, t]) => chrome.storage.local.set({ edlToken: t, studyAreas: JSON.stringify({ state: { areas: [a], activeId: a.id }, version: 0 }) }),
  [area, token],
);

const page = await ctx.newPage();
const failures = [];
// Tile requests cancelled by zooming are normal; report everything else.
page.on('requestfailed', (r) => r.failure()?.errorText !== 'net::ERR_ABORTED' && failures.push(`${r.failure()?.errorText} ${new URL(r.url()).host}`));
page.on('pageerror', (e) => {
  failures.push(`page error: ${e.message}`);
  console.log('PAGE ERROR:', e.message);
});
await page.setViewportSize({ width: 1440, height: 900 });
await page.goto(`chrome-extension://${id}/app.html`);
await page.getByRole('tabpanel').getByRole('button', { name: 'Search', exact: true }).click();
await page.getByText('Preview on the map').waitFor({ timeout: 90_000 });
console.log('search ok:', await page.getByRole('heading', { name: /granules/ }).innerText());

const t0 = Date.now();
await page.getByRole('button', { name: /Show on map/ }).click();
await page.getByText(/pass QC|none inside your area/).first().waitFor({ timeout: 180_000 });
console.log(`preview loaded in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
const legend = page.locator('div.space-y-5', { has: page.getByRole('radiogroup', { name: 'Colour by' }) }).last();
console.log('legend:', (await legend.innerText()).replace(/\n/g, ' | '));
await page.waitForTimeout(2500);
await page.getByRole('heading', { name: 'Preview on the map' }).scrollIntoViewIfNeeded();
await page.screenshot({ path: `${out}/preview.png` });
await legend.scrollIntoViewIfNeeded();
await page.screenshot({ path: `${out}/legend-level.png` });
await page.getByRole('radio', { name: 'Quality flag' }).click();
await page.waitForTimeout(1500);
console.log('legend (quality):', (await legend.innerText()).replace(/\n/g, ' | '));
await page.screenshot({ path: `${out}/legend-quality.png` });
await page.getByRole('radio', { name: 'Water level' }).click();

// Reorder the SWOT layers from the preview list itself; the map's Layers menu must agree.
const previewList = page.locator('fieldset', { hasText: 'top is drawn on top' }).locator('li');
const previewOrder = async () => (await previewList.allInnerTexts()).map((t) => t.split('\n')[0].trim()).join(' > ');
console.log('preview list before:', await previewOrder());
await page.getByRole('button', { name: 'Move Lakes up' }).click();
await page.getByRole('button', { name: 'Move Lakes up' }).click();
await page.waitForTimeout(600);
console.log('preview list after Lakes up twice:', await previewOrder());
await page.getByRole('heading', { name: 'Preview on the map' }).scrollIntoViewIfNeeded();
await page.screenshot({ path: `${out}/preview-reordered.png` });
await page.getByRole('button', { name: /^Layers/ }).click();
console.log('map Layers menu:', (await page.locator('ol li').allInnerTexts()).slice(0, 4).map((t) => t.trim()).join(' > '));
await page.keyboard.press('Escape');
await page.getByRole('button', { name: 'Move Lakes down' }).click();
await page.getByRole('button', { name: 'Move Lakes down' }).click();

// Click around the map centre until a feature popup opens.
const box = await page.locator('.maplibregl-canvas').boundingBox();
let opened = false;
for (let r = 0; r <= 220 && !opened; r += 20)
  for (let a = 0; a < 360 && !opened; a += r ? 30 : 360) {
    await page.mouse.click(box.x + box.width / 2 + r * Math.cos((a * Math.PI) / 180), box.y + box.height / 2 + r * Math.sin((a * Math.PI) / 180));
    opened = (await page.locator('.swot-popup').count()) > 0;
  }
console.log('popup opened:', opened, opened ? `| ${(await page.locator('.swot-popup').innerText()).replace(/\n/g, ' | ')}` : '');
await page.screenshot({ path: `${out}/popup.png` });

// Clicking a lake opens its full SWOT time series from Hydrocron.
if (opened) {
  await page.getByRole('region', { name: /Time series for/ }).waitFor({ timeout: 60_000 });
  try {
    await page.getByText(/pass QC · \d+ total/).waitFor({ timeout: 30_000 });
  } catch (err) {
    console.log('panel says:', (await page.getByRole('region', { name: /Time series for/ }).innerText()).replaceAll('\n', ' | '));
    await page.screenshot({ path: `${out}/timeseries-failed.png` });
    throw err;
  }
  await page.waitForTimeout(1200);
  const stats = await page.getByRole('region', { name: /Time series for/ }).locator('dl').innerText();
  console.log('time series:', stats.replaceAll('\n', ' | '));
  await page.getByRole('tab', { name: 'Area' }).click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${out}/timeseries.png` });
}
// Layer order: close the time series and popup, then move Lakes above River reaches and hide them.
await page.keyboard.press('Escape');
await page.getByRole('button', { name: 'Close time series' }).click().catch(() => undefined);
await page.locator('.maplibregl-popup-close-button').click().catch(() => undefined);
await page.getByRole('button', { name: /^Layers/ }).click();
const order = async () => (await page.locator('ol li').allInnerTexts()).map((t) => t.trim()).join(' > ');
console.log('layer order before:', await order());
await page.screenshot({ path: `${out}/layers-before.png` });
await page.locator('ol li', { hasText: 'Lakes' }).getByRole('button', { name: 'Move up' }).click();
await page.waitForTimeout(600);
console.log('layer order after moving Lakes up:', await order());
await page.screenshot({ path: `${out}/layers-after.png` });
await page.locator('ol li', { hasText: 'Lakes' }).getByRole('button', { name: /Hide Lakes/ }).click();
await page.waitForTimeout(600);
await page.screenshot({ path: `${out}/layers-hidden.png` });
await page.getByRole('button', { name: 'Reset order and visibility' }).click();

console.log('network/page failures:', failures.length ? failures : 'none');
await ctx.close();
