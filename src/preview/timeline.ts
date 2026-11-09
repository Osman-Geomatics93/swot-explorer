/**
 * Pass timeline: replay the SWOT history of the lakes and reaches already on the map. Each
 * feature's Hydrocron series is fetched once; a frame recolours every feature by its level on
 * the chosen day, so GERD filling or a release wave reaching Roseires can be watched pass by pass.
 */
import type { Feature, FeatureCollection } from 'geojson';
import type { MapPreview, PreviewKind } from '@/map/MapView';
import type { SeriesPoint } from '@/timeseries/featureSeries';

/** A level stays on the map (drawn faint) for one SWOT repeat cycle after it was measured. */
export const HOLD_DAYS = 21;
const DAY = 86_400_000;

export interface Obs {
  day: number; // UTC ms of the day
  time: string;
  wse: number;
  wse_u: number | null;
  /** Lakes: water area that day; reaches: width. */
  area_total: number | null;
  width: number | null;
  flag: number | null;
}

export type Histories = Map<string, Obs[]>;

export const historyKey = (kind: PreviewKind, id: string) => `${kind}|${id}`;
const dayOf = (iso: string) => Math.floor(Date.parse(iso) / DAY) * DAY;

/** Passing observations with a level, sorted by time. */
export function toObs(points: SeriesPoint[]): Obs[] {
  return points
    .filter((p) => p.qcPass && p.wse !== null && Number.isFinite(Date.parse(p.time)))
    .map((p) => ({ day: dayOf(p.time), time: p.time, wse: p.wse!, wse_u: p.wse_u, area_total: p.area_total, width: p.width, flag: p.flag }))
    .sort((a, b) => a.time.localeCompare(b.time));
}

/** Every day on which at least one feature was observed, oldest first. */
export function timelineDays(histories: Histories): number[] {
  return [...new Set([...histories.values()].flatMap((h) => h.map((o) => o.day)))].sort((a, b) => a - b);
}

/** The latest observation at or before `day`, if it is at most HOLD_DAYS old. */
export function obsAt(history: Obs[] | undefined, day: number): Obs | null {
  if (!history) return null;
  let found: Obs | null = null;
  for (const o of history) {
    if (o.day > day) break;
    found = o;
  }
  return found && day - found.day <= HOLD_DAYS * DAY ? found : null;
}

const FLAG_FIELD: Record<PreviewKind, string> = { lakes: 'quality_f', reaches: 'reach_q', nodes: 'node_q' };

/**
 * The preview as it looked on `day`. Features measured that day are drawn in full; features
 * last measured up to HOLD_DAYS earlier are drawn faint (qc_pass false); others have no level.
 */
export function frameAt(
  preview: MapPreview,
  histories: Histories,
  day: number,
  idOf: (kind: PreviewKind, p: Record<string, unknown>) => string,
  wseRange: [number, number] | null,
): { preview: MapPreview; observed: number; shown: number } {
  let observed = 0;
  let shown = 0;
  const layers: MapPreview['layers'] = {};
  for (const [kind, fc] of Object.entries(preview.layers) as [PreviewKind, FeatureCollection][]) {
    if (kind === 'nodes') continue; // thousands of nodes: too many histories to fetch
    layers[kind] = {
      type: 'FeatureCollection',
      features: fc.features.map((f): Feature => {
        const p = (f.properties ?? {}) as Record<string, unknown>;
        const o = obsAt(histories.get(historyKey(kind, idOf(kind, p))), day);
        if (o) shown++;
        if (o && o.day === day) observed++;
        return {
          ...f,
          properties: {
            ...p,
            wse: o?.wse ?? null,
            // Values of that day, never the loaded pass's.
            wse_u: o?.wse_u ?? null,
            ...(kind === 'lakes' ? { area_total: o?.area_total ?? null } : { width: o?.width ?? null }),
            time_str: o?.time ?? null,
            [FLAG_FIELD[kind]]: o?.flag ?? null,
            qc_pass: Boolean(o && o.day === day),
            qc_reason: o ? (o.day === day ? null : 'measured_earlier') : 'not_observed',
          },
        };
      }),
    };
  }
  return { preview: { ...preview, layers, wseRange: wseRange ?? preview.wseRange }, observed, shown };
}
