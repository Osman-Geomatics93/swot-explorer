import { describe, expect, it } from 'vitest';
import {
  addJobs,
  backoffMs,
  cancelJob,
  clearFinished,
  EMPTY_QUEUE,
  jobsToStart,
  markStarted,
  onFinished,
  pauseJob,
  resumeJob,
  retryJob,
  type NewJob,
  type QueueState,
} from '@/downloads/queue';

let n = 0;
const id = () => `j${++n}`;
const job = (i: number): NewJob => ({ url: `https://x/${i}.zip`, filename: `SWOT/${i}.zip`, product: 'p', granule: `g${i}`, sizeBytes: 1 });
const fresh = (count: number, concurrency = 2): QueueState =>
  addJobs({ ...EMPTY_QUEUE, concurrency }, Array.from({ length: count }, (_, i) => job(i)), 0, id).state;
const start = (s: QueueState, now = 0) => jobsToStart(s, now).reduce((acc, j, i) => markStarted(acc, j.id, 100 + i, now), s);

describe('download queue', () => {
  it('skips URLs already queued or done', () => {
    const s = fresh(2);
    const { added, state } = addJobs(s, [job(0), job(5)], 1, id);
    expect(added).toBe(1);
    expect(state.jobs).toHaveLength(3);
  });

  it('starts no more than the concurrency limit, and nothing when paused', () => {
    const s = fresh(5, 2);
    expect(jobsToStart(s, 0)).toHaveLength(2);
    expect(jobsToStart(start(s), 0)).toHaveLength(0);
    expect(jobsToStart({ ...s, paused: true }, 0)).toHaveLength(0);
  });

  it('marks a complete download done and frees a slot', () => {
    const s = onFinished(start(fresh(3)), 100, { kind: 'complete', htmlPage: false }, 1);
    expect(s.jobs[0]!.state).toBe('done');
    expect(jobsToStart(s, 1)).toHaveLength(1);
  });

  it('falls back once to the browser login when the token is refused, then fails', () => {
    let s = onFinished(start(fresh(1)), 100, { kind: 'interrupted', error: 'SERVER_FORBIDDEN' }, 1);
    expect(s.jobs[0]).toMatchObject({ state: 'queued', useToken: false, attempts: 0 });
    s = onFinished(start(s, 1), 100, { kind: 'complete', htmlPage: true }, 2); // login page again
    expect(s.jobs[0]!.state).toBe('failed');
    expect(s.jobs[0]!.error).toMatch(/login required/);
  });

  it('retries network failures with backoff, then gives up', () => {
    let s = start(fresh(1));
    for (let attempt = 1; attempt <= 2; attempt++) {
      s = onFinished(s, 100, { kind: 'interrupted', error: 'NETWORK_FAILED' }, 0);
      expect(s.jobs[0]).toMatchObject({ state: 'queued', attempts: attempt, nextAttemptAt: backoffMs(attempt) });
      expect(jobsToStart(s, 0)).toHaveLength(0); // still backing off
      s = start(s, backoffMs(attempt));
    }
    s = onFinished(s, 100, { kind: 'interrupted', error: 'NETWORK_FAILED' }, 0);
    expect(s.jobs[0]).toMatchObject({ state: 'failed', attempts: 3 });
  });

  it('treats a cancel from Chrome’s download page as cancelled', () => {
    const s = onFinished(start(fresh(1)), 100, { kind: 'interrupted', error: 'USER_CANCELED' }, 1);
    expect(s.jobs[0]!.state).toBe('cancelled');
  });

  it('pauses and resumes queued and active jobs', () => {
    let s = start(fresh(2, 1));
    const [a, q] = s.jobs;
    s = pauseJob(pauseJob(s, a!.id, 1), q!.id, 1);
    expect(s.jobs.map((j) => j.state)).toEqual(['paused', 'paused']);
    s = resumeJob(resumeJob(s, a!.id, 2), q!.id, 2);
    expect(s.jobs.map((j) => j.state)).toEqual(['active', 'queued']);
  });

  it('retries a failed job from scratch, cancels and clears', () => {
    let s = onFinished(start(fresh(2)), 100, { kind: 'interrupted', error: 'USER_CANCELED' }, 1);
    s = retryJob(s, s.jobs[0]!.id, 2);
    expect(s.jobs[0]).toMatchObject({ state: 'queued', attempts: 0, useToken: true });
    s = cancelJob(s, s.jobs[1]!.id, 3);
    s = onFinished(start(s, 3), 100, { kind: 'complete', htmlPage: false }, 4);
    s = clearFinished(s);
    expect(s.jobs).toHaveLength(0);
  });

  it('ignores events for downloads it does not track', () => {
    const s = start(fresh(1));
    expect(onFinished(s, 999, { kind: 'complete', htmlPage: false }, 1)).toBe(s);
  });
});
