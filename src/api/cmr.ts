import { z } from 'zod';

const CMR = 'https://cmr.earthdata.nasa.gov/search/granules.umm_json';
const CLIENT_ID = 'swot-explorer-ext';

const RelatedUrl = z.object({ URL: z.string(), Type: z.string().optional() });
const Granule = z.object({
  meta: z.object({ 'concept-id': z.string() }),
  umm: z.object({
    GranuleUR: z.string(),
    TemporalExtent: z.object({ RangeDateTime: z.object({ BeginningDateTime: z.string() }) }).partial().optional(),
    RelatedUrls: z.array(RelatedUrl).default([]),
    SpatialExtent: z
      .object({
        HorizontalSpatialDomain: z
          .object({
            Geometry: z
              .object({
                BoundingRectangles: z
                  .array(
                    z.object({
                      WestBoundingCoordinate: z.number(),
                      EastBoundingCoordinate: z.number(),
                      SouthBoundingCoordinate: z.number(),
                      NorthBoundingCoordinate: z.number(),
                    }),
                  )
                  .optional(),
                GPolygons: z
                  .array(
                    z.object({
                      Boundary: z.object({ Points: z.array(z.object({ Longitude: z.number(), Latitude: z.number() })) }),
                    }),
                  )
                  .optional(),
              })
              .partial(),
          })
          .partial(),
      })
      .partial()
      .optional(),
    DataGranule: z
      .object({
        ArchiveAndDistributionInformation: z
          .array(z.object({ Name: z.string(), SizeInBytes: z.number().optional() }))
          .default([]),
      })
      .optional(),
  }),
});
const Page = z.object({ items: z.array(Granule) });

export interface GranuleRef {
  id: string;
  name: string;
  url: string;
  sizeBytes: number | null;
  start: string | null;
  /** Footprint polygons as [lng, lat] rings; null when CMR gives a whole-world box (antimeridian scenes). */
  footprint: number[][][] | null;
}

function footprintOf(g: z.infer<typeof Granule>): number[][][] | null {
  const geom = g.umm.SpatialExtent?.HorizontalSpatialDomain?.Geometry;
  const polys = geom?.GPolygons?.map((p) => p.Boundary.Points.map((pt) => [pt.Longitude, pt.Latitude]));
  if (polys?.length) return polys;
  const rects = (geom?.BoundingRectangles ?? []).filter(
    (r) => r.EastBoundingCoordinate - r.WestBoundingCoordinate < 180, // whole-world boxes carry no location
  );
  if (!rects.length) return null;
  return rects.map((r) => [
    [r.WestBoundingCoordinate, r.SouthBoundingCoordinate],
    [r.EastBoundingCoordinate, r.SouthBoundingCoordinate],
    [r.EastBoundingCoordinate, r.NorthBoundingCoordinate],
    [r.WestBoundingCoordinate, r.NorthBoundingCoordinate],
    [r.WestBoundingCoordinate, r.SouthBoundingCoordinate],
  ]);
}

export type CmrParams = Record<string, string | number>;

function toRef(g: z.infer<typeof Granule>): GranuleRef | null {
  const url = g.umm.RelatedUrls.find((u) => u.Type === 'GET DATA' && u.URL.startsWith('https://'))?.URL;
  if (!url) return null;
  const file = url.split('/').pop()!;
  const size = g.umm.DataGranule?.ArchiveAndDistributionInformation.find((a) => a.Name === file)?.SizeInBytes;
  return {
    id: g.meta['concept-id'],
    name: g.umm.GranuleUR,
    url,
    sizeBytes: size ?? null,
    start: g.umm.TemporalExtent?.RangeDateTime?.BeginningDateTime ?? null,
    footprint: footprintOf(g),
  };
}

/** All granules matching the query, following CMR-Search-After paging. */
export async function searchGranules(params: CmrParams, signal?: AbortSignal, max = 2000): Promise<GranuleRef[]> {
  const query = new URLSearchParams(Object.entries({ page_size: 200, ...params }).map(([k, v]) => [k, String(v)]));
  const headers: Record<string, string> = { 'Client-Id': CLIENT_ID };
  const out: GranuleRef[] = [];
  for (;;) {
    const resp = await fetch(`${CMR}?${query}`, { headers, signal });
    if (!resp.ok) throw new Error(`CMR search failed (HTTP ${resp.status}).`);
    const page = Page.parse(await resp.json());
    out.push(...page.items.map(toRef).filter((r): r is GranuleRef => r !== null));
    const after = resp.headers.get('CMR-Search-After');
    const hits = Number(resp.headers.get('CMR-Hits') ?? 0);
    if (!after || page.items.length === 0 || out.length >= Math.min(hits, max)) return out;
    headers['CMR-Search-After'] = after;
  }
}

/**
 * Passes that actually observe a point. LakeSP/RiverSP footprints are
 * continent-wide boxes, so they are useless for this; PIXC tiles are ~64 km.
 */
export async function passesCovering(lng: number, lat: number, signal?: AbortSignal): Promise<string[]> {
  const tiles = await searchGranules(
    { short_name: 'SWOT_L2_HR_PIXC_D', point: `${lng},${lat}`, sort_key: '-start_date' },
    signal,
    60,
  );
  const counts = new Map<string, number>();
  for (const t of tiles) {
    const pass = t.name.split('_')[5]; // SWOT_L2_HR_PIXC_<cycle>_<pass>_<tile>_...
    if (pass) counts.set(pass, (counts.get(pass) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([p]) => p);
}

/** Pass number is matched in the granule name because CMR rejects passes[n][pass] without cycle[]. */
export function lakeObsQuery(pass: string, continent = 'AF'): CmrParams {
  return {
    short_name: 'SWOT_L2_HR_LakeSP_obs_D',
    readable_granule_name: `SWOT_L2_HR_LakeSP_Obs_???_${pass}_${continent}_*`,
    'options[readable_granule_name][pattern]': 'true',
    sort_key: 'start_date',
  };
}
