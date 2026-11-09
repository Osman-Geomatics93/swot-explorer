/**
 * Background download engine against a fake Chrome download manager:
 * concurrency, completion, auth fallback, and catching up after a service-worker restart.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { startDownloadEngine } from '@/downloads/engine';
import { QUEUE_KEY, type NewJob, type QueueState } from '@/downloads/queue';
import { sendMessage } from '@/messaging/protocol';

type Item = { id: number; url: string; state: 'in_progress' | 'complete' | 'interrupted'; mime: string; error?: string; bytesReceived: number; totalBytes: number; headers?: { name: string; value: string }[] };

function makeEvent<T extends unknown[]>() {
  const listeners: ((...a: T) => unknown)[] = [];
  return {
    addListener: (l: (...a: T) => unknown) => listeners.push(l),
    removeListener: (l: (...a: T) => unknown) => listeners.splice(listeners.indexOf(l), 1),
    trigger: (...a: T) => Promise.all(listeners.map((l) => l(...a))),
  };
}

let items: Map<number, Item>;
let nextId: number;
let onChanged: ReturnType<typeof makeEvent<[{ id: number; state?: { current: string } }]>>;
let onAlarm: ReturnType<typeof makeEvent<[{ name: string }]>>;
let removed: number[];
let stopEngine: () => void;

const TOKEN = `x.${btoa(JSON.stringify({ uid: 'tester', exp: Math.floor(Date.now() / 1000) + 86400 }))}.y`;
const job = (i: number): NewJob => ({ url: `https://archive/${i}.zip`, filename: `SWOT/p/${i}.zip`, product: 'p', granule: `g${i}`, sizeBytes: 10 });
const readQueue = async () => (await fakeBrowser.storage.local.get(QUEUE_KEY))[QUEUE_KEY] as QueueState;
const finish = async (id: number, patch: Partial<Item>, emitEvent = true) => {
  Object.assign(items.get(id)!, patch);
  if (emitEvent) await onChanged.trigger({ id, state: { current: patch.state! } });
};

beforeEach(async () => {
  fakeBrowser.reset();
  items = new Map();
  nextId = 1;
  removed = [];
  onChanged = makeEvent();
  onAlarm = makeEvent();
  Object.assign(fakeBrowser.downloads, {
    download: vi.fn(async (o: { url: string; headers?: Item['headers'] }) => {
      const id = nextId++;
      items.set(id, { id, url: o.url, state: 'in_progress', mime: 'application/zip', bytesReceived: 0, totalBytes: 10, headers: o.headers });
      return id;
    }),
    search: vi.fn(async (q: { id: number }) => (items.has(q.id) ? [{ ...items.get(q.id)! }] : [])),
    removeFile: vi.fn(async (id: number) => void removed.push(id)),
    pause: vi.fn(async () => undefined),
    resume: vi.fn(async () => undefined),
    cancel: vi.fn(async () => undefined),
    onChanged,
  });
  Object.assign(fakeBrowser.alarms, { create: vi.fn(), get: vi.fn(async () => undefined), onAlarm });
  await fakeBrowser.storage.local.set({ edlToken: TOKEN });
  stopEngine = startDownloadEngine();
});

afterEach(() => stopEngine());

const active = () => [...items.values()].filter((i) => i.state === 'in_progress');

describe('background download engine', () => {
  it('starts up to 3 downloads with the bearer token and keeps the rest queued', async () => {
    expect(await sendMessage('queueAdd', [job(1), job(2), job(3), job(4)])).toBe(4);
    await vi.waitFor(() => expect(active()).toHaveLength(3));
    expect(active()[0]!.headers).toEqual([{ name: 'Authorization', value: `Bearer ${TOKEN}` }]);
    const q = await readQueue();
    expect(q.jobs.map((j) => j.state)).toEqual(['active', 'active', 'active', 'queued']);
  });

  it('marks finished downloads done and starts the next one', async () => {
    await sendMessage('queueAdd', [job(1), job(2), job(3), job(4)]);
    await vi.waitFor(() => expect(active()).toHaveLength(3));
    await finish(1, { state: 'complete', bytesReceived: 10 });
    await vi.waitFor(async () => expect((await readQueue()).jobs[0]!.state).toBe('done'));
    await vi.waitFor(() => expect(items.size).toBe(4));
  });

  it('retries without the token when Earthdata returns its login page, and deletes that page', async () => {
    await sendMessage('queueAdd', [job(1)]);
    await vi.waitFor(() => expect(active()).toHaveLength(1));
    await finish(1, { state: 'complete', mime: 'text/html' });
    await vi.waitFor(() => expect(items.size).toBe(2));
    expect(removed).toEqual([1]);
    expect(items.get(2)!.headers).toBeUndefined();
    expect((await readQueue()).jobs[0]).toMatchObject({ state: 'active', useToken: false });
  });

  it('catches up on a download that finished while the service worker was stopped', async () => {
    await sendMessage('queueAdd', [job(1)]);
    await vi.waitFor(() => expect(active()).toHaveLength(1));
    await finish(1, { state: 'complete' }, false); // no event delivered
    await onAlarm.trigger({ name: 'download-queue-watchdog' });
    await vi.waitFor(async () => expect((await readQueue()).jobs[0]!.state).toBe('done'));
  });

  it('pauses and cancels the underlying Chrome download', async () => {
    await sendMessage('queueAdd', [job(1), job(2)]);
    await vi.waitFor(() => expect(active()).toHaveLength(2));
    const [a, b] = (await readQueue()).jobs;
    await sendMessage('queuePause', a!.id);
    await sendMessage('queueCancel', b!.id);
    expect(fakeBrowser.downloads.pause).toHaveBeenCalledWith(1);
    expect(fakeBrowser.downloads.cancel).toHaveBeenCalledWith(2);
    expect((await readQueue()).jobs.map((j) => j.state)).toEqual(['paused', 'cancelled']);
  });

  it("never touches the user's own downloads (e.g. a saved web page)", async () => {
    await sendMessage('queueAdd', [job(1)]);
    await vi.waitFor(() => expect(active()).toHaveLength(1));
    // The user saves an HTML page in Chrome while the queue is running.
    items.set(77, { id: 77, url: 'https://example.org/page.html', state: 'complete', mime: 'text/html', bytesReceived: 5, totalBytes: 5 });
    await onChanged.trigger({ id: 77, state: { current: 'complete' } });
    await new Promise((r) => setTimeout(r, 50));
    expect(removed).toEqual([]);
    expect((await readQueue()).jobs[0]!.state).toBe('active');
  });

  it('cancels the Chrome download even when the job started a moment before', async () => {
    await sendMessage('queueAdd', [job(1)]);
    const { jobs } = await readQueue(); // may still say "queued" if pump() has not saved yet
    await sendMessage('queueCancel', jobs[0]!.id);
    await vi.waitFor(async () => expect((await readQueue()).jobs[0]!.state).toBe('cancelled'));
    const started = [...items.keys()];
    if (started.length) expect(fakeBrowser.downloads.cancel).toHaveBeenCalledWith(started[0]);
  });
});
