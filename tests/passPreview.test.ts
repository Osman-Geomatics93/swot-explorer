import { expect, it } from 'vitest';
import { passesOf, summarizeLayer } from '@/preview/passPreview';

it('lists each cycle/pass/continent once, newest first', () => {
  const g = (cycle: string, pass: string, start: string) => ({ cycle, pass, continent: 'AF', start });
  expect(passesOf([g('057', '499', '2026-10-19'), g('058', '318', '2026-11-02'), g('058', '318', '2026-11-02'), { cycle: '058', pass: null, continent: 'AF', start: 'x' }])).toEqual([
    g('058', '318', '2026-11-02'),
    g('057', '499', '2026-10-19'),
  ]);
});

it('summarises a layer: counts, QC, level range and lake water inside the area', () => {
  const lake = (wse: number | null, area: number, fraction: number, qc: boolean) => ({
    type: 'Feature' as const,
    geometry: { type: 'Point' as const, coordinates: [0, 0] },
    properties: { wse, area_total: area, clip_fraction: fraction, qc_pass: qc },
  });
  const s = summarizeLayer({ kind: 'lakes', granule: null, fields: new Map(), features: [lake(606.75, 863.52, 0.8, true), lake(null, 10, 1, false)] });
  expect(s).toMatchObject({ count: 2, passing: 1, wseMin: 606.75, wseMax: 606.75 });
  expect(s.lakeAreaKm2).toBeCloseTo(863.52 * 0.8 + 10, 1);
});
