import type { Feature, Polygon } from 'geojson';
import { describe, expect, it } from 'vitest';
import { levelsInArea, type AreaPiece } from '@/gauge/areaLevels';

const box = (x0: number, y0: number, x1: number, y1: number): Polygon => ({
  type: 'Polygon',
  coordinates: [
    [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
      [x0, y0],
    ],
  ],
});
const zone: Feature<Polygon> = { type: 'Feature', properties: {}, geometry: box(34.3, 11.6, 34.4, 11.7) };

const piece = (granule: string, wse: number, geometry: Polygon, extra: Partial<AreaPiece> = {}): AreaPiece => ({
  granule,
  cycle: granule.split('_')[0]!,
  pass: '318',
  time_str: '2024-03-01T07:00:00Z',
  obs_id: `${granule}-${wse}`,
  wse,
  wse_u: 0.05,
  quality_f: 0,
  area_total: 1,
  geometry,
  ...extra,
});

describe('SWOT level inside a study area', () => {
  it('weights observations by their surface inside the area and ignores water outside it', () => {
    const r = levelsInArea(
      [
        piece('010_A', 488.0, box(34.3, 11.6, 34.4, 11.7)), // fully inside, large
        piece('010_A', 488.4, box(34.39, 11.6, 34.5, 11.7)), // mostly outside: only a 0.01° strip counts
        piece('010_A', 470.0, box(35.0, 12.0, 35.1, 12.1)), // far away: never counts
      ],
      zone,
    );
    expect(r.levels).toHaveLength(1);
    expect(r.levels[0]!.wse).toBe(488.0);
    expect(r.levels[0]!.pieces).toBe(2);
    expect(r.levels[0]!.insideKm2).toBeGreaterThan(110);
  });

  it('applies the QC rule, keeps the latest reprocessing of a pass, and counts passes without usable water', () => {
    const r = levelsInArea(
      [
        piece('011_A_PIB0_01', 480, box(34.3, 11.6, 34.4, 11.7), { cycle: '011' }),
        piece('011_A_PIC0_01', 481, box(34.3, 11.6, 34.4, 11.7), { cycle: '011' }), // reprocessed copy wins
        piece('012_A', 482, box(34.3, 11.6, 34.4, 11.7), { cycle: '012', quality_f: 2 }), // bad flag
        piece('013_A', 483, box(34.3, 11.6, 34.4, 11.7), { cycle: '013', wse_u: 0.3 }), // too uncertain
      ],
      zone,
    );
    expect(r.levels.map((l) => l.wse)).toEqual([481]);
    expect(r.duplicatesRemoved).toBe(1);
    expect(r.passesWithoutData).toBe(2);
  });
});

describe('passes that observed a lake', async () => {
  const { passesFromRows, passCode } = await import('@/robust/lakePasses');
  it('collects zero-padded pass ids from rows with a real observation time', () => {
    expect(passCode('40')).toBe('040');
    expect(
      passesFromRows([
        { time_str: '2024-01-01T07:00:00Z', pass_id: '499' },
        { time_str: 'no_data', pass_id: '318' },
        { time_str: '2024-01-02T07:00:00Z', pass_id: '40' },
        { time_str: '2024-01-03T07:00:00Z', pass_id: '499' },
      ]).sort(),
    ).toEqual(['040', '499']);
  });
});
