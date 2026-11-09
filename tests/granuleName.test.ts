import { describe, expect, it } from 'vitest';
import { latestVersions, parseGranuleName } from '@/search/granuleName';

// Real Version D names from CMR (2025-10, over GERD).
describe('parseGranuleName', () => {
  it.each([
    ['SWOT_L2_HR_RiverSP_Reach_039_290_AF_20251001T101231_20251001T102351_PID0_01_swot', { cycle: '039', pass: '290', continent: 'AF', tile: null }],
    ['SWOT_L2_HR_LakeSP_Prior_039_290_AF_20251001T101231_20251001T102351_PID0_01_swot', { cycle: '039', pass: '290', continent: 'AF', tile: null }],
    ['SWOT_L2_HR_RiverAvg_039_AF_11_20250921T020646_20251011T225152_PID0_01', { cycle: '039', pass: null, continent: 'AF', tile: null }],
    ['SWOT_L2_HR_PIXC_039_318_135R_20251002T101752_20251002T101803_PID0_01', { cycle: '039', pass: '318', continent: null, tile: '135R' }],
    ['SWOT_L2_HR_Raster_100m_UTM36P_N_x_x_x_039_318_068F_20251002T101752_20251002T101810_PID0_01_swot', { cycle: '039', pass: '318', continent: null, tile: '068F' }],
    ['SWOT_L2_LR_SSH_Expert_039_318_20251002T095530_20251002T104658_PID0_01_swot', { cycle: '039', pass: '318', continent: null, tile: null }],
  ])('%s', (name, expected) => {
    expect(parseGranuleName(name)).toMatchObject(expected);
  });

  it('parses the start time', () => {
    expect(parseGranuleName('SWOT_L2_HR_PIXC_039_318_135R_20251002T101752_20251002T101803_PID0_01').start).toBe(
      '2025-10-02T10:17:52Z',
    );
  });
});

it('keeps only the newest reprocessed version', () => {
  const { items, removed } = latestVersions([
    { name: 'SWOT_L2_HR_PIXC_040_499_087L_20251029T182116_20251029T182127_PID0_01' },
    { name: 'SWOT_L2_HR_PIXC_040_499_087L_20251029T182116_20251029T182127_PID0_02' },
    { name: 'SWOT_L2_HR_PIXC_040_499_088L_20251029T182127_20251029T182138_PID0_01' },
  ]);
  expect(removed).toBe(1);
  expect(items.map((i) => i.name).sort()).toEqual([
    'SWOT_L2_HR_PIXC_040_499_087L_20251029T182116_20251029T182127_PID0_02',
    'SWOT_L2_HR_PIXC_040_499_088L_20251029T182127_20251029T182138_PID0_01',
  ]);
});
