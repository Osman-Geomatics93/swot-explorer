import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseCsv } from '@/api/hydrocron';
import { compareSeries, fitAreaLevel, MIN_FULL_PASSES, storageChangeMcm } from '@/timeseries/analysis';
import { toSeries } from '@/timeseries/featureSeries';

describe('compareSeries', () => {
  const swot = [
    { time: '2025-01-01T10:00:00Z', wse: 480.5 },
    { time: '2025-01-11T10:00:00Z', wse: 481.0 },
    { time: '2025-02-20T10:00:00Z', wse: 482.0 }, // no independent observation within 3 days
  ];
  const other = [
    { time: '2025-01-02T00:00:00Z', wse: 480.0 },
    { time: '2025-01-10T00:00:00Z', wse: 480.6 },
    { time: '2025-03-30T00:00:00Z', wse: 470.0 },
  ];

  it('pairs observations within the window and reports bias and RMSE', () => {
    const c = compareSeries(swot, other, 3);
    expect(c.n).toBe(2);
    expect(c.bias).toBeCloseTo(0.45, 6); // median of 0.5 and 0.4
    expect(c.rmse).toBeCloseTo(Math.sqrt((0.25 + 0.16) / 2), 6);
    expect(c.rmseUnbiased).toBeCloseTo(0.05, 6);
  });

  it('returns no statistics when nothing overlaps', () => {
    expect(compareSeries(swot, [{ time: '2020-01-01T00:00:00Z', wse: 1 }]).bias).toBeNull();
  });
});

describe('area-elevation fit and storage change', () => {
  it('recovers a known linear reservoir and integrates it exactly', () => {
    // A(h) = 100 + 20 (h - 480) km², observed 480..490 m, with two partial-coverage outliers.
    const pts = Array.from({ length: 11 }, (_, i) => ({ wse: 480 + i, area: 100 + 20 * i }));
    pts.push({ wse: 486, area: 40 }, { wse: 488, area: 60 });
    const fit = fitAreaLevel(pts)!;
    expect(fit.slope).toBeCloseTo(20, 6);
    expect(fit.intercept + fit.slope * 480).toBeCloseTo(100, 6);
    expect(fit.physical).toBe(true);
    // ΔV from 480 to 490 m = ∫ (100 + 20 z) dz over 0..10 = 1000 + 1000 = 2000 km²·m = 2000 MCM.
    expect(storageChangeMcm(490, fit)).toBeCloseTo(2000, 6);
    expect(storageChangeMcm(480, fit)).toBeCloseTo(0, 9);
  });

  it('flags a fit where area shrinks as the level rises', () => {
    const fit = fitAreaLevel(Array.from({ length: 6 }, (_, i) => ({ wse: 500 + i, area: 50 - i })))!;
    expect(fit.physical).toBe(false);
  });

  const load = (name: string) =>
    toSeries('lakes', parseCsv(JSON.parse(readFileSync(`tests/fixtures/hydrocron_${name}_area.csv`, 'utf8')) as string));
  const fullPasses = (name: string) =>
    load(name)
      .points.filter((p) => p.qcPass && p.wse !== null && p.area_total !== null && p.partial === false)
      .map((p) => ({ wse: p.wse!, area: p.area_total! }));

  it('Roseires (real Hydrocron record): full-coverage passes give a sound, physical fit', () => {
    const fit = fitAreaLevel(fullPasses('roseires'))!;
    expect(fit.n).toBeGreaterThanOrEqual(40);
    expect(fit.physical).toBe(true);
    expect(fit.r2).toBeGreaterThan(0.4);
  });

  it('partial-coverage passes understate lake area, which is why they are excluded', () => {
    const pts = load('roseires').points.filter((p) => p.qcPass && p.area_total !== null);
    const med = (xs: number[]) => xs.sort((a, b) => a - b)[xs.length >> 1]!;
    expect(med(pts.filter((p) => p.partial).map((p) => p.area_total!))).toBeLessThan(med(pts.filter((p) => p.partial === false).map((p) => p.area_total!)));
  });

  it('Lake Nasser is wider than the SWOT swath: too few full passes to fit', () => {
    expect(fullPasses('aswan').length).toBeLessThan(MIN_FULL_PASSES);
  });
});
