const HYDROCRON = 'https://soto.podaac.earthdatacloud.nasa.gov/hydrocron/v1/timeseries';

export type HydrocronFeature = 'PriorLake' | 'Reach' | 'Node';

export interface HydrocronQuery {
  feature: HydrocronFeature;
  featureId: string;
  start: string;
  end: string;
  fields: string[];
  collection: string;
}

/**
 * Time series as CSV rows. Notes from the API spike:
 *  - `Accept: text/csv` must be sent without `output=` (HTTP 400 otherwise);
 *  - the body is a JSON-encoded string;
 *  - rows can be duplicated, so they are de-duplicated on time_str;
 *  - "no data" comes back as HTTP 400 with a "not found" message.
 */
export async function getTimeseries(q: HydrocronQuery, signal?: AbortSignal): Promise<Record<string, string>[]> {
  const params = new URLSearchParams({
    feature: q.feature,
    feature_id: q.featureId,
    start_time: q.start,
    end_time: q.end,
    fields: q.fields.join(','),
    collection_name: q.collection,
  });
  const resp = await fetch(`${HYDROCRON}?${params}`, { headers: { Accept: 'text/csv' }, signal });
  const text = await resp.text();
  if (!resp.ok) {
    if (/not found/i.test(text)) return [];
    throw new Error(`Hydrocron request failed (HTTP ${resp.status}).`);
  }
  return parseCsv(JSON.parse(text) as string);
}

export function parseCsv(csv: string): Record<string, string>[] {
  const [header, ...lines] = csv.trim().split('\n');
  if (!header) return [];
  const cols = header.split(',');
  const seen = new Set<string>();
  const rows: Record<string, string>[] = [];
  for (const line of lines) {
    const row = Object.fromEntries(line.split(',').map((v, i) => [cols[i]!, v]));
    const key = `${row[cols[0]!]}_${row.time_str}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push(row);
  }
  return rows;
}
