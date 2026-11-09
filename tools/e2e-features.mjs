/**
 * End-to-end check of cascade comparison, storage change, DAHITI comparison (no key) and
 * new-pass alerts, with real SWOT data. Needs EDL_TOKEN in the Windows user environment.
 * Usage: node tools/e2e-features.mjs <outDir>
 */
import { execSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const out = resolve(process.argv[2] ?? 'tools/out/e2e-features');
mkdirSync(out, { recursive: true });
const token =
  process.env.EDL_TOKEN ?? /EDL_TOKEN\s+REG_\w+\s+(\S+)/.exec(execSync('reg query HKCU\\Environment /v EDL_TOKEN', { encoding: 'utf8' }))?.[1];
const ext = resolve('dist/chrome-mv3');
const ctx = await chromium.launchPersistentContext('', { channel: 'chromium', headless: true, args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`] });
let [sw] = ctx.serviceWorkers();
sw ??= await ctx.waitForEvent('serviceworker');
const id = new URL(sw.url()).host;
const area = {
  id: 'gerd-drawn', name: 'GERD drawn polygon', source: 'polygon', bufferKm: 0,
  geometry: { type: 'Polygon', coordinates: [[[35.0, 10.7], [35.45, 10.75], [35.3, 11.25], [35.05, 11.2], [35.0, 10.7]]] },
};
await sw.evaluate(([a, t]) => chrome.storage.local.set({ edlToken: t, studyAreas: JSON.stringify({ state: { areas: [a], activeId: a.id }, version: 0 }) }), [area, token]);

const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message));
await page.setViewportSize({ width: 1440, height: 1000 });
await page.goto(`chrome-extension://${id}/app.html`);
const text = async (loc) => (await loc.innerText()).replaceAll('\n', ' | ');

// 4. Cascade comparison
await page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: 'Compare' }).click();
const cascade = page.locator('section', { has: page.getByRole('heading', { name: 'Cascade' }) });
await cascade.getByText(/Consistent|Questionable|Unreliable/).first().waitFor({ timeout: 60_000 });
await page.waitForTimeout(3000);
console.log('CASCADE table:', await text(cascade.locator('tbody')));
await cascade.scrollIntoViewIfNeeded();
await page.screenshot({ path: `${out}/cascade.png` });

// 2. Storage change and 1. DAHITI (no key) on the GERD lake
await page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: 'Search' }).click();
await page.getByRole('tabpanel').getByRole('button', { name: 'Search', exact: true }).click();
await page.getByText('Preview on the map').waitFor({ timeout: 90_000 });
await page.getByRole('button', { name: /Show on map/ }).click();
await page.getByText(/pass QC|none inside your area/).first().waitFor({ timeout: 180_000 });
await page.waitForTimeout(2500);
const box = await page.locator('.maplibregl-canvas').boundingBox();
let opened = false;
for (let r = 0; r <= 220 && !opened; r += 20)
  for (let a = 0; a < 360 && !opened; a += r ? 30 : 360) {
    await page.mouse.click(box.x + box.width / 2 + r * Math.cos((a * Math.PI) / 180), box.y + box.height / 2 + r * Math.sin((a * Math.PI) / 180));
    opened = (await page.locator('.swot-popup').count()) > 0;
  }
const panel = page.getByRole('region', { name: /Time series for/ });
await panel.getByText(/pass QC · \d+ total/).waitFor({ timeout: 60_000 });
await page.locator('.maplibregl-popup-close-button').click().catch(() => undefined);
await panel.getByRole('tab', { name: 'Storage' }).click();
await page.waitForTimeout(800);
console.log('STORAGE:', await text(panel.locator('dl, [role=status], [role=alert]').first()));
console.log('STORAGE notices:', (await panel.getByRole('status').allInnerTexts()).map((t) => t.replaceAll('\n', ' ')).join(' || '));
await page.screenshot({ path: `${out}/storage.png` });
await panel.getByRole('tab', { name: 'Water level' }).click();
await panel.getByText(/Compare with independent altimetry/).click();
await page.waitForTimeout(8000);
console.log('INDEPENDENT panel:', ((await panel.innerText()).split('Compare with independent altimetry')[1] ?? '').split('\n').join(' | ').slice(0, 600));
await panel.getByText('Station', { exact: true }).waitFor({ timeout: 60_000 });
const options = await panel.locator('select').last().locator('option').allInnerTexts();
console.log(`INDEPENDENT stations (${options.length}):`, options.slice(0, 6).join(' || '));
console.log('INDEPENDENT notes:', (await panel.locator('p', { hasText: /older stations|DAHITI key/ }).allInnerTexts()).join(' '));
await panel.getByRole('alert').waitFor({ timeout: 30_000 });
console.log('INDEPENDENT without key:', await text(panel.getByRole('alert')));
await page.screenshot({ path: `${out}/independent.png` });
await panel.getByRole('button', { name: 'Close time series' }).click();

// 6. Alerts: save the search, turn on the bell, check now
await page.getByRole('button', { name: 'Save search' }).click();
await page.getByRole('button', { name: 'Save', exact: true }).click();
await page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: 'Saved' }).click();
await page.getByRole('button', { name: /Alert me about new passes/ }).first().click();
await page.getByRole('button', { name: /Stop new-pass alerts/ }).first().waitFor({ timeout: 120_000 });
await page.getByRole('button', { name: 'Check now' }).click();
await page.getByText(/new granule|No new SWOT passes/).waitFor({ timeout: 120_000 });
console.log('ALERTS:', await text(page.locator('section', { has: page.getByRole('heading', { name: 'Saved searches' }) }).locator('header ~ p, [role=status]').first()));
console.log('ALERTS check:', await page.getByText(/new granule|No new SWOT passes/).first().innerText());
await page.screenshot({ path: `${out}/alerts.png` });
await ctx.close();
