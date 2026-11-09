/**
 * Independent altimetry sources for checking SWOT, behind one interface:
 *  - Hydroweb (Theia/CNES): station search is public; downloads need a key.
 *  - DAHITI (DGFI-TUM): search and downloads need a key.
 * Stations that stopped before SWOT began cannot be compared and are left out.
 */
import { DahitiError, downloadWaterLevel, getDahitiKey, listTargets } from '@/api/dahiti';
import { downloadStation, HYDROWEB_CITATION, HydrowebError, searchStations } from '@/api/hydroweb';
import { DAHITI_CITATION } from '@/lib/citation';
import type { LevelPoint } from '@/timeseries/analysis';

export type SourceId = 'hydroweb' | 'dahiti';
export const SOURCE_LABEL: Record<SourceId, string> = { hydroweb: 'Hydroweb', dahiti: 'DAHITI' };

/** SWOT science orbit start; earlier-ending stations cannot overlap. */
const SWOT_START = '2023-07-01';

export interface Candidate {
  key: string; // `${source}:${id}`
  source: SourceId;
  name: string;
  type: 'lake' | 'river';
  km: number;
  citation: string;
  load: () => Promise<LevelPoint[]>;
}

export interface CandidateSearch {
  candidates: Candidate[];
  /** Stations found but ending before SWOT began. */
  tooOld: number;
  notes: string[];
}

const distanceKm = (a: [number, number], b: [number, number]) => {
  const r = Math.PI / 180;
  const x = (b[0] - a[0]) * r * Math.cos(((a[1] + b[1]) / 2) * r);
  return Math.hypot(x, (b[1] - a[1]) * r) * 6371;
};

/**
 * Candidates near a clicked feature, nearest first. For a lake, river stations are included too:
 * a river virtual station inside a reservoir (e.g. the Blue Nile through GERD) measures its level.
 */
export async function findCandidates(kind: 'lakes' | 'reaches', at: [number, number], radiusDeg = 0.6): Promise<CandidateSearch> {
  const [lon, lat] = at;
  const bbox: [number, number, number, number] = [lon - radiusDeg, lat - radiusDeg, lon + radiusDeg, lat + radiusDeg];
  const notes: string[] = [];
  let tooOld = 0;

  const hydroweb = searchStations(bbox, kind === 'lakes' ? ['lakes', 'rivers'] : ['rivers'])
    .then((stations) =>
      stations.flatMap((s): Candidate[] => {
        if (s.lastDate && s.lastDate.slice(0, 10) < SWOT_START) {
          tooOld++;
          return [];
        }
        return [
          {
            key: `hydroweb:${s.id}`,
            source: 'hydroweb',
            name: s.name,
            type: s.type,
            km: distanceKm(at, [s.lon, s.lat]),
            citation: s.operational ? HYDROWEB_CITATION.operational : HYDROWEB_CITATION.research,
            load: () => downloadStation(s),
          },
        ];
      }),
    )
    .catch((err: unknown) => {
      notes.push(err instanceof HydrowebError ? err.message : 'Hydroweb search failed.');
      return [] as Candidate[];
    });

  const dahiti = getDahitiKey().then(async (key) => {
    if (!key) {
      notes.push('Add a DAHITI key in Options to include DAHITI stations.');
      return [] as Candidate[];
    }
    try {
      const wanted = kind === 'lakes' ? /reservoir|lake|river/i : /river/i;
      return (await listTargets(bbox))
        .filter((t) => wanted.test(t.type))
        .map(
          (t): Candidate => ({
            key: `dahiti:${t.dahiti_id}`,
            source: 'dahiti',
            name: t.target_name,
            type: /river/i.test(t.type) ? 'river' : 'lake',
            km: distanceKm(at, [t.longitude, t.latitude]),
            citation: DAHITI_CITATION,
            load: async () =>
              (await downloadWaterLevel(t.dahiti_id)).map((o) => ({ time: o.date.endsWith('Z') ? o.date : `${o.date}Z`, wse: o.wse })),
          }),
        );
    } catch (err) {
      notes.push(err instanceof DahitiError ? err.message : 'DAHITI search failed.');
      return [] as Candidate[];
    }
  });

  // The search box is square; keep a true radius so its corners don't bring in another lake.
  const radiusKm = radiusDeg * 100;
  const all = (await Promise.all([hydroweb, dahiti])).flat().filter((c) => c.km <= radiusKm);
  // For lakes, a nearby lake station (it averages the whole lake) beats a river station;
  // a far one does not, as it is probably a different lake. Then by distance.
  const preferred = (c: Candidate) => kind === 'lakes' && c.type === 'lake' && c.km <= 40;
  all.sort((a, b) => Number(preferred(b)) - Number(preferred(a)) || a.km - b.km);
  return { candidates: all, tooOld, notes };
}
