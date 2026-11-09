/**
 * Run a real search in the built extension and report any Content Security Policy violations
 * (e.g. eval probes). Needs EDL_TOKEN in the Windows user environment.
 * Usage: node tools/check-csp.mjs
 */
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const token =
  process.env.EDL_TOKEN ?? /EDL_TOKEN\s+REG_\w+\s+(\S+)/.exec(execSync('reg query HKCU\\Environment /v EDL_TOKEN', { encoding: 'utf8' }))?.[1];
const ext = resolve('dist/chrome-mv3');
const ctx = await chromium.launchPersistentContext('', { channel: 'chromium', headless: true, args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`] });
let [sw] = ctx.serviceWorkers();
sw ??= await ctx.waitForEvent('serviceworker');
const area = {
  id: 'a', name: 'GERD', source: 'polygon', bufferKm: 0,
  geometry: { type: 'Polygon', coordinates: [[[35.0, 10.7], [35.45, 10.75], [35.3, 11.25], [35.05, 11.2], [35.0, 10.7]]] },
};
await sw.evaluate(([a, t]) => chrome.storage.local.set({ edlToken: t, studyAreas: JSON.stringify({ state: { areas: [a], activeId: a.id }, version: 0 }) }), [area, token]);
await ctx.addInitScript(() => {
  window.__csp = [];
  document.addEventListener('securitypolicyviolation', (e) =>
    window.__csp.push(`${e.violatedDirective} ${e.blockedURI} ${String(e.sourceFile).split('/').pop()}:${e.lineNumber}`),
  );
});

const page = await ctx.newPage();
const consoleCsp = [];
page.on('console', (m) => /Content Security Policy|unsafe-eval/i.test(m.text()) && consoleCsp.push(m.text().slice(0, 120)));
await page.goto(`chrome-extension://${new URL(sw.url()).host}/app.html`);
await page.getByRole('tabpanel').getByRole('button', { name: 'Search', exact: true }).click();
await page.getByRole('heading', { name: /granules/ }).waitFor({ timeout: 90_000 });
console.log('search:', await page.getByRole('heading', { name: /granules/ }).innerText());
await page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: 'Reservoirs' }).click();
await page.waitForTimeout(4000);
console.log('CSP violations on the page:', JSON.stringify(await page.evaluate(() => window.__csp)));
console.log('CSP messages in console:', JSON.stringify(consoleCsp));
await ctx.close();
