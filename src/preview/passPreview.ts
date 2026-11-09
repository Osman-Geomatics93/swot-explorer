/**
 * Preview one SWOT pass inside the study area before downloading: lake polygons (LakeSP Prior),
 * river reach lines and river node points (RiverSP), cut to the area exactly as Clip & merge does,
 * with fill values removed and the QC rule evaluated per feature.
 */
import type { Feature, MultiPolygon, Polygon } from 'geojson';
import shp from 'shpjs';
import { fetchArchiveFile } from '@/api/archive';
import { searchGranules, type GranuleRef } from '@/api/cmr';
import { requireToken } from '@/auth/token';
import { clipFeatures } from '@/clip/clipVector';
import { parseShapefileXml, readShapefileXml, type FieldMap } from '@/clip/fieldMeta';
import { findProduct } from '@/config/products';
import { DEFAULT_QC_RULE } from '@/qc/qualityControl';
import { parseGranuleName } from '@/search/granuleName';

export type LayerKind = 'lakes' | 'reaches' | 'nodes';

export const LAYERS: Record<LayerKind, { label: string; productKey: string; prefix: string }> = {
  lakes: { label: 'Lakes', productKey: 'lake-prior', prefix: 'SWOT_L2_HR_LakeSP_Prior' },
  reaches: { label: 'River reaches', productKey: 'river-reach', prefix: 'SWOT_L2_HR_RiverSP_Reach' },
  nodes: { label: 'River nodes', productKey: 'river-node', prefix: 'SWOT_L2_HR_RiverSP_Node' },
};

export interface PassKey {
  cycle: string;
  pass: string;
  continent: string;
  start: string | null;
}

export interface PreviewLayer {
  kind: LayerKind;
  granule: GranuleRef | null;
  features: Feature[];
  fields: FieldMap;
}

/** The granule of one product for one cycle/pass/continent (newest reprocessing). */
export async function findPassGranule(kind: LayerKind, p: PassKey, signal?: AbortSignal): Promise<GranuleRef | null> {
  const product = findProduct(LAYERS[kind].productKey);
  const found = await searchGranules(
    {
      short_name: product.shortName,
      readable_granule_name: `${LAYERS[kind].prefix}_${p.cycle}_${p.pass}_${p.continent}_*`,
      'options[readable_granule_name][pattern]': 'true',
    },
    signal,
    10,
  );
  return found.sort((a, b) => parseGranuleName(b.name).version.localeCompare(parseGranuleName(a.name).version))[0] ?? null;
}

export async function loadPreviewLayer(
  kind: LayerKind,
  p: PassKey,
  area: Feature<Polygon | MultiPolygon>,
  signal?: AbortSignal,
): Promise<PreviewLayer> {
  const granule = await findPassGranule(kind, p, signal);
  if (!granule) return { kind, granule: null, features: [], fields: new Map() };
  const zip = await fetchArchiveFile(granule.url, await requireToken(), signal);
  const xml = readShapefileXml(zip);
  const fields = xml ? parseShapefileXml(xml) : new Map();
  const name = parseGranuleName(granule.name);
  const features = clipFeatures(
    await shp(zip),
    area,
    { name: granule.name, cycle: name.cycle, pass: name.pass, continent: name.continent, start: name.start },
    findProduct(LAYERS[kind].productKey),
    { cut: true, qcMode: 'flag', qcRule: DEFAULT_QC_RULE },
    {},
    fields,
  );
  return { kind, granule, features, fields };
}

/** Passes in a result list, newest first, one entry per cycle/pass/continent. */
export function passesOf(granules: { cycle: string | null; pass: string | null; continent: string | null; start: string | null }[]): PassKey[] {
  const seen = new Map<string, PassKey>();
  for (const g of granules) {
    if (!g.cycle || !g.pass || !g.continent) continue;
    const key = `${g.cycle}_${g.pass}_${g.continent}`;
    if (!seen.has(key)) seen.set(key, { cycle: g.cycle, pass: g.pass, continent: g.continent, start: g.start });
  }
  return [...seen.values()].sort((a, b) => (b.start ?? '').localeCompare(a.start ?? ''));
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Headline numbers for the panel. */
export function summarizeLayer(layer: PreviewLayer) {
  const f = layer.features;
  const wse = f.map((x) => num(x.properties?.wse)).filter((v): v is number => v !== null);
  const passing = f.filter((x) => x.properties?.qc_pass).length;
  // area_total describes the whole lake; for cut lakes, scale by the fraction inside.
  const lakeArea = f.reduce((s, x) => s + (num(x.properties?.area_total) ?? 0) * (num(x.properties?.clip_fraction) ?? 1), 0);
  return {
    count: f.length,
    passing,
    wseMin: wse.length ? Math.min(...wse) : null,
    wseMax: wse.length ? Math.max(...wse) : null,
    lakeAreaKm2: layer.kind === 'lakes' ? lakeArea : null,
  };
}
