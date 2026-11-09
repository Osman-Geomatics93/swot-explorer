/**
 * Download LakeSP_obs granules for a lake's passes and extract the pieces
 * linked to that lake. Results are cached per granule in IndexedDB, so each
 * ~10 MB file is downloaded once.
 */
import type { Feature, FeatureCollection, Geometry } from 'geojson';
import shp from 'shpjs';
import { DownloadHostError, fetchArchiveFile } from '@/api/archive';
import { lakeObsQuery, searchGranules, type GranuleRef } from '@/api/cmr';
import { requireToken } from '@/auth/token';
import { db, type CachedPieces } from '@/storage/db';
import type { ObsPiece } from './robustLevel';

export interface FetchProgress {
  total: number;
  done: number;
  cached: number;
  failed: number;
}

type Piece = CachedPieces['pieces'][number];

function extract(fc: FeatureCollection | FeatureCollection[], lakeId: string, g: GranuleRef): Piece[] {
  const collections = Array.isArray(fc) ? fc : [fc];
  const [, , , , , cycle = '', pass = ''] = g.name.split('_'); // SWOT_L2_HR_LakeSP_Obs_<cycle>_<pass>_...
  const pieces: Piece[] = [];
  for (const c of collections) {
    for (const f of c.features as Feature<Geometry | null>[]) {
      const p = f.properties ?? {};
      if (!String(p.lake_id ?? '').split(';').includes(lakeId)) continue;
      pieces.push({
        granule: g.name,
        cycle,
        pass,
        time_str: String(p.time_str ?? g.start ?? ''),
        obs_id: String(p.obs_id ?? ''),
        wse: Number(p.wse),
        wse_u: Number(p.wse_u),
        quality_f: Number(p.quality_f),
        area_total: Number(p.area_total),
        geometry: f.geometry ?? null,
      });
    }
  }
  return pieces;
}

export async function fetchLakePieces(
  lakeId: string,
  passes: string[],
  onProgress: (p: FetchProgress) => void,
  signal?: AbortSignal,
  continent = 'AF',
): Promise<Piece[]> {
  const granules = (await Promise.all(passes.map((p) => searchGranules(lakeObsQuery(p, continent), signal)))).flat();
  const progress: FetchProgress = { total: granules.length, done: 0, cached: 0, failed: 0 };
  onProgress({ ...progress });

  const token = await requireToken();
  const out: Piece[] = [];
  const queue = [...granules];

  const worker = async () => {
    for (let g = queue.shift(); g; g = queue.shift()) {
      signal?.throwIfAborted(); // cancelling must never return partial results as if complete
      const key = `${lakeId}|${g.name}`;
      const hit = await db.obsPieces.get(key);
      if (hit) {
        out.push(...hit.pieces);
        progress.cached++;
      } else {
        try {
          const pieces = extract(await shp(await fetchArchiveFile(g.url, token, signal)), lakeId, g);
          await db.obsPieces.put({ key, lakeId, granule: g.name, pieces, cachedAt: Date.now() });
          out.push(...pieces);
        } catch (err) {
          if (signal?.aborted || err instanceof DownloadHostError) throw err;
          progress.failed++;
        }
      }
      progress.done++;
      onProgress({ ...progress });
    }
  };
  await Promise.all(Array.from({ length: 3 }, worker));
  signal?.throwIfAborted();
  return out;
}

export function piecesToFeatures(pieces: Piece[], kept: Set<string>, reference: Map<string, number>): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: pieces
      .filter((p) => p.geometry)
      .map((p) => ({
        type: 'Feature',
        geometry: p.geometry!,
        properties: {
          obs_id: p.obs_id,
          wse: Number(p.wse),
          area: Number(p.area_total),
          kept: kept.has(`${p.granule}|${p.obs_id}`),
          wse_dev: Number(p.wse) - (reference.get(p.granule) ?? Number(p.wse)),
        },
      })),
  };
}

export type { ObsPiece };
