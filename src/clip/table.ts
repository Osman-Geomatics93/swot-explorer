/**
 * Turn clipped features into a tidy table: one row per feature per pass, identifiers and
 * location first, then SWOT fields in product order, then the columns SWOT Explorer adds.
 */
import type { FeatureCollection } from 'geojson';
import { columnsOf } from '@/lib/csv';
import type { FieldMap } from './fieldMeta';

export type ColumnSet = 'essential' | 'all';

/** Columns SWOT Explorer adds, with their descriptions for the column dictionary. */
export const ADDED_COLUMNS: Record<string, { description: string; units: string }> = {
  cycle: { description: 'SWOT repeat cycle (from the granule name)', units: '' },
  pass: { description: 'SWOT pass number (from the granule name)', units: '' },
  centroid_lon: { description: 'Longitude of the centroid of the geometry kept inside the study area', units: 'degrees_east' },
  centroid_lat: { description: 'Latitude of the centroid of the geometry kept inside the study area', units: 'degrees_north' },
  clipped: { description: 'true if the feature was cut at the study-area boundary', units: '' },
  clip_fraction: {
    description: 'Fraction of the feature inside the study area (by length for rivers, by area for lakes). SWOT values still describe the whole feature.',
    units: '1',
  },
  qc_pass: { description: 'true if the row passes the quality-control rule in the README', units: '' },
  qc_reason: { description: 'Why the row failed quality control (empty if it passed)', units: '' },
  continent: { description: 'SWOT continent code (from the granule name)', units: '' },
  granule: { description: 'Source SWOT granule', units: '' },
};

const FRONT = ['reach_id', 'node_id', 'lake_id', 'obs_id', 'river_name', 'lake_name', 'time_str', 'cycle', 'pass', 'centroid_lon', 'centroid_lat', 'p_lon', 'p_lat', 'lon', 'lat'];
const BACK = ['clipped', 'clip_fraction', 'qc_pass', 'qc_reason', 'continent', 'granule'];

export function buildTable(fc: FeatureCollection, fields: FieldMap, set: ColumnSet) {
  const rows = fc.features.map((f) => ({ ...f.properties }) as Record<string, unknown>);
  const present = new Set(columnsOf(rows));
  const swot = [...fields.keys()].filter((k) => present.has(k) && (set === 'all' || fields.get(k)!.basic));
  // Fields the XML doesn't describe (or a product without XML) are kept so nothing silently disappears.
  const undescribed = [...present].filter((k) => !fields.has(k) && !(k in ADDED_COLUMNS));
  const middle = [...swot, ...(set === 'all' || fields.size === 0 ? undescribed : [])];

  const ordered = [...FRONT, ...middle, ...BACK].filter((c, i, all) => present.has(c) && all.indexOf(c) === i);
  return { columns: ordered, rows };
}

/** Column dictionary rows for <name>_columns.csv. */
export function dictionary(columns: string[], fields: FieldMap) {
  return columns.map((c) => {
    const f = fields.get(c);
    const added = ADDED_COLUMNS[c];
    return {
      column: c,
      description: f?.longName ?? added?.description ?? '',
      units: f?.units ?? added?.units ?? '',
      source: f ? (f.basic ? 'SWOT (Basic)' : 'SWOT (Expert)') : added ? 'SWOT Explorer' : 'SWOT',
    };
  });
}
