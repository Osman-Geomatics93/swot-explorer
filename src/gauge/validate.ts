/**
 * SWOT water levels against in-situ gauge readings (pure functions, unit-tested).
 *
 * Matching: the gauge series is interpolated linearly to each SWOT pass time, but only between
 * two readings close enough together (maxGapDays); passes outside the gauge record or inside a
 * gap get no pair. A date-only gauge reading is taken as the level at midday local time.
 *
 * Statistics on d = SWOT − gauge:
 *   bias          median(d): mostly the datum difference (dam datum vs SWOT's geoid heights)
 *   RMSE          √mean(d²)
 *   RMSE (bias removed), MAE (bias removed), share within ±10 / ±25 cm (boundary included): the agreement that
 *                 is not a constant offset, which is what a datum shift cannot explain
 *   r             Pearson correlation of the two level series
 * Outliers: |d − bias| > 3 × 1.4826 × MAD (robust 3σ), reported and optionally excluded.
 */
import { median, type LevelPoint } from '@/timeseries/analysis';

const DAY = 86_400_000;

export interface GaugePoint {
  /** UTC ms. */
  t: number;
  level: number;
}

/**
 * Gauge sheets carry dates without times. Each date-only value (UTC midnight of its date)
 * becomes local midday, so a pass at 10:00 local pairs with that day's reading.
 */
export function gaugePoints(raw: [number, number][], utcOffsetHours: number): GaugePoint[] {
  return raw
    .map(([t, level]) => ({ t: t % DAY === 0 ? t + (12 - utcOffsetHours) * 3_600_000 : t - utcOffsetHours * 3_600_000, level }))
    .sort((a, b) => a.t - b.t);
}

/** 1.5 × the usual spacing of readings, at least 1.5 days: consecutive daily readings pair, gaps do not. */
export function defaultMaxGapDays(points: GaugePoint[]): number {
  const steps = points
    .slice(1)
    .map((p, i) => (p.t - points[i]!.t) / DAY)
    .sort((a, b) => a - b);
  return Math.max(1.5, 1.5 * (steps[steps.length >> 1] ?? 1));
}

/** Gauge level at time t, or null when t is outside the record or inside a gap. */
export function interpolateGauge(points: GaugePoint[], t: number, maxGapDays: number): { level: number; gapDays: number } | null {
  let lo = 0;
  let hi = points.length - 1;
  if (hi < 0 || t < points[0]!.t - DAY / 2 || t > points[hi]!.t + DAY / 2) return null;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (points[mid]!.t <= t) lo = mid;
    else hi = mid;
  }
  const [a, b] = [points[lo]!, points[hi]!];
  // Within half a day of the first or last reading: that reading stands for its day.
  if (t <= a.t || lo === hi) return { level: a.level, gapDays: 0 };
  if (t >= b.t) return { level: b.level, gapDays: 0 };
  const gapDays = (b.t - a.t) / DAY;
  if (gapDays > maxGapDays) return null;
  return { level: a.level + ((b.level - a.level) * (t - a.t)) / (b.t - a.t), gapDays };
}

export interface ValidationPair {
  time: string;
  swot: number;
  gauge: number;
  /** SWOT − gauge, m. */
  diff: number;
  /** Spacing of the two gauge readings used, days (0 = a reading on the day itself). */
  gapDays: number;
  outlier: boolean;
}

export interface ValidationStats {
  n: number;
  start: string | null;
  end: string | null;
  bias: number | null;
  meanBias: number | null;
  rmse: number | null;
  rmseUnbiased: number | null;
  maeUnbiased: number | null;
  r: number | null;
  within10: number | null;
  within25: number | null;
}

export interface Validation {
  pairs: ValidationPair[];
  /** SWOT passes with no gauge reading close enough. */
  unmatched: number;
  outliers: number;
  /** Statistics over the pairs actually used (all, or all but outliers). */
  stats: ValidationStats;
}

export function stats(pairs: Pick<ValidationPair, 'time' | 'swot' | 'gauge' | 'diff'>[]): ValidationStats {
  const n = pairs.length;
  if (!n) return { n, start: null, end: null, bias: null, meanBias: null, rmse: null, rmseUnbiased: null, maeUnbiased: null, r: null, within10: null, within25: null };
  const d = pairs.map((p) => p.diff);
  const bias = median(d);
  const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
  const u = d.map((x) => x - bias);
  const [ms, mg] = [mean(pairs.map((p) => p.swot)), mean(pairs.map((p) => p.gauge))];
  let [sxy, sxx, syy] = [0, 0, 0];
  for (const p of pairs) {
    sxy += (p.swot - ms) * (p.gauge - mg);
    sxx += (p.swot - ms) ** 2;
    syy += (p.gauge - mg) ** 2;
  }
  const times = pairs.map((p) => p.time).sort();
  return {
    n,
    start: times[0]!,
    end: times[n - 1]!,
    bias,
    meanBias: mean(d),
    rmse: Math.sqrt(mean(d.map((x) => x * x))),
    rmseUnbiased: Math.sqrt(mean(u.map((x) => x * x))),
    maeUnbiased: mean(u.map(Math.abs)),
    r: n > 2 && sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : null,
    within10: u.filter((x) => Math.abs(x) <= 0.1 + 1e-9).length / n,
    within25: u.filter((x) => Math.abs(x) <= 0.25 + 1e-9).length / n,
  };
}

export function validateAgainstGauge(swot: LevelPoint[], gauge: GaugePoint[], opts: { maxGapDays: number; excludeOutliers: boolean }): Validation {
  const pairs: ValidationPair[] = [];
  let unmatched = 0;
  for (const s of swot) {
    const g = interpolateGauge(gauge, Date.parse(s.time), opts.maxGapDays);
    if (!g) {
      unmatched++;
      continue;
    }
    pairs.push({ time: s.time, swot: s.wse, gauge: g.level, diff: s.wse - g.level, gapDays: g.gapDays, outlier: false });
  }
  if (pairs.length >= 5) {
    const b = median(pairs.map((p) => p.diff));
    const sigma = 1.4826 * median(pairs.map((p) => Math.abs(p.diff - b)));
    if (sigma > 0) for (const p of pairs) p.outlier = Math.abs(p.diff - b) > 3 * sigma;
  }
  const outliers = pairs.filter((p) => p.outlier).length;
  return { pairs, unmatched, outliers, stats: stats(opts.excludeOutliers ? pairs.filter((p) => !p.outlier) : pairs) };
}
