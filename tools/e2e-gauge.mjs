/**
 * End-to-end gauge validation: import a gauge workbook for a reservoir in the built extension,
 * keep the suggested columns, and print the statistics against live SWOT data.
 * Usage: node tools/e2e-gauge.mjs <gauge.xlsx|csv> [reservoir name] [outDir]
 */
import { execSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const [file, name = 'Roseires Dam', outArg] = process.argv.slice(2);
if (!file) throw new Error('Usage: node tools/e2e-gauge.mjs <gauge.xlsx|csv> [reservoir name] [outDir]');
const out = resolve(outArg ?? 'tools/out/e2e-gauge');
mkdirSync(out, { recursive: true });
const token =
  process.env.EDL_TOKEN ?? /EDL_TOKEN\s+REG_\w+\s+(\S+)/.exec(execSync('reg query HKCU\\Environment /v EDL_TOKEN', { encoding: 'utf8' }))?.[1];
const ext = resolve('dist/chrome-mv3');
const ctx = await chromium.launchPersistentContext('', { channel: 'chromium', headless: true, args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`] });
let [sw] = ctx.serviceWorkers();
sw ??= await ctx.waitForEvent('serviceworker');
await sw.evaluate((t) => chrome.storage.local.set({ edlToken: t }), token);
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message));
await page.setViewportSize({ width: 1440, height: 1000 });
await page.goto(`chrome-extension://${new URL(sw.url()).host}/app.html`);

await page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: 'Reservoirs' }).click();
await page.getByRole('button', { name: new RegExp(name) }).click();
await page.getByRole('tab', { name: 'Gauge validation' }).click();
await page.locator('input[type=file][accept*=xlsx]').setInputFiles(file);
const list = page.locator('label', { has: page.locator('input[type=checkbox]') });
await list.first().waitFor();
for (const row of await list.all()) console.log(`${(await row.locator('input').isChecked()) ? '[x]' : '[ ]'} ${(await row.innerText()).replaceAll('\n', ' | ')}`);
await page.screenshot({ path: `${out}/1-columns.png` });
await page.getByRole('button', { name: /^Save for/ }).click();

const stats = page.locator('dl').last();
await stats.waitFor({ timeout: 90_000 });
await page.waitForTimeout(1500);
console.log('GAUGE:', (await page.locator('p', { hasText: / readings$/ }).first().innerText()).replaceAll('\n', ' '));
console.log('STATS:', (await stats.innerText()).split('\n').join(' | '));
console.log('NOTE:', await page.locator('p', { hasText: 'EGM2008' }).first().innerText());
await page.screenshot({ path: `${out}/2-validation.png`, fullPage: true });
const scroller = page.locator('[role=tabpanel]:not([hidden])');
await scroller.evaluate((el) => (el.scrollTop = 900));
await page.waitForTimeout(500);
await page.screenshot({ path: `${out}/3-charts.png` });
const outlierBox = page.getByLabel(/Exclude \d+ outlier/);
if (await outlierBox.count()) {
  await outlierBox.check();
  await page.waitForTimeout(500);
  console.log('WITHOUT OUTLIERS:', (await stats.innerText()).split('\n').join(' | '));
}
await ctx.close();
