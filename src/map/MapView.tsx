import type { Feature, FeatureCollection } from 'geojson';
import { Pin, X } from 'lucide-react';
import {
  Map as MlMap,
  Marker,
  NavigationControl,
  ScaleControl,
  setWorkerUrl,
  type ExpressionSpecification,
  type GeoJSONSource,
  type MapLayerMouseEvent,
} from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useRef, useState } from 'react';
import {
  TerraDraw,
  TerraDrawCircleMode,
  TerraDrawFreehandMode,
  TerraDrawPointMode,
  TerraDrawPolygonMode,
  TerraDrawRectangleMode,
  TerraDrawRenderMode,
} from 'terra-draw';
import { TerraDrawMapLibreGLAdapter } from 'terra-draw-maplibre-gl-adapter';
import { baseStyle, basemapSourceId, findBasemap, rasterSource } from './basemaps';
import { LEVEL_TOKENS, NO_DATA_TOKEN, QUALITY_CLASSES, levelStops } from './symbology';
import { token } from '@/lib/tokens';
import { groupById } from '@/state/layers';
import { clipPolygon, type AreaSource, type StudyArea } from '@/state/studyArea';

// Load the worker from the extension bundle: MV3's CSP blocks MapLibre's default blob worker.
setWorkerUrl(workerUrl);

export type DrawTool = 'none' | 'rectangle' | 'polygon' | 'circle' | 'point' | 'freehand';

export interface ReservoirMarker {
  id: string;
  name: string;
  lngLat: [number, number];
}

interface Props {
  basemapId: string;
  /** Show the basemap; when off, data layers sit on a plain background. */
  showBasemap: boolean;
  tool: DrawTool;
  areas: StudyArea[];
  activeAreaId: string | null;
  reservoirs: ReservoirMarker[];
  /** Optional data layer, e.g. robust-mode observation pieces with a numeric `wse` property. */
  pieces?: FeatureCollection;
  /** Granule footprints from a search, with a boolean `selected` property. */
  footprints?: FeatureCollection;
  /** SWOT features previewed inside the study area. */
  preview?: MapPreview;
  /** Popup content for a clicked preview feature. */
  describeFeature?: (kind: PreviewKind, properties: Record<string, unknown>) => { title: string; rows: [string, string][] };
  /** Data layer groups to draw, top first (see state/layers.ts), and the hidden ones. */
  layerOrder?: string[];
  hiddenLayers?: string[];
  /** A previewed lake, reach or node was clicked. */
  onFeatureClick?: (kind: PreviewKind, properties: Record<string, unknown>, lngLat: [number, number]) => void;
  fitTo?: [number, number, number, number] | null;
  onDrawn: (feature: Feature, source: AreaSource) => void;
  onReservoirClick: (id: string) => void;
  /** The MapLibre map, once loaded (for figure export). */
  onReady?: (map: MlMap) => void;
}

/** A previewed feature under the pointer or pinned by a click, shown in the card over the map. */
interface CardFeature {
  key: string;
  source: string;
  id: number;
  title: string;
  rows: [string, string][];
}

const DATA_ANCHOR = 'areas-fill';
/** A previewed feature under the pointer or pinned by a click. */
const HOT = ['any', ['boolean', ['feature-state', 'hover'], false], ['boolean', ['feature-state', 'pinned'], false]] as ExpressionSpecification;
const LABEL_ZOOM = 5.5;

export type PreviewKind = 'lakes' | 'reaches' | 'nodes';
export interface MapPreview {
  layers: Partial<Record<PreviewKind, FeatureCollection>>;
  colorBy: 'wse' | 'quality';
  wseRange: [number, number] | null;
}
const PREVIEW_KINDS: PreviewKind[] = ['lakes', 'reaches', 'nodes'];

export function MapView(props: Props) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const drawRef = useRef<TerraDraw | null>(null);
  const loaded = useRef(false);
  const labels = useRef(new Map<string, HTMLElement>());
  const latest = useRef(props);
  const initialBasemap = useRef(props.basemapId).current;
  latest.current = props;
  const [hovered, setHovered] = useState<CardFeature | null>(null);
  const [pinned, setPinned] = useState<CardFeature | null>(null);
  const hoverRef = useRef<CardFeature | null>(null);
  const pinRef = useRef<CardFeature | null>(null);

  // Create the map once.
  useEffect(() => {
    if (!container.current) return;
    const map = new MlMap({
      container: container.current,
      style: baseStyle(findBasemap(props.basemapId)),
      center: [34.5, 13.5],
      zoom: 4.3,
      attributionControl: { compact: true },
    });
    mapRef.current = map;
    map.addControl(new NavigationControl({ visualizePitch: false }), 'bottom-right');
    map.addControl(new ScaleControl({ unit: 'metric' }), 'bottom-left');

    map.on('load', () => {
      addDataLayers(map);
      loaded.current = true;

      const draw = new TerraDraw({
        adapter: new TerraDrawMapLibreGLAdapter({ map }),
        modes: [
          new TerraDrawRectangleMode(),
          new TerraDrawPolygonMode(),
          new TerraDrawCircleMode(),
          new TerraDrawPointMode(),
          new TerraDrawFreehandMode(),
          new TerraDrawRenderMode({ modeName: 'static', styles: {} }),
        ],
      });
      draw.start();
      draw.setMode('static');
      draw.on('finish', (id, ctx) => {
        const feature = draw.getSnapshotFeature(id);
        if (!feature) return;
        draw.removeFeatures([id]); // finished shapes live in the study-area store
        latest.current.onDrawn(feature as Feature, ctx.mode as AreaSource);
      });
      drawRef.current = draw;

      syncData(map, latest.current);
      applyLayerOrder(map, latest.current.layerOrder, latest.current.hiddenLayers);
      // Map sources start collapsed to the ⓘ button.
      const attrib = map.getContainer().querySelector<HTMLElement>('.maplibregl-ctrl-attrib');
      if (attrib) {
        attrib.classList.remove('maplibregl-compact-show');
        attrib.removeAttribute('open');
        const button = attrib.querySelector<HTMLElement>('.maplibregl-ctrl-attrib-button');
        button?.setAttribute('title', 'Show or hide map sources');
        button?.setAttribute('aria-label', 'Show or hide map sources');
      }
      setBasemapVisible(map, latest.current.showBasemap);
      latest.current.onReady?.(map);

      // Choices made while the map was still loading.
      if (latest.current.tool !== 'none') draw.setMode(latest.current.tool);
      if (latest.current.basemapId !== initialBasemap) setBasemap(map, latest.current.basemapId, latest.current.showBasemap);
    });

    // Previewed features: hovering outlines one and shows its values in the card; a click pins it.
    const previewLayerIds = ['preview-nodes', 'preview-reaches', 'preview-lakes', 'preview-lakes-line'];
    const featureAt = (point: { x: number; y: number }): (CardFeature & { kind: PreviewKind; properties: Record<string, unknown> }) | null => {
      const describe = latest.current.describeFeature;
      const layers = previewLayerIds.filter((id) => map.getLayer(id) && map.getLayoutProperty(id, 'visibility') !== 'none');
      const hit = describe && layers.length ? map.queryRenderedFeatures([point.x, point.y], { layers })[0] : undefined;
      if (!hit || hit.id === undefined) return null;
      const kind = hit.source.replace('preview-', '') as PreviewKind;
      const properties = hit.properties as Record<string, unknown>;
      return { key: `${hit.source}/${hit.id}`, source: hit.source, id: Number(hit.id), kind, properties, ...describe!(kind, properties) };
    };
    const mark = (f: CardFeature | null, state: 'hover' | 'pinned', on: boolean) => {
      if (f && map.getSource(f.source)) map.setFeatureState({ source: f.source, id: f.id }, { [state]: on });
    };
    let frame = 0;
    map.on('mousemove', (e) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const f = latest.current.tool === 'none' ? featureAt(e.point) : null;
        if (f?.key === hoverRef.current?.key) return;
        mark(hoverRef.current, 'hover', false);
        mark(f, 'hover', true);
        hoverRef.current = f;
        setHovered(f);
        map.getCanvas().style.cursor = f ? 'pointer' : '';
      });
    });
    map.getCanvas().addEventListener('mouseleave', () => {
      cancelAnimationFrame(frame);
      mark(hoverRef.current, 'hover', false);
      hoverRef.current = null;
      setHovered(null);
    });
    map.on('click', (e) => {
      if (latest.current.tool !== 'none') return;
      const f = featureAt(e.point);
      mark(pinRef.current, 'pinned', false);
      mark(f, 'pinned', true);
      pinRef.current = f;
      setPinned(f);
      if (f) latest.current.onFeatureClick?.(f.kind, f.properties, [e.lngLat.lng, e.lngLat.lat]);
    });

    map.on('click', 'reservoirs', (e: MapLayerMouseEvent) => {
      const id = e.features?.[0]?.properties?.id;
      if (typeof id === 'string') latest.current.onReservoirClick(id);
    });
    // Names stay hidden at regional zoom (they collide) and appear on zoom-in or hover.
    const showLabels = () => map.getContainer().classList.toggle('labels-on', map.getZoom() >= LABEL_ZOOM);
    map.on('zoom', showLabels);
    showLabels();
    map.on('mousemove', 'reservoirs', (e: MapLayerMouseEvent) => {
      map.getCanvas().style.cursor = 'pointer';
      const id = e.features?.[0]?.properties?.id;
      for (const [rid, el] of labels.current) el.classList.toggle('is-hovered', rid === id);
    });
    map.on('mouseleave', 'reservoirs', () => {
      map.getCanvas().style.cursor = '';
      for (const el of labels.current.values()) el.classList.remove('is-hovered');
    });

    const resize = new ResizeObserver(() => map.resize());
    resize.observe(container.current);
    return () => {
      resize.disconnect();
      drawRef.current?.stop();
      map.remove();
      mapRef.current = null;
      loaded.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Basemap: swap the raster source in place so data layers survive.
  useEffect(() => {
    const map = mapRef.current;
    if (map && loaded.current) setBasemap(map, props.basemapId, latest.current.showBasemap);
  }, [props.basemapId]);

  useEffect(() => {
    const map = mapRef.current;
    if (map && loaded.current) setBasemapVisible(map, props.showBasemap);
  }, [props.showBasemap]);

  useEffect(() => {
    const map = mapRef.current;
    if (map && loaded.current) applyLayerOrder(map, props.layerOrder, props.hiddenLayers);
  }, [props.layerOrder, props.hiddenLayers]);

  useEffect(() => {
    drawRef.current?.setMode(props.tool === 'none' ? 'static' : props.tool);
  }, [props.tool]);

  useEffect(() => {
    const map = mapRef.current;
    if (map && loaded.current) syncData(map, props);
  }, [props.areas, props.activeAreaId, props.reservoirs, props.pieces, props.footprints, props.preview]);

  // New preview data renumbers the features: keep the pinned one by its position, refresh its values.
  useEffect(() => {
    const map = mapRef.current;
    const describe = props.describeFeature;
    const refresh = (f: CardFeature | null, state: 'hover' | 'pinned'): CardFeature | null => {
      if (!f || !map || !describe) return null;
      const kind = f.source.replace('preview-', '') as PreviewKind;
      const feature = props.preview?.layers[kind]?.features[f.id];
      if (!feature) return null;
      map.setFeatureState({ source: f.source, id: f.id }, { [state]: true });
      return { ...f, ...describe(kind, (feature.properties ?? {}) as Record<string, unknown>) };
    };
    pinRef.current = refresh(pinRef.current, 'pinned');
    setPinned(pinRef.current);
    hoverRef.current = null;
    setHovered(null);
  }, [props.preview, props.describeFeature]);

  const unpin = () => {
    const map = mapRef.current;
    if (map && pinRef.current && map.getSource(pinRef.current.source)) map.setFeatureState({ source: pinRef.current.source, id: pinRef.current.id }, { pinned: false });
    pinRef.current = null;
    setPinned(null);
  };

  // Reservoir names as HTML markers: they use the app's own font and need no remote glyph server.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const markers = props.reservoirs.map((r) => {
      // MapLibre sets an inline opacity on the marker element, so the label is a child of it.
      const wrapper = document.createElement('div');
      const label = wrapper.appendChild(document.createElement('span'));
      label.className = 'map-label';
      label.textContent = r.name;
      labels.current.set(r.id, label);
      return new Marker({ element: wrapper, anchor: 'top', offset: [0, 8] }).setLngLat(r.lngLat).addTo(map);
    });
    return () => {
      markers.forEach((m) => m.remove());
      labels.current.clear();
    };
  }, [props.reservoirs]);

  useEffect(() => {
    if (props.fitTo && mapRef.current) mapRef.current.fitBounds(props.fitTo, { padding: 40, maxZoom: 11 });
  }, [props.fitTo]);

  const card = hovered ?? pinned;
  const isPinned = Boolean(card && pinned && card.key === pinned.key);
  return (
    <>
      {/* bg-sunken shows through when the basemap is hidden. */}
      <div ref={container} className="h-full w-full bg-sunken" />
      {card && (
        <div
          role="status"
          aria-label={isPinned ? `${card.title} (pinned)` : card.title}
          className="swot-popup map-card absolute top-16 right-3 z-20 w-72 max-w-[calc(100%-1.5rem)] animate-[rise_0.24s_var(--ease)_both] rounded-ui border border-line bg-surface/95 p-4 shadow-float backdrop-blur-md"
        >
          <div className="mb-2 flex items-start gap-2">
            <p className="swot-popup-title min-w-0 flex-1 truncate text-body font-medium text-ink">{card.title}</p>
            {isPinned ? (
              <button
                type="button"
                aria-label="Unpin"
                title="Unpin"
                onClick={unpin}
                className="-mt-1 -mr-2 inline-flex size-7 shrink-0 items-center justify-center rounded-ui text-ink-3 transition-colors duration-200 ease-signature hover:bg-sunken hover:text-ink"
              >
                <X aria-hidden size={14} strokeWidth={1.75} />
              </button>
            ) : (
              <span className="inline-flex shrink-0 items-center gap-1 text-eyebrow text-ink-3">
                <Pin aria-hidden size={12} strokeWidth={1.75} />
                Click to pin
              </span>
            )}
          </div>
          <dl className="tabular grid max-h-56 grid-cols-[auto_1fr] gap-x-4 gap-y-1 overflow-y-auto text-meta">
            {(isPinned ? card.rows : card.rows.filter(([k]) => /level|quality|observed|width|area/i.test(k))).map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-ink-3">{k}</dt>
                <dd className="m-0 text-right text-ink">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </>
  );
}

function setBasemapVisible(map: MlMap, show: boolean) {
  if (map.getLayer(basemapSourceId)) map.setLayoutProperty(basemapSourceId, 'visibility', show ? 'visible' : 'none');
}

function setBasemap(map: MlMap, id: string, show: boolean) {
  if (map.getLayer(basemapSourceId)) map.removeLayer(basemapSourceId);
  if (map.getSource(basemapSourceId)) map.removeSource(basemapSourceId);
  map.addSource(basemapSourceId, rasterSource(findBasemap(id)));
  const first = map.getStyle().layers[0]?.id;
  map.addLayer({ id: basemapSourceId, type: 'raster', source: basemapSourceId, layout: { visibility: show ? 'visible' : 'none' } }, first);
}

function addDataLayers(map: MlMap) {
  const empty: FeatureCollection = { type: 'FeatureCollection', features: [] };
  for (const id of ['areas', 'footprints', 'reservoirs', 'pieces']) map.addSource(id, { type: 'geojson', data: empty });
  // Preview features get ids (their index) so hover and pin can be drawn with feature state.
  for (const id of ['preview-lakes', 'preview-reaches', 'preview-nodes']) map.addSource(id, { type: 'geojson', data: empty, generateId: true });

  map.addLayer({
    id: 'footprints',
    type: 'line',
    source: 'footprints',
    paint: {
      'line-color': ['case', ['get', 'selected'], token('map-selected'), token('map-footprint')],
      'line-width': ['case', ['get', 'selected'], 1.5, 0.75],
    },
  });

  map.addLayer({
    id: DATA_ANCHOR,
    type: 'fill',
    source: 'areas',
    paint: { 'fill-color': token('map-area'), 'fill-opacity': ['case', ['get', 'active'], 0.16, 0.05] },
  });
  map.addLayer({
    id: 'areas-line',
    type: 'line',
    source: 'areas',
    paint: { 'line-color': token('map-area'), 'line-width': ['case', ['get', 'active'], 2, 1], 'line-dasharray': ['case', ['get', 'active'], ['literal', [1]], ['literal', [2, 2]]] },
  });
  map.addLayer({
    id: 'pieces',
    type: 'fill',
    source: 'pieces',
    paint: {
      'fill-color': [
        'case',
        ['!', ['get', 'kept']],
        token('map-rejected'),
        ['interpolate', ['linear'], ['get', 'wse_dev'], -5, token('map-low'), 0, token('map-area'), 5, token('map-high')],
      ],
      'fill-opacity': 0.8,
      'fill-outline-color': token('map-label-halo'),
    },
  });
  // Preview of SWOT features: lakes under reaches under nodes; colours are set in syncPreview.
  // Features failing the QC rule are drawn faint (the legend says so).
  const failsQc = ['==', ['get', 'qc_pass'], false];
  const faint = (pass: number, fail: number) => ['case', HOT, 1, failsQc, fail, pass] as unknown as number;
  // Lakes: a translucent fill so the imagery shows through, and a crisp outline in the same colour.
  map.addLayer({ id: 'preview-lakes', type: 'fill', source: 'preview-lakes', paint: { 'fill-opacity': faint(0.55, 0.18) } });
  map.addLayer({
    id: 'preview-lakes-line',
    type: 'line',
    source: 'preview-lakes',
    layout: { 'line-join': 'round' },
    paint: { 'line-width': ['interpolate', ['linear'], ['zoom'], 6, ['case', HOT, 3, 1], 12, ['case', HOT, 4, 2]], 'line-opacity': faint(1, 0.4) },
  });
  // Reaches: a dark casing under the coloured line keeps them readable on bright imagery.
  map.addLayer({
    id: 'preview-reaches-casing',
    type: 'line',
    source: 'preview-reaches',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': ['case', HOT, token('map-selected'), token('map-label-halo')],
      'line-width': ['interpolate', ['linear'], ['zoom'], 6, ['case', HOT, 7, 4], 12, ['case', HOT, 12, 8]],
      'line-opacity': faint(0.55, 0.2),
    },
  });
  map.addLayer({
    id: 'preview-reaches',
    type: 'line',
    source: 'preview-reaches',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-width': ['interpolate', ['linear'], ['zoom'], 6, 2, 12, 5], 'line-opacity': faint(1, 0.35) },
  });
  map.addLayer({
    id: 'preview-nodes',
    type: 'circle',
    source: 'preview-nodes',
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 6, ['case', HOT, 4, 2], 12, ['case', HOT, 7, 5]],
      'circle-stroke-color': ['case', HOT, token('map-selected'), token('map-area')],
      'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 6, ['case', HOT, 2, 0.5], 12, ['case', HOT, 2.5, 1.5]],
      'circle-opacity': faint(1, 0.35),
      'circle-stroke-opacity': faint(0.9, 0.3),
    },
  });

  map.addLayer({
    id: 'reservoirs',
    type: 'circle',
    source: 'reservoirs',
    paint: {
      'circle-radius': 5,
      'circle-color': token('map-reservoir'),
      'circle-stroke-color': token('map-area'),
      'circle-stroke-width': 2,
    },
  });
}

/** Same colours as the legend (map/symbology.ts). */
function colorExpression(p: MapPreview): unknown {
  if (p.colorBy === 'quality') {
    return [
      'match',
      ['coalesce', ['get', 'reach_q'], ['get', 'node_q'], ['get', 'quality_f'], -1],
      ...QUALITY_CLASSES.flatMap((q) => [q.code, token(q.token)]),
      token(NO_DATA_TOKEN),
    ];
  }
  const stops = levelStops(p.wseRange ?? [0, 1]);
  return [
    'case',
    ['==', ['typeof', ['get', 'wse']], 'number'],
    ['interpolate', ['linear'], ['get', 'wse'], ...stops.flatMap((v, i) => [v, token(LEVEL_TOKENS[i]!)])],
    token(NO_DATA_TOKEN),
  ];
}

function syncPreview(map: MlMap, preview: MapPreview | undefined) {
  const empty: FeatureCollection = { type: 'FeatureCollection', features: [] };
  for (const kind of PREVIEW_KINDS) (map.getSource(`preview-${kind}`) as GeoJSONSource).setData(preview?.layers[kind] ?? empty);
  if (!preview) return;
  const color = colorExpression(preview) as never;
  map.setPaintProperty('preview-lakes', 'fill-color', color);
  map.setPaintProperty('preview-lakes-line', 'line-color', ['case', HOT, token('map-selected'), color]);
  map.setPaintProperty('preview-reaches', 'line-color', color);
  map.setPaintProperty('preview-nodes', 'circle-color', color);
}

/**
 * Stack the data layers in the chosen order just below the reservoir markers
 * (which stay on top); the basemap stays at the bottom.
 */
function applyLayerOrder(map: MlMap, order: string[] | undefined, hidden: string[] | undefined) {
  if (!order) return;
  for (const groupId of [...order].reverse()) {
    for (const layerId of [...(groupById.get(groupId)?.mapLayers ?? [])].reverse()) {
      if (!map.getLayer(layerId)) continue;
      map.moveLayer(layerId, 'reservoirs');
      map.setLayoutProperty(layerId, 'visibility', hidden?.includes(groupId) ? 'none' : 'visible');
    }
  }
}

function syncData(map: MlMap, p: Props) {
  const areas: Feature[] = p.areas.flatMap((a) => {
    const poly = clipPolygon(a);
    const shapes: Feature[] = [];
    if (poly) shapes.push({ ...poly, properties: { id: a.id, active: a.id === p.activeAreaId } });
    if (a.geometry.type.includes('Point') || a.geometry.type.includes('Line'))
      shapes.push({ type: 'Feature', geometry: a.geometry, properties: { id: a.id, active: a.id === p.activeAreaId } });
    return shapes;
  });
  (map.getSource('areas') as GeoJSONSource).setData({ type: 'FeatureCollection', features: areas });
  (map.getSource('reservoirs') as GeoJSONSource).setData({
    type: 'FeatureCollection',
    features: p.reservoirs.map((r) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: r.lngLat },
      properties: { id: r.id, name: r.name },
    })),
  });
  (map.getSource('pieces') as GeoJSONSource).setData(p.pieces ?? { type: 'FeatureCollection', features: [] });
  (map.getSource('footprints') as GeoJSONSource).setData(p.footprints ?? { type: 'FeatureCollection', features: [] });
  syncPreview(map, p.preview);
}
