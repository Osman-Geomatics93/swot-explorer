/**
 * Drawing order and visibility of the map's data layers, top first.
 * The basemap always stays at the bottom and reservoir markers on top.
 */
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export interface LayerGroup {
  id: string;
  label: string;
  /** MapLibre layer ids drawn for this group, top first. */
  mapLayers: string[];
}

const FIXED: LayerGroup[] = [
  { id: 'preview-nodes', label: 'River nodes', mapLayers: ['preview-nodes'] },
  { id: 'preview-reaches', label: 'River reaches', mapLayers: ['preview-reaches', 'preview-reaches-casing'] },
  { id: 'preview-lakes', label: 'Lakes', mapLayers: ['preview-lakes-line', 'preview-lakes'] },
  { id: 'pieces', label: 'Robust-mode pieces', mapLayers: ['pieces'] },
  { id: 'footprints', label: 'Search footprints', mapLayers: ['footprints'] },
  { id: 'areas', label: 'Study areas', mapLayers: ['areas-line', 'areas-fill'] },
];

export const LAYER_GROUPS: LayerGroup[] = FIXED;

export const groupById = new Map(LAYER_GROUPS.map((g) => [g.id, g]));

const DEFAULT_ORDER = LAYER_GROUPS.map((g) => g.id);

interface LayerState {
  order: string[];
  hidden: string[];
  /** The whole basemap (imagery or streets) switched off, leaving data on a plain background. */
  basemapHidden: boolean;
  /** Swap with the next active layer above (dir -1) or below (dir 1). */
  move: (id: string, dir: -1 | 1, active: string[]) => void;
  toggle: (id: string) => void;
  setBasemapHidden: (hidden: boolean) => void;
  reset: () => void;
}

const storage = createJSONStorage(() => ({
  getItem: async (name: string) => ((await browser.storage.local.get(name))[name] as string | undefined) ?? null,
  setItem: (name: string, value: string) => browser.storage.local.set({ [name]: value }),
  removeItem: (name: string) => browser.storage.local.remove(name),
}));

/** Full order with any newly added groups at their default position. */
export function completeOrder(order: string[]): string[] {
  const known = order.filter((id) => groupById.has(id));
  for (const id of DEFAULT_ORDER) {
    if (known.includes(id)) continue;
    const defaultIndex = DEFAULT_ORDER.indexOf(id);
    const after = DEFAULT_ORDER.slice(0, defaultIndex).reverse().find((x) => known.includes(x));
    known.splice(after ? known.indexOf(after) + 1 : 0, 0, id);
  }
  return known;
}

export function moveInOrder(order: string[], id: string, dir: -1 | 1, active: string[]): string[] {
  const visible = completeOrder(order).filter((x) => active.includes(x));
  const i = visible.indexOf(id);
  const neighbour = visible[i + dir];
  if (i < 0 || !neighbour) return order;
  const full = completeOrder(order);
  const a = full.indexOf(id);
  const b = full.indexOf(neighbour);
  [full[a], full[b]] = [full[b]!, full[a]!];
  return full;
}

/** Same sync between views as the study areas (state/studyArea.ts). */
export const syncLayersAcrossViews = () =>
  browser.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && 'mapLayers' in changes) void useLayers.persist.rehydrate();
  });

export const useLayers = create<LayerState>()(
  persist(
    (set) => ({
      order: DEFAULT_ORDER,
      hidden: [],
      basemapHidden: false,
      move: (id, dir, active) => set((s) => ({ order: moveInOrder(s.order, id, dir, active) })),
      toggle: (id) => set((s) => ({ hidden: s.hidden.includes(id) ? s.hidden.filter((x) => x !== id) : [...s.hidden, id] })),
      setBasemapHidden: (basemapHidden) => set({ basemapHidden }),
      reset: () => set({ order: DEFAULT_ORDER, hidden: [], basemapHidden: false }),
    }),
    { name: 'mapLayers', storage, partialize: (s) => ({ order: s.order, hidden: s.hidden, basemapHidden: s.basemapHidden }) },
  ),
);

syncLayersAcrossViews();
