import { Download, Pause, Play, RotateCcw, X } from 'lucide-react';
import { Button, Empty, IconButton, Notice, Progress, Section, Select, cx } from '@/components/ui';
import { queue, useDownloadProgress, useQueue } from '@/downloads/queueClient';
import { summarize, type Job } from '@/downloads/queue';
import { fmtSize } from '@/lib/format';

const STATE: Record<Job['state'], { label: string; className: string }> = {
  queued: { label: 'Queued', className: 'text-ink-3' },
  active: { label: 'Downloading', className: 'text-accent' },
  paused: { label: 'Paused', className: 'text-caution' },
  done: { label: 'Done', className: 'text-ok' },
  failed: { label: 'Failed', className: 'text-error' },
  cancelled: { label: 'Cancelled', className: 'text-ink-3' },
};

export function DownloadsPanel() {
  const state = useQueue();
  const counts = summarize(state);
  const progress = useDownloadProgress(state.jobs.filter((j) => j.state === 'active' && j.downloadId !== undefined).map((j) => j.downloadId!));
  const totalBytes = state.jobs.reduce((s, j) => s + (j.sizeBytes ?? 0), 0);
  const doneBytes = state.jobs.reduce((s, j) => {
    if (j.state === 'done') return s + (j.sizeBytes ?? 0);
    const p = j.downloadId !== undefined ? progress.get(j.downloadId) : undefined;
    return s + (j.state === 'active' && p ? p.received : 0);
  }, 0);

  const summary = [
    counts.active && `${counts.active} downloading`,
    counts.queued && `${counts.queued} queued`,
    counts.done && `${counts.done} done`,
    counts.failed && `${counts.failed} failed`,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <Section eyebrow="Runs in the background" title="Downloads">
      {state.jobs.length === 0 ? (
        <Empty icon={Download}>
          <p>Nothing queued yet. Search for data and choose Download. Files keep downloading after you close this page.</p>
        </Empty>
      ) : (
        <>
          <div className="space-y-4">
            <p className="tabular text-body text-ink" aria-live="polite">
              {summary}
            </p>
            {totalBytes > 0 && <Progress value={doneBytes} max={totalBytes} label={`${fmtSize(doneBytes)} of ${fmtSize(totalBytes)}`} />}
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <Button icon={state.paused ? Play : Pause} onClick={() => void queue.setPaused(!state.paused)}>
              {state.paused ? 'Resume queue' : 'Pause queue'}
            </Button>
            <Button variant="ghost" onClick={() => void queue.clearFinished()}>
              Clear finished
            </Button>
            <label className="ml-auto flex items-center gap-2 text-meta text-ink-2">
              At once
              <Select value={state.concurrency} onChange={(e) => void queue.setConcurrency(Number(e.target.value))} className="w-20">
                {[1, 2, 3, 4, 5, 6].map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </Select>
            </label>
          </div>
          {state.paused && <Notice tone="warning">Queue paused. Running downloads finish; no new ones start.</Notice>}

          <ul className="divide-y divide-line border-y border-line">
            {[...state.jobs].reverse().map((j) => {
              const p = j.downloadId !== undefined ? progress.get(j.downloadId) : undefined;
              const pct = j.state === 'active' && p?.total ? Math.round((100 * p.received) / p.total) : null;
              return (
                <li key={j.id} className="space-y-2 py-3">
                  <div className="flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-meta text-ink" title={j.filename}>
                        {j.filename.split('/').pop()}
                      </p>
                      <p className="tabular text-meta">
                        <span className={STATE[j.state].className}>{pct !== null ? `${pct}%` : STATE[j.state].label}</span>
                        <span className="text-ink-3">{j.sizeBytes ? ` · ${fmtSize(j.sizeBytes)}` : ''}</span>
                      </p>
                    </div>
                    <div className="flex">
                      {(j.state === 'queued' || j.state === 'active') && <IconButton icon={Pause} label="Pause" onClick={() => void queue.pause(j.id)} />}
                      {j.state === 'paused' && <IconButton icon={Play} label="Resume" onClick={() => void queue.resume(j.id)} />}
                      {(j.state === 'failed' || j.state === 'cancelled') && <IconButton icon={RotateCcw} label="Retry" onClick={() => void queue.retry(j.id)} />}
                      {(j.state === 'queued' || j.state === 'active' || j.state === 'paused') && (
                        <IconButton icon={X} label="Cancel" tone="danger" onClick={() => void queue.cancel(j.id)} />
                      )}
                    </div>
                  </div>
                  {pct !== null && <Progress value={pct} max={100} />}
                  {j.error && <p className={cx('text-meta', j.state === 'failed' ? 'text-error' : 'text-ink-2')}>{j.error}</p>}
                  {!j.useToken && j.state !== 'failed' && <p className="text-meta text-ink-2">Using your browser’s Earthdata login; the token was refused.</p>}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </Section>
  );
}
