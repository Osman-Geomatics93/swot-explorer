/**
 * Column metadata from the .shp.xml inside every SWOT vector granule: description, units,
 * fill value, and NASA's "Basic"/"Expert" tag. Used to blank fill values per column and to
 * offer an "essential columns" export based on NASA's own Basic tag.
 */
import { strFromU8, unzipSync } from 'fflate';

export interface FieldMeta {
  name: string;
  longName: string;
  units: string | null;
  fill: string | null;
  basic: boolean;
}

export type FieldMap = Map<string, FieldMeta>;

const child = (block: string, tag: string) => block.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))?.[1]?.trim() ?? null;

/**
 * Each field is an element whose children are all simple text elements and include
 * <long_name>; child order varies by product. Containers (with nested elements) never match.
 */
const FIELD_BLOCK = /<([A-Za-z]\w*)>((?:\s*<([A-Za-z]\w*)>[^<]*<\/\3>)+)\s*<\/\1>/g;

export function parseShapefileXml(xml: string): FieldMap {
  const fields: FieldMap = new Map();
  for (const m of xml.matchAll(FIELD_BLOCK)) {
    const [, name, body] = m;
    if (!name || !body?.includes('<long_name>')) continue;
    fields.set(name, {
      name,
      longName: child(body, 'long_name') ?? '',
      units: child(body, 'units'),
      fill: child(body, 'fill_value'),
      basic: child(body, 'tag_basic_expert') === 'Basic',
    });
  }
  return fields;
}

/** The .shp.xml from a zipped SWOT shapefile, if present. */
export function readShapefileXml(zip: ArrayBuffer): string | null {
  const files = unzipSync(new Uint8Array(zip), { filter: (f) => f.name.endsWith('.shp.xml') });
  const first = Object.values(files)[0];
  return first ? strFromU8(first) : null;
}

/** SWOT fill values: the column's declared fill, plus the generic ones used across products. */
export function isFill(value: unknown, meta?: FieldMeta): boolean {
  if (value === null || value === undefined || value === 'no_data') return true;
  if (typeof value === 'number') {
    if (value <= -1e11) return true; // -999999999999 in every product
    if (meta?.fill && meta.fill !== 'no_data' && Number(meta.fill) === value) return true;
  }
  return typeof value === 'string' && meta?.fill !== null && meta?.fill !== undefined && value === meta.fill;
}
