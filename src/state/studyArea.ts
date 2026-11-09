import area from '@turf/area';
import buffer from '@turf/buffer';
import type { Feature, Geometry, Polygon, MultiPolygon } from 'geojson';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export type AreaSource = 'rectangle' | 'polygon' | 'circle' | 'point' | 'freehand' | 'upload' | 'reservoir';

export interface StudyArea {
  id: string;
  name: string;
  source: AreaSource;
  /** Geometry as drawn or uploaded (a point stays a point). */
  geometry: Geometry;
  /** Buffer for points, in km. The search/clip polygon uses it. */
  bufferKm: number;
}

interface StudyAreaState {
  areas: StudyArea[];
  activeId: string | null;
  add: (area: StudyArea) => void;
  update: (id: string, patch: Partial<StudyArea>) => void;
  remove: (id: string) => void;
  setActive: (id: string | null) => void;
  clear: () => void;
}

/** Study areas are kept in chrome.storage.local, shared by the side panel and the full page. */
const extensionStorage = createJSONStorage(() => ({
  getItem: async (name: string) => ((await browser.storage.local.get(name))[name] as string | undefined) ?? null,
  setItem: (name: string, value: string) => browser.storage.local.set({ [name]: value }),
  removeItem: (name: string) => browser.storage.local.remove(name),
}));

export const useStudyAreas = create<StudyAreaState>()(
  persist(
    (set) => ({
      areas: [],
      activeId: null,
      add: (a) => set((s) => ({ areas: [...s.areas.filter((x) => x.id !== a.id), a], activeId: a.id })),
      update: (id, patch) => set((s) => ({ areas: s.areas.map((a) => (a.id === id ? { ...a, ...patch } : a)) })),
      remove: (id) =>
        set((s) => ({ areas: s.areas.filter((a) => a.id !== id), activeId: s.activeId === id ? null : s.activeId })),
      setActive: (id) => set({ activeId: id }),
      clear: () => set({ areas: [], activeId: null }),
    }),
    { name: 'studyAreas', storage: extensionStorage, partialize: (s) => ({ areas: s.areas, activeId: s.activeId }) },
  ),
);

/** Polygon used for searching and clipping: points and lines are buffered. */
export function clipPolygon(a: StudyArea): Feature<Polygon | MultiPolygon> | null {
  try {
    return toPolygon(a);
  } catch {
    return null; // a malformed stored geometry is treated as unusable, never a crash
  }
}

function toPolygon(a: StudyArea): Feature<Polygon | MultiPolygon> | null {
  const g = a.geometry;
  if (g.type === 'Polygon' || g.type === 'MultiPolygon') return { type: 'Feature', properties: {}, geometry: g };
  if (a.bufferKm <= 0) return null;
  const buffered = buffer({ type: 'Feature', properties: {}, geometry: g }, a.bufferKm, { units: 'kilometers' });
  return (buffered as Feature<Polygon | MultiPolygon> | undefined) ?? null;
}

export function areaKm2(a: StudyArea): number {
  const poly = clipPolygon(a);
  try {
    return poly ? area(poly) / 1e6 : 0;
  } catch {
    return 0;
  }
}

/**
 * Keep the side panel and the full page in sync: when the other view saves study areas,
 * reload them here instead of later overwriting them with this view's stale list.
 */
browser.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local' && 'studyAreas' in changes) void useStudyAreas.persist.rehydrate();
});
