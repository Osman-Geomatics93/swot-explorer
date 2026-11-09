/**
 * Full SWOT history of one lake, reach or node from Hydrocron (no file download).
 * Fill values become null, the QC rule is evaluated per observation, and units come
 * from Hydrocron's own *_units columns.
 */
import { getTimeseries, type HydrocronFeature } from '@/api/hydrocron';
import { isFill } from '@/clip/fieldMeta';
import type { PreviewKind } from '@/map/MapView';
import { evaluateQc, type FeatureKind, type QcReason } from '@/qc/qualityControl';

export type Metric = 'wse' | 'area_total' | 'width' | 'discharge';

export interface SeriesPoint {
  time: string;
  wse: number | null;
  wse_u: number | null;
  area_total: number | null;
  width: number | null;
  /** River discharge (m³/s), reaches only; SWOT leaves it empty where it is not computed. */
  discharge: number | null;
  flag: number | null;
  /** Lakes: true if SWOT saw only part of the lake on this pass (its area is then too small). */
  partial: boolean | null;
  qcPass: boolean;
  qcReason?: QcReason;
}

export interface FeatureSeries {
  points: SeriesPoint[];
  units: Partial<Record<Metric | 'wse_u', string>>;
}

const SPEC: Record<PreviewKind, { feature: HydrocronFeature; idField: string; qcKind: FeatureKind; collection: string; fields: string[] }> = {
  lakes: {
    feature: 'PriorLake',
    idField: 'lake_id',
    qcKind: 'lake',
    collection: 'SWOT_L2_HR_LakeSP_D',
    fields: ['lake_id', 'time_str', 'wse', 'wse_u', 'area_total', 'quality_f', 'partial_f'],
  },
  reaches: {
    feature: 'Reach',
    idField: 'reach_id',
    qcKind: 'reach',
    collection: 'SWOT_L2_HR_RiverSP_D',
    fields: ['reach_id', 'time_str', 'wse', 'wse_u', 'width', 'reach_q', 'dschg_c'],
  },
  nodes: {
    feature: 'Node',
    idField: 'node_id',
    qcKind: 'node',
    collection: 'SWOT_L2_HR_RiverSP_D',
    fields: ['node_id', 'time_str', 'wse', 'wse_u', 'width', 'node_q'],
  },
};

export const SERIES_START = '2023-07-01T00:00:00Z'; // start of SWOT science orbit

const val = (v: string | undefined): number | null => {
  if (v === undefined || v === '' || isFill(v) || isFill(Number(v))) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** A flag in 0..max, or null for fills (-999, -99999999, no_data) and anything out of range. */
const flagVal = (v: string | undefined, max: number): number | null => {
  const n = val(v);
  return n !== null && Number.isInteger(n) && n >= 0 && n <= max ? n : null;
};

export function toSeries(kind: PreviewKind, rows: Record<string, string>[]): FeatureSeries {
  const spec = SPEC[kind];
  const flagField = spec.qcKind === 'lake' ? 'quality_f' : spec.qcKind === 'reach' ? 'reach_q' : 'node_q';
  const points = rows
    .map((r) => {
      const qc = evaluateQc(r, spec.qcKind);
      return {
        time: r.time_str ?? '',
        wse: val(r.wse),
        wse_u: val(r.wse_u),
        area_total: val(r.area_total),
        width: val(r.width),
        discharge: val(r.dschg_c),
        flag: flagVal(r[flagField], 3),
        // Missing partial_f (fill) is unknown, never "full coverage": only 0 means full.
        partial: (() => {
          const pf = flagVal(r.partial_f, 1);
          return pf === null ? null : pf !== 0;
        })(),
        qcPass: qc.pass,
        qcReason: qc.reason,
      };
    })
    .filter((p) => p.time && !isFill(p.time))
    .sort((a, b) => a.time.localeCompare(b.time));
  const first = rows[0] ?? {};
  const units: FeatureSeries['units'] = {};
  for (const k of ['wse', 'wse_u', 'area_total', 'width'] as const) if (first[`${k}_units`]) units[k] = first[`${k}_units`];
  if (first.dschg_c_units) units.discharge = first.dschg_c_units;
  return { points, units };
}

export async function fetchFeatureSeries(kind: PreviewKind, id: string, signal?: AbortSignal): Promise<FeatureSeries> {
  const spec = SPEC[kind];
  const rows = await getTimeseries(
    {
      feature: spec.feature,
      featureId: id,
      start: SERIES_START,
      end: `${new Date().toISOString().slice(0, 19)}Z`,
      fields: spec.fields,
      collection: spec.collection,
    },
    signal,
  );
  return toSeries(kind, rows);
}

export const idOf = (kind: PreviewKind, p: Record<string, unknown>) => String(p[SPEC[kind].idField] ?? '');

/** Series already fetched in this page, shared by the reservoir cards, the cascade and the timeline. */
const cache = new Map<string, { at: number; series: Promise<FeatureSeries> }>();
const CACHE_MS = 30 * 60_000;

/** Like fetchFeatureSeries, but asks Hydrocron at most once per feature every 30 minutes. */
export function cachedFeatureSeries(kind: PreviewKind, id: string): Promise<FeatureSeries> {
  const key = `${kind}|${id}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.series;
  const series = fetchFeatureSeries(kind, id);
  // A failed request is not remembered, so the next caller tries again.
  series.catch(() => cache.get(key)?.series === series && cache.delete(key));
  cache.set(key, { at: Date.now(), series });
  return series;
}
