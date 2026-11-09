/**
 * Screenshot the built extension (dist/chrome-mv3) in Chromium for design review.
 * Usage: node tools/screenshots.mjs <outDir>
 * Seeds a study area and a sample (paused) download queue so screens are not empty.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const ext = resolve('dist/chrome-mv3');
const out = resolve(process.argv[2] ?? 'tools/out/screens');
mkdirSync(out, { recursive: true });

const gerd = {
  id: 'gerd-box',
  name: 'GERD reservoir',
  source: 'rectangle',
  bufferKm: 0,
  geometry: { type: 'Polygon', coordinates: [[[34.9, 10.6], [35.5, 10.6], [35.5, 11.3], [34.9, 11.3], [34.9, 10.6]]] },
};
const job = (i, state, extra = {}) => ({
  id: `j${i}`, url: `https://example.invalid/${i}.zip`, filename: `SWOT/SWOT_L2_HR_LakeSP_prior_D/SWOT_L2_HR_LakeSP_Prior_04${i}_318_AF_20251023T070258_PID0_01.zip`,
  product: 'SWOT_L2_HR_LakeSP_prior_D', granule: `g${i}`, sizeBytes: 9_800_000 + i * 731_000, state, attempts: 0, useToken: true, addedAt: 0, updatedAt: 0, ...extra,
});

for (const scheme of ['light', 'dark']) {
  const ctx = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    headless: true,
    colorScheme: scheme,
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
  });
  let [sw] = ctx.serviceWorkers();
  sw ??= await ctx.waitForEvent('serviceworker');
  const id = new URL(sw.url()).host;
  await sw.evaluate(
    ([area, jobs]) =>
      chrome.storage.local.set({
        studyAreas: JSON.stringify({ state: { areas: [area], activeId: area.id }, version: 0 }),
        downloadQueue: { jobs, concurrency: 3, paused: true },
      }),
    [gerd, [job(1, 'done'), job(2, 'done'), job(3, 'failed', { error: 'Interrupted (NETWORK_FAILED)', attempts: 3 }), job(4, 'queued'), job(5, 'queued')]],
  );

  const shot = async (path, size, name, before) => {
    const page = await ctx.newPage();
    await page.setViewportSize(size);
    await page.goto(`chrome-extension://${id}/${path}`);
    await page.waitForTimeout(2500); // fonts, tiles, entrance motion
    if (before) await before(page);
    await page.screenshot({ path: `${out}/${scheme}-${name}.png` });
    await page.close();
  };

  // Signed out: the first-run sign-in screen.
  await shot('sidepanel.html', { width: 400, height: 900 }, 'panel-signin');
  await shot('options.html', { width: 1280, height: 800 }, 'options-signed-out');
  // Signed in with a dummy token (the app only decodes its uid and expiry).
  const claims = btoa(JSON.stringify({ uid: 'osmangeo93', exp: Math.floor(Date.now() / 1000) + 50 * 86400 }));
  await sw.evaluate((t) => chrome.storage.local.set({ edlToken: t }), `x.${claims}.y`);

  await shot('app.html', { width: 1440, height: 900 }, 'page-search');
  await shot('app.html', { width: 1440, height: 900 }, 'page-account-menu', async (p) => {
    await p.getByRole('button', { name: /Account:/ }).click();
    await p.waitForTimeout(500);
  });
  await shot('sidepanel.html', { width: 400, height: 900 }, 'panel-search');
  await shot('sidepanel.html', { width: 400, height: 900 }, 'panel-downloads', async (p) => {
    await p.getByRole('tab', { name: /Downloads/ }).click();
    await p.waitForTimeout(700);
  });
  const nav = (p, name) => p.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name });
  await shot('app.html', { width: 1440, height: 900 }, 'page-reservoirs', async (p) => {
    await nav(p, 'Reservoirs').click();
    await p.waitForTimeout(700);
  });
  await shot('app.html', { width: 1440, height: 900 }, 'page-reservoir-detail', async (p) => {
    await nav(p, 'Reservoirs').click();
    await p.getByRole('button', { name: /Roseires Dam/ }).click();
    await p.waitForTimeout(2500);
  });
  await shot('app.html', { width: 1440, height: 900 }, 'page-compare', async (p) => {
    await nav(p, 'Compare').click();
    await p.waitForTimeout(8000);
  });
  await shot('app.html', { width: 1440, height: 900 }, 'page-downloads', async (p) => {
    await nav(p, /^Downloads/).click();
    await p.waitForTimeout(700);
  });
  await shot('app.html', { width: 1440, height: 900 }, 'page-collapsed', async (p) => {
    await p.getByRole('button', { name: /Hide panel/ }).click();
    await p.waitForTimeout(1200);
  });
  await shot('options.html', { width: 1280, height: 800 }, 'options');
  await ctx.close();
}
console.log('saved to', out);
