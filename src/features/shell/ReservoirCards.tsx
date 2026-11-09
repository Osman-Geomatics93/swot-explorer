import { AlertCircle, ArrowDownRight, ArrowRight, ArrowUpRight, CheckCircle2, ChevronRight, Info, TriangleAlert, type LucideIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Section, Skeleton, cx } from '@/components/ui';
import { CASCADES } from '@/features/compare/CascadePanel';
import type { Reservoir } from '@/features/robust/RobustPanel';
import type { Reliability } from '@/robust/robustLevel';
import { cachedFeatureSeries } from '@/timeseries/featureSeries';
import { ageLabel, lakeOverview, type LakeOverview } from '@/timeseries/overview';

const GRADE: Record<Reliability, { label: string; icon: LucideIcon; className: string; hint: string }> = {
  good: { label: 'Consistent', icon: CheckCircle2, className: 'text-ok', hint: 'Pass-to-pass levels over the last year agree well' },
  questionable: { label: 'Questionable', icon: TriangleAlert, className: 'text-caution', hint: 'Pass-to-pass levels jump by more than half a metre' },
  unreliable: { label: 'Unreliable', icon: AlertCircle, className: 'text-error', hint: 'Levels jump by metres between passes; use Robust level' },
  insufficient: { label: 'Too few passes', icon: Info, className: 'text-ink-3', hint: 'Fewer than five passing observations in the last year' },
};

const fmtDay = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

type State = LakeOverview | { error: string } | undefined;

/** Last year's levels as a small line, with the latest pass marked. Shape only; the number beside it carries the value. */
function Sparkline({ year }: { year: LakeOverview['year'] }) {
  if (year.length < 2) return <div className="h-10 w-28" />;
  const t0 = year[0]!.t;
  const t1 = year.at(-1)!.t;
  const lo = Math.min(...year.map((p) => p.wse));
  const hi = Math.max(...year.map((p) => p.wse));
  const x = (t: number) => ((t - t0) / Math.max(1, t1 - t0)) * 100;
  const y = (v: number) => 4 + (1 - (v - lo) / Math.max(0.01, hi - lo)) * 32;
  const line = year.map((p) => `${x(p.t).toFixed(2)},${y(p.wse).toFixed(2)}`).join(' ');
  const last = year.at(-1)!;
  return (
    <div className="relative h-10 w-28 shrink-0" title={`Last 12 months: ${lo.toFixed(2)}–${hi.toFixed(2)} m`}>
      <svg aria-hidden viewBox="0 0 100 40" preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible">
        <polygon points={`0,40 ${line} 100,40`} fill="var(--accent-soft)" />
        <polyline points={line} fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      </svg>
      {/* The end dot is HTML so it stays round when the line stretches. */}
      <span
        aria-hidden
        className="absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent ring-2 ring-surface"
        style={{ left: `${x(last.t)}%`, top: `${(y(last.wse) / 40) * 100}%` }}
      />
    </div>
  );
}

function Change({ o }: { o: LakeOverview }) {
  if (o.changeM === null || !o.previous) return null;
  const steady = Math.abs(o.changeM) < 0.05;
  const Icon = steady ? ArrowRight : o.changeM > 0 ? ArrowUpRight : ArrowDownRight;
  const words = steady ? 'steady' : `${o.changeM > 0 ? '+' : '−'}${Math.abs(o.changeM).toFixed(2)} m`;
  return (
    <span className="tabular inline-flex items-center gap-1 text-ink-2" title={`Change since the previous passing observation (${fmtDay(o.previous.time)})`}>
      <Icon aria-hidden size={14} strokeWidth={2} />
      <span>
        {words} <span className="text-ink-3">since {fmtDay(o.previous.time)}</span>
      </span>
    </span>
  );
}

function ReservoirCard({ r, state, onSelect }: { r: Reservoir; state: State; onSelect: () => void }) {
  const o = state && 'latest' in state ? state : null;
  const grade = o && GRADE[o.grade];
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-label={`${r.name}${o?.latest ? `, latest level ${o.latest.wse.toFixed(2)} metres` : ''}`}
      className="group flex w-full flex-col gap-3 rounded-ui border border-line bg-surface p-4 text-left transition-[border-color,transform] duration-200 ease-signature hover:-translate-y-px hover:border-line-strong"
    >
      <span className="flex w-full items-start gap-2">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-body font-medium text-ink">{r.name}</span>
          <span className="block text-meta text-ink-3">
            {r.country}
            {r.confidence !== 'high' && <span className="text-caution"> · ID needs checking</span>}
          </span>
        </span>
        <ChevronRight
          aria-hidden
          size={16}
          strokeWidth={1.75}
          className="mt-1 shrink-0 text-ink-3 transition-transform duration-200 ease-signature group-hover:translate-x-0.5"
        />
      </span>

      {state === undefined ? (
        <span className="flex w-full flex-col gap-2" aria-label="Loading">
          <span className="flex items-end justify-between gap-3">
            <Skeleton className="h-7 w-28" />
            <Skeleton className="h-10 w-28" />
          </span>
          <Skeleton className="h-4 w-40" />
        </span>
      ) : 'error' in state ? (
        <span className="text-meta text-ink-3">Couldn't load the SWOT record. Open the reservoir to try again.</span>
      ) : !o?.latest ? (
        <span className="text-meta text-ink-3">No observation passes QC yet.</span>
      ) : (
        <>
          <span className="flex w-full items-end justify-between gap-3">
            <span className="min-w-0">
              <span className="tabular block font-display text-heading text-ink">
                {o.latest.wse.toFixed(2)}
                <span className="ml-1 font-body text-meta text-ink-3">m</span>
              </span>
              <span className="block text-meta text-ink-3">
                {fmtDay(o.latest.time)} · {ageLabel(o.ageDays!)}
              </span>
            </span>
            <Sparkline year={o.year} />
          </span>
          <span className="flex w-full flex-wrap items-center justify-between gap-x-3 gap-y-1 text-meta">
            <Change o={o} />
            {grade && (
              <span className={cx('inline-flex items-center gap-1', grade.className)} title={grade.hint}>
                <grade.icon aria-hidden size={14} strokeWidth={1.75} />
                {grade.label}
              </span>
            )}
          </span>
        </>
      )}
    </button>
  );
}

/** The whole Nile system at a glance: one card per reservoir, grouped by river, upstream first. */
export function ReservoirCards({ reservoirs, onSelect }: { reservoirs: Reservoir[]; onSelect: (id: string) => void }) {
  const [data, setData] = useState<Record<string, State>>({});

  useEffect(() => {
    let live = true;
    for (const r of reservoirs)
      cachedFeatureSeries('lakes', r.lake_id)
        .then((s) => live && setData((d) => ({ ...d, [r.id]: lakeOverview(s.points) })))
        .catch((err) => live && setData((d) => ({ ...d, [r.id]: { error: err instanceof Error ? err.message : 'failed' } })));
    return () => {
      live = false;
    };
  }, [reservoirs]);

  const byId = new Map(reservoirs.map((r) => [r.id, r]));
  const grouped = new Set<string>(CASCADES.flatMap((c) => c.reservoirs));
  const groups = [
    ...CASCADES.map((c) => ({ label: c.label, items: c.reservoirs.map((id) => byId.get(id)).filter((r): r is Reservoir => Boolean(r)) })),
    { label: 'Other', items: reservoirs.filter((r) => !grouped.has(r.id)) },
  ].filter((g) => g.items.length);

  return (
    <Section eyebrow="Nile basin" title="Reservoirs">
      <p className="text-meta text-ink-2">
        Latest SWOT water level of each reservoir (passing QC), with its last 12 months. Pick one to analyse it, or click its marker on the map.
      </p>
      <div className="@container space-y-6">
        {groups.map((g) => (
          <section key={g.label} aria-label={g.label} className="space-y-2">
            <h3 className="font-body text-eyebrow font-medium tracking-[0.08em] text-ink-3 uppercase">{g.label}</h3>
            <ul className="grid grid-cols-1 gap-3 @[34rem]:grid-cols-2">
              {g.items.map((r) => (
                <li key={r.id}>
                  <ReservoirCard r={r} state={data[r.id]} onSelect={() => onSelect(r.id)} />
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Section>
  );
}
