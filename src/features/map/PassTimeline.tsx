import { History, Pause, Play, SkipBack, SkipForward, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { IconButton, Progress, cx } from '@/components/ui';
import type { MapPreview, PreviewKind } from '@/map/MapView';
import { LEVEL_TOKENS, levelRange } from '@/map/symbology';
import { frameAt, historyKey, HOLD_DAYS, timelineDays, toObs, type Histories } from '@/preview/timeline';
import { cachedFeatureSeries, idOf } from '@/timeseries/featureSeries';

/** Features whose history is fetched; beyond this the timeline would take minutes to load. */
const MAX_FEATURES = 80;
const STEP_MS = 900;
const FLOAT = 'rounded-ui border border-line bg-surface/95 shadow-float backdrop-blur-md';

const fmtDay = (ms: number) => new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

interface Props {
  /** The pass on the map (from Preview). */
  preview: MapPreview | undefined;
  /** A frame to draw instead of the pass, or null to go back to it. The label names the day. */
  onFrame: (frame: MapPreview | null, label: string | null) => void;
}

/** Replay the SWOT history of the previewed lakes and reaches, pass by pass, on the map. */
export function PassTimeline({ preview, onFrame }: Props) {
  const [open, setOpen] = useState(false);
  const [histories, setHistories] = useState<Histories | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const run = useRef(0);

  // New features on the map: start over.
  useEffect(() => {
    run.current++;
    setOpen(false);
    setHistories(null);
    setPlaying(false);
    setProgress(null);
    onFrame(null, null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview?.layers]);

  const targets = useMemo(() => {
    if (!preview) return [];
    const ids: { kind: PreviewKind; id: string }[] = [];
    for (const kind of ['lakes', 'reaches'] as const)
      for (const f of preview.layers[kind]?.features ?? []) {
        const id = idOf(kind, (f.properties ?? {}) as Record<string, unknown>);
        if (id && !ids.some((x) => x.kind === kind && x.id === id)) ids.push({ kind, id });
      }
    return ids.slice(0, MAX_FEATURES);
  }, [preview?.layers]);

  const days = useMemo(() => (histories ? timelineDays(histories) : []), [histories]);
  // One colour scale for the whole history, so a colour means the same level on every day.
  const range = useMemo(() => (histories ? (levelRange([...histories.values()].flat().map((o) => o.wse))?.range ?? null) : null), [histories]);
  const day = days[Math.min(index, days.length - 1)];

  const frame = useMemo(
    () => (preview && histories && day !== undefined ? frameAt(preview, histories, day, idOf, range) : null),
    [preview, histories, day, range],
  );

  useEffect(() => {
    if (open && frame && day !== undefined) onFrame(frame.preview, fmtDay(day));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, frame]);

  useEffect(() => {
    if (!playing) return;
    if (index >= days.length - 1) return setPlaying(false);
    const t = setTimeout(() => setIndex((i) => i + 1), STEP_MS);
    return () => clearTimeout(t);
  }, [playing, index, days.length]);

  const start = async () => {
    setOpen(true);
    if (histories) return;
    const id = ++run.current;
    const found: Histories = new Map();
    setProgress({ done: 0, total: targets.length });
    let next = 0;
    let done = 0;
    // Six requests at a time: quick, and gentle on Hydrocron.
    const worker = async () => {
      while (next < targets.length && run.current === id) {
        const t = targets[next++]!;
        try {
          found.set(historyKey(t.kind, t.id), toObs((await cachedFeatureSeries(t.kind, t.id)).points));
        } catch {
          // A feature without history just stays grey.
        }
        if (run.current === id) setProgress({ done: ++done, total: targets.length });
      }
    };
    await Promise.all(Array.from({ length: 6 }, worker));
    if (run.current !== id) return;
    setProgress(null);
    setHistories(found);
    setIndex(Math.max(0, timelineDays(found).length - 1));
  };

  const close = () => {
    setPlaying(false);
    setOpen(false);
    onFrame(null, null);
  };

  if (!preview || !targets.length) return null;

  if (!open)
    return (
      <div className="pointer-events-none absolute inset-x-3 bottom-10 z-20 flex justify-center">
        <button
          type="button"
          onClick={() => void start()}
          title="Replay the SWOT history of the lakes and reaches on the map"
          className={cx(FLOAT, 'pointer-events-auto inline-flex h-10 items-center gap-2 px-4 text-meta font-medium text-ink transition-colors duration-200 ease-signature hover:bg-surface')}
        >
          <History aria-hidden size={16} strokeWidth={1.75} className="text-accent" />
          Pass history
        </button>
      </div>
    );

  const togglePlay = () => {
    if (!playing && index >= days.length - 1) setIndex(0);
    setPlaying((p) => !p);
  };

  return (
    <div
      role="region"
      aria-label="Pass history"
      className={cx(FLOAT, 'absolute bottom-10 left-1/2 z-20 w-[min(36rem,calc(100%-1.5rem))] -translate-x-1/2 space-y-2 p-3')}
    >
      {progress ? (
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <Progress value={progress.done} max={progress.total} label={`Loading the SWOT history of ${progress.total} features… ${progress.done} of ${progress.total}`} />
          </div>
          <IconButton icon={X} label="Close pass history" onClick={close} />
        </div>
      ) : !days.length ? (
        <div className="flex items-center gap-3">
          <p className="flex-1 text-meta text-ink-2">These features have no passing observations to replay.</p>
          <IconButton icon={X} label="Close pass history" onClick={close} />
        </div>
      ) : (
        <>
          <div className="flex items-center gap-1">
            <IconButton icon={SkipBack} label="Previous pass" disabled={index === 0} className="disabled:opacity-30" onClick={() => setIndex((i) => Math.max(0, i - 1))} />
            <IconButton icon={playing ? Pause : Play} label={playing ? 'Pause' : 'Play through the passes'} pressed={playing} onClick={togglePlay} />
            <IconButton
              icon={SkipForward}
              label="Next pass"
              disabled={index >= days.length - 1}
              className="disabled:opacity-30"
              onClick={() => setIndex((i) => Math.min(days.length - 1, i + 1))}
            />
            <div className="min-w-0 flex-1 px-2" aria-live="polite">
              <p className="tabular truncate text-body font-medium text-ink">{fmtDay(day!)}</p>
              <p className="tabular truncate text-meta text-ink-3">
                {frame?.observed ?? 0} of {targets.length} measured this day · pass {index + 1} of {days.length}
              </p>
            </div>
            <IconButton icon={X} label="Close pass history" onClick={close} />
          </div>
          <input
            type="range"
            className="timeline-range"
            min={0}
            max={days.length - 1}
            value={index}
            aria-label="Day"
            aria-valuetext={fmtDay(day!)}
            onChange={(e) => {
              setPlaying(false);
              setIndex(Number(e.target.value));
            }}
          />
          <div className="tabular flex justify-between text-eyebrow text-ink-3">
            <span>{fmtDay(days[0]!)}</span>
            {preview.colorBy === 'wse' && range && (
              <span className="flex items-center gap-2">
                {range[0].toFixed(1)}
                <span
                  aria-hidden
                  className="h-2 w-20 rounded-ui"
                  style={{ background: `linear-gradient(90deg, ${LEVEL_TOKENS.map((t) => `var(--${t})`).join(', ')})` }}
                />
                {range[1].toFixed(1)} m
              </span>
            )}
            <span>{fmtDay(days.at(-1)!)}</span>
          </div>
          <p className="text-eyebrow text-ink-3">
            Full colour: measured this day · faint: last measured up to {HOLD_DAYS} days before · grey: no level. Passing QC only
            {targets.length >= MAX_FEATURES ? `; first ${MAX_FEATURES} features` : ''}.
          </p>
        </>
      )}
    </div>
  );
}
