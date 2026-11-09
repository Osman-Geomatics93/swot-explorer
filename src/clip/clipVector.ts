/**
 * Clip and merge vector granules (RiverSP, LakeSP, Avg products) to a study area.
 *
 * Each zipped shapefile is downloaded with the Earthdata token, parsed in the page,
 * reduced to the features that touch the area, tagged with granule/cycle/pass, run
 * through the QC rule, and merged into one GeoJSON FeatureCollection.
 */
import along from '@turf/along';
import turfArea from '@turf/area';
import booleanIntersects from '@turf/boolean-intersects';
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import centroid from '@turf/centroid';
import { lineString } from '@turf/helpers';
import intersect from '@turf/intersect';
import length from '@turf/length';
import lineSplit from '@turf/line-split';
import type { Feature, FeatureCollection, Geometry, LineString, MultiLineString, MultiPolygon, Polygon, Position } from 'geojson';
import shp from 'shpjs';
import { DownloadHostError, fetchArchiveFile } from '@/api/archive';
import { requireToken } from '@/auth/token';
import { isFill, parseShapefileXml, readShapefileXml, type FieldMap } from './fieldMeta';
import type { Product } from '@/config/products';
import { DEFAULT_QC_RULE, evaluateQc, type QcReason, type QcRule } from '@/qc/qualityControl';
import type { GranuleResult } from '@/search/searchProduct';

export type QcMode = 'filter' | 'flag' | 'off';

export interface ClipOptions {
  /**
   * true: keep only the part of each feature inside the area (lines split at the boundary,
   * polygons intersected, points outside dropped). false: keep whole features that touch it.
   */
  cut: boolean;
  qcMode: QcMode;
  qcRule: QcRule;
}

export interface ClipProgress {
  total: number;
  done: number;
  failed: number;
  features: number;
}

export interface ClipSummary {
  granules: number;
  failed: { name: string; error: string }[];
  kept: number;
  rejected: Partial<Record<QcReason, number>>;
}

type Area = Feature<Polygon | MultiPolygon>;

/** Keep the parts of a line inside the area: split at the boundary, keep segments whose midpoint is inside. */
function cutLine(geom: LineString | MultiLineString, area: Area): { geometry: Geometry; fraction: number } | null {
  const parts = geom.type === 'LineString' ? [geom.coordinates] : geom.coordinates;
  const kept: Position[][] = [];
  let total = 0;
  let inside = 0;
  for (const coords of parts) {
    if (coords.length < 2) continue;
    const line = lineString(coords);
    total += length(line);
    const pieces = lineSplit(line, area).features;
    for (const seg of pieces.length ? pieces : [line]) {
      const len = length(seg);
      if (len === 0 || !booleanPointInPolygon(along(seg, len / 2), area)) continue;
      kept.push(seg.geometry.coordinates);
      inside += len;
    }
  }
  if (!kept.length) return null;
  return {
    geometry: kept.length === 1 ? { type: 'LineString', coordinates: kept[0]! } : { type: 'MultiLineString', coordinates: kept },
    fraction: total > 0 ? inside / total : 1,
  };
}

/** The part of a feature inside the area, with the fraction (by length or area) that was kept. */
export function cutToArea(f: Feature<Geometry>, area: Area): { feature: Feature<Geometry>; fraction: number } | null {
  const g = f.geometry;
  switch (g.type) {
    case 'Polygon':
    case 'MultiPolygon': {
      const cut = intersect({ type: 'FeatureCollection', features: [f as Area, area] });
      if (!cut) return null;
      const full = turfArea(f);
      return { feature: { ...f, geometry: cut.geometry }, fraction: full > 0 ? turfArea(cut) / full : 1 };
    }
    case 'LineString':
    case 'MultiLineString': {
      const cut = cutLine(g, area);
      return cut ? { feature: { ...f, geometry: cut.geometry }, fraction: cut.fraction } : null;
    }
    case 'Point':
      return booleanPointInPolygon(g.coordinates, area) ? { feature: f, fraction: 1 } : null;
    case 'MultiPoint': {
      const pts = g.coordinates.filter((c) => booleanPointInPolygon(c, area));
      return pts.length ? { feature: { ...f, geometry: { type: 'MultiPoint', coordinates: pts } }, fraction: pts.length / g.coordinates.length } : null;
    }
    default:
      return { feature: f, fraction: 1 };
  }
}

export function clipFeatures(
  collections: FeatureCollection | FeatureCollection[],
  area: Feature<Polygon | MultiPolygon>,
  granule: Pick<GranuleResult, 'name' | 'cycle' | 'pass' | 'continent' | 'start'>,
  product: Product,
  o: ClipOptions,
  rejected: Partial<Record<QcReason, number>>,
  fields: FieldMap = new Map(),
): Feature[] {
  const out: Feature[] = [];
  for (const fc of Array.isArray(collections) ? collections : [collections]) {
    for (const raw of fc.features) {
      if (!raw.geometry || !booleanIntersects(raw, area)) continue;
      const cut = o.cut ? cutToArea(raw as Feature<Geometry>, area) : { feature: raw as Feature<Geometry>, fraction: 1 };
      if (!cut) continue;
      const f = cut.feature;

      // SWOT fill values (which differ by column: -999, -99999999, -999999999999, no_data) become null.
      const source: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(f.properties ?? {})) source[k] = isFill(v, fields.get(k)) ? null : v;
      const [cx, cy] = f.geometry.type === 'Point' ? f.geometry.coordinates : centroid(f).geometry.coordinates;

      const props: Record<string, unknown> = {
        ...source,
        centroid_lon: Math.round(cx! * 1e6) / 1e6,
        centroid_lat: Math.round(cy! * 1e6) / 1e6,
        granule: granule.name,
        cycle: granule.cycle,
        pass: granule.pass,
        continent: granule.continent,
        // SWOT attributes (wse, width, area_total, ...) always describe the whole reach or lake.
        clipped: cut.fraction < 0.9999,
        clip_fraction: Math.round(cut.fraction * 1000) / 1000,
      };
      if (product.qcKind && o.qcMode !== 'off') {
        const qc = evaluateQc(props, product.qcKind, o.qcRule);
        if (!qc.pass) rejected[qc.reason!] = (rejected[qc.reason!] ?? 0) + 1;
        if (o.qcMode === 'filter' && !qc.pass) continue;
        if (o.qcMode === 'flag') Object.assign(props, { qc_pass: qc.pass, qc_reason: qc.reason ?? '' });
      }
      out.push({ ...f, properties: props });
    }
  }
  return out;
}

export async function clipGranules(
  granules: GranuleResult[],
  area: Feature<Polygon | MultiPolygon>,
  product: Product,
  options: Partial<ClipOptions>,
  onProgress: (p: ClipProgress) => void,
  signal?: AbortSignal,
): Promise<{ collection: FeatureCollection; summary: ClipSummary; fields: FieldMap }> {
  const o: ClipOptions = { cut: true, qcMode: 'filter', qcRule: DEFAULT_QC_RULE, ...options };
  const token = await requireToken();
  const progress: ClipProgress = { total: granules.length, done: 0, failed: 0, features: 0 };
  const summary: ClipSummary = { granules: granules.length, failed: [], kept: 0, rejected: {} };
  const features: Feature[] = [];
  const fields: FieldMap = new Map();
  const queue = [...granules];
  onProgress({ ...progress });

  const worker = async () => {
    for (let g = queue.shift(); g; g = queue.shift()) {
      signal?.throwIfAborted(); // cancelling must never return partial results as if complete
      try {
        const zip = await fetchArchiveFile(g.url, token, signal);
        const xml = readShapefileXml(zip);
        const granuleFields = xml ? parseShapefileXml(xml) : new Map();
        for (const [k, v] of granuleFields) if (!fields.has(k)) fields.set(k, v);
        const clipped = clipFeatures(await shp(zip), area, g, product, o, summary.rejected, granuleFields);
        features.push(...clipped);
        progress.features += clipped.length;
      } catch (err) {
        if (signal?.aborted || err instanceof DownloadHostError) throw err;
        progress.failed++;
        summary.failed.push({ name: g.name, error: err instanceof Error ? err.message : String(err) });
      }
      progress.done++;
      onProgress({ ...progress });
    }
  };
  await Promise.all(Array.from({ length: 3 }, worker));
  signal?.throwIfAborted();

  features.sort((a, b) => String(a.properties?.time_str ?? '').localeCompare(String(b.properties?.time_str ?? '')));
  summary.kept = features.length;
  return { collection: { type: 'FeatureCollection', features }, summary, fields };
}
