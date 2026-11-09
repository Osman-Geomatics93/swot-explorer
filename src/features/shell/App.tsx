import bbox from '@turf/bbox';
import type { Feature, FeatureCollection } from 'geojson';
import {
  Circle,
  Command as CommandIcon,
  Droplets,
  ImageDown,
  Layers,
  Map as MapIcon,
  MapPin,
  Maximize2,
  Monitor,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Pentagon,
  PenLine,
  Settings,
  Sparkles,
  Square,
  Sun,
} from 'lucide-react';
import type { Map as MlMap } from 'maplibre-gl';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useAccount } from '@/auth/useAccount';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { Toaster } from '@/components/Toaster';
import { IconButton } from '@/components/ui';
import reservoirsConfig from '@/config/reservoirs.json';
import { summarize } from '@/downloads/queue';
import { useQueue } from '@/downloads/queueClient';
import { AccountMenu } from '@/features/account/AccountMenu';
import { SignInScreen } from '@/features/account/SignInScreen';
import { StudyAreaPanel } from '@/features/aoi/StudyAreaPanel';
import { CascadePanel } from '@/features/compare/CascadePanel';
import { DownloadsPanel } from '@/features/downloads/DownloadsPanel';
import { MapToolbar } from '@/features/map/MapToolbar';
import { PassTimeline } from '@/features/map/PassTimeline';
import type { Describe } from '@/features/preview/PreviewPanel';
import { TimeSeriesPanel, type SeriesTarget } from '@/features/timeseries/TimeSeriesPanel';
import { idOf } from '@/timeseries/featureSeries';
import type { Reservoir } from '@/features/robust/RobustPanel';
import { SavedPanel } from '@/features/saved/SavedPanel';
import { SearchPanel } from '@/features/search/SearchPanel';
import { CommandPalette, type Command } from '@/features/shell/CommandPalette';
import { GettingStarted, guideDismissed, markReservoirOpened, setGuideDismissed } from '@/features/shell/GettingStarted';
import { NavRail, NavTabs, TABS, type Tab } from '@/features/shell/nav';
import { ReservoirsSection } from '@/features/shell/ReservoirsSection';
import { PANEL_MAX, PANEL_MIN, usePanelWidth } from '@/features/shell/usePanelWidth';
import { exportMapFigure } from '@/map/exportMap';
import { MapView, type DrawTool, type MapPreview, type ReservoirMarker } from '@/map/MapView';
import { completeOrder, useLayers } from '@/state/layers';
import { useRunSavedSearch } from '@/state/runSavedSearch';
import { clipPolygon, useStudyAreas, type AreaSource } from '@/state/studyArea';
import { nextTheme, THEME_LABEL, useTheme, type ThemeMode } from '@/state/theme';
import { toast } from '@/state/toast';
import { db } from '@/storage/db';

type Layout = 'panel' | 'page';

const THEME_ICON: Record<ThemeMode, typeof Sun> = { auto: Monitor, light: Sun, dark: Moon };
const DRAW_COMMANDS: { tool: DrawTool; label: string; icon: typeof Sun }[] = [
  { tool: 'rectangle', label: 'Draw a rectangle', icon: Square },
  { tool: 'polygon', label: 'Draw a polygon', icon: Pentagon },
  { tool: 'circle', label: 'Draw a circle', icon: Circle },
  { tool: 'point', label: 'Place a point', icon: MapPin },
  { tool: 'freehand', label: 'Draw freehand', icon: PenLine },
];

const reservoirs = reservoirsConfig.reservoirs as (Reservoir & {
  dam: number[];
})[];

const SOURCE_LABEL: Record<AreaSource, string> = {
  rectangle: 'Rectangle',
  polygon: 'Polygon',
  circle: 'Circle',
  point: 'Point',
  freehand: 'Freehand area',
  upload: 'Upload',
  reservoir: 'Reservoir',
};

export function App({ layout }: { layout: Layout }) {
  const { areas, activeId, add } = useStudyAreas();
  const [basemapId, setBasemapId] = useState('satellite');
  const [tool, setTool] = useState<DrawTool>('none');
  const [reservoirId, setReservoirId] = useState<string | null>(null);
  const [pieces, setPieces] = useState<FeatureCollection | undefined>();
  const [footprints, setFootprints] = useState<FeatureCollection | undefined>();
  const [preview, setPreview] = useState<{
    map?: MapPreview;
    describe?: Describe;
  }>({});
  const [seriesTarget, setSeriesTarget] = useState<SeriesTarget | null>(null);
  const layers = useLayers();
  // A pass-history frame drawn instead of the previewed pass, and the day it shows.
  const [frame, setFrame] = useState<{ map: MapPreview; label: string } | null>(null);
  const onFrame = useCallback((map: MapPreview | null, label: string | null) => setFrame(map && label ? { map, label } : null), []);
  const mapInstance = useRef<MlMap | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(() => !guideDismissed());
  const theme = useTheme();
  const ThemeIcon = THEME_ICON[theme.mode];

  // Ctrl+K (⌘K on a Mac) opens the command palette from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Layer groups that currently have something on the map, for the Layers panel and drawing order.
  const activeLayers = useMemo(
    () => [
      ...(['nodes', 'reaches', 'lakes'] as const).filter((k) => preview.map?.layers[k]).map((k) => `preview-${k}`),
      ...(pieces ? ['pieces'] : []),
      ...(footprints?.features.length ? ['footprints'] : []),
      ...(areas.length ? ['areas'] : []),
    ],
    [preview.map, pieces, footprints, areas.length],
  );
  const layerOrder = useMemo(() => completeOrder(layers.order), [layers.order]);
  const [fitTo, setFitTo] = useState<[number, number, number, number] | null>(null);
  const [tab, setTab] = useState<Tab>('search');
  // Full page: the panel beside the rail can be hidden to give the map the whole width.
  const [panelOpen, setPanelOpen] = useState(true);
  // Side panel: the map can be folded away to give the tools the whole height.
  const [mapOpen, setMapOpen] = useState(true);
  const panelWidth = usePanelWidth();
  const openTab = (t: Tab) => {
    setTab(t);
    setPanelOpen(true);
  };
  const pending = summarize(useQueue()).pending;
  const account = useAccount();
  const [wantsSignIn, setWantsSignIn] = useState(false);
  // Once signed in, a later sign-out should respect an earlier "continue without signing in".
  useEffect(() => {
    if (account.info && !account.info.expired) setWantsSignIn(false);
  }, [account.info]);

  const markers = useMemo<ReservoirMarker[]>(
    () =>
      reservoirs.map((r) => ({
        id: r.id,
        name: r.name,
        lngLat: [r.dam[0]!, r.dam[1]!],
      })),
    [],
  );
  const reservoir = reservoirs.find((r) => r.id === reservoirId) ?? null;
  const runSaved = useRunSavedSearch();

  useEffect(() => {
    const id = new URLSearchParams(location.search).get('saved');
    if (!id) return;
    void db.savedSearches.get(id).then((s) => {
      if (!s) return;
      openTab('search');
      runSaved(s);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onDrawn = (feature: Feature, source: AreaSource) => {
    const count = areas.filter((a) => a.source === source).length + 1;
    add({
      id: crypto.randomUUID(),
      name: `${SOURCE_LABEL[source]} ${count}`,
      source,
      geometry: feature.geometry,
      bufferKm: source === 'point' ? 5 : 0,
    });
    setTool('none');
  };

  const selectReservoir = (id: string) => {
    const r = reservoirs.find((x) => x.id === id);
    if (!r) return;
    setReservoirId(id);
    markReservoirOpened();
    openTab('reservoirs');
    setPieces(undefined);
    const [lng, lat] = [r.dam[0]!, r.dam[1]!];
    setFitTo([lng - 0.4, lat - 0.4, lng + 0.4, lat + 0.4]);
  };

  const exportMap = async () => {
    const m = mapInstance.current;
    if (!m) return;
    const area = areas.find((a) => a.id === activeId);
    const shown = frame?.map ?? preview.map;
    const time = Object.values(preview.map?.layers ?? {})
      .flatMap((fc) => fc?.features ?? [])
      .map((f) => String(f.properties?.time_str ?? ''))
      .find((t) => /^\d{4}-\d{2}-\d{2}/.test(t));
    try {
      const path = await exportMapFigure(m, {
        title: area && preview.map ? `${area.name} · SWOT water surface elevation` : area ? area.name : 'SWOT Explorer',
        subtitle: frame ? `Pass history · ${frame.label}` : time ? `Pass of ${time.slice(0, 10)}` : undefined,
        preview: shown,
        labels: markers,
        name: `map_${(area?.name ?? 'swot').replace(/[^\w-]+/g, '_')}_${new Date().toISOString().slice(0, 10)}`,
      });
      toast(`Map figure saved to Downloads/${path}`);
    } catch (err) {
      toast(err instanceof Error ? `Map not saved: ${err.message}` : 'Map not saved.', { tone: 'error' });
    }
  };

  const commands = useMemo<Command[]>(
    () => [
      ...TABS.map((t) => ({ id: `tab-${t.id}`, group: 'Go to', label: t.label, icon: t.icon, keywords: t.hint, run: () => openTab(t.id) })),
      ...reservoirs.map((r) => ({
        id: `res-${r.id}`,
        group: 'Reservoirs',
        label: r.name,
        icon: Droplets,
        keywords: `${r.country} ${r.lake_id} robust gauge validation`,
        hint: r.country,
        run: () => selectReservoir(r.id),
      })),
      ...DRAW_COMMANDS.map((d) => ({
        id: `draw-${d.tool}`,
        group: 'Map',
        label: d.label,
        icon: d.icon,
        keywords: 'study area',
        run: () => {
          openTab('search');
          setTool(d.tool);
        },
      })),
      {
        id: 'basemap',
        group: 'Map',
        label: layers.basemapHidden ? 'Show basemap' : 'Hide basemap',
        icon: Layers,
        keywords: 'imagery satellite background',
        run: () => layers.setBasemapHidden(!layers.basemapHidden),
      },
      { id: 'export-map', group: 'Map', label: 'Export map figure', icon: ImageDown, hint: 'PNG · 300 dpi', keywords: 'save image print', run: () => void exportMap() },
      ...(layout === 'page'
        ? [{ id: 'panel', group: 'Map', label: panelOpen ? 'Full-width map (hide panel)' : 'Show panel', icon: panelOpen ? PanelLeftClose : PanelLeftOpen, run: () => setPanelOpen((o) => !o) }]
        : [{ id: 'mapfold', group: 'Map', label: mapOpen ? 'Hide map' : 'Show map', icon: MapIcon, run: () => setMapOpen((o) => !o) }]),
      ...(['auto', 'light', 'dark'] as const).map((m) => ({
        id: `theme-${m}`,
        group: 'Appearance',
        label: `Theme: ${THEME_LABEL[m]}`,
        icon: THEME_ICON[m],
        keywords: 'dark light mode colour',
        hint: theme.mode === m ? 'current' : undefined,
        run: () => theme.setMode(m),
      })),
      {
        id: 'guide',
        group: 'Help',
        label: 'Getting started guide',
        icon: Sparkles,
        keywords: 'help welcome tour',
        run: () => {
          setGuideDismissed(false);
          setGuideOpen(true);
          openTab('search');
        },
      },
      { id: 'options', group: 'Help', label: 'Options', icon: Settings, keywords: 'settings keys dahiti hydroweb', run: () => void browser.runtime.openOptionsPage() },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [layers.basemapHidden, layout, panelOpen, mapOpen, theme.mode, areas, activeId, preview.map, frame],
  );

  const themeButton = (
    <IconButton
      icon={ThemeIcon}
      label={`Theme: ${THEME_LABEL[theme.mode]} · click for ${THEME_LABEL[nextTheme(theme.mode)]}`}
      onClick={() => theme.setMode(nextTheme(theme.mode))}
    />
  );
  const paletteButton = <IconButton icon={CommandIcon} label="Commands (Ctrl+K)" onClick={() => setPaletteOpen(true)} />;

  const map = (
    <div className="relative h-full">
      <MapView
        onReady={(m) => (mapInstance.current = m)}
        basemapId={basemapId}
        showBasemap={!layers.basemapHidden}
        tool={tool}
        areas={areas}
        activeAreaId={activeId}
        reservoirs={markers}
        pieces={pieces}
        footprints={footprints}
        preview={frame?.map ?? preview.map}
        layerOrder={layerOrder}
        hiddenLayers={layers.hidden}
        describeFeature={preview.describe}
        onFeatureClick={(kind, p, lngLat) => {
          const id = idOf(kind, p);
          if (id)
            setSeriesTarget({
              kind,
              id,
              name: preview.describe?.(kind, p).title ?? id,
              lngLat,
            });
        }}
        fitTo={fitTo}
        onDrawn={onDrawn}
        onReservoirClick={selectReservoir}
      />
      <MapToolbar
        basemapId={basemapId}
        tool={tool}
        onBasemap={setBasemapId}
        onTool={setTool}
        activeLayers={activeLayers}
        onExport={() => void exportMap()}
      />
      <PassTimeline preview={preview.map} onFrame={onFrame} />
      {layout === 'page' && seriesTarget && (
        <ErrorBoundary label="Time series">
          <TimeSeriesPanel target={seriesTarget} layout="overlay" onClose={() => setSeriesTarget(null)} />
        </ErrorBoundary>
      )}
    </div>
  );

  // Sections stay mounted so a running search, clip or analysis survives switching, and each keeps
  // its own scroll position. `.reveal` replays its staggered entrance each time a section is shown.
  const pane = (id: Tab, children: ReactNode) => (
    <div role="tabpanel" aria-label={id} hidden={tab !== id} className="absolute inset-0 overflow-y-auto">
      <div className="reveal space-y-12 px-6 pt-8 pb-16">{children}</div>
    </div>
  );
  const sections = (
    <>
      {pane(
        'search',
        <>
          {guideOpen && (
            <GettingStarted
              onDraw={() => setTool('rectangle')}
              onSearch={() => document.getElementById('s-what-to-look-for')?.scrollIntoView({ behavior: 'smooth' })}
              onReservoirs={() => openTab('reservoirs')}
              onDismiss={() => {
                setGuideDismissed(true);
                setGuideOpen(false);
              }}
            />
          )}
          <StudyAreaPanel />
          <SearchPanel
            onFootprints={setFootprints}
            onShowDownloads={() => openTab('downloads')}
            onPreview={(map, describe) => {
              // Zoom to the study area when a preview first appears.
              const active = areas.find((a) => a.id === activeId);
              const poly = active ? clipPolygon(active) : null;
              if (map && !preview.map && poly) setFitTo(bbox(poly) as [number, number, number, number]);
              setPreview({ map, describe });
            }}
          />
        </>,
      )}
      {pane(
        'reservoirs',
        <ReservoirsSection
          reservoirs={reservoirs}
          selected={reservoir}
          onSelect={selectReservoir}
          onBack={() => {
            setReservoirId(null);
            setPieces(undefined);
          }}
          onPieces={setPieces}
        />,
      )}
      {pane(
        'compare',
        <ErrorBoundary label="Cascade comparison">
          <CascadePanel />
        </ErrorBoundary>,
      )}
      {pane('downloads', <DownloadsPanel />)}
      {pane('saved', <SavedPanel onOpenSearch={() => openTab('search')} />)}
    </>
  );

  // Wait for both the account and the "skipped" choice, so the sign-in screen never flashes.
  if (account.info === undefined || account.skipped === undefined) return null;
  const signedIn = Boolean(account.info && !account.info.expired);
  // An overlay, not a replacement: signing in or out keeps the map, results and running work.
  const showSignIn = !signedIn && (wantsSignIn || !account.skipped);
  const overlays = (
    <>
      <CommandPalette open={paletteOpen} commands={commands} onClose={() => setPaletteOpen(false)} />
      <Toaster />
    </>
  );
  const signIn = showSignIn && (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-paper">
      <SignInScreen
        expired={account.info?.expired}
        onSkip={() => {
          account.skip();
          setWantsSignIn(false);
        }}
      />
    </div>
  );

  if (layout === 'page') {
    return (
      <div className="flex h-screen">
        {signIn}
        {overlays}
        <aside className="flex w-20 shrink-0 flex-col items-center border-r border-line bg-paper py-3">
          <img src="/logo-mark.png" alt="SWOT Explorer" width={32} height={32} className="mb-5" />
          <NavRail tab={tab} pending={pending} panelOpen={panelOpen} onTab={(t) => (t === tab ? setPanelOpen((o) => !o) : openTab(t))} />
          <div className="mt-auto flex flex-col items-center gap-2">
            {paletteButton}
            {themeButton}
            <IconButton
              icon={panelOpen ? PanelLeftClose : PanelLeftOpen}
              label={panelOpen ? 'Hide panel (full-width map)' : 'Show panel'}
              onClick={() => setPanelOpen((o) => !o)}
            />
            {!account.info && <IconButton icon={Settings} label="Options" onClick={() => void browser.runtime.openOptionsPage()} />}
            <AccountMenu side="right" info={account.info ?? null} onSignIn={() => setWantsSignIn(true)} />
          </div>
        </aside>

        <div hidden={!panelOpen} style={{ width: panelWidth.width }} className="relative flex shrink-0 flex-col border-r border-line">
          <header className="flex h-16 shrink-0 flex-col justify-center border-b border-line px-6">
            <h1 className="text-title whitespace-nowrap">SWOT Explorer</h1>
            <p className="truncate text-meta text-ink-3">Surface water from SWOT · Hydraulics Research Center, Sudan</p>
          </header>
          <div className="relative min-h-0 flex-1">{sections}</div>
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize panel"
            aria-valuemin={PANEL_MIN}
            aria-valuemax={PANEL_MAX}
            aria-valuenow={panelWidth.width}
            tabIndex={0}
            title="Drag to resize · double-click to reset"
            onPointerDown={panelWidth.onPointerDown}
            onKeyDown={panelWidth.onKeyDown}
            onDoubleClick={panelWidth.reset}
            className="group absolute inset-y-0 -right-1.5 z-20 flex w-3 cursor-col-resize justify-center outline-none"
          >
            <span className="h-full w-0.5 bg-transparent transition-colors duration-200 ease-signature group-hover:bg-accent group-focus-visible:bg-accent" />
          </div>
        </div>

        <main className="relative min-w-0 flex-1">{map}</main>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col">
      {signIn}
      {overlays}
      <header className="flex h-16 shrink-0 items-center justify-between gap-4 border-b border-line px-6">
        <div className="flex items-center gap-3">
          <img src="/logo-mark.png" alt="" width={32} height={32} className="shrink-0" />
          <h1 className="text-title whitespace-nowrap">SWOT Explorer</h1>
        </div>
        <div className="flex items-center gap-1">
          {paletteButton}
          {themeButton}
          <IconButton icon={MapIcon} label={mapOpen ? 'Hide map' : 'Show map'} onClick={() => setMapOpen((o) => !o)} />
          <IconButton
            icon={Maximize2}
            label="Open as full page"
            onClick={() =>
              void browser.tabs.create({
                url: browser.runtime.getURL('/app.html'),
              })
            }
          />
          {!account.info && <IconButton icon={Settings} label="Options" onClick={() => void browser.runtime.openOptionsPage()} />}
          <AccountMenu info={account.info ?? null} onSignIn={() => setWantsSignIn(true)} />
        </div>
      </header>
      <div hidden={!mapOpen} className="h-[22rem] shrink-0 border-b border-line">
        {map}
      </div>
      <NavTabs tab={tab} pending={pending} onTab={openTab} />
      <div className="relative min-h-0 flex-1">
        {sections}
        {seriesTarget && (
          // A clicked lake, reach or node opens over the sections; closing it returns to where you were.
          <div className="absolute inset-0 z-10 overflow-y-auto bg-paper">
            <ErrorBoundary label="Time series">
              <TimeSeriesPanel target={seriesTarget} layout="inline" onClose={() => setSeriesTarget(null)} />
            </ErrorBoundary>
          </div>
        )}
      </div>
    </div>
  );
}
