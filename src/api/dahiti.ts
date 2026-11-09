/**
 * DAHITI (Database for Hydrological Time Series of Inland Waters, DGFI-TUM): multi-mission
 * altimetry water levels, used as an independent check on SWOT. API v2, needs a free API key.
 * https://dahiti.dgfi.tum.de/en/api/doc/v2/
 */
import { z } from 'zod';

const BASE = 'https://dahiti.dgfi.tum.de/api/v2';
const KEY = 'dahitiKey';

export const DAHITI_LINKS = {
  home: 'https://dahiti.dgfi.tum.de/',
  apiDocs: 'https://dahiti.dgfi.tum.de/en/api/doc/v2/',
} as const;

export class DahitiError extends Error {}

const Target = z.object({
  dahiti_id: z.coerce.number(),
  target_name: z.string(),
  type: z.string().optional().default(''),
  country: z.string().nullish(),
  longitude: z.coerce.number(),
  latitude: z.coerce.number(),
  data_access: z.record(z.string(), z.unknown()).nullish(),
});
export type DahitiTarget = z.infer<typeof Target>;

/** A number, or NaN when missing (never 0: null/"" must not become a fake 0 m reading). */
const num = z.unknown().transform((v) => (typeof v === 'number' ? v : v === null || v === undefined || v === '' ? NaN : Number(v)));

/** Documented fields are date / wse / wse_u; a few alternative names are accepted in case the live API differs. */
const Observation = z
  .record(z.string(), z.unknown())
  .transform((o) => ({ date: o.date ?? o.datetime, wse: o.wse ?? o.water_level ?? o.height, wse_u: o.wse_u ?? o.error ?? o.uncertainty, data: o.data }))
  .pipe(
    z.object({
      date: z.string(),
      wse: num,
      wse_u: num.transform((v) => (Number.isFinite(v) ? v : null)),
      data: z.unknown().transform((v) => (typeof v === 'string' ? v : null)), // mission and track, e.g. "jason2_hf 219 001"
    }),
  );
export type DahitiObservation = z.infer<typeof Observation>;

const Envelope = z.object({ code: z.coerce.number().optional(), message: z.string().optional(), data: z.unknown().optional() });

export async function getDahitiKey(): Promise<string | null> {
  const v = (await browser.storage.local.get(KEY))[KEY];
  return typeof v === 'string' && v ? v : null;
}

async function call(endpoint: string, args: Record<string, unknown>, key?: string): Promise<unknown> {
  const api_key = key ?? (await getDahitiKey());
  if (!api_key) throw new DahitiError('Add your DAHITI API key in Options to compare with DAHITI.');
  let resp: Response;
  try {
    resp = await fetch(`${BASE}/${endpoint}/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // Send only the arguments each endpoint documents: DAHITI rejects unknown ones
      // (list-targets answers "Invalid argument `format` not found!").
      body: JSON.stringify({ api_key, ...args }),
    });
  } catch {
    throw new DahitiError('Could not reach DAHITI. Check your connection.');
  }
  const text = await resp.text();
  const parsed = parseDahitiJson(text);
  const body = Envelope.safeParse(parsed);
  // Success: HTTP 200 with data (the water-level reply may omit `code`).
  if (resp.ok && body.success && (body.data.code === undefined || body.data.code === 200) && body.data.data !== undefined) return body.data.data;

  const msg = body.success ? body.data.message : undefined;
  if (resp.status === 403) throw new DahitiError(`DAHITI refused the API key${msg ? `: ${msg}` : '.'}`);
  if (msg) throw new DahitiError(`DAHITI: ${msg}`);
  // Say what came back, so an unexpected format can be diagnosed from the message alone.
  const sample = text.slice(0, 120).replace(/\s+/g, ' ').trim();
  throw new DahitiError(`DAHITI sent a reply the extension could not read (HTTP ${resp.status}${sample ? `: “${sample}…”` : ', empty'}).`);
}

/**
 * DAHITI's server writes missing numbers as bare NaN / Infinity (Python's json default),
 * which JSON.parse rejects. Turn them into null outside of strings, then parse.
 */
export function parseDahitiJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    try {
      return JSON.parse(text.replace(/("(?:[^"\\]|\\.)*")|-?\b(?:NaN|Infinity)\b/g, (m, str: string | undefined) => str ?? 'null'));
    } catch {
      return undefined;
    }
  }
}

export async function saveDahitiKey(key: string): Promise<void> {
  const clean = key.trim();
  // A tiny search proves the key works before it is stored.
  await call('list-targets', { min_lon: 35, max_lon: 35.1, min_lat: 11, max_lat: 11.1 }, clean);
  await browser.storage.local.set({ [KEY]: clean });
}

export const removeDahitiKey = () => browser.storage.local.remove(KEY);

export async function listTargets(bbox: [number, number, number, number]): Promise<DahitiTarget[]> {
  const [min_lon, min_lat, max_lon, max_lat] = bbox;
  const data = await call('list-targets', { min_lon, max_lon, min_lat, max_lat });
  return z.array(Target).parse(data ?? []);
}

export async function downloadWaterLevel(dahitiId: number): Promise<DahitiObservation[]> {
  const data = await call('download-water-level', { dahiti_id: dahitiId, format: 'json' });
  return z
    .array(Observation)
    .parse(data ?? [])
    .filter((o) => Number.isFinite(o.wse));
}
