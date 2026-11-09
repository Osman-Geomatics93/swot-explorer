/**
 * Robust reservoir level from LakeSP_obs pieces.
 *
 * SWOT can observe one reservoir as several pieces per pass, each with its own
 * height. Per pass (granule):
 *   1. drop duplicate reprocessed granules (keep the latest CRID/counter);
 *   2. apply the QC rule to each piece and drop pieces smaller than minAreaKm2;
 *   3. area-weighted median of the remaining pieces → first estimate m0;
 *   4. drop pieces further than k·σ from m0, σ = max(1.4826·MAD, sigmaFloorM);
 *   5. area-weighted median of the kept pieces → robust WSE for that pass.
 * Over time:
 *   6. Hampel filter flags spikes (|wse − rolling median| > k·σ_local);
 *   7. a reliability grade from the size of jumps between consecutive passes.
 *
 * Step 7 matters: if the pieces themselves are wrong (as at GERD, where even the
 * best pieces jump ~7 m between 21-day cycles), no aggregation can fix it, and
 * the series is graded "unreliable" rather than silently smoothed.
 */

import { DEFAULT_QC_RULE, evaluateQc, type QcRule } from '@/qc/qualityControl';

export interface ObsPiece {
  granule: string;
  cycle: string;
  pass: string;
  time_str: string;
  obs_id?: string;
  wse: number | string;
  wse_u: number | string;
  quality_f: number | string;
  area_total: number | string;
}

export interface RobustOptions {
  qc: QcRule;
  minAreaKm2: number;
  k: number;
  sigmaFloorM: number;
  hampelWindow: number; // observations on each side
  hampelFloorM: number;
}

export const DEFAULT_ROBUST_OPTIONS: RobustOptions = {
  qc: DEFAULT_QC_RULE,
  minAreaKm2: 1,
  k: 3,
  sigmaFloorM: 0.25,
  hampelWindow: 3,
  hampelFloorM: 0.5,
};

export interface PassLevel {
  time_str: string;
  cycle: string;
  pass: string;
  granule: string;
  wse: number;
  /** Area-weighted spread of the kept pieces (m). */
  spread_m: number;
  area_used_km2: number;
  n_pieces: number;
  n_qc: number;
  n_kept: number;
  kept_obs_ids: string[];
  spike: boolean;
}

export type Reliability = 'good' | 'questionable' | 'unreliable' | 'insufficient';

export interface RobustResult {
  levels: PassLevel[];
  duplicatesRemoved: number;
  passesWithoutData: number;
  reliability: Reliability;
  medianJumpM: number | null;
  p90JumpM: number | null;
}

const num = (v: number | string) => (typeof v === 'number' ? v : Number(v));

/** Granule names differ only in CRID/counter for reprocessed files; the lexicographic max is the newest. */
export function dedupeGranules<T extends Pick<ObsPiece, 'granule' | 'cycle' | 'pass'>>(pieces: T[]): { pieces: T[]; removed: number } {
  const latest = new Map<string, string>();
  for (const p of pieces) {
    const key = `${p.cycle}_${p.pass}`;
    const cur = latest.get(key);
    if (!cur || p.granule > cur) latest.set(key, p.granule);
  }
  const granules = new Set(pieces.map((p) => p.granule));
  return {
    pieces: pieces.filter((p) => latest.get(`${p.cycle}_${p.pass}`) === p.granule),
    removed: granules.size - latest.size,
  };
}

export function weightedMedian(values: { v: number; w: number }[]): number {
  const sorted = [...values].sort((a, b) => a.v - b.v);
  const total = sorted.reduce((s, x) => s + x.w, 0);
  let acc = 0;
  for (const x of sorted) {
    acc += x.w;
    if (acc >= total / 2) return x.v;
  }
  return sorted[sorted.length - 1]!.v;
}

export function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

const mad = (xs: number[]) => {
  const m = median(xs);
  return median(xs.map((x) => Math.abs(x - m)));
};

export function passLevel(pieces: ObsPiece[], o: RobustOptions): Omit<PassLevel, 'spike'> | null {
  const first = pieces[0];
  if (!first) return null;
  const good = pieces.filter((p) => evaluateQc(p, 'lake', o.qc).pass && num(p.area_total) >= o.minAreaKm2);
  if (!good.length) return null;

  const vals = good.map((p) => ({ v: num(p.wse), w: num(p.area_total), id: p.obs_id ?? '' }));
  const m0 = weightedMedian(vals);
  const sigma = Math.max(1.4826 * mad(vals.map((x) => x.v)), o.sigmaFloorM);
  const kept = vals.filter((x) => Math.abs(x.v - m0) <= o.k * sigma);
  const wse = weightedMedian(kept);
  const area = kept.reduce((s, x) => s + x.w, 0);
  const spread = Math.sqrt(kept.reduce((s, x) => s + x.w * (x.v - wse) ** 2, 0) / area);

  return {
    time_str: first.time_str,
    cycle: first.cycle,
    pass: first.pass,
    granule: first.granule,
    wse,
    spread_m: spread,
    area_used_km2: area,
    n_pieces: pieces.length,
    n_qc: good.length,
    n_kept: kept.length,
    kept_obs_ids: kept.map((x) => x.id),
  };
}

/** Flag points far from the rolling median of their neighbours (Hampel filter). */
export function hampelFlags(values: number[], window: number, floor: number, k: number): boolean[] {
  return values.map((v, i) => {
    const neighbours = values.slice(Math.max(0, i - window), i + window + 1);
    if (neighbours.length < 3) return false;
    const m = median(neighbours);
    const s = Math.max(1.4826 * mad(neighbours), floor);
    return Math.abs(v - m) > k * s;
  });
}

export function gradeReliability(wse: number[]): Pick<RobustResult, 'reliability' | 'medianJumpM' | 'p90JumpM'> {
  if (wse.length < 5) return { reliability: 'insufficient', medianJumpM: null, p90JumpM: null };
  const jumps = wse.slice(1).map((v, i) => Math.abs(v - wse[i]!)).sort((a, b) => a - b);
  const medianJumpM = median(jumps);
  const p90JumpM = jumps[Math.floor(0.9 * (jumps.length - 1))]!;
  // Calibrated on Hydrocron series after QC (2023-2026): Victoria, Roseires, Sennar and
  // Aswan have median jumps <= 0.26 m and p90 <= 1 m; GERD has a median of ~7 m.
  const reliability: Reliability =
    medianJumpM <= 0.5 && p90JumpM <= 2 ? 'good' : medianJumpM <= 2 ? 'questionable' : 'unreliable';
  return { reliability, medianJumpM, p90JumpM };
}

export function robustLevels(allPieces: ObsPiece[], options: Partial<RobustOptions> = {}): RobustResult {
  const o = { ...DEFAULT_ROBUST_OPTIONS, ...options };
  const { pieces, removed } = dedupeGranules(allPieces);

  const byGranule = new Map<string, ObsPiece[]>();
  for (const p of pieces) byGranule.set(p.granule, [...(byGranule.get(p.granule) ?? []), p]);

  const levels: Omit<PassLevel, 'spike'>[] = [];
  let empty = 0;
  for (const group of byGranule.values()) {
    const level = passLevel(group, o);
    if (level) levels.push(level);
    else empty++;
  }
  levels.sort((a, b) => a.time_str.localeCompare(b.time_str));

  const flags = hampelFlags(levels.map((l) => l.wse), o.hampelWindow, o.hampelFloorM, o.k);
  const withFlags = levels.map((l, i) => ({ ...l, spike: flags[i]! }));
  const grade = gradeReliability(withFlags.filter((l) => !l.spike).map((l) => l.wse));

  return { levels: withFlags, duplicatesRemoved: removed, passesWithoutData: empty, ...grade };
}
