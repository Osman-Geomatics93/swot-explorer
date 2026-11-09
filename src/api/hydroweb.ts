/**
 * Hydroweb (hydroweb.next, Theia/CNES): satellite-altimetry water levels at lake and river
 * virtual stations, used as an independent check on SWOT.
 *  - Search: public STAC API (no key), POST /api/v1/rs-catalog/stac/search.
 *  - Download: needs a free API key in the X-API-Key header.
 * Verified 2026-11-07: collections HYDROWEB_{LAKES,RIVERS}_{OPE,RESEARCH}; one text asset per station.
 */
import { z } from 'zod';

const STAC = 'https://hydroweb.next.theia-land.fr/api/v1/rs-catalog/stac/search';
const KEY = 'hydrowebKey';

export const HYDROWEB_LINKS = { home: 'https://hydroweb.next.theia-land.fr/' } as const;
export const HYDROWEB_COLLECTIONS = {
  lakes: ['HYDROWEB_LAKES_OPE', 'HYDROWEB_LAKES_RESEARCH'],
  rivers: ['HYDROWEB_RIVERS_OPE', 'HYDROWEB_RIVERS_RESEARCH'],
} as const;

/** Acknowledgement requested by the Hydroweb Product User Manual (THEIA-MU-42-0282-CNES, §5.4). */
export const HYDROWEB_CITATION = {
  research: 'Hydroweb (hydroweb.next, Theia): timeseries specified by LEGOS and computed by CLS on behalf of CNES.',
  operational: 'Hydroweb (hydroweb.next, Theia): timeseries specified by LEGOS and computed by CLS on behalf of CNES and Copernicus Global Land.',
};

export class HydrowebError extends Error {}

const Feature = z.object({
  id: z.string(),
  collection: z.string(),
  geometry: z.object({ type: z.string(), coordinates: z.unknown() }),
  properties: z.object({ start_datetime: z.string().optional(), end_datetime: z.string().optional() }).passthrough(),
  assets: z.record(z.string(), z.object({ href: z.string(), title: z.string().optional(), 'file:size': z.number().optional() }).passthrough()),
});

export interface HydrowebStation {
  id: string;
  /** e.g. L_roseires or R_NILE_BLUE-NILE_KM0815 */
  code: string;
  name: string;
  type: 'lake' | 'river';
  operational: boolean;
  lon: number;
  lat: number;
  href: string;
  lastDate: string | null;
}

export interface HydrowebObservation {
  time: string; // ISO UTC
  wse: number;
  wse_u: number | null;
}

export async function getHydrowebKey(): Promise<string | null> {
  const v = (await browser.storage.local.get(KEY))[KEY];
  return typeof v === 'string' && v ? v : null;
}

const prettyName = (code: string) => {
  const body = code.replace(/^[LR]_/, '');
  const km = /_KM(\d+)$/.exec(body);
  const words = body.replace(/_KM\d+$/, '').split('_').map((w) => w.toLowerCase().replace(/(^|-)\w/g, (c) => c.toUpperCase()));
  return km ? `${words.slice(1).join(' ') || words[0]} · km ${Number(km[1])}` : words.join(' ');
};

/** Stations in a box (public search, no key needed). */
export async function searchStations(bbox: [number, number, number, number], kinds: ('lakes' | 'rivers')[], signal?: AbortSignal): Promise<HydrowebStation[]> {
  const collections = kinds.flatMap((k) => HYDROWEB_COLLECTIONS[k]);
  let resp: Response;
  try {
    resp = await fetch(STAC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ collections, bbox, limit: 500 }),
      signal,
    });
  } catch (err) {
    if (signal?.aborted) throw err;
    throw new HydrowebError('Could not reach Hydroweb. Check your connection.');
  }
  if (!resp.ok) throw new HydrowebError(`Hydroweb search failed (HTTP ${resp.status}).`);
  const features = z.object({ features: z.array(Feature) }).parse(await resp.json()).features;
  return features.flatMap((f) => {
    const coords = f.geometry.coordinates as number[];
    const asset = Object.values(f.assets)[0];
    if (f.geometry.type !== 'Point' || !asset) return [];
    const code = f.id.split('@')[0]!;
    return [
      {
        id: f.id,
        code,
        name: prettyName(code),
        type: f.collection.includes('LAKES') ? ('lake' as const) : ('river' as const),
        operational: f.collection.endsWith('_OPE'),
        lon: coords[0]!,
        lat: coords[1]!,
        href: asset.href,
        lastDate: f.properties.end_datetime ?? null,
      },
    ];
  });
}

const MISSING = (v: number) => !Number.isFinite(v) || Math.abs(v - 9999.999) < 1e-6 || v >= 9999;
const DATE = /^(\d{4})[-/](\d{2})[-/](\d{2})$/;
const TIME = /^(\d{1,2})[:.](\d{2})$/;

/**
 * Parse a Hydroweb time-series text file. Two documented layouts (Product User Manual V2.1):
 *   lakes : "decimal_year ; yyyy/mm/dd ; hh:mm ; height ; std ; surface ; volume ; flag"
 *   rivers: "yyyy-mm-dd hh:mm height uncertainty [expert columns…]"
 * Lines starting with '#' are header. "9999.999" and "NA" mean missing.
 * The date and time are found by pattern, so column shifts between versions don't break it.
 */
export function parseHydrowebText(text: string): HydrowebObservation[] {
  const out: HydrowebObservation[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const tokens = (line.includes(';') ? line.split(';') : line.split(/\s+/)).map((t) => t.trim());
    const di = tokens.findIndex((t) => DATE.test(t));
    if (di < 0) continue;
    const [, y, mo, d] = DATE.exec(tokens[di]!)!;
    const ti = TIME.test(tokens[di + 1] ?? '') ? di + 1 : -1;
    const [, hh = '0', mm = '0'] = ti > 0 ? TIME.exec(tokens[ti]!)! : [];
    const rest = tokens.slice((ti > 0 ? ti : di) + 1).map((t) => (t === '' || t.toUpperCase() === 'NA' ? NaN : Number(t)));
    const wse = rest[0] ?? NaN;
    if (MISSING(wse)) continue;
    const u = rest[1] ?? NaN;
    out.push({ time: `${y}-${mo}-${d}T${hh.padStart(2, '0')}:${mm}:00Z`, wse, wse_u: MISSING(u) ? null : u });
  }
  return out.sort((a, b) => a.time.localeCompare(b.time));
}

async function download(href: string, key: string): Promise<string> {
  let resp: Response;
  try {
    resp = await fetch(href, { headers: { 'X-API-Key': key } });
  } catch {
    throw new HydrowebError('Could not reach Hydroweb. Check your connection.');
  }
  if (resp.status === 401 || resp.status === 403) throw new HydrowebError('Hydroweb refused the API key. Check it in Options.');
  if (!resp.ok) throw new HydrowebError(`Hydroweb download failed (HTTP ${resp.status}).`);
  const text = await resp.text();
  if (/^\s*<(!doctype|html)/i.test(text)) throw new HydrowebError('Hydroweb returned a web page instead of data. Check the API key in Options.');
  return text;
}

export async function downloadStation(station: Pick<HydrowebStation, 'href'>): Promise<HydrowebObservation[]> {
  const key = await getHydrowebKey();
  if (!key) throw new HydrowebError('Add your Hydroweb API key in Options to compare with Hydroweb.');
  return parseHydrowebText(await download(station.href, key));
}

/** Check a key by downloading one small station file (Roseires) before storing it. */
export async function saveHydrowebKey(key: string): Promise<void> {
  const clean = key.trim();
  const [probe] = await searchStations([34.3, 11.2, 34.9, 11.9], ['lakes']);
  if (!probe) throw new HydrowebError('Could not find a Hydroweb station to check the key against.');
  const rows = parseHydrowebText(await download(probe.href, clean));
  if (!rows.length) throw new HydrowebError('The key works, but the test file had no readable data. Please report this.');
  await browser.storage.local.set({ [KEY]: clean });
}

export const removeHydrowebKey = () => browser.storage.local.remove(KEY);
