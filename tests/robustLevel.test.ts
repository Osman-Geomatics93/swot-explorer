import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  dedupeGranules,
  gradeReliability,
  hampelFlags,
  passLevel,
  robustLevels,
  weightedMedian,
  DEFAULT_ROBUST_OPTIONS,
  type ObsPiece,
} from '@/robust/robustLevel';

const load = (name: string) => JSON.parse(readFileSync(`tests/fixtures/obs_pieces_${name}.json`, 'utf8')) as ObsPiece[];

const piece = (over: Partial<ObsPiece>): ObsPiece => ({
  granule: 'SWOT_L2_HR_LakeSP_Obs_001_318_AF_20250101T000000_20250101T000100_PGD0_01',
  cycle: '001',
  pass: '318',
  time_str: '2025-01-01T00:00:00Z',
  obs_id: 'a',
  wse: 600,
  wse_u: 0.05,
  quality_f: 1,
  area_total: 100,
  ...over,
});

describe('building blocks', () => {
  it('weighted median follows area, not piece count', () => {
    expect(weightedMedian([{ v: 600, w: 690 }, { v: 611, w: 174 }, { v: 538, w: 2 }])).toBe(600);
  });

  it('keeps the newest reprocessed granule per cycle/pass', () => {
    const old = piece({ granule: 'X_001_318_AF_T_PGD0_01' });
    const repro = piece({ granule: 'X_001_318_AF_T_PGD0_02' });
    const { pieces, removed } = dedupeGranules([old, repro]);
    expect(removed).toBe(1);
    expect(pieces).toEqual([repro]);
  });

  it('drops a QC-passing outlier piece by MAD, then takes the area-weighted median', () => {
    const level = passLevel(
      [
        piece({ obs_id: 'big', wse: 605.7, area_total: 690 }),
        piece({ obs_id: 'dam', wse: 605.9, area_total: 174 }),
        piece({ obs_id: 'mid', wse: 605.6, area_total: 40 }),
        piece({ obs_id: 'bad', wse: 538.2, area_total: 2.4 }), // flag 1, wse_u 0.05: passes QC
      ],
      DEFAULT_ROBUST_OPTIONS,
    )!;
    expect(level.n_qc).toBe(4);
    expect(level.kept_obs_ids).not.toContain('bad');
    expect(level.wse).toBe(605.7);
  });

  it('ignores pieces failing QC or smaller than the minimum area', () => {
    const level = passLevel(
      [piece({ obs_id: 'ok' }), piece({ obs_id: 'q3', quality_f: 3 }), piece({ obs_id: 'tiny', area_total: 0.2 })],
      DEFAULT_ROBUST_OPTIONS,
    )!;
    expect(level.kept_obs_ids).toEqual(['ok']);
  });

  it('flags a single spike in an otherwise smooth series', () => {
    const series = [480, 480.2, 480.1, 492, 480.3, 480.2, 480.4];
    expect(hampelFlags(series, 3, 0.5, 3)).toEqual([false, false, false, true, false, false, false]);
  });

  it('grades a smooth series good and a jumpy one unreliable', () => {
    expect(gradeReliability([480, 480.2, 480.3, 480.1, 480.4, 480.6]).reliability).toBe('good');
    expect(gradeReliability([600, 590, 605, 588, 610, 595]).reliability).toBe('unreliable');
    expect(gradeReliability([600, 601]).reliability).toBe('insufficient');
  });
});

describe('GERD (real LakeSP_obs pieces, passes 318 and 499, 2023-2026)', () => {
  const result = robustLevels(load('gerd'));

  it('removes the 14 reprocessed duplicate granules', () => {
    expect(result.duplicatesRemoved).toBe(14);
  });

  it('is graded unreliable: robust aggregation cannot fix errors in the piece heights', () => {
    expect(result.reliability).toBe('unreliable');
    expect(result.medianJumpM!).toBeGreaterThan(2);
  });
});

describe.runIf(existsSync('tests/fixtures/obs_pieces_roseires.json'))('Roseires (real pieces, passes 318 and 221)', () => {
  it('is graded good', () => {
    const result = robustLevels(load('roseires'));
    expect(result.reliability).toBe('good');
  });
});
