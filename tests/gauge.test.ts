import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { findCandidates, mergeCandidates, readCsv } from '@/gauge/table';
import { defaultMaxGapDays, gaugePoints, interpolateGauge, stats, validateAgainstGauge } from '@/gauge/validate';
import { isDateFormat, readXlsx, serialToDate } from '@/gauge/xlsx';

const DAY = 86_400_000;
const utc = (s: string) => Date.parse(`${s}T00:00:00Z`);

/** A workbook shaped like a dam record: daily block in A–C, a second block in E–F, text headers above. */
function workbook(): Uint8Array {
  const shared = ['daily', 'Date', 'Day', 'U/S level', '10-daily', 'Roseries Dam', 'D/S level'];
  const si = shared.map((s) => `<si><t>${s}</t></si>`).join('');
  const c = (ref: string, v: string | number, s?: number, t?: string) => `<c r="${ref}"${s !== undefined ? ` s="${s}"` : ''}${t ? ` t="${t}"` : ''}><v>${v}</v></c>`;
  const rows = [
    `<row r="1">${c('A1', 0, undefined, 's')}${c('E1', 4, undefined, 's')}${c('F1', 5, undefined, 's')}</row>`,
    `<row r="2">${c('A2', 1, undefined, 's')}${c('B2', 2, undefined, 's')}${c('C2', 3, undefined, 's')}${c('D2', 6, undefined, 's')}${c('E2', 1, undefined, 's')}${c('F2', 3, undefined, 's')}</row>`,
  ];
  // 2014-01-01 is serial 41640; 2024-01-01 is 45292.
  for (let i = 0; i < 12; i++)
    rows.push(
      `<row r="${i + 3}">${c(`A${i + 3}`, 41640 + i, 1)}<c r="B${i + 3}" t="inlineStr"><is><t>${String(i + 1).padStart(2, '0')}</t></is></c>${c(`C${i + 3}`, 489 - i * 0.1)}${c(`D${i + 3}`, 441.7)}${c(`E${i + 3}`, 45292 + i, 2)}${c(`F${i + 3}`, 488 + i * 0.05)}</row>`,
    );
  return zipSync({
    'xl/workbook.xml': strToU8('<workbook><sheets><sheet name="Roseires" sheetId="1" r:id="rId1"/></sheets></workbook>'),
    'xl/_rels/workbook.xml.rels': strToU8('<Relationships><Relationship Id="rId1" Type="ws" Target="worksheets/sheet1.xml"/></Relationships>'),
    'xl/sharedStrings.xml': strToU8(`<sst>${si}</sst>`),
    'xl/styles.xml': strToU8(
      '<styleSheet><numFmts><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/></numFmts><cellXfs><xf numFmtId="0"/><xf numFmtId="14"/><xf numFmtId="164"/></cellXfs></styleSheet>',
    ),
    'xl/worksheets/sheet1.xml': strToU8(`<worksheet><sheetData>${rows.join('')}</sheetData></worksheet>`),
  });
}

describe('xlsx reader', () => {
  it('reads shared and inline strings, numbers, and date-styled serials as UTC dates', () => {
    const [sheet] = readXlsx(workbook());
    expect(sheet!.name).toBe('Roseires');
    expect(sheet!.rows[1]![2]).toBe('U/S level');
    expect(sheet!.rows[2]![0]).toEqual(new Date(utc('2014-01-01')));
    expect(sheet!.rows[2]![1]).toBe('01');
    expect(sheet!.rows[2]![2]).toBe(489);
    expect(sheet!.rows[2]![4]).toEqual(new Date(utc('2024-01-01')));
  });

  it('tells date formats from number formats', () => {
    expect(isDateFormat('dd/mm/yyyy')).toBe(true);
    expect(isDateFormat('[$-409]d-mmm-yy;@')).toBe(true);
    expect(isDateFormat('0.00')).toBe(false);
    expect(isDateFormat('"m" 0.00')).toBe(false);
    expect(serialToDate(45292)).toEqual(new Date(utc('2024-01-01')));
  });
});

describe('gauge columns', () => {
  it('finds each block with its own date column and ticks the upstream levels only', () => {
    const found = findCandidates(readXlsx(workbook()));
    const byLabel = found.map((c) => `${c.label}|${c.columns}|${c.suggested}`);
    expect(byLabel).toEqual(['U/S level|A → C|true', 'D/S level|A → D|false', 'U/S level|E → F|true']);
    expect(found[0]!.context).toBe('daily');
    expect(found[2]!.context).toBe('10-daily · Roseries Dam');
    expect(found[0]!.stepDays).toBe(1);
    const merged = mergeCandidates(found.filter((c) => c.suggested));
    expect(merged).toHaveLength(24);
    expect(merged[0]).toEqual([utc('2014-01-01'), 489]);
  });

  it('reads CSV with day-first dates, semicolons and decimal commas', () => {
    const rows = ['date;level', ...Array.from({ length: 12 }, (_, i) => `${String(i + 1).padStart(2, '0')}/03/2024;487,${50 + i}`)].join('\r\n');
    const [c] = findCandidates([readCsv(rows)]);
    expect(c!.points[0]).toEqual([utc('2024-03-01'), 487.5]);
    expect(c!.suggested).toBe(true);
  });

  it('switches to month-first when the file proves it', () => {
    const rows = ['date,level', '03/13/2024,1', ...Array.from({ length: 11 }, (_, i) => `03/${String(i + 1).padStart(2, '0')}/2024,2`)].join('\n');
    expect(findCandidates([readCsv(rows)])[0]!.points.at(-1)![0]).toBe(utc('2024-03-13'));
  });
});

describe('gauge validation', () => {
  const daily = (start: string, n: number, f: (i: number) => number): [number, number][] => Array.from({ length: n }, (_, i) => [utc(start) + i * DAY, f(i)]);

  it('puts date-only readings at local midday and interpolates between consecutive days only', () => {
    const g = gaugePoints(daily('2024-01-01', 3, (i) => 480 + i), 2);
    expect(new Date(g[0]!.t).toISOString()).toBe('2024-01-01T10:00:00.000Z');
    const max = defaultMaxGapDays(g);
    expect(max).toBe(1.5);
    expect(interpolateGauge(g, Date.parse('2024-01-01T22:00:00Z'), max)!.level).toBeCloseTo(480.5);
    expect(interpolateGauge(g, Date.parse('2024-01-05T10:00:00Z'), max)).toBeNull();
    const gappy = gaugePoints([[utc('2024-01-01'), 1], [utc('2024-01-05'), 2]], 2);
    expect(interpolateGauge(gappy, Date.parse('2024-01-03T10:00:00Z'), 1.5)).toBeNull();
  });

  it('separates a constant datum offset from the real disagreement', () => {
    const pairs = [0.1, -0.1, 0.05, -0.05, 0].map((e, i) => ({ time: `2024-01-0${i + 1}`, gauge: 480 + i, swot: 480 + i + 1.5 + e, diff: 1.5 + e }));
    const s = stats(pairs);
    expect(s.bias).toBeCloseTo(1.5);
    expect(s.rmseUnbiased).toBeCloseTo(Math.sqrt((0.01 + 0.01 + 0.0025 + 0.0025) / 5));
    expect(s.rmse!).toBeGreaterThan(1.4);
    expect(s.within10).toBe(1);
    expect(s.r!).toBeGreaterThan(0.99);
  });

  it('pairs SWOT passes, counts the unmatched, and flags and optionally drops outliers', () => {
    const gauge = gaugePoints(daily('2024-01-01', 30, (i) => 480 + i * 0.1), 2);
    const swot = Array.from({ length: 10 }, (_, i) => ({ time: new Date(utc('2024-01-02') + i * 2 * DAY + 8 * 3_600_000).toISOString(), wse: 0 }));
    for (const [i, p] of swot.entries()) p.wse = interpolateGauge(gauge, Date.parse(p.time), 1.5)!.level + 2 + (i % 2 ? 0.02 : -0.02);
    swot[4]!.wse += 3; // a bad pass
    swot.push({ time: '2025-06-01T08:00:00Z', wse: 490 }); // after the gauge record
    const all = validateAgainstGauge(swot, gauge, { maxGapDays: 1.5, excludeOutliers: false });
    expect(all.pairs).toHaveLength(10);
    expect(all.unmatched).toBe(1);
    expect(all.outliers).toBe(1);
    expect(all.stats.bias).toBeCloseTo(2, 1);
    const clean = validateAgainstGauge(swot, gauge, { maxGapDays: 1.5, excludeOutliers: true });
    expect(clean.stats.n).toBe(9);
    expect(clean.stats.rmseUnbiased!).toBeLessThan(0.03);
  });
});
