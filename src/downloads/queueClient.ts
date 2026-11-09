/** Page-side access to the background download queue. */
import { useEffect, useState } from 'react';
import { sendMessage } from '@/messaging/protocol';
import { EMPTY_QUEUE, QUEUE_KEY, type NewJob, type QueueState } from './queue';

export function useQueue(): QueueState {
  const [state, setState] = useState<QueueState>(EMPTY_QUEUE);
  useEffect(() => {
    void browser.storage.local.get(QUEUE_KEY).then((r) => setState((r[QUEUE_KEY] as QueueState) ?? EMPTY_QUEUE));
    const listener = (changes: Record<string, { newValue?: unknown }>, area: string) => {
      if (area === 'local' && QUEUE_KEY in changes) setState((changes[QUEUE_KEY]!.newValue as QueueState) ?? EMPTY_QUEUE);
    };
    browser.storage.onChanged.addListener(listener);
    return () => browser.storage.onChanged.removeListener(listener);
  }, []);
  return state;
}

/** Live byte counts for running downloads (polled while the page is open). */
export function useDownloadProgress(downloadIds: number[]): Map<number, { received: number; total: number }> {
  const [progress, setProgress] = useState(new Map<number, { received: number; total: number }>());
  const key = downloadIds.join(',');
  useEffect(() => {
    if (!downloadIds.length) return;
    const tick = async () => {
      const items = await Promise.all(downloadIds.map((id) => browser.downloads.search({ id })));
      setProgress(new Map(items.flat().map((i) => [i.id, { received: i.bytesReceived, total: i.totalBytes }])));
    };
    void tick();
    const timer = setInterval(() => void tick(), 1000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return progress;
}

export const queue = {
  add: (jobs: NewJob[]) => sendMessage('queueAdd', jobs),
  pause: (id: string) => sendMessage('queuePause', id),
  resume: (id: string) => sendMessage('queueResume', id),
  retry: (id: string) => sendMessage('queueRetry', id),
  cancel: (id: string) => sendMessage('queueCancel', id),
  clearFinished: () => sendMessage('queueClearFinished', undefined),
  setPaused: (paused: boolean) => sendMessage('queueSetPaused', paused),
  setConcurrency: (n: number) => sendMessage('queueSetConcurrency', n),
};
