/**
 * Background download engine. Runs in the service worker and survives pages closing.
 *
 * MV3 can stop the service worker at any time, so it keeps no state in memory: every
 * change is read-modify-written to chrome.storage.local under a lock, and the worker is
 * woken by chrome.downloads events, page messages, and a watchdog alarm.
 */
import type { Browser } from 'wxt/browser';
import { loadToken } from '@/auth/token';
import { onMessage } from '@/messaging/protocol';
import {
  addJobs,
  cancelJob,
  clearFinished,
  EMPTY_QUEUE,
  jobsToStart,
  markStarted,
  markStartFailed,
  onFinished,
  pauseJob,
  resumeJob,
  retryJob,
  summarize,
  QUEUE_KEY,
  type Outcome,
  type QueueState,
} from './queue';

const WATCHDOG = 'download-queue-watchdog';

let lock: Promise<unknown> = Promise.resolve();

/** Serialised read-modify-write of the queue. */
function mutate<T>(fn: (s: QueueState) => Promise<[QueueState, T]> | [QueueState, T]): Promise<T> {
  const run = lock.then(async () => {
    const stored = (await browser.storage.local.get(QUEUE_KEY))[QUEUE_KEY] as QueueState | undefined;
    const [next, result] = await fn(stored ?? EMPTY_QUEUE);
    await browser.storage.local.set({ [QUEUE_KEY]: next });
    void updateBadge(next).catch(() => undefined);
    return result;
  });
  lock = run.catch(() => undefined);
  return run;
}

async function updateBadge(s: QueueState) {
  const { pending, failed } = summarize(s);
  await browser.action.setBadgeText({ text: pending ? String(pending) : failed ? '!' : '' });
  // The service worker has no CSS; these mirror --error and --accent in tokens.css.
  await browser.action.setBadgeBackgroundColor({ color: failed && !pending ? '#a33a2b' : '#1f5f5b' });
}

/**
 * Start queued jobs up to the concurrency limit, one locked write per job, so a started
 * download is saved before the next begins (a worker killed mid-way can't start it twice).
 */
async function pump(): Promise<void> {
  const token = await loadToken();
  for (;;) {
    const started = await mutate(async (s): Promise<[QueueState, boolean]> => {
      const [job] = jobsToStart(s, Date.now());
      if (!job) return [s, false];
      try {
        const id = await browser.downloads.download({
          url: job.url,
          filename: job.filename,
          conflictAction: 'uniquify',
          headers: job.useToken && token ? [{ name: 'Authorization', value: `Bearer ${token}` }] : undefined,
        });
        return [markStarted(s, job.id, id, Date.now()), true];
      } catch (err) {
        return [markStartFailed(s, job.id, err instanceof Error ? err.message : String(err), Date.now()), true];
      }
    });
    if (!started) return;
  }
}

function outcomeOf(item: Browser.downloads.DownloadItem): Outcome | null {
  if (item.state === 'in_progress') return null;
  // Earthdata answers an unauthenticated request with its HTML login page.
  if (item.state === 'complete') return { kind: 'complete', htmlPage: item.mime.includes('html') };
  return { kind: 'interrupted', error: item.error ?? 'UNKNOWN' };
}

const tracks = (s: QueueState, downloadId: number) => s.jobs.some((j) => j.state === 'active' && j.downloadId === downloadId);

/**
 * A Chrome download finished. Chrome reports every download, including the user's own,
 * so anything that is not an active job in this queue is ignored and never touched.
 */
async function handleFinished(downloadId: number) {
  const stored = (await browser.storage.local.get(QUEUE_KEY))[QUEUE_KEY] as QueueState | undefined;
  if (!stored || !tracks(stored, downloadId)) return;
  const [item] = await browser.downloads.search({ id: downloadId });
  const outcome = item ? outcomeOf(item) : { kind: 'interrupted' as const, error: 'FILE_REMOVED' };
  if (!outcome) return;
  const wasOurs = await mutate((s) => (tracks(s, downloadId) ? [onFinished(s, downloadId, outcome, Date.now()), true] : [s, false]));
  // Only a login page that this queue downloaded is deleted.
  if (wasOurs && outcome.kind === 'complete' && outcome.htmlPage) await browser.downloads.removeFile(downloadId).catch(() => undefined);
  await pump();
}

/** Catch up on events missed while the worker was stopped, and start backed-off retries. */
async function reconcile() {
  const stored = (await browser.storage.local.get(QUEUE_KEY))[QUEUE_KEY] as QueueState | undefined;
  for (const job of stored?.jobs ?? []) {
    if (job.state !== 'active' || job.downloadId === undefined) continue;
    const [item] = await browser.downloads.search({ id: job.downloadId });
    if (!item || item.state !== 'in_progress') await handleFinished(job.downloadId);
  }
  await pump();
}

/** Applies a command, then mirrors pause/resume/cancel onto the Chrome download. */
async function command(apply: (s: QueueState) => QueueState, jobId?: string) {
  // Read the job inside the lock: pump() may have just started it.
  const { prev, after } = await mutate((s) => {
    const next = apply(s);
    return [next, { prev: s.jobs.find((j) => j.id === jobId), after: next.jobs.find((j) => j.id === jobId) }];
  });
  if (prev?.downloadId !== undefined && after) {
    const id = prev.downloadId;
    if (prev.state === 'active' && after.state === 'paused') await browser.downloads.pause(id).catch(() => undefined);
    if (prev.state === 'paused' && after.state === 'active') await browser.downloads.resume(id).catch(() => undefined);
    if (prev.state !== 'cancelled' && after.state === 'cancelled') await browser.downloads.cancel(id).catch(() => undefined);
  }
  await pump();
}

/**
 * Register listeners synchronously at service-worker start-up (MV3 requirement).
 * Returns a function that removes them (used by tests).
 */
export function startDownloadEngine(): () => void {
  const onDownloadChanged = (delta: Browser.downloads.DownloadDelta) => {
    if (delta.state && delta.state.current !== 'in_progress') void handleFinished(delta.id);
  };
  const onAlarm = (alarm: Browser.alarms.Alarm) => {
    if (alarm.name === WATCHDOG) void reconcile();
  };
  const onStartup = () => void reconcile();

  browser.downloads.onChanged.addListener(onDownloadChanged);
  // Re-creating an existing alarm resets its schedule, so only create it when missing.
  void browser.alarms.get(WATCHDOG).then(async (a) => {
    if (!a) await browser.alarms.create(WATCHDOG, { periodInMinutes: 0.5 });
  });
  browser.alarms.onAlarm.addListener(onAlarm);
  browser.runtime.onStartup.addListener(onStartup);

  const removeMessageListeners = [
    onMessage('queueAdd', ({ data }) =>
      mutate((s) => {
        const { state, added } = addJobs(s, data, Date.now(), () => crypto.randomUUID());
        return [state, added];
      }).then(async (added) => {
        await pump();
        return added;
      }),
    ),
    onMessage('queuePause', ({ data }) => command((s) => pauseJob(s, data, Date.now()), data)),
    onMessage('queueResume', ({ data }) => command((s) => resumeJob(s, data, Date.now()), data)),
    onMessage('queueRetry', ({ data }) => command((s) => retryJob(s, data, Date.now()), data)),
    onMessage('queueCancel', ({ data }) => command((s) => cancelJob(s, data, Date.now()), data)),
    onMessage('queueClearFinished', () => command(clearFinished)),
    onMessage('queueSetPaused', ({ data }) => command((s) => ({ ...s, paused: data }))),
    onMessage('queueSetConcurrency', ({ data }) => command((s) => ({ ...s, concurrency: Math.min(6, Math.max(1, data)) }))),
  ];

  void reconcile();

  return () => {
    browser.downloads.onChanged.removeListener(onDownloadChanged);
    browser.alarms.onAlarm.removeListener(onAlarm);
    browser.runtime.onStartup.removeListener(onStartup);
    removeMessageListeners.forEach((remove) => remove());
  };
}
