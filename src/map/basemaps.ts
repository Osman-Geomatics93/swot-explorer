/**
 * Basemaps, ported from geemap's basemaps.py (XYZ_TILES).
 *
 * Differences from basemaps.py:
 *  - OSM's `{s}` subdomain template is not supported by MapLibre, so the single host is used.
 *  - Overlays (WMS layers, place labels) are not included; the map shows only a basemap and SWOT data.
 *  - Google Maps (needs a paid key) and QMS search (arbitrary hosts) are not ported.
 */

import type { RasterSourceSpecification, StyleSpecification } from 'maplibre-gl';

export interface Basemap {
  id: string;
  name: string;
  url: string;
  attribution: string;
  maxzoom?: number;
}

const esri = (service: string) =>
  `https://server.arcgisonline.com/ArcGIS/rest/services/${service}/MapServer/tile/{z}/{y}/{x}`;

export const BASEMAPS: Basemap[] = [
  { id: 'satellite', name: 'Satellite (Esri)', url: esri('World_Imagery'), attribution: '© Esri, Maxar, Earthstar Geographics', maxzoom: 19 },
  { id: 'terrain', name: 'Topographic (Esri)', url: esri('World_Topo_Map'), attribution: '© Esri', maxzoom: 19 },
  { id: 'roadmap', name: 'Streets (Esri)', url: esri('World_Street_Map'), attribution: '© Esri', maxzoom: 19 },
  { id: 'osm', name: 'OpenStreetMap', url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', attribution: '© OpenStreetMap contributors', maxzoom: 19 },
  { id: 'dark', name: 'Dark (CARTO)', url: 'https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png', attribution: '© OpenStreetMap contributors © CARTO', maxzoom: 19 },
  { id: 'light', name: 'Light (CARTO)', url: 'https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png', attribution: '© OpenStreetMap contributors © CARTO', maxzoom: 19 },
];

export function rasterSource(layer: Basemap): RasterSourceSpecification {
  return {
    type: 'raster',
    tiles: [layer.url],
    tileSize: 256,
    attribution: layer.attribution,
    maxzoom: layer.maxzoom ?? 19,
  };
}

export const basemapSourceId = 'basemap';

export function baseStyle(basemap: Basemap): StyleSpecification {
  return {
    version: 8,
    sources: { [basemapSourceId]: rasterSource(basemap) },
    layers: [{ id: basemapSourceId, type: 'raster', source: basemapSourceId }],
  };
}

export function findBasemap(id: string): Basemap {
  return BASEMAPS.find((b) => b.id === id) ?? BASEMAPS[0]!;
}
