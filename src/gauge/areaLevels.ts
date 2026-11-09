/**
 * SWOT water level inside a study area, per pass, from LakeSP_Obs observation polygons
 * (pure functions, unit-tested).
 *
 * Per pass: observations passing the QC rule that overlap the area are weighted by the part
 * of their surface inside it; the level is the area-weighted median of their heights.
 * Water outside the area never contributes. Reprocessed copies of a pass count once.
 */
import area from '@turf/area';
import booleanIntersects from '@turf/boolean-intersects';
import { featureCollection } from '@turf/helpers';
import intersect from '@turf/intersect';
import type { Feature, Geometry, MultiPolygon, Polygon } from 'geojson';
import { evaluateQc } from '@/qc/qualityControl';
import { dedupeGranules, weightedMedian, type ObsPiece } from '@/robust/robustLevel';

export type AreaPiece = ObsPiece & { geometry: Geometry | null };

export interface AreaPassLevel {
  time: string;
  wse: number;
  granule: string;
  /** Water surface of the used observations inside the study area, km². */
  insideKm2: number;
  pieces: number;
  /** Weighted spread of the used heights around the level (median absolute deviation), m. */
  spreadM: number;
}

export interface AreaLevels {
  levels: AreaPassLevel[];
  /** Passes with observations of the lake but none usable inside the area. */
  passesWithoutData: number;
  duplicatesRemoved: number;
}

/** Slivers smaller than this inside the area are ignored (edge noise, not water). */
const MIN_INSIDE_KM2 = 0.01;

function insideKm2(piece: Feature<Polygon | MultiPolygon>, zone: Feature<Polygon | MultiPolygon>): number {
  try {
    if (!booleanIntersects(piece, zone)) return 0;
    const cut = intersect(featureCollection([piece, zone]));
    return cut ? area(cut) / 1e6 : 0;
  } catch {
    return 0; // a self-intersecting observation polygon is skipped, never a crash
  }
}

export function levelsInArea(all: AreaPiece[], zone: Feature<Polygon | MultiPolygon>): AreaLevels {
  const { pieces, removed } = dedupeGranules(all);
  const byGranule = new Map<string, AreaPiece[]>();
  for (const p of pieces) byGranule.set(p.granule, [...(byGranule.get(p.granule) ?? []), p]);

  const levels: AreaPassLevel[] = [];
  let empty = 0;
  for (const [granule, group] of byGranule) {
    const used: { v: number; w: number; time: string }[] = [];
    for (const p of group) {
      const wse = Number(p.wse);
      const g = p.geometry;
      if (!g || (g.type !== 'Polygon' && g.type !== 'MultiPolygon') || !Number.isFinite(wse)) continue;
      if (!evaluateQc(p, 'lake').pass) continue;
      const w = insideKm2({ type: 'Feature', properties: {}, geometry: g }, zone);
      if (w >= MIN_INSIDE_KM2) used.push({ v: wse, w, time: p.time_str });
    }
    if (!used.length) {
      empty++;
      continue;
    }
    const wse = weightedMedian(used);
    const spreadM = weightedMedian(used.map((u) => ({ v: Math.abs(u.v - wse), w: u.w })));
    levels.push({
      time: used.map((u) => u.time).sort()[0]!,
      wse,
      granule,
      insideKm2: used.reduce((s, u) => s + u.w, 0),
      pieces: used.length,
      spreadM,
    });
  }
  levels.sort((a, b) => a.time.localeCompare(b.time));
  return { levels, passesWithoutData: empty, duplicatesRemoved: removed };
}
