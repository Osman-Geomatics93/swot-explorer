import { Circle, ImageDown, Map as MapIcon, MapPin, Pentagon, PenLine, Square, type LucideIcon } from 'lucide-react';
import { Check, IconButton, Menu, MenuItem, cx } from '@/components/ui';
import { BASEMAPS } from '@/map/basemaps';
import type { DrawTool } from '@/map/MapView';
import { useLayers } from '@/state/layers';
import { LayerPanel } from './LayerPanel';

const TOOLS: { id: DrawTool; icon: LucideIcon; label: string }[] = [
  { id: 'rectangle', icon: Square, label: 'Draw rectangle' },
  { id: 'polygon', icon: Pentagon, label: 'Draw polygon (double-click to finish)' },
  { id: 'circle', icon: Circle, label: 'Draw circle' },
  { id: 'point', icon: MapPin, label: 'Place point' },
  { id: 'freehand', icon: PenLine, label: 'Draw freehand' },
];

interface Props {
  basemapId: string;
  tool: DrawTool;
  onBasemap: (id: string) => void;
  onTool: (tool: DrawTool) => void;
  /** Layer groups currently on the map (state/layers.ts ids). */
  activeLayers: string[];
  /** Save the current view as a publication figure. */
  onExport: () => void;
}

const FLOAT = 'rounded-ui border border-line bg-surface/90 shadow-float backdrop-blur-md';

/** Floating controls over the map: drawing tools on the left, layers on the right. */
export function MapToolbar({ basemapId, tool, onBasemap, onTool, activeLayers, onExport }: Props) {
  const active = TOOLS.find((t) => t.id === tool);
  const { basemapHidden, setBasemapHidden } = useLayers();

  // z-30: open menus stay above the map's own controls.
  // @container: in a narrow map (the side panel) the Layers and Map buttons drop their labels.
  return (
    <div className="@container pointer-events-none absolute inset-x-3 top-3 z-30 flex items-start justify-between gap-3">
      <div className="pointer-events-auto space-y-2">
        <div role="toolbar" aria-label="Drawing tools" className={cx(FLOAT, 'flex gap-0.5 p-1')}>
          {TOOLS.map((t) => (
            <IconButton key={t.id} icon={t.icon} label={t.label} pressed={tool === t.id} onClick={() => onTool(tool === t.id ? 'none' : t.id)} />
          ))}
        </div>
        {active && (
          <p className={cx(FLOAT, 'px-3 py-2 text-meta text-ink-2')} role="status">
            {active.id === 'polygon' ? 'Click to add points, double-click to finish.' : `${active.label}. Press the tool again to cancel.`}
          </p>
        )}
      </div>

      <div className={cx(FLOAT, 'pointer-events-auto flex items-center')}>
        <IconButton icon={ImageDown} label="Export map figure (PNG, 300 dpi, with legend and scale bar)" className="mx-1" onClick={onExport} />
        <LayerPanel active={activeLayers} basemapName={BASEMAPS.find((b) => b.id === basemapId)?.name ?? ''} />
        <Menu label="Map" labelClassName="hidden @[30rem]:inline" icon={MapIcon} align="right" variant="ghost">
          {() => (
            <div className="w-64 space-y-3 p-1">
              <fieldset className="space-y-0.5">
                <legend className="px-3 pb-1 text-eyebrow font-medium tracking-[0.08em] text-ink-3 uppercase">Basemap</legend>
                <Check className="px-3 pb-2" label="Show basemap" checked={!basemapHidden} onChange={(e) => setBasemapHidden(!e.target.checked)} />
                {BASEMAPS.map((b) => (
                  <MenuItem
                    key={b.id}
                    onClick={() => {
                      onBasemap(b.id);
                      setBasemapHidden(false);
                    }}
                    aria-pressed={b.id === basemapId}
                  >
                    <span className={cx('size-2 rounded-ui', b.id === basemapId ? 'bg-accent' : 'bg-line-strong')} aria-hidden />
                    {b.name}
                  </MenuItem>
                ))}
              </fieldset>
            </div>
          )}
        </Menu>
      </div>
    </div>
  );
}
