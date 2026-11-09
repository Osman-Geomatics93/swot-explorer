import { expect, it } from 'vitest';
import { formatCitation } from '@/lib/citation';

it('formats a data citation from real CMR collection metadata', () => {
  // UMM-C of SWOT_L2_HR_LakeSP_prior_D as returned by CMR (2026-11-07).
  const umm = {
    DOI: { DOI: '10.5067/SWOT-LAKESP-D' },
    CollectionCitations: [
      {
        Creator: 'Surface Water Ocean Topography (SWOT)',
        Title: 'SWOT Level 2 Lake Single-Pass Vector Prior Data Product, Version D',
        Publisher: 'JPL NASA',
        ReleaseDate: '2025-05-13T00:00:00.000Z',
        Version: 'D',
      },
    ],
  };
  const c = formatCitation('SWOT_L2_HR_LakeSP_prior_D', umm, new Date('2026-11-07T00:00:00Z'));
  expect(c.doi).toBe('10.5067/SWOT-LAKESP-D');
  expect(c.text).toBe(
    'Surface Water Ocean Topography (SWOT). (2025). SWOT Level 2 Lake Single-Pass Vector Prior Data Product, Version D (Version D) [Data set]. JPL NASA. https://doi.org/10.5067/SWOT-LAKESP-D. Accessed 2026-11-07.',
  );
});

it('falls back gracefully when CMR has no citation block', () => {
  expect(formatCitation('X_D', {}, new Date('2026-01-01')).text).toBe('SWOT. (n.d.). X_D [Data set]. NASA Physical Oceanography DAAC. CMR short name X_D. Accessed 2026-01-01.');
});
