import { defineExtensionMessaging } from '@webext-core/messaging';
import type { NewJob } from '@/downloads/queue';

/** Commands pages send to the background download queue. The queue state itself is read from storage. */
interface ProtocolMap {
  queueAdd(jobs: NewJob[]): number;
  queuePause(id: string): void;
  queueResume(id: string): void;
  queueRetry(id: string): void;
  queueCancel(id: string): void;
  queueClearFinished(): void;
  queueSetPaused(paused: boolean): void;
  queueSetConcurrency(n: number): void;
}

export const { sendMessage, onMessage } = defineExtensionMessaging<ProtocolMap>();
