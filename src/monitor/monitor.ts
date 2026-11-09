/**
 * New-pass alerts for saved searches. Runs in the background service worker: every few hours
 * each monitored saved search is re-run, granules not seen before are counted, and a
 * notification opens that search when clicked.
 */
import { findProduct } from '@/config/products';
import { parseGranuleName } from '@/search/granuleName';
import { searchProduct } from '@/search/searchProduct';
import { clipPolygon } from '@/state/studyArea';
import { db, resolvePeriod, type SavedSearch } from '@/storage/db';

export const MONITOR_ALARM = 'monitor-saved-searches';
export const MONITOR_PERIOD_MINUTES = 360;
const SEEN_LIMIT = 5000;
const NOTIFY_PREFIX = 'saved-search:';

/** Granule names in the latest result that are not in `seen` (pure; unit-tested). */
export function newGranules(current: string[], seen: string[]): string[] {
  const known = new Set(seen);
  return current.filter((n) => !known.has(n));
}

async function currentGranules(s: SavedSearch): Promise<string[]> {
  const area = clipPolygon(s.area);
  if (!area) return [];
  const { start, end } = resolvePeriod(s.period);
  const result = await searchProduct({ product: findProduct(s.productKey), area, start, end, cycle: s.cycle, pass: s.pass });
  return result.granules.map((g) => parseGranuleName(g.name).baseName);
}

/** Record what exists now, so only later passes count as new. */
export async function startMonitoring(id: string): Promise<void> {
  const s = await db.savedSearches.get(id);
  if (!s) return;
  const seen = await currentGranules(s);
  await db.savedSearches.update(id, { monitor: true, seen, newCount: 0, lastCheckedAt: Date.now() });
}

export async function stopMonitoring(id: string): Promise<void> {
  await db.savedSearches.update(id, { monitor: false, newCount: 0 });
}

export async function checkSavedSearches(): Promise<number> {
  const monitored = (await db.savedSearches.toArray()).filter((s) => s.monitor);
  let total = 0;
  for (const s of monitored) {
    try {
      const current = await currentGranules(s);
      // Re-read and write in one transaction: another check (the page's "Check now" or the
      // background alarm) or a reset by opening the search may have changed the row meanwhile.
      const fresh = await db.transaction('rw', db.savedSearches, async () => {
        const row = await db.savedSearches.get(s.id);
        if (!row?.monitor) return [];
        const found = newGranules(current, row.seen ?? []);
        const seen = [...(row.seen ?? []), ...found].slice(-SEEN_LIMIT);
        await db.savedSearches.update(s.id, { seen, newCount: (row.newCount ?? 0) + found.length, lastCheckedAt: Date.now() });
        return found;
      });
      if (fresh.length) {
        total += fresh.length;
        await browser.notifications.create(`${NOTIFY_PREFIX}${s.id}`, {
          type: 'basic',
          iconUrl: browser.runtime.getURL('/icon/128.png'),
          title: 'New SWOT data',
          message: `${fresh.length} new ${fresh.length === 1 ? 'granule' : 'granules'} for “${s.name}”.`,
          contextMessage: 'Click to open the search',
          priority: 1,
        });
      }
    } catch {
      // Network or CMR hiccup: try again at the next check.
    }
  }
  return total;
}

/** Register in the service worker. Returns a remover (for tests). */
export function startMonitor(): () => void {
  // Re-creating an existing alarm resets its schedule (MV3 restarts the worker often), so only create it when missing.
  void browser.alarms.get(MONITOR_ALARM).then(async (a) => {
    if (!a) await browser.alarms.create(MONITOR_ALARM, { periodInMinutes: MONITOR_PERIOD_MINUTES, delayInMinutes: 1 });
  });
  const onAlarm = (a: { name: string }) => {
    if (a.name === MONITOR_ALARM) void checkSavedSearches();
  };
  const onClicked = (id: string) => {
    if (!id.startsWith(NOTIFY_PREFIX)) return;
    void browser.tabs.create({ url: browser.runtime.getURL(`/app.html?saved=${encodeURIComponent(id.slice(NOTIFY_PREFIX.length))}`) });
    void browser.notifications.clear(id);
  };
  browser.alarms.onAlarm.addListener(onAlarm);
  browser.notifications.onClicked.addListener(onClicked);
  return () => {
    browser.alarms.onAlarm.removeListener(onAlarm);
    browser.notifications.onClicked.removeListener(onClicked);
  };
}
