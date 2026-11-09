import { describe, expect, it } from 'vitest';
import { parseHydrowebText } from '@/api/hydroweb';

// Layouts as documented in the Hydroweb Product User Manual V2.1 (THEIA-MU-42-0282-CNES).
describe('parseHydrowebText', () => {
  it('reads the lake layout (";"-separated, decimal year first)', () => {
    const text = [
      '#lake=Roseires;country=Sudan;basin=Nile',
      '# (1): decimal year, (2): date = yyyy/mm/dd, (3): time = hh:mm, (4): height above surface of ref (m), (5): standard deviation (m), (6): area (km2), (7): volume (km3), (8): flag',
      '2024.5014 ; 2024/07/02 ; 10:15 ; 481.23 ; 0.05 ; 412.0 ; 9999.999 ; ',
      '2024.4795 ; 2024/06/24 ; 21:40 ; 482.10 ; 9999.999 ; 9999.999 ; 9999.999 ; ',
      '2024.5040 ; 2024/07/03 ; 07:00 ; 9999.999 ; 0.10 ; 9999.999 ; 9999.999 ; ',
    ].join('\n');
    expect(parseHydrowebText(text)).toEqual([
      { time: '2024-06-24T21:40:00Z', wse: 482.1, wse_u: null },
      { time: '2024-07-02T10:15:00Z', wse: 481.23, wse_u: 0.05 },
    ]);
  });

  it('reads the river layout (space-separated, with expert columns)', () => {
    const text = [
      '#BASIN:: NILE',
      '#RIVER:: BLUE-NILE',
      '#COL 1 : DATE(YYYY-MM-DD)',
      '#COL 2 : TIME(HH:MM)',
      '#COL 3 : ORTHOMETRIC HEIGHT (M) OF WATER SURFACE AT REFERENCE POSITION',
      '#COL 4 : ASSOCIATED UNCERTAINTY(M)',
      '2025-03-01 08:31 605.410 0.120 34.98 11.22 610.2 4.8 0.4 SENTINEL-6 J5 109 98 MLE4 F',
      '2025-03-11 06:29 NA NA 34.98 11.22',
      '2025-03-21 04:27 606.020 NA 34.98 11.22',
    ].join('\r\n');
    expect(parseHydrowebText(text)).toEqual([
      { time: '2025-03-01T08:31:00Z', wse: 605.41, wse_u: 0.12 },
      { time: '2025-03-21T04:27:00Z', wse: 606.02, wse_u: null },
    ]);
  });

  it('ignores headers and malformed lines', () => {
    expect(parseHydrowebText('# only a header\n\nnot data at all\n')).toEqual([]);
  });
});
