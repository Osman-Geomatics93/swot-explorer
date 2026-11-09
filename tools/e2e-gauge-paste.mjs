/**
 * End-to-end check of the paste-from-Excel table: paste a tab-separated block (as Excel copies it)
 * into the gauge table, pick columns, edit a cell, save, and print the validation statistics.
 * Usage: node tools/e2e-gauge-paste.mjs <clipboard.tsv> [reservoir name] [outDir]
 */
import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const [file, name = 'Roseires Dam', outArg] = process.argv.slice(2);
if (!file) throw new Error('Usage: node tools/e2e-gauge-paste.mjs <clipboard.tsv> [reservoir name] [outDir]');
const clip = readFileSync(file, 'utf8');
const out = resolve(outArg ?? 'tools/out/e2e-gauge-paste');
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
await page.getByRole('button', { name: 'Paste from Excel' }).click();

const grid = page.getByRole('grid', { name: 'Gauge readings' });
await grid.getByRole('gridcell').first().click();
// What Ctrl+V delivers: a paste event carrying the clipboard text.
await grid.evaluate((el, text) => {
  const data = new DataTransfer();
  data.setData('text/plain', text);
  el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
}, clip);
const mapping = page.getByText(/You pasted \d+ columns/);
if (await mapping.isVisible().catch(() => false)) {
  const selects = page.locator('select').filter({ has: page.locator('option', { hasText: 'Column' }) });
  console.log('MAPPING: date =', await page.getByLabel('Date column').locator('option:checked').innerText(), '| level =', await page.getByLabel('Level column').locator('option:checked').innerText(), `(${await selects.count()} selects)`);
  await page.screenshot({ path: `${out}/1-mapping.png` });
  await page.getByRole('button', { name: 'Use these columns' }).click();
}
console.log('STATUS:', await page.getByRole('status').filter({ hasText: /readings ready|No readings/ }).innerText());

// Type over one level, as a user fixing a value would: go to row 1, step to the level, type, Enter.
const row1Level = grid.locator('[aria-rowindex="2"] [role=gridcell]').nth(1);
await page.keyboard.press('Control+Home');
await page.keyboard.press('ArrowRight');
await page.keyboard.type('489.32');
await page.keyboard.press('Enter');
console.log('EDITED row 1 level:', await row1Level.innerText(), '| active row after Enter:', await grid.locator('[aria-selected=true]').first().evaluate((el) => el.parentElement.getAttribute('aria-rowindex') - 1));
await page.keyboard.press('Control+z');
console.log('AFTER UNDO row 1 level:', await row1Level.innerText());
// Excel-style copy of a selection: row 1 to 3, both columns.
await page.keyboard.press('Control+Home');
await page.keyboard.press('Shift+ArrowDown');
await page.keyboard.press('Shift+ArrowDown');
await page.keyboard.press('Shift+ArrowRight');
const copied = await grid.evaluate((el) => {
  const data = new DataTransfer();
  el.dispatchEvent(new ClipboardEvent('copy', { clipboardData: data, bubbles: true, cancelable: true }));
  return data.getData('text/plain');
});
console.log('COPIED:', JSON.stringify(copied));
await page.screenshot({ path: `${out}/2-grid.png` });

await page.getByRole('button', { name: /^Save [\d,]+ readings for/ }).click();
const stats = page.locator('dl').last();
await stats.waitFor({ timeout: 90_000 });
await page.waitForTimeout(1000);
console.log('SAVED:', (await page.locator('p', { hasText: / readings$/ }).first().innerText()).replaceAll('\n', ' '));
console.log('STATS:', (await stats.innerText()).split('\n').join(' | '));

// Reopen the saved readings in the table.
await page.getByRole('button', { name: 'Edit in table' }).click();
console.log('EDIT STATUS:', await page.getByRole('status').filter({ hasText: /readings ready/ }).innerText());
await page.screenshot({ path: `${out}/3-edit.png` });
await ctx.close();
