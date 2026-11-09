/**
 * Granule search inside a study area, with the corrections each product family needs
 * (see docs/api-notes.md §6 and §13):
 *  - continental / raster: CMR footprints are continent-wide (or whole-world near the
 *    antimeridian), so keep only cycle/pass pairs whose PIXC tiles touch the area;
 *  - everything: drop footprints that do not touch the area, and drop older reprocessed
 *    versions of the same granule.
 */
import bbox from '@turf/bbox';
import booleanIntersects from '@turf/boolean-intersects';
import type { Feature, MultiPolygon, Polygon } from 'geojson';
import { searchGranules, type GranuleRef } from '@/api/cmr';
import type { Product } from '@/config/products';
import { latestVersions, parseGranuleName, type GranuleName } from './granuleName';

export interface SearchQuery {
  product: Product;
  area: Feature<Polygon | MultiPolygon>;
  start: string; // ISO date
  end: string; // ISO date
  cycle?: number;
  pass?: number;
}

export type GranuleResult = GranuleRef & GranuleName & { touchesArea: boolean | null };

export interface SearchResult {
  granules: GranuleResult[];
  duplicatesRemoved: number;
  /** Granules CMR returned that turned out not to observe the area. */
  outsideRemoved: number;
  truncated: boolean;
}

const MAX = 2000;

/** null when CMR gives no usable footprint (whole-world box). Each ring is a separate footprint polygon. */
const footprintTouches = (g: GranuleRef, area: Feature<Polygon | MultiPolygon>): boolean | null =>
  g.footprint ? g.footprint.some((ring) => booleanIntersects({ type: 'Polygon', coordinates: [ring] }, area)) : null;

function baseParams(q: SearchQuery, shortName: string) {
  const [w, s, e, n] = bbox(q.area);
  return {
    short_name: shortName,
    bounding_box: `${w},${s},${e},${n}`,
    temporal: `${q.start}T00:00:00Z,${q.end}T23:59:59Z`,
    sort_key: '-start_date',
  };
}

const matchesFilter = (n: GranuleName, q: SearchQuery) =>
  (q.cycle === undefined || Number(n.cycle) === q.cycle) && (q.pass === undefined || Number(n.pass) === q.pass);

/** Cycle/pass pairs whose PIXC tiles touch the area: the passes that really observe it. */
export async function observingPasses(q: SearchQuery, signal?: AbortSignal): Promise<Set<string> & { truncated?: boolean }> {
  const tiles = await searchGranules(baseParams(q, 'SWOT_L2_HR_PIXC_D'), signal, MAX);
  // Capped tile lists miss the oldest passes, which would then wrongly count as "not observing".
  const pairs: Set<string> & { truncated?: boolean } = Object.assign(new Set<string>(), { truncated: tiles.length >= MAX });
  for (const t of tiles) {
    if (footprintTouches(t, q.area) === false) continue;
    const n = parseGranuleName(t.name);
    if (n.cycle && n.pass) pairs.add(`${n.cycle}_${n.pass}`);
  }
  return pairs;
}

export async function searchProduct(q: SearchQuery, signal?: AbortSignal): Promise<SearchResult> {
  const { product } = q;
  const [raw, pairs] = await Promise.all([
    searchGranules(baseParams(q, product.shortName), signal, MAX),
    product.family === 'continental' || product.family === 'raster' ? observingPasses(q, signal) : Promise.resolve(null),
  ]);

  const { items, removed } = latestVersions(raw);
  let outside = 0;
  const granules: GranuleResult[] = [];
  for (const g of items) {
    const name = parseGranuleName(g.name);
    if (!matchesFilter(name, q)) continue;
    const touches = footprintTouches(g, q.area);
    const observed = pairs ? pairs.has(`${name.cycle}_${name.pass}`) : true;
    // Continental boxes always "touch"; for them only the pass check means anything.
    const keep = product.family === 'continental' ? observed : observed && touches !== false;
    if (!keep) {
      outside++;
      continue;
    }
    granules.push({ ...g, ...name, start: name.start ?? g.start, touchesArea: product.family === 'continental' ? null : touches });
  }
  granules.sort((a, b) => (b.start ?? '').localeCompare(a.start ?? ''));
  return { granules, duplicatesRemoved: removed, outsideRemoved: outside, truncated: raw.length >= MAX || Boolean(pairs?.truncated) };
}
