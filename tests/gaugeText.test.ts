import { describe, expect, it } from 'vitest';
import { checkRows, detectOrder, parseClipboard, parseDateText, parseLevelText } from '@/gauge/parseText';

const utc = (s: string) => Date.parse(`${s}T00:00:00Z`);

describe('dates as Excel shows them', () => {
  it.each([
    ['2024-01-31', 'dmy', '2024-01-31'],
    ['31/01/2024', 'dmy', '2024-01-31'],
    ['01/31/2024', 'mdy', '2024-01-31'],
    ['31.01.2024', 'dmy', '2024-01-31'],
    ['31-Jan-24', 'dmy', '2024-01-31'],
    ['31 January 2024', 'dmy', '2024-01-31'],
    ['Jan 31, 2024', 'dmy', '2024-01-31'],
    ['45322', 'dmy', '2024-01-31'],
  ] as const)('%s', (text, order, iso) => expect(parseDateText(text, order)).toBe(utc(iso)));

  it('rejects impossible and non-dates', () => {
    expect(parseDateText('31/02/2024', 'dmy')).toBeNull();
    expect(parseDateText('U/S level', 'dmy')).toBeNull();
    expect(parseDateText('489.31', 'dmy')).toBeNull();
  });

  it('decides day-first or month-first from the whole column', () => {
    expect(detectOrder(['01/02/2024', '13/02/2024'])).toMatchObject({ order: 'dmy', certain: true });
    expect(detectOrder(['02/13/2024'])).toMatchObject({ order: 'mdy', certain: true });
    expect(detectOrder(['01/02/2024'])).toMatchObject({ order: 'dmy', certain: false });
    expect(detectOrder(['13/02/2024', '02/13/2024']).conflict).toBe(true);
  });
});

describe('levels', () => {
  it('reads decimal points, decimal commas, units and thousands', () => {
    expect(parseLevelText('489.31')).toBe(489.31);
    expect(parseLevelText('489,31')).toBe(489.31);
    expect(parseLevelText(' 489.31 m')).toBe(489.31);
    expect(parseLevelText('1,234.5')).toBe(1234.5);
    expect(parseLevelText('n/a')).toBeNull();
  });
});

describe('clipboard from Excel', () => {
  it('splits tabs and lines, keeps quoted line breaks, drops the trailing newline', () => {
    expect(parseClipboard('Date\tLevel\r\n01/01/2024\t489.31\r\n"a\nb"\t1\r\n')).toEqual([
      ['Date', 'Level'],
      ['01/01/2024', '489.31'],
      ['a\nb', '1'],
    ]);
  });
});

describe('row checks', () => {
  it('flags bad cells and duplicates, warns on jumps, and returns sorted valid readings', () => {
    const c = checkRows(
      [
        { date: '02/01/2024', level: '489.28' },
        { date: '01/01/2024', level: '489.31' },
        { date: '', level: '' },
        { date: '03/01/2024', level: 'abc' },
        { date: '01/01/2024', level: '489.00' },
        { date: '04/01/2024', level: '479.30' },
        { date: '05/01/2024', level: '' },
      ],
      'auto',
    );
    expect(c.points).toEqual([
      [utc('2024-01-01'), 489.31],
      [utc('2024-01-02'), 489.28],
      [utc('2024-01-04'), 479.3],
    ]);
    expect(c.rows[2]).toBeNull();
    expect(c.rows[3]!.issues[0]!.text).toMatch(/not a number/);
    expect(c.rows[4]!.issues[0]!.text).toBe('Same date as row 2');
    expect(c.rows[5]!.issues[0]).toMatchObject({ kind: 'warning' });
    expect(c.rows[6]!.issues[0]!.text).toBe('Missing level');
    expect([c.errors, c.warnings]).toEqual([3, 1]);
  });
});
