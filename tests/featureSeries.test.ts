import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { parseCsv } from '@/api/hydrocron';
import { toSeries } from '@/timeseries/featureSeries';

it('turns a real Hydrocron lake record into a sorted, QC-tagged series', () => {
  const rows = parseCsv(JSON.parse(readFileSync('tests/fixtures/hydrocron_roseires.csv', 'utf8')) as string);
  const s = toSeries('lakes', rows);
  expect(s.points.length).toBeGreaterThan(100);
  expect(s.units.wse).toBe('m');
  expect([...s.points].map((p) => p.time)).toEqual([...s.points].map((p) => p.time).sort());
  // Fill values never reach the chart as numbers.
  expect(s.points.every((p) => p.wse === null || p.wse > -1e10)).toBe(true);
  // Every point that passes QC has a level, flag 0/1 and wse_u <= 0.10 m.
  for (const p of s.points.filter((x) => x.qcPass)) {
    expect(p.wse).not.toBeNull();
    expect([0, 1]).toContain(p.flag);
    expect(p.wse_u!).toBeLessThanOrEqual(0.1);
  }
});

it('treats fill values in flags as missing, never as full coverage or a real flag', async () => {
  const s = toSeries('lakes', [
    { lake_id: '1', time_str: '2025-01-01T00:00:00Z', wse: '480', wse_u: '0.05', area_total: '400', quality_f: '-999', partial_f: '-999' },
    { lake_id: '1', time_str: '2025-01-02T00:00:00Z', wse: '480', wse_u: '0.05', area_total: '400', quality_f: '0', partial_f: 'no_data' },
    { lake_id: '1', time_str: '2025-01-03T00:00:00Z', wse: '480', wse_u: '0.05', area_total: '400', quality_f: '1', partial_f: '0' },
  ]);
  expect(s.points.map((p) => [p.flag, p.partial])).toEqual([[null, null], [0, null], [1, false]]);
});
