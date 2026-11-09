import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { Feature, Polygon } from 'geojson';
import shp from 'shpjs';
import { describe, expect, it } from 'vitest';
import { clipFeatures } from '@/clip/clipVector';
import { isFill, parseShapefileXml, readShapefileXml } from '@/clip/fieldMeta';
import { buildTable, dictionary } from '@/clip/table';
import { findProduct } from '@/config/products';
import { columnsOf, toCsv } from '@/lib/csv';
import { readme } from '@/lib/exportCsv';
import { DEFAULT_QC_RULE } from '@/qc/qualityControl';

describe('toCsv', () => {
  const csv = toCsv(['id', 'name', 'wse', 'ok'], [
    { id: 1, name: 'Roseires, "Er Rosieres"', wse: 488.31, ok: true },
    { id: 2, name: 'النيل الأزرق', wse: null, ok: false },
  ]);

  it('starts with a UTF-8 BOM and the header, uses CRLF', () => {
    expect(csv.startsWith('﻿id,name,wse,ok\r\n')).toBe(true);
    expect(csv.split('\r\n')).toHaveLength(4);
  });

  it('quotes only where needed and leaves missing values empty', () => {
    expect(csv).toContain('1,"Roseires, ""Er Rosieres""",488.31,true');
    expect(csv).toContain('2,النيل الأزرق,,false');
  });

  it('collects columns across rows', () => {
    expect(columnsOf([{ a: 1 }, { b: 2, a: 3 }])).toEqual(['a', 'b']);
  });
});

const REACH_ZIP = 'tools/out/granules/SWOT_L2_HR_RiverSP_Reach_058_318_AF_20261102T202820_20261102T204242_PID0_01.zip';
const area: Feature<Polygon> = {
  type: 'Feature',
  properties: {},
  geometry: { type: 'Polygon', coordinates: [[[35.0, 10.7], [35.45, 10.75], [35.3, 11.25], [35.05, 11.2], [35.0, 10.7]]] },
};

describe.runIf(existsSync(REACH_ZIP))('CSV export of a real RiverSP reach granule', async () => {
  const buf = readFileSync(REACH_ZIP);
  const zip = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const fields = parseShapefileXml(readShapefileXml(zip)!);
  const features = clipFeatures(await shp(zip), area, { name: 'SWOT_L2_HR_RiverSP_Reach_058_318_AF_x', cycle: '058', pass: '318', continent: 'AF', start: null }, findProduct('river-reach'), { cut: true, qcMode: 'flag', qcRule: DEFAULT_QC_RULE }, {}, fields);
  const fc = { type: 'FeatureCollection' as const, features };

  it('reads units, fill values and the Basic tag from the shapefile XML', () => {
    expect(fields.get('wse')).toMatchObject({ units: 'm', basic: true, fill: '-999999999999.0' });
    expect([...fields.values()].filter((f) => f.basic).length).toBeGreaterThan(40);
    expect(new Set([...fields.values()].map((f) => f.fill))).toContain('-999');
  });

  it('turns every fill value into an empty cell, per column', () => {
    for (const f of features)
      for (const [k, v] of Object.entries(f.properties ?? {})) expect(isFill(v, fields.get(k)) && v !== null, `${k}=${String(v)}`).toBe(false);
  });

  it('essential columns: identifiers and location first, Basic fields, then added columns', () => {
    const t = buildTable(fc, fields, 'essential');
    expect(t.columns.slice(0, 7)).toEqual(['reach_id', 'river_name', 'time_str', 'cycle', 'pass', 'centroid_lon', 'centroid_lat']);
    expect(t.columns).toContain('wse');
    expect(t.columns).not.toContain('wse_r_u'); // an Expert field
    expect(t.columns.slice(-6)).toEqual(['clipped', 'clip_fraction', 'qc_pass', 'qc_reason', 'continent', 'granule']);
    expect(buildTable(fc, fields, 'all').columns.length).toBeGreaterThan(t.columns.length + 50);
  });

  it('the dictionary documents every column with units', () => {
    const t = buildTable(fc, fields, 'essential');
    const d = dictionary(t.columns, fields);
    expect(d).toHaveLength(t.columns.length);
    expect(d.find((r) => r.column === 'wse')).toMatchObject({ units: 'm', source: 'SWOT (Basic)' });
    expect(d.find((r) => r.column === 'clip_fraction')?.source).toBe('SWOT Explorer');
    expect(d.every((r) => r.description)).toBe(true);

    // Written out for a check with pandas (tools/out is git-ignored).
    mkdirSync('tools/out/csv-check', { recursive: true });
    writeFileSync('tools/out/csv-check/reaches.csv', toCsv(t.columns, t.rows));
    writeFileSync('tools/out/csv-check/reaches_columns.csv', toCsv(['column', 'description', 'units', 'source'], d));
    writeFileSync('tools/out/csv-check/reaches_README.txt', readme({ product: 'SWOT_L2_HR_RiverSP_reach_D' }, t.columns, t.rows.length));
  });
});
