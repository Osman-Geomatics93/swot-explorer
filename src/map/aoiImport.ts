/**
 * Read a study area from a user file: GeoJSON, KML, or a zipped Shapefile.
 * Returns the polygon/point geometries found; the caller decides how to merge them.
 */
import type { Feature, FeatureCollection, Geometry } from 'geojson';
import shp from 'shpjs';

export class AoiImportError extends Error {}

export async function readAoiFile(file: File): Promise<Feature[]> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.geojson') || name.endsWith('.json')) return fromGeoJson(JSON.parse(await file.text()));
  if (name.endsWith('.kml')) return fromKml(await file.text());
  if (name.endsWith('.zip')) return fromGeoJson(await shp(await file.arrayBuffer()));
  throw new AoiImportError('Use a .geojson, .kml or zipped Shapefile (.zip).');
}

const finitePair = (c: unknown) => Array.isArray(c) && c.length >= 2 && Number.isFinite(c[0]) && Number.isFinite(c[1]);
const ring = (r: unknown, min: number) => Array.isArray(r) && r.length >= min && r.every(finitePair);

/** Only geometries the map and clipper can use: no GeometryCollection, no empty or broken coordinates. */
export function isValidGeometry(g: Geometry | null | undefined): boolean {
  if (!g || !('coordinates' in g)) return false;
  const c = g.coordinates as unknown;
  switch (g.type) {
    case 'Point':
      return finitePair(c);
    case 'MultiPoint':
      return ring(c, 1);
    case 'LineString':
      return ring(c, 2);
    case 'MultiLineString':
      return Array.isArray(c) && c.length > 0 && c.every((l) => ring(l, 2));
    case 'Polygon':
      return Array.isArray(c) && c.length > 0 && c.every((r) => ring(r, 4));
    case 'MultiPolygon':
      return Array.isArray(c) && c.length > 0 && c.every((p) => Array.isArray(p) && p.length > 0 && p.every((r) => ring(r, 4)));
    default:
      return false;
  }
}

function fromGeoJson(data: unknown): Feature[] {
  const collections = (Array.isArray(data) ? data : [data]) as (FeatureCollection | Feature | Geometry)[];
  const features: Feature[] = [];
  for (const c of collections) {
    if (c.type === 'FeatureCollection') features.push(...c.features);
    else if (c.type === 'Feature') features.push(c);
    else features.push({ type: 'Feature', properties: {}, geometry: c });
  }
  const usable = features.filter((f) => isValidGeometry(f.geometry));
  if (!usable.length) throw new AoiImportError('No geometry found in the file.');
  return usable;
}

const coords = (text: string): number[][] =>
  text
    .trim()
    .split(/\s+/)
    .map((t) => t.split(',').slice(0, 2).map(Number))
    .filter((c) => c.length === 2 && c.every(Number.isFinite));

/** Minimal KML reader: Point, LineString and Polygon (outer + inner rings) inside Placemarks. */
function fromKml(text: string): Feature[] {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) throw new AoiImportError('The KML file could not be read.');
  const features: Feature[] = [];

  for (const pm of Array.from(doc.getElementsByTagName('Placemark'))) {
    const name = pm.getElementsByTagName('name')[0]?.textContent ?? '';
    const push = (geometry: Geometry) => features.push({ type: 'Feature', properties: { name }, geometry });

    for (const p of Array.from(pm.getElementsByTagName('Polygon'))) {
      const ring = (tag: string) =>
        Array.from(p.getElementsByTagName(tag)).map((b) => coords(b.getElementsByTagName('coordinates')[0]?.textContent ?? ''));
      push({ type: 'Polygon', coordinates: [...ring('outerBoundaryIs'), ...ring('innerBoundaryIs')] });
    }
    for (const l of Array.from(pm.getElementsByTagName('LineString'))) {
      push({ type: 'LineString', coordinates: coords(l.getElementsByTagName('coordinates')[0]?.textContent ?? '') });
    }
    for (const pt of Array.from(pm.getElementsByTagName('Point'))) {
      const c = coords(pt.getElementsByTagName('coordinates')[0]?.textContent ?? '')[0];
      if (c) push({ type: 'Point', coordinates: c });
    }
  }
  const usable = features.filter((f) => isValidGeometry(f.geometry));
  if (!usable.length) throw new AoiImportError('No Placemark geometry found in the KML file.');
  return usable;
}
