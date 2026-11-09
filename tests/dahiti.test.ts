/**
 * DAHITI requests carry only the arguments each endpoint documents. A stray `format` on
 * list-targets made DAHITI answer "Invalid argument `format` not found!" when saving a key.
 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { downloadWaterLevel, listTargets, saveDahitiKey } from '@/api/dahiti';

const ALLOWED: Record<string, string[]> = {
  'list-targets': ['api_key', 'min_lon', 'max_lon', 'min_lat', 'max_lat', 'basin', 'country', 'continent'],
  'download-water-level': ['api_key', 'dahiti_id', 'format'],
};

let bodies: { endpoint: string; body: Record<string, unknown> }[];
beforeEach(() => {
  fakeBrowser.reset();
  bodies = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const endpoint = url.split('/').filter(Boolean).pop()!;
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      bodies.push({ endpoint, body });
      const unknown = Object.keys(body).find((k) => !ALLOWED[endpoint]!.includes(k));
      if (unknown) return new Response(JSON.stringify({ code: 400, message: `Invalid argument \`${unknown}\` not found!` }), { status: 400 });
      if (body.api_key !== 'good-key') return new Response(JSON.stringify({ code: 403, message: 'Permission Denied (Login failed!)!' }), { status: 403 });
      const data =
        endpoint === 'list-targets'
          ? [{ dahiti_id: 1234, target_name: 'Roseires, Reservoir', type: 'Reservoir', country: 'Sudan', longitude: 34.4, latitude: 11.6 }]
          : [{ date: '2025-01-05T00:00:00', wse: 488.1, wse_u: 0.08, data: 'sentinel6a 109 001' }];
      return new Response(JSON.stringify({ code: 200, message: 'Request successful!', data }), { status: 200 });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

it('saves a valid key without sending arguments DAHITI does not accept', async () => {
  await saveDahitiKey('  good-key  ');
  expect(bodies[0]).toEqual({ endpoint: 'list-targets', body: { api_key: 'good-key', min_lon: 35, max_lon: 35.1, min_lat: 11, max_lat: 11.1 } });
  expect((await fakeBrowser.storage.local.get('dahitiKey')).dahitiKey).toBe('good-key');
});

it('reports a wrong key clearly and does not store it', async () => {
  await expect(saveDahitiKey('wrong')).rejects.toThrow(/refused the API key/);
  expect((await fakeBrowser.storage.local.get('dahitiKey')).dahitiKey).toBeUndefined();
});

it('searches and downloads with the stored key; format is sent only where documented', async () => {
  await fakeBrowser.storage.local.set({ dahitiKey: 'good-key' });
  expect((await listTargets([34, 11, 35, 12]))[0]).toMatchObject({ dahiti_id: 1234, type: 'Reservoir' });
  expect(await downloadWaterLevel(1234)).toEqual([{ date: '2025-01-05T00:00:00', wse: 488.1, wse_u: 0.08, data: 'sentinel6a 109 001' }]);
  expect(bodies.find((b) => b.endpoint === 'download-water-level')!.body.format).toBe('json');
  expect(bodies.find((b) => b.endpoint === 'list-targets')!.body).not.toHaveProperty('format');
});

it('reads replies with bare NaN and without a `code` field, and never turns a missing level into 0 m', async () => {
  await fakeBrowser.storage.local.set({ dahitiKey: 'good-key' });
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      new Response(
        '{"target": {"id": 1234}, "data": [' +
          '{"date": "2025-01-05T00:00:00", "wse": 488.1, "wse_u": NaN, "data": "sentinel6a 109 001"},' +
          '{"date": "2025-01-15T00:00:00", "wse": NaN, "wse_u": 0.1, "data": "note: NaN stays in strings"},' +
          '{"date": "2025-01-25T00:00:00", "wse": null, "wse_u": null, "data": null}]}',
        { status: 200 },
      ),
    ),
  );
  expect(await downloadWaterLevel(1234)).toEqual([{ date: '2025-01-05T00:00:00', wse: 488.1, wse_u: null, data: 'sentinel6a 109 001' }]);
});

it('shows what DAHITI sent when a reply cannot be read', async () => {
  await fakeBrowser.storage.local.set({ dahitiKey: 'good-key' });
  vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>maintenance</html>', { status: 200 })));
  await expect(downloadWaterLevel(1)).rejects.toThrow('DAHITI sent a reply the extension could not read (HTTP 200: “<html>maintenance</html>…”).');
});

it('turns -Infinity and Infinity into null as well', async () => {
  const { parseDahitiJson } = await import('@/api/dahiti');
  expect(parseDahitiJson('{"a": -Infinity, "b": Infinity, "c": NaN, "d": "-Infinity stays text"}')).toEqual({ a: null, b: null, c: null, d: '-Infinity stays text' });
});
