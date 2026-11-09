/**
 * Visit every screen (all sections, each reservoir's tabs, side panel, options) and report
 * page errors and React error-boundary messages with their component stacks.
 * Usage: node tools/e2e-crawl.mjs <outDir>
 */
import { execSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const out = resolve(process.argv[2] ?? 'tools/out/crawl');
mkdirSync(out, { recursive: true });
const token =
  process.env.EDL_TOKEN ??
  /EDL_TOKEN\s+REG_\w+\s+(\S+)/.exec(execSync('reg query HKCU\\Environment /v EDL_TOKEN', { encoding: 'utf8' }))?.[1];
const ext = resolve('dist/chrome-mv3');
const ctx = await chromium.launchPersistentContext('', {
  channel: 'chromium',
  headless: true,
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
});
// Newer Chrome returns a Promise from the scroll methods; act like it, so an effect that
// returns their result (React then calls it as a cleanup) fails here too.
await ctx.addInitScript(() => {
  for (const name of ['scrollIntoView', 'scrollTo', 'scrollBy']) {
    const original = Element.prototype[name];
    Element.prototype[name] = function (...args) {
      original.apply(this, args);
      return Promise.resolve();
    };
  }
});
let [sw] = ctx.serviceWorkers();
sw ??= await ctx.waitForEvent('serviceworker');
const id = new URL(sw.url()).host;
await sw.evaluate((t) => chrome.storage.local.set({ edlToken: t }), token);

const errors = [];
const watch = (page, where) => {
  page.on('pageerror', (e) => errors.push(`[${where}] pageerror: ${e.message}\n${e.stack?.split('\n').slice(0, 4).join('\n')}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`[${where}] console: ${m.text().slice(0, 600)}`));
};
const boundaries = async (page, where) => {
  const t = await page.locator('text=/went wrong|could not be shown|is not a function/i').allInnerTexts();
  if (t.length) errors.push(`[${where}] boundary: ${t.join(' | ').slice(0, 300)}`);
};

for (const [file, where] of [
  ['app.html', 'page'],
  ['sidepanel.html', 'sidepanel'],
]) {
  const page = await ctx.newPage();
  watch(page, where);
  await page.setViewportSize(where === 'page' ? { width: 1440, height: 900 } : { width: 420, height: 900 });
  await page.goto(`chrome-extension://${id}/${file}`);
  await page.waitForTimeout(1500);
  if (where === 'page') {
    // A gauge series for Roseires, so the validation charts draw (daily level, 2024).
    await page.evaluate(
      () =>
        new Promise((done, fail) => {
          const req = indexedDB.open('swot-explorer');
          req.onsuccess = () => {
            const tx = req.result.transaction('gauges', 'readwrite');
            const points = [];
            for (let d = 0; d < 366; d++) points.push([Date.UTC(2024, 0, 1 + d, 10), 485 + 4 * Math.sin((d / 366) * 2 * Math.PI)]);
            tx.objectStore('gauges').put({ reservoirId: 'roseires', label: 'U/S level', fileName: 'test.xlsx', importedAt: Date.now(), points });
            tx.oncomplete = () => done();
            tx.onerror = () => fail(tx.error);
          };
          req.onerror = () => fail(req.error);
        }),
    );
  }
  const nav = where === 'page' ? page.getByRole('navigation', { name: 'Sections' }) : page.getByRole('tablist', { name: 'Sections' });
  for (const tab of ['Search', 'Reservoirs', 'Compare', 'Downloads', 'Saved']) {
    await nav.getByRole(where === 'page' ? 'button' : 'tab', { name: new RegExp(tab) }).click();
    await page.waitForTimeout(2500);
    await boundaries(page, `${where}/${tab}`);
  }
  if (where === 'page') {
    for (const name of ['GERD', 'Roseires Dam']) try {
      // Pressing the open section again folds the panel, so only press it when another is open.
      if ((await nav.locator('[aria-current="page"]').innerText()).includes('Reservoirs') === false) await nav.getByRole('button', { name: /Reservoirs/ }).click();
      await page.getByRole('tabpanel').getByRole('button', { name: new RegExp(`^${name}`) }).first().click();
      await page.waitForTimeout(2000);
      await boundaries(page, `${name}/robust`);
      await page.getByRole('tab', { name: 'Gauge validation' }).click();
      await page.waitForTimeout(2000);
      await boundaries(page, `${name}/gauge`);
      if (name === 'Roseires Dam') {
        await page.getByRole('radio', { name: /Whole lake/ }).click();
        await page.getByRole('button', { name: 'Export figure' }).first().waitFor({ timeout: 60_000 }).catch(() => errors.push('gauge charts never appeared'));
        await page.waitForTimeout(2000);
        await boundaries(page, `${name}/gauge-charts`);
      }
      await page.screenshot({ path: `${out}/${name.replace(/\W/g, '')}-gauge.png` });
      await page.getByRole('button', { name: 'All reservoirs' }).click();
    } catch (err) {
      errors.push(`[${name}] step failed: ${err.message.split('\n')[0]}`);
      await page.screenshot({ path: `${out}/${name.replace(/\W/g, '')}-failed.png` });
      await boundaries(page, `${name}/failed`);
    }
    await page.keyboard.press('Control+K');
    await page.waitForTimeout(500);
    for (const key of ['ArrowDown', 'ArrowDown', 'r', 'o', 'ArrowDown', 'Backspace', 'Backspace']) await page.keyboard.press(key);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    await boundaries(page, `${where}/palette`);
  }
  await page.screenshot({ path: `${out}/${where}.png` });
}
const opt = await ctx.newPage();
watch(opt, 'options');
await opt.goto(`chrome-extension://${id}/options.html`);
await opt.waitForTimeout(1500);
console.log(errors.length ? errors.join('\n---\n') : 'no errors');
await ctx.close();
