import Dexie, { type EntityTable } from 'dexie';
import type { Feature, Geometry } from 'geojson';
import type { ObsPiece } from '@/robust/robustLevel';
import type { StudyArea } from '@/state/studyArea';

/** Pieces extracted from one LakeSP_obs granule for one lake. Granules never change, so this never expires. */
export interface CachedPieces {
  key: string; // `${lakeId}|${granule}`
  lakeId: string;
  granule: string;
  pieces: (ObsPiece & { geometry: Geometry | null })[];
  cachedAt: number;
}

/** A fixed date range, or "the last N days" for monitoring searches that should stay current. */
export type Period = { kind: 'fixed'; start: string; end: string } | { kind: 'last'; days: number };

export interface SavedSearch {
  id: string;
  name: string;
  productKey: string;
  /** Copy of the study area, so the search still works if the area is deleted. */
  area: StudyArea;
  period: Period;
  cycle?: number;
  pass?: number;
  createdAt: number;
  lastRunAt?: number;
  lastResultCount?: number;
  /** Check for new SWOT passes in the background and notify. */
  monitor?: boolean;
  /** Granule base names already seen (the baseline for "new"). */
  seen?: string[];
  /** New granules found since the search was last opened. */
  newCount?: number;
  lastCheckedAt?: number;
}

export type HistoryKind = 'search' | 'download' | 'clip' | 'robust' | 'validation';

export interface HistoryEntry {
  id?: number;
  at: number;
  kind: HistoryKind;
  title: string;
  detail: string;
  /** Enough to repeat a search from the history list. */
  search?: Omit<SavedSearch, 'id' | 'name' | 'createdAt'>;
}

/** In-situ gauge levels imported for one reservoir (one series per reservoir; importing again replaces it). */
export interface GaugeRecord {
  reservoirId: string;
  /** e.g. "U/S level (Roseires A → C, Roseires H → I)". */
  label: string;
  fileName: string;
  importedAt: number;
  /** [UTC ms of the date (midnight for date-only readings), level m], sorted. */
  points: [number, number][];
}

export const db = new Dexie('swot-explorer') as Dexie & {
  obsPieces: EntityTable<CachedPieces, 'key'>;
  savedSearches: EntityTable<SavedSearch, 'id'>;
  history: EntityTable<HistoryEntry, 'id'>;
  gauges: EntityTable<GaugeRecord, 'reservoirId'>;
};

db.version(1).stores({
  obsPieces: 'key, lakeId',
});
db.version(2).stores({
  obsPieces: 'key, lakeId',
  savedSearches: 'id, createdAt',
  history: '++id, at, kind',
});
db.version(3).stores({
  obsPieces: 'key, lakeId',
  savedSearches: 'id, createdAt',
  history: '++id, at, kind',
  gauges: 'reservoirId',
});

const HISTORY_LIMIT = 300;

export async function addHistory(entry: Omit<HistoryEntry, 'id' | 'at'>): Promise<void> {
  await db.history.add({ ...entry, at: Date.now() });
  const count = await db.history.count();
  if (count > HISTORY_LIMIT) {
    const oldest = await db.history.orderBy('at').limit(count - HISTORY_LIMIT).primaryKeys();
    await db.history.bulkDelete(oldest);
  }
}

export function resolvePeriod(p: Period, today = new Date()): { start: string; end: string } {
  if (p.kind === 'fixed') return { start: p.start, end: p.end };
  const end = today.toISOString().slice(0, 10);
  const start = new Date(today.getTime() - p.days * 86_400_000).toISOString().slice(0, 10);
  return { start, end };
}

export type PieceFeature = Feature<Geometry, ObsPiece>;
