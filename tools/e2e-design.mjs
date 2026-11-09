/**
 * End-to-end check of the design features: getting-started guide, command palette, reservoir
 * cards, theme switch, chart and map figure export, hover/pin card and the pass timeline.
 * Needs the Earthdata token in the Windows user environment variable EDL_TOKEN (never printed).
 * Usage: node tools/e2e-design.mjs <outDir>
 */
import { execSync } from 'node:child_process';
import { copyFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const out = resolve(process.argv[2] ?? 'tools/out/design');
mkdirSync(out, { recursive: true });
const token =
  process.env.EDL_TOKEN ??
  /EDL_TOKEN\s+REG_\w+\s+(\S+)/.exec(execSync('reg query HKCU\\Environment /v EDL_TOKEN', { encoding: 'utf8' }))?.[1];
if (!token) throw new Error('EDL_TOKEN not set');

const ext = resolve('dist/chrome-mv3');
const ctx = await chromium.launchPersistentContext('', {
  channel: 'chromium',
  headless: true,
  acceptDownloads: true,
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
});
let [sw] = ctx.serviceWorkers();
sw ??= await ctx.waitForEvent('serviceworker');
const id = new URL(sw.url()).host;
const area = {
  id: 'roseires-box',
  name: 'Roseires near dam',
  source: 'rectangle',
  bufferKm: 0,
  geometry: { type: 'Polygon', coordinates: [[[34.33, 11.62], [34.5, 11.62], [34.5, 11.8], [34.33, 11.8], [34.33, 11.62]]] },
};
await sw.evaluate(
  ([a, t]) => chrome.storage.local.set({ edlToken: t, studyAreas: JSON.stringify({ state: { areas: [a], activeId: a.id }, version: 0 }) }),
  [area, token],
);
const downloads = () => sw.evaluate(() => chrome.downloads.search({}).then((d) => d.map((x) => `${x.filename.split(/[\\/]/).slice(-3).join('/')} ${x.state} ${x.fileSize}`)));

const page = await ctx.newPage();
page.on('download', (d) => void d.path().then(() => d.saveAs(`${out}/${d.suggestedFilename()}`)));
const failures = [];
page.on('pageerror', (e) => failures.push(`page error: ${e.message}`));
page.on('console', (m) => (m.type() === 'error' || /maxCanvasSize/.test(m.text())) && failures.push(`console: ${m.text().slice(0, 200)}`));
await page.setViewportSize({ width: Number(process.env.VIEW_W ?? 1440), height: Number(process.env.VIEW_H ?? 900) });
await page.goto(`chrome-extension://${id}/app.html`);

// 1. Getting started guide.
const guide = page.getByRole('region', { name: 'Welcome to SWOT Explorer' }).or(page.locator('section[aria-labelledby="guide-title"]'));
await guide.waitFor();
console.log('guide:', (await guide.innerText()).replace(/\n/g, ' | ').slice(0, 220));
await page.screenshot({ path: `${out}/1-guide.png` });

// 2. Command palette: Ctrl+K, type, Enter.
await page.keyboard.press('Control+K');
const palette = page.getByRole('dialog', { name: 'Commands' });
await palette.waitFor();
await page.keyboard.type('ros');
console.log('palette "ros":', (await palette.getByRole('option').allInnerTexts()).map((t) => t.trim()).join(' / '));
await page.screenshot({ path: `${out}/2-palette.png` });
await page.keyboard.press('Escape');
await palette.waitFor({ state: 'hidden' });

// 3. Reservoir cards.
await page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: /Reservoirs/ }).click();
await page.getByRole('tabpanel').getByText(/ago|today|yesterday/).first().waitFor({ timeout: 60_000 });
await page.waitForTimeout(4000);
const cards = page.getByRole('tabpanel').locator('li > button');
console.log('cards:', (await cards.count()), '|', (await cards.allInnerTexts()).slice(0, 4).map((t) => t.replace(/\n/g, ' ')).join(' || '));
await page.screenshot({ path: `${out}/3-cards.png` });

// 4. Theme: cycle Auto → Light → Dark.
const themeBtn = page.getByRole('button', { name: /^Theme:/ });
await themeBtn.click();
await themeBtn.click();
console.log('theme attr:', await page.evaluate(() => document.documentElement.dataset.theme));
await page.screenshot({ path: `${out}/4-cards-dark.png` });
await page.getByRole('button', { name: /^Theme:/ }).click(); // back to auto

// 5. Chart export (cascade).
await page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: /Compare/ }).click();
const exportBtn = page.getByRole('tabpanel').getByRole('button', { name: 'Export figure' });
await exportBtn.waitFor({ timeout: 60_000 });
await page.waitForTimeout(3000);
await exportBtn.click();
await page.getByRole('button', { name: /PNG · 300 dpi/ }).click();
await page.getByText(/Figure saved to/).waitFor({ timeout: 20_000 });
await page.screenshot({ path: `${out}/5-toast.png` });
await exportBtn.click();
await page.getByRole('button', { name: /SVG · vector/ }).click();
await page.waitForTimeout(2500);

// 6. Preview a pass, hover and pin, pass history.
await page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: /Search/ }).click();
await page.getByRole('tabpanel').getByRole('button', { name: 'Search', exact: true }).click();
await page.getByText('Preview on the map').waitFor({ timeout: 90_000 });
await page.getByRole('button', { name: /Show on map/ }).click();
await page.getByText(/pass QC|none inside your area/).first().waitFor({ timeout: 180_000 });
await page.waitForTimeout(3000);
const box = await page.locator('.maplibregl-canvas').boundingBox();
let hovered = false;
for (let r = 0; r <= 240 && !hovered; r += 15)
  for (let a = 0; a < 360 && !hovered; a += r ? 20 : 360) {
    await page.mouse.move(box.x + box.width / 2 + r * Math.cos((a * Math.PI) / 180), box.y + box.height / 2 + r * Math.sin((a * Math.PI) / 180));
    await page.waitForTimeout(60);
    hovered = (await page.locator('.map-card').count()) > 0;
  }
console.log('hover card:', hovered, hovered ? (await page.locator('.map-card').innerText()).replace(/\n/g, ' | ') : '');
await page.screenshot({ path: `${out}/6-hover.png` });
if (hovered) {
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(800);
  console.log('pinned:', await page.getByRole('button', { name: 'Unpin' }).count());
  await page.getByRole('button', { name: 'Close time series' }).click().catch(() => undefined);
}
await page.getByRole('button', { name: 'Pass history' }).click();
const history = page.getByRole('region', { name: 'Pass history' });
await history.getByRole('slider').waitFor({ timeout: 120_000 });
console.log('timeline:', (await history.innerText()).replace(/\n/g, ' | '));
await page.screenshot({ path: `${out}/7-timeline-last.png` });
await history.getByRole('slider').focus();
await page.keyboard.press('Home');
await page.waitForTimeout(800);
console.log('timeline first:', (await history.innerText()).split('\n').slice(0, 2).join(' | '));
await history.getByRole('button', { name: 'Play through the passes' }).click();
await page.waitForTimeout(3000);
console.log('after 3 s play:', (await history.innerText()).split('\n').slice(0, 2).join(' | '));
await page.screenshot({ path: `${out}/8-timeline-playing.png` });
await history.getByRole('button', { name: 'Pause' }).click();

// 7. Map figure.
await page.getByRole('button', { name: /Export map figure/ }).click();
await page.getByText(/Map figure saved to/).waitFor({ timeout: 60_000 });
await page.waitForTimeout(2000);
console.log('downloads:', (await downloads()).join(' ; '));
// Keep the exported figures (Playwright deletes its download folder on close).
const files = await sw.evaluate(() => chrome.downloads.search({ state: 'complete' }).then((d) => d.map((x) => [x.filename, x.mime, x.fileSize])));
files.forEach(([path, mime], i) => copyFileSync(path, `${out}/figure-${i}.${mime.includes('svg') ? 'svg' : 'png'}`));
console.log('figures:', files.map(([, mime, size]) => `${mime} ${size}`).join(' ; '));
console.log('failures:', failures.length ? failures : 'none');
await ctx.close();
