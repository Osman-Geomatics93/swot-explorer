import { ChevronDown, ChevronUp, Eye, EyeOff, ListOrdered } from 'lucide-react';
import { IconButton, Menu, cx } from '@/components/ui';
import { completeOrder, groupById, useLayers } from '@/state/layers';

/** Layers currently on the map, top first, with up/down and show/hide controls. */
export function LayerPanel({ active, basemapName }: { active: string[]; basemapName: string }) {
  const { order, hidden, basemapHidden, move, toggle, setBasemapHidden, reset } = useLayers();
  const shown = completeOrder(order).filter((id) => active.includes(id));
  const fixedRow = 'flex h-9 items-center gap-3 px-3 text-meta text-ink-3';

  return (
    <Menu label={`Layers${shown.length ? ` · ${shown.length}` : ''}`} icon={ListOrdered} align="right" variant="ghost" labelClassName="hidden @[30rem]:inline">
      {() => (
        <div className="w-72 space-y-1 p-1">
          <p className="px-3 pb-1 text-eyebrow font-medium tracking-[0.08em] text-ink-3 uppercase">Drawing order · top first</p>
          <p className={fixedRow}>Reservoir markers · always on top</p>

          {shown.length === 0 ? (
            <p className="px-3 py-2 text-meta text-ink-2">No data layers yet. Draw a study area, search, or show a preview.</p>
          ) : (
            <ol className="space-y-0.5">
              {shown.map((id, i) => {
                const off = hidden.includes(id);
                return (
                  <li key={id} className="flex items-center gap-1 rounded-ui pl-1 hover:bg-sunken">
                    <IconButton icon={off ? EyeOff : Eye} label={off ? `Show ${groupById.get(id)?.label}` : `Hide ${groupById.get(id)?.label}`} onClick={() => toggle(id)} />
                    <span className={cx('min-w-0 flex-1 truncate text-meta', off ? 'text-ink-3 line-through' : 'text-ink')}>{groupById.get(id)?.label}</span>
                    <IconButton icon={ChevronUp} label="Move up" disabled={i === 0} className="disabled:opacity-30" onClick={() => move(id, -1, active)} />
                    <IconButton icon={ChevronDown} label="Move down" disabled={i === shown.length - 1} className="disabled:opacity-30" onClick={() => move(id, 1, active)} />
                  </li>
                );
              })}
            </ol>
          )}

          <div className="flex items-center gap-1 rounded-ui pl-1 hover:bg-sunken">
            <IconButton icon={basemapHidden ? EyeOff : Eye} label={basemapHidden ? 'Show basemap' : 'Hide basemap'} onClick={() => setBasemapHidden(!basemapHidden)} />
            <span className={cx('min-w-0 flex-1 truncate text-meta', basemapHidden ? 'text-ink-3 line-through' : 'text-ink')}>Basemap: {basemapName}</span>
            <span className="pr-3 text-meta text-ink-3">always at the bottom</span>
          </div>
          <div className="border-t border-line px-3 pt-2">
            <button type="button" onClick={reset} className="text-meta text-ink-2 underline underline-offset-2 hover:text-ink">
              Reset order and visibility
            </button>
          </div>
        </div>
      )}
    </Menu>
  );
}
