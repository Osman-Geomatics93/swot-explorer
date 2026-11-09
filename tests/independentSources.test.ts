/**
 * Candidate search across Hydroweb and DAHITI, with fetch mocked. The Hydroweb records follow the
 * STAC structure returned by hydroweb.next (2026-11-07): Point geometry, id "<code>@hysope2:<uuid>:V1",
 * one text asset per station, end_datetime = last measurement.
 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { parseHydrowebText } from '@/api/hydroweb';
import { findCandidates } from '@/independent/sources';

const station = (code: string, collection: string, lon: number, lat: number, end: string) => ({
  type: 'Feature',
  id: `${code}@hysope2:00000000-0000-0000-0000-000000000000:V1`,
  collection,
  geometry: { type: 'Point', coordinates: [lon, lat] },
  properties: { start_datetime: '2016-01-01T00:00:00Z', end_datetime: end },
  assets: { [`hydroprd_${code}.txt`]: { href: `https://hydroweb.next.theia-land.fr/api/v1/rs-catalog/downloads/URN:FEATURE:DATA:hysope2:x:V1/files/${code}`, title: `hydroprd_${code}.txt` } },
});

const STATIONS = [
  station('R_NILE_BLUE-NILE_KM3926', 'HYDROWEB_RIVERS_OPE', 34.95, 11.24, '2026-09-25T00:00:00Z'),
  station('R_NILE_BLUE-NILE_KM0815', 'HYDROWEB_RIVERS_RESEARCH', 34.98, 11.22, '2010-09-16T00:00:00Z'), // stopped before SWOT
  station('R_NILE_BLUE-NILE_KM4014', 'HYDROWEB_RIVERS_OPE', 35.17, 10.7, '2026-10-28T00:00:00Z'),
  station('L_roseires', 'HYDROWEB_LAKES_OPE', 34.45, 11.6, '2026-11-02T00:00:00Z'),
];

const RIVER_FILE = ['#COL 1 : DATE(YYYY-MM-DD)', '2025-10-01 07:00 605.40 0.10', '2025-10-11 05:00 606.10 0.12'].join('\n');

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fakeBrowser.reset();
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/stac/search')) {
      const { bbox } = JSON.parse(String(init?.body)) as { bbox: number[] };
      const inBox = STATIONS.filter((s) => {
        const [x, y] = s.geometry.coordinates as number[];
        return x! >= bbox[0]! && x! <= bbox[2]! && y! >= bbox[1]! && y! <= bbox[3]!;
      });
      return new Response(JSON.stringify({ type: 'FeatureCollection', features: inBox }), { status: 200 });
    }
    if (url.includes('/files/')) {
      const key = (init?.headers as Record<string, string>)['X-API-Key'];
      return key === 'good' ? new Response(RIVER_FILE, { status: 200 }) : new Response('{"message":"No user found with api-key"}', { status: 401 });
    }
    throw new Error(`unexpected ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

it('GERD: lists active Blue Nile stations inside the reservoir, nearest first, and drops pre-SWOT ones', async () => {
  const r = await findCandidates('lakes', [35.0, 11.2]);
  expect(r.candidates.map((c) => c.name)).toEqual(['Blue-Nile · km 3926', 'Blue-Nile · km 4014']);
  expect(r.candidates.every((c) => c.source === 'hydroweb' && c.type === 'river')).toBe(true);
  expect(r.tooOld).toBe(1);
  expect(r.notes).toContain('Add a DAHITI key in Options to include DAHITI stations.');
});

it('Roseires: a nearby lake station comes before closer river stations', async () => {
  const r = await findCandidates('lakes', [34.6, 11.5]);
  expect(r.candidates[0]).toMatchObject({ name: 'Roseires', type: 'lake' });
});

it('downloads need the Hydroweb key; with it, the file is parsed', async () => {
  const [first] = (await findCandidates('lakes', [35.0, 11.2])).candidates;
  await expect(first!.load()).rejects.toThrow(/Add your Hydroweb API key/);
  await fakeBrowser.storage.local.set({ hydrowebKey: 'bad' });
  await expect(first!.load()).rejects.toThrow(/refused the API key/);
  await fakeBrowser.storage.local.set({ hydrowebKey: 'good' });
  expect(await first!.load()).toEqual(parseHydrowebText(RIVER_FILE));
});
