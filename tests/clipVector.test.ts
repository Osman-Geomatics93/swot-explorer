import { existsSync, readFileSync } from 'node:fs';
import type { Feature, Polygon } from 'geojson';
import shp from 'shpjs';
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import { describe, expect, it } from 'vitest';
import { clipFeatures } from '@/clip/clipVector';
import { findProduct } from '@/config/products';
import { DEFAULT_QC_RULE } from '@/qc/qualityControl';

// A real LakeSP_Prior granule over GERD, downloaded by tools/find_pld_ids.py (not committed: 12 MB).
const ZIP = 'tools/out/granules/SWOT_L2_HR_LakeSP_Prior_057_499_AF_20261019T105441_20261019T111105_PID0_01.zip';

const gerdBox: Feature<Polygon> = {
  type: 'Feature',
  properties: {},
  geometry: { type: 'Polygon', coordinates: [[[34.9, 10.5], [35.6, 10.5], [35.6, 11.3], [34.9, 11.3], [34.9, 10.5]]] },
};
const granule = { name: 'SWOT_L2_HR_LakeSP_Prior_057_499_AF_x', cycle: '057', pass: '499', continent: 'AF', start: null };
const product = findProduct('lake-prior');

describe.runIf(existsSync(ZIP))('clipFeatures on a real LakeSP_Prior granule', async () => {
  const buf = readFileSync(ZIP);
  const parsed = await shp(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const all = (Array.isArray(parsed) ? parsed : [parsed]).flatMap((c) => c.features);

  it('keeps only features touching the study area, tagged with granule info', () => {
    const out = clipFeatures(parsed, gerdBox, granule, product, { cut: false, qcMode: 'off', qcRule: DEFAULT_QC_RULE }, {});
    expect(out.length).toBeGreaterThan(0);
    expect(out.length).toBeLessThan(all.length / 10);
    expect(out.map((f) => f.properties?.lake_id)).toContain('1720058403'); // GERD
    expect(out[0]!.properties).toMatchObject({ cycle: '057', pass: '499', continent: 'AF' });
  });

  it('filter mode drops QC failures; flag mode keeps them with a qc_pass column', () => {
    const rejected = {};
    const filtered = clipFeatures(parsed, gerdBox, granule, product, { cut: false, qcMode: 'filter', qcRule: DEFAULT_QC_RULE }, rejected);
    const flagged = clipFeatures(parsed, gerdBox, granule, product, { cut: false, qcMode: 'flag', qcRule: DEFAULT_QC_RULE }, {});
    expect(flagged.length).toBeGreaterThanOrEqual(filtered.length);
    expect(flagged.filter((f) => f.properties?.qc_pass)).toHaveLength(filtered.length);
    expect(Object.values(rejected).reduce((a: number, b) => a + (b as number), 0)).toBe(flagged.length - filtered.length);
  });

  it('cut mode keeps lake polygons inside the area', () => {
    const out = clipFeatures(parsed, gerdBox, granule, product, { cut: true, qcMode: 'off', qcRule: DEFAULT_QC_RULE }, {});
    for (const f of out) {
      const coords = JSON.stringify(f.geometry);
      for (const [x, y] of coords.match(/-?\d+\.?\d*,-?\d+\.?\d*/g)!.map((p) => p.split(',').map(Number))) {
        expect(x).toBeGreaterThanOrEqual(34.9 - 1e-9);
        expect(x).toBeLessThanOrEqual(35.6 + 1e-9);
        expect(y).toBeGreaterThanOrEqual(10.5 - 1e-9);
        expect(y).toBeLessThanOrEqual(11.3 + 1e-9);
      }
    }
  });
});

// A drawn, non-rectangular polygon over GERD and a real RiverSP reach granule (pass 318).
const REACH_ZIP = 'tools/out/granules/SWOT_L2_HR_RiverSP_Reach_058_318_AF_20261102T202820_20261102T204242_PID0_01.zip';
const drawn: Feature<Polygon> = {
  type: 'Feature',
  properties: {},
  geometry: { type: 'Polygon', coordinates: [[[35.0, 10.7], [35.45, 10.75], [35.3, 11.25], [35.05, 11.2], [35.0, 10.7]]] },
};

/** Planar distance (degrees) from a point to the polygon outline: the geometry the clipper works in. */
function degreesOutside([x, y]: number[], ring: number[][]): number {
  if (booleanPointInPolygon([x!, y!], drawn)) return 0;
  let best = Infinity;
  for (let i = 0; i < ring.length - 1; i++) {
    const [ax, ay] = ring[i]!;
    const [bx, by] = ring[i + 1]!;
    const dx = bx! - ax!;
    const dy = by! - ay!;
    const t = Math.max(0, Math.min(1, ((x! - ax!) * dx + (y! - ay!) * dy) / (dx * dx + dy * dy)));
    best = Math.min(best, Math.hypot(x! - (ax! + t * dx), y! - (ay! + t * dy)));
  }
  return best;
}

const load = async (path: string) => {
  const b = readFileSync(path);
  return shp(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
};

describe.runIf(existsSync(REACH_ZIP) && existsSync(ZIP))('cutting to a drawn polygon (real data)', () => {
  const opts = { qcMode: 'off' as const, qcRule: DEFAULT_QC_RULE };
  const ring = drawn.geometry.coordinates[0]!;

  it.each([
    ['river-reach', REACH_ZIP],
    ['lake-prior', ZIP],
  ])('%s: nothing extends past the boundary when cutting', async (key, path) => {
    const out = clipFeatures(await load(path), drawn, granule, findProduct(key), { cut: true, ...opts }, {});
    expect(out.length).toBeGreaterThan(0);
    const vertices = out.flatMap((f) => JSON.stringify(f.geometry).match(/-?\d+\.?\d*(e-?\d+)?,-?\d+\.?\d*(e-?\d+)?/g)!.map((p) => p.split(',').map(Number)));
    const worst = Math.max(...vertices.map((v) => degreesOutside(v, ring)));
    expect(worst).toBeLessThan(1e-9); // on the boundary at most (cut points), never outside
  });

  it('river reaches crossing the boundary are cut and marked with the fraction kept', async () => {
    const parsed = await load(REACH_ZIP);
    const whole = clipFeatures(parsed, drawn, granule, findProduct('river-reach'), { cut: false, ...opts }, {});
    const cut = clipFeatures(parsed, drawn, granule, findProduct('river-reach'), { cut: true, ...opts }, {});
    const crossing = cut.filter((f) => f.properties?.clipped);
    expect(crossing.length).toBeGreaterThan(0);
    for (const f of crossing) expect(f.properties?.clip_fraction).toBeGreaterThan(0);
    for (const f of crossing) expect(f.properties?.clip_fraction).toBeLessThan(1);
    // Whole-feature mode keeps the original geometry and marks nothing as clipped.
    expect(whole.every((f) => f.properties?.clipped === false)).toBe(true);
  });
});
