/**
 * Symbology of the SWOT preview layers, shared by the map and its legend so they always agree.
 *
 * Water level is a magnitude: one hue, light → dark (darker = higher water), from the validated
 * sequential blue ramp (dataviz palette, steps 100/250/400/550/700). Quality flags are states:
 * the fixed status palette, always shown with a label. Colours sit on satellite imagery, so they
 * are CSS tokens (--map-seq-*, --map-q-*) read at draw time.
 */

export const LEVEL_TOKENS = ['map-seq-1', 'map-seq-2', 'map-seq-3', 'map-seq-4', 'map-seq-5'] as const;

export const QUALITY_CLASSES = [
  { code: 0, label: 'Good', token: 'map-q-good' },
  { code: 1, label: 'Suspect', token: 'map-q-suspect' },
  { code: 2, label: 'Degraded', token: 'map-q-degraded' },
  { code: 3, label: 'Bad', token: 'map-q-bad' },
] as const;

/** Features with no height or no flag. */
export const NO_DATA_TOKEN = 'map-rejected';

/** Evenly spaced stops across the colour range, one per ramp step. */
export function levelStops([lo, hi]: [number, number]): number[] {
  const top = hi > lo ? hi : lo + 1;
  return LEVEL_TOKENS.map((_, i) => lo + ((top - lo) * i) / (LEVEL_TOKENS.length - 1));
}

/** The SWOT quality flag of a lake, reach or node (each product names it differently). */
export function qualityOf(p: Record<string, unknown> | null | undefined): number | null {
  for (const k of ['reach_q', 'node_q', 'quality_f']) {
    const v = p?.[k];
    if (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 3) return v;
  }
  return null;
}

export interface LevelRange {
  /** Range the colours span: 2nd–98th percentile, so one outlier does not wash out the rest. */
  range: [number, number];
  /** Full min–max of the levels. */
  full: [number, number];
}

export function levelRange(values: number[]): LevelRange | null {
  const nums = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!nums.length) return null;
  return {
    range: [nums[Math.floor(nums.length * 0.02)]!, nums[Math.ceil(nums.length * 0.98) - 1]!],
    full: [nums[0]!, nums[nums.length - 1]!],
  };
}

/** "423.1 m", or "407.7–423.1 m" when the levels differ. */
export function fmtLevels(min: number, max: number): string {
  return Math.abs(max - min) < 0.05 ? `${min.toFixed(1)} m` : `${min.toFixed(1)}–${max.toFixed(1)} m`;
}
