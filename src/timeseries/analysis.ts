/**
 * Analyses on a feature's time series (pure functions, unit-tested):
 *  - comparison with an independent altimetry series (bias, RMSE on matched dates);
 *  - area-elevation fit and storage change for lakes and reservoirs.
 */

export interface LevelPoint {
  time: string; // ISO
  wse: number;
}

const DAY = 86_400_000;

export const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

/* --------------------------------------------------------------- comparison */

export interface Comparison {
  pairs: { time: string; swot: number; other: number; days: number }[];
  n: number;
  /** median(SWOT − other), m: a constant offset is usually a datum/geoid difference. */
  bias: number | null;
  /** RMSE after removing the bias, m: the disagreement that is not a constant offset. */
  rmseUnbiased: number | null;
  rmse: number | null;
}

/** Pair each SWOT observation with the closest independent observation within maxDays. */
export function compareSeries(swot: LevelPoint[], other: LevelPoint[], maxDays = 3): Comparison {
  const others = other.map((o) => ({ ...o, t: Date.parse(o.time) })).sort((a, b) => a.t - b.t);
  const pairs: Comparison['pairs'] = [];
  for (const s of swot) {
    const t = Date.parse(s.time);
    let best: (typeof others)[number] | null = null;
    for (const o of others) if (!best || Math.abs(o.t - t) < Math.abs(best.t - t)) best = o;
    if (best && Math.abs(best.t - t) <= maxDays * DAY) pairs.push({ time: s.time, swot: s.wse, other: best.wse, days: Math.abs(best.t - t) / DAY });
  }
  if (!pairs.length) return { pairs, n: 0, bias: null, rmse: null, rmseUnbiased: null };
  const diffs = pairs.map((p) => p.swot - p.other);
  const bias = median(diffs);
  const rms = (xs: number[]) => Math.sqrt(xs.reduce((s, x) => s + x * x, 0) / xs.length);
  return { pairs, n: pairs.length, bias, rmse: rms(diffs), rmseUnbiased: rms(diffs.map((d) => d - bias)) };
}

/* ------------------------------------------------------------ storage change */

/** Fewer full-coverage passes than this and the area–level fit is not attempted. */
export const MIN_FULL_PASSES = 8;

export interface AreaLevelFit {
  /** area (km²) = intercept + slope · level (m); slope in km² per m. */
  intercept: number;
  slope: number;
  r2: number;
  n: number;
  /** Lowest observed level, the reference for storage change. */
  h0: number;
  /** A positive slope is required: area must grow with level. */
  physical: boolean;
}

/**
 * Theil–Sen line (median of pairwise slopes): robust to the partial-coverage passes and
 * outliers common in SWOT lake areas, where least squares would be pulled off.
 */
export function fitAreaLevel(points: { wse: number; area: number }[]): AreaLevelFit | null {
  const p = points.filter((x) => Number.isFinite(x.wse) && Number.isFinite(x.area) && x.area > 0);
  if (p.length < 5) return null;
  const slopes: number[] = [];
  for (let i = 0; i < p.length; i++)
    for (let j = i + 1; j < p.length; j++) {
      const dh = p[j]!.wse - p[i]!.wse;
      if (Math.abs(dh) > 1e-6) slopes.push((p[j]!.area - p[i]!.area) / dh);
    }
  if (!slopes.length) return null;
  const slope = median(slopes);
  const intercept = median(p.map((x) => x.area - slope * x.wse));
  const mean = p.reduce((s, x) => s + x.area, 0) / p.length;
  const ssTot = p.reduce((s, x) => s + (x.area - mean) ** 2, 0);
  const ssRes = p.reduce((s, x) => s + (x.area - (intercept + slope * x.wse)) ** 2, 0);
  return {
    intercept,
    slope,
    r2: ssTot > 0 ? 1 - ssRes / ssTot : 0,
    n: p.length,
    h0: Math.min(...p.map((x) => x.wse)),
    physical: slope > 0,
  };
}

/**
 * Storage above the reference level h0, in million m³ (MCM):
 * ΔV = ∫_{h0}^{h} A(z) dz = a(h − h0) + b/2 (h² − h0²), with A in km² and h in m (km²·m = 10⁶ m³).
 */
export function storageChangeMcm(h: number, fit: Pick<AreaLevelFit, 'intercept' | 'slope' | 'h0'>): number {
  const { intercept: a, slope: b, h0 } = fit;
  return a * (h - h0) + (b / 2) * (h * h - h0 * h0);
}
