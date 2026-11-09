/**
 * Download queue state machine (pure functions, no browser APIs).
 *
 * The background service worker owns the queue: it is the only writer, keeps the state
 * in chrome.storage.local, and applies these transitions in response to UI commands and
 * chrome.downloads events. Pages read the state through storage.onChanged.
 *
 *   queued ──start──▶ active ──complete──▶ done
 *     ▲                 │ interrupted / auth refused
 *     │                 ▼
 *     └──retry (backoff)┴──▶ failed      (after MAX_ATTEMPTS, or login required)
 *   queued/active ⇄ paused        any unfinished ──▶ cancelled
 */

export type JobState = 'queued' | 'active' | 'paused' | 'done' | 'failed' | 'cancelled';

export interface NewJob {
  url: string;
  /** Path below the Downloads folder. */
  filename: string;
  product: string;
  granule: string;
  sizeBytes: number | null;
}

export interface Job extends NewJob {
  id: string;
  state: JobState;
  downloadId?: number;
  /** Failed attempts so far (auth fallback does not count). */
  attempts: number;
  /** Send the Earthdata bearer token; switched off once if the server refuses it. */
  useToken: boolean;
  pausedFrom?: 'queued' | 'active';
  nextAttemptAt?: number;
  error?: string;
  addedAt: number;
  updatedAt: number;
}

export interface QueueState {
  jobs: Job[];
  concurrency: number;
  paused: boolean;
}

export type Outcome =
  | { kind: 'complete'; htmlPage: boolean }
  | { kind: 'interrupted'; error: string };

/** chrome.storage.local key holding the QueueState. */
export const QUEUE_KEY = 'downloadQueue';
export const MAX_ATTEMPTS = 3;
export const EMPTY_QUEUE: QueueState = { jobs: [], concurrency: 3, paused: false };

const AUTH_ERRORS = new Set(['SERVER_UNAUTHORIZED', 'SERVER_FORBIDDEN', 'SERVER_BAD_CONTENT']);
const UNFINISHED: JobState[] = ['queued', 'active', 'paused'];

export const backoffMs = (attempts: number) => 15_000 * 2 ** (attempts - 1); // 15 s, 30 s, 60 s

const update = (s: QueueState, id: string, patch: Partial<Job>, now: number): QueueState => ({
  ...s,
  jobs: s.jobs.map((j) => (j.id === id ? { ...j, ...patch, updatedAt: now } : j)),
});

/** Add jobs, skipping URLs that are already queued, running or done. */
export function addJobs(s: QueueState, items: NewJob[], now: number, makeId: () => string): { state: QueueState; added: number } {
  const taken = new Set(s.jobs.filter((j) => j.state !== 'failed' && j.state !== 'cancelled').map((j) => j.url));
  const fresh: Job[] = [];
  for (const item of items) {
    if (taken.has(item.url)) continue;
    taken.add(item.url);
    fresh.push({ ...item, id: makeId(), state: 'queued', attempts: 0, useToken: true, addedAt: now, updatedAt: now });
  }
  // Re-adding a failed/cancelled URL replaces the old entry.
  const replaced = new Set(fresh.map((j) => j.url));
  const kept = s.jobs.filter((j) => !(replaced.has(j.url) && (j.state === 'failed' || j.state === 'cancelled')));
  return { state: { ...s, jobs: pruneFinished([...kept, ...fresh]) }, added: fresh.length };
}

/** Finished jobs kept for the Downloads list; older ones are dropped so storage stays small. */
export const FINISHED_LIMIT = 300;

function pruneFinished(jobs: Job[]): Job[] {
  const finished = jobs.filter((j) => j.state === 'done' || j.state === 'cancelled');
  if (finished.length <= FINISHED_LIMIT) return jobs;
  const drop = new Set(finished.slice(0, finished.length - FINISHED_LIMIT).map((j) => j.id));
  return jobs.filter((j) => !drop.has(j.id));
}

/** Jobs to start now, respecting concurrency, global pause and retry backoff. */
export function jobsToStart(s: QueueState, now: number): Job[] {
  if (s.paused) return [];
  const free = s.concurrency - s.jobs.filter((j) => j.state === 'active').length;
  if (free <= 0) return [];
  return s.jobs.filter((j) => j.state === 'queued' && (j.nextAttemptAt ?? 0) <= now).slice(0, free);
}

export const markStarted = (s: QueueState, id: string, downloadId: number, now: number) =>
  update(s, id, { state: 'active', downloadId, nextAttemptAt: undefined, error: undefined }, now);

/** The download could not even be created (bad URL, invalid filename, ...). */
export const markStartFailed = (s: QueueState, id: string, error: string, now: number) =>
  update(s, id, { state: 'failed', error }, now);

export function onFinished(s: QueueState, downloadId: number, outcome: Outcome, now: number): QueueState {
  const job = s.jobs.find((j) => j.downloadId === downloadId && j.state === 'active');
  if (!job) return s;

  if (outcome.kind === 'complete' && !outcome.htmlPage) return update(s, job.id, { state: 'done', error: undefined }, now);

  const authProblem = outcome.kind === 'complete' || AUTH_ERRORS.has(outcome.error);
  if (authProblem && job.useToken) {
    // Retry at once without the token: a browser logged in to Earthdata can still download.
    return update(s, job.id, { state: 'queued', useToken: false, downloadId: undefined }, now);
  }
  if (authProblem) {
    return update(s, job.id, { state: 'failed', error: 'Earthdata login required: add a token in Options or log in at urs.earthdata.nasa.gov.' }, now);
  }
  if (outcome.error === 'USER_CANCELED') return update(s, job.id, { state: 'cancelled' }, now);

  const attempts = job.attempts + 1;
  if (attempts >= MAX_ATTEMPTS) return update(s, job.id, { state: 'failed', attempts, error: `Interrupted (${outcome.error})` }, now);
  return update(
    s,
    job.id,
    { state: 'queued', attempts, downloadId: undefined, nextAttemptAt: now + backoffMs(attempts), error: `Retrying after ${outcome.error}` },
    now,
  );
}

export function pauseJob(s: QueueState, id: string, now: number): QueueState {
  const job = s.jobs.find((j) => j.id === id);
  if (!job || (job.state !== 'queued' && job.state !== 'active')) return s;
  return update(s, id, { state: 'paused', pausedFrom: job.state }, now);
}

export function resumeJob(s: QueueState, id: string, now: number): QueueState {
  const job = s.jobs.find((j) => j.id === id);
  if (!job || job.state !== 'paused') return s;
  return update(s, id, { state: job.pausedFrom === 'active' && job.downloadId !== undefined ? 'active' : 'queued', pausedFrom: undefined }, now);
}

export function retryJob(s: QueueState, id: string, now: number): QueueState {
  const job = s.jobs.find((j) => j.id === id);
  if (!job || (job.state !== 'failed' && job.state !== 'cancelled')) return s;
  return update(s, id, { state: 'queued', attempts: 0, useToken: true, downloadId: undefined, nextAttemptAt: undefined, error: undefined }, now);
}

export function cancelJob(s: QueueState, id: string, now: number): QueueState {
  const job = s.jobs.find((j) => j.id === id);
  if (!job || !UNFINISHED.includes(job.state)) return s;
  return update(s, id, { state: 'cancelled' }, now);
}

export const clearFinished = (s: QueueState): QueueState => ({
  ...s,
  jobs: s.jobs.filter((j) => UNFINISHED.includes(j.state) || j.state === 'failed'),
});

export function summarize(s: QueueState) {
  const count = (st: JobState) => s.jobs.filter((j) => j.state === st).length;
  return {
    queued: count('queued'),
    active: count('active'),
    paused: count('paused'),
    done: count('done'),
    failed: count('failed'),
    cancelled: count('cancelled'),
    pending: count('queued') + count('active') + count('paused'),
  };
}
