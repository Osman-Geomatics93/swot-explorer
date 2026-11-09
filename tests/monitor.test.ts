import { expect, it } from 'vitest';
import { newGranules } from '@/monitor/monitor';

it('counts only granules not seen before', () => {
  const seen = ['SWOT_L2_HR_LakeSP_Prior_057_318_AF_x', 'SWOT_L2_HR_LakeSP_Prior_057_499_AF_x'];
  const current = [...seen, 'SWOT_L2_HR_LakeSP_Prior_058_318_AF_x'];
  expect(newGranules(current, seen)).toEqual(['SWOT_L2_HR_LakeSP_Prior_058_318_AF_x']);
  expect(newGranules(seen, seen)).toEqual([]);
});
