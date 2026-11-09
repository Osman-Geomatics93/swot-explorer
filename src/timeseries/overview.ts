/** Headline numbers for a reservoir card: latest level, change since the pass before, last year's trend. */
import { gradeReliability, type Reliability } from '@/robust/robustLevel';
import type { SeriesPoint } from './featureSeries';

const DAY = 86_400_000;

export interface LakeOverview {
  latest: { time: string; wse: number } | null;
  previous: { time: string; wse: number } | null;
  /** Latest minus previous, m. */
  changeM: number | null;
  /** Days since the latest passing observation. */
  ageDays: number | null;
  /** Passing levels of the year before the latest pass, for the sparkline. */
  year: { t: number; wse: number }[];
  /** How consistent last year's pass-to-pass levels are (robustLevel.gradeReliability). */
  grade: Reliability;
  /** Share of last year's observations that pass QC. */
  qcShare: number | null;
}

export function lakeOverview(points: SeriesPoint[], now = Date.now()): LakeOverview {
  const passing = points
    .filter((p) => p.qcPass && p.wse !== null)
    .map((p) => ({ time: p.time, t: Date.parse(p.time), wse: p.wse! }))
    .filter((p) => Number.isFinite(p.t))
    .sort((a, b) => a.t - b.t);
  const latest = passing.at(-1) ?? null;
  const previous = passing.at(-2) ?? null;
  const from = (latest?.t ?? now) - 365 * DAY;
  const year = passing.filter((p) => p.t >= from).map(({ t, wse }) => ({ t, wse }));
  const observedYear = points.filter((p) => Date.parse(p.time) >= from && p.wse !== null).length;
  return {
    latest: latest && { time: latest.time, wse: latest.wse },
    previous: previous && { time: previous.time, wse: previous.wse },
    changeM: latest && previous ? latest.wse - previous.wse : null,
    ageDays: latest ? Math.max(0, Math.floor((now - latest.t) / DAY)) : null,
    year,
    grade: gradeReliability(year.map((p) => p.wse)).reliability,
    qcShare: observedYear ? year.length / observedYear : null,
  };
}

const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

/** "today", "yesterday", "5 days ago", "3 weeks ago". */
export function ageLabel(days: number): string {
  if (days < 14) return rtf.format(-days, 'day');
  if (days < 60) return rtf.format(-Math.round(days / 7), 'week');
  return rtf.format(-Math.round(days / 30), 'month');
}
