/**
 * Minimal .xlsx reader: cell values of every sheet, with date-formatted numbers turned into
 * Dates. Enough for gauge tables (numbers, text, dates); formulas are read from their cached
 * values, so the workbook must have been saved by Excel or LibreOffice.
 */
import { strFromU8, unzipSync } from 'fflate';

export type Cell = string | number | Date | null;
export interface Sheet {
  name: string;
  /** rows[r][c], 0-based, ragged; empty cells are null. */
  rows: Cell[][];
}

const ENTITY: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) =>
    e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : (ENTITY[e] ?? m),
  );

const attr = (tag: string, name: string) => new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];

/** Built-in number formats that display dates or times (ECMA-376 §18.8.30). */
const BUILTIN_DATE = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58]);

/** A custom format is a date if, outside quotes, escapes and [colour] blocks, it uses d, m, y, h or s. */
export function isDateFormat(code: string): boolean {
  const bare = code.replace(/"[^"]*"|\\.|\[[^\]]*\]/g, '');
  return /[dmyhs]/i.test(bare) && !/^general$/i.test(bare.trim());
}

/** Excel serial day → UTC Date. The 1900 system counts a fictitious 29 Feb 1900, hence 25569. */
export function serialToDate(serial: number, date1904 = false): Date {
  return new Date(Math.round((serial - (date1904 ? 24107 : 25569)) * 86_400_000));
}

/** "AB12" → 27 (0-based column). */
function columnIndex(ref: string): number {
  let n = 0;
  for (const ch of ref) {
    const c = ch.charCodeAt(0);
    if (c < 65 || c > 90) break;
    n = n * 26 + (c - 64);
  }
  return n - 1;
}

export function readXlsx(bytes: Uint8Array): Sheet[] {
  const files = unzipSync(bytes);
  const text = (path: string) => (files[path] ? strFromU8(files[path]) : '');
  const workbook = text('xl/workbook.xml');
  if (!workbook) throw new Error('Not an Excel workbook (.xlsx). Older .xls files must be saved as .xlsx first.');
  const date1904 = /<workbookPr[^>]*date1904="(1|true)"/.test(workbook);

  const shared = [...text('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) =>
    decode([...m[1]!.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join('')),
  );

  const styles = text('xl/styles.xml');
  const customFormats = new Map([...styles.matchAll(/<numFmt\s[^>]*>/g)].map((m) => [Number(attr(m[0], 'numFmtId')), decode(attr(m[0], 'formatCode') ?? '')]));
  const cellXfs = /<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/.exec(styles)?.[1] ?? '';
  const dateStyle = [...cellXfs.matchAll(/<xf\s[^>]*?\/?>/g)].map((m) => {
    const id = Number(attr(m[0], 'numFmtId') ?? 0);
    const custom = customFormats.get(id);
    return custom !== undefined ? isDateFormat(custom) : BUILTIN_DATE.has(id);
  });

  const rels = new Map(
    [...text('xl/_rels/workbook.xml.rels').matchAll(/<Relationship\s[^>]*>/g)].map((m) => [attr(m[0], 'Id'), attr(m[0], 'Target') ?? '']),
  );

  return [...workbook.matchAll(/<sheet\s[^>]*>/g)].map((m) => {
    const name = decode(attr(m[0], 'name') ?? 'Sheet');
    const target = rels.get(attr(m[0], 'r:id')) ?? '';
    const path = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
    const rows: Cell[][] = [];
    for (const row of text(path).matchAll(/<row\s[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
      const r = Number(attr(row[0], 'r')) - 1;
      if (!(r >= 0) || !row[1]) continue;
      const cells: Cell[] = [];
      for (const c of row[1].matchAll(/<c\s([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const tag = ` ${c[1]}`;
        const col = columnIndex(attr(tag, 'r') ?? '');
        const body = c[2] ?? '';
        const type = attr(tag, 't');
        const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
        let value: Cell = null;
        if (type === 's') value = v !== undefined ? (shared[Number(v)] ?? null) : null;
        else if (type === 'inlineStr') value = decode([...body.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join(''));
        else if (type === 'str') value = v !== undefined ? decode(v) : null;
        else if (type === 'd') value = v ? new Date(v.length === 10 ? `${v}T00:00:00Z` : v) : null;
        else if (type === 'b' || type === 'e') value = null;
        else if (v !== undefined && v !== '') {
          const n = Number(v);
          value = Number.isFinite(n) ? (dateStyle[Number(attr(tag, 's') ?? 0)] ? serialToDate(n, date1904) : n) : null;
        }
        if (col >= 0) cells[col] = value;
      }
      rows[r] = Array.from(cells, (x) => x ?? null);
    }
    return { name, rows: Array.from(rows, (x) => x ?? []) };
  });
}
