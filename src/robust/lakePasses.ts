/**
 * Every SWOT pass that has observed a PLD lake, from Hydrocron's lake record. The pass lists in
 * reservoirs.json were compiled by hand and can miss a pass (Roseires is also seen by pass 499),
 * so they are only a fallback and a floor.
 */
import { getTimeseries } from '@/api/hydrocron';
import { SERIES_START } from '@/timeseries/featureSeries';

export const passCode = (p: string) => p.trim().padStart(3, '0');

/** Pass ids in Hydrocron rows that carry a real observation time. */
export function passesFromRows(rows: Record<string, string>[]): string[] {
  return [...new Set(rows.filter((r) => r.time_str && r.time_str !== 'no_data' && /^\d+$/.test(r.pass_id ?? '')).map((r) => passCode(r.pass_id!)))];
}

export async function lakePasses(lakeId: string, configured: string[], signal?: AbortSignal): Promise<string[]> {
  let found: string[] = [];
  try {
    const rows = await getTimeseries(
      {
        feature: 'PriorLake',
        featureId: lakeId,
        start: SERIES_START,
        end: `${new Date().toISOString().slice(0, 19)}Z`,
        fields: ['lake_id', 'time_str', 'pass_id'],
        collection: 'SWOT_L2_HR_LakeSP_D',
      },
      signal,
    );
    found = passesFromRows(rows);
  } catch (err) {
    if (signal?.aborted) throw err;
    // Hydrocron unavailable: fall back to the configured passes.
  }
  return [...new Set([...configured.map(passCode), ...found])].sort();
}
