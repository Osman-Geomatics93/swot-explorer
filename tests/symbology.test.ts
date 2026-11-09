import { describe, expect, it } from 'vitest';
import { fmtLevels, levelRange, levelStops, qualityOf } from '@/map/symbology';

describe('preview symbology', () => {
  it('spreads five colour stops evenly across the level range', () => {
    expect(levelStops([400, 420])).toEqual([400, 405, 410, 415, 420]);
    expect(levelStops([423.1, 423.1])).toEqual([423.1, 423.35, 423.6, 423.85, 424.1]); // a flat range still draws
  });

  it('stretches colours over the 2nd–98th percentile but keeps the full range', () => {
    const r = levelRange([...Array.from({ length: 98 }, (_, i) => 400 + i * 0.1), 300, 900])!;
    expect(r.full).toEqual([300, 900]);
    expect(r.range[0]).toBeGreaterThan(300);
    expect(r.range[1]).toBeLessThan(900);
    expect(levelRange([])).toBeNull();
  });

  it('reads the quality flag whatever the product calls it, ignoring fills', () => {
    expect(qualityOf({ quality_f: 1 })).toBe(1);
    expect(qualityOf({ reach_q: 3 })).toBe(3);
    expect(qualityOf({ node_q: -999 })).toBeNull();
    expect(qualityOf({})).toBeNull();
  });

  it('writes one level when they are all the same', () => {
    expect(fmtLevels(423.1, 423.12)).toBe('423.1 m');
    expect(fmtLevels(407.7, 423.1)).toBe('407.7–423.1 m');
  });
});
