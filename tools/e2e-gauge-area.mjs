/**
 * End-to-end gauge validation inside a study area: seed a study area, paste gauge readings,
 * load SWOT LakeSP_Obs inside the area (downloads once, then cached), and compare the
 * statistics with the whole-lake (Hydrocron) series.
 * Usage: node tools/e2e-gauge-area.mjs <clipboard.tsv> <minLon,minLat,maxLon,maxLat> [reservoir name] [outDir] [profileDir]
 * A profileDir keeps the downloaded observations between runs.
 */
import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const [file, bboxArg, name = 'Roseires Dam', outArg, profile = ''] = process.argv.slice(2);
if (!file || !bboxArg) throw new Error('Usage: node tools/e2e-gauge-area.mjs <clipboard.tsv> <minLon,minLat,maxLon,maxLat> [reservoir name] [outDir] [profileDir]');
const [x0, y0, x1, y1] = bboxArg.split(',').map(Number);
const clip = readFileSync(file, 'utf8');
const out = resolve(outArg ?? 'tools/out/e2e-gauge-area');
mkdirSync(out, { recursive: true });
const token =
  process.env.EDL_TOKEN ?? /EDL_TOKEN\s+REG_\w+\s+(\S+)/.exec(execSync('reg query HKCU\\Environment /v EDL_TOKEN', { encoding: 'utf8' }))?.[1];
const ext = resolve('dist/chrome-mv3');
const ctx = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true, args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`] });
let [sw] = ctx.serviceWorkers();
sw ??= await ctx.waitForEvent('serviceworker');
const area = {
  id: 'near-dam',
  name: 'Near the dam',
  source: 'rectangle',
  bufferKm: 0,
  geometry: { type: 'Polygon', coordinates: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]] },
};
await sw.evaluate(([a, t]) => chrome.storage.local.set({ edlToken: t, studyAreas: JSON.stringify({ state: { areas: [a], activeId: a.id }, version: 0 }) }), [area, token]);
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message));
await page.setViewportSize({ width: 1440, height: 1000 });
await page.goto(`chrome-extension://${new URL(sw.url()).host}/app.html`);

await page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: 'Reservoirs' }).click();
await page.getByRole('button', { name: new RegExp(name) }).click();
await page.getByRole('tab', { name: 'Gauge validation' }).click();

// Gauge readings: paste them unless this profile already has them saved.
if (await page.getByRole('button', { name: 'Paste from Excel' }).isVisible().catch(() => false)) {
  await page.getByRole('button', { name: 'Paste from Excel' }).click();
  const grid = page.getByRole('grid', { name: 'Gauge readings' });
  await grid.getByRole('gridcell').first().click();
  await grid.evaluate((el, text) => {
    const data = new DataTransfer();
    data.setData('text/plain', text);
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, clip);
  if (await page.getByRole('button', { name: 'Use these columns' }).isVisible().catch(() => false)) await page.getByRole('button', { name: 'Use these columns' }).click();
  await page.getByRole('button', { name: /^Save [\d,]+ readings for/ }).click();
}

const stats = page.locator('dl').last();
const started = Date.now();
await page.getByRole('radio', { name: 'Inside my study area' }).click();
await page.getByRole('button', { name: /Load SWOT in this area|Load again/ }).click();
const progress = setInterval(async () => {
  const p = await page.getByRole('progressbar').getAttribute('aria-valuenow').catch(() => null);
  if (p) console.log(`  … ${p} passes done (${Math.round((Date.now() - started) / 1000)} s)`);
}, 60_000);
await page.getByRole('status').filter({ hasText: /passes with water inside/ }).waitFor({ timeout: 45 * 60_000 });
clearInterval(progress);
console.log(`LOADED in ${Math.round((Date.now() - started) / 1000)} s`);
console.log('AREA:', await page.getByRole('status').filter({ hasText: /passes with water inside/ }).innerText());
await stats.waitFor({ timeout: 30_000 });
await page.waitForTimeout(800);
console.log('STATS inside area:', (await stats.innerText()).split('\n').join(' | '));
await page.screenshot({ path: `${out}/1-inside-area.png`, fullPage: true });

await page.getByRole('radio', { name: 'Whole lake' }).click();
await page.waitForTimeout(4000);
console.log('STATS whole lake:', (await stats.innerText()).split('\n').join(' | '));
await ctx.close();
