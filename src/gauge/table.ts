/**
 * Find gauge series in a spreadsheet or CSV: every (date column, numeric column) pair with
 * enough values, labelled from the header cells above it. Real gauge workbooks put several
 * blocks side by side (e.g. 2014–2023 daily in A–E and 2024 in H–I), so each block becomes
 * its own candidate and the user ticks the ones that form the series.
 */
import { readXlsx, type Cell, type Sheet } from './xlsx';

export interface GaugeCandidate {
  id: string;
  sheet: string;
  /** Header of the value column, e.g. "U/S level". */
  label: string;
  /** Text above the header block, e.g. "daily", "10-daily · Roseries Dam". */
  context: string;
  /** Spreadsheet columns, e.g. "A → C". */
  columns: string;
  /** [UTC ms of the date, value], sorted, one per date. */
  points: [number, number][];
  stepDays: number;
  /** Looks like a reservoir (upstream) water level; pre-ticked. */
  suggested: boolean;
}

const MIN_POINTS = 10;
const DAY = 86_400_000;

export const columnName = (i: number): string => (i >= 26 ? columnName(Math.floor(i / 26) - 1) : '') + String.fromCharCode(65 + (i % 26));

/* ---------------------------------------------------------------- CSV input */

function splitCsvLine(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') (cur += '"'), i++;
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) out.push(cur), (cur = '');
    else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

const ISO = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?)?Z?$/;
const DMY = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?: (\d{1,2}):(\d{2})(?::(\d{2}))?)?$/;

/**
 * Text table → cells. Delimiter `,` `;` or tab; decimal comma accepted with `;` or tab.
 * Slash dates are day-first (as written in Sudan and most of the world) unless the file
 * itself proves month-first (a middle number above 12).
 */
export function readCsv(text: string): Sheet {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim() !== '');
  const head = lines.slice(0, 20).join('\n');
  const sep = ['\t', ';', ','].map((s) => [s, head.split(s).length] as const).sort((a, b) => b[1] - a[1])[0]![0];
  const raw = lines.map((l) => splitCsvLine(l, sep));
  const monthFirst = raw.some((r) =>
    r.some((c) => {
      const m = DMY.exec(c);
      return m !== null && Number(m[2]) > 12 && Number(m[1]) <= 12;
    }),
  );
  const toCell = (s: string): Cell => {
    if (s === '') return null;
    let m = ISO.exec(s);
    if (m) return new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0)));
    m = DMY.exec(s);
    if (m) {
      const [a, b] = [+m[1]!, +m[2]!];
      return new Date(Date.UTC(+m[3]!, (monthFirst ? a : b) - 1, monthFirst ? b : a, +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0)));
    }
    const n = Number(sep === ',' ? s : s.replace(',', '.'));
    return Number.isFinite(n) ? n : s;
  };
  return { name: 'CSV', rows: raw.map((r) => r.map(toCell)) };
}

export function readTableFile(name: string, bytes: Uint8Array): Sheet[] {
  if (/\.xlsx$/i.test(name)) return readXlsx(bytes);
  if (/\.(csv|txt|tsv)$/i.test(name)) return [readCsv(new TextDecoder().decode(bytes))];
  throw new Error('Use an Excel workbook (.xlsx) or a CSV/TXT file.');
}

/* ----------------------------------------------------------- series finding */

const isDate = (c: Cell | undefined): c is Date => c instanceof Date && !Number.isNaN(c.getTime());
const isNum = (c: Cell | undefined): c is number => typeof c === 'number' && Number.isFinite(c);
const text = (c: Cell | undefined) => (typeof c === 'string' ? c.trim() : '');

const NOT_A_SERIES = /^(year|yr|month|day|doy|no\.?|#|id)$/i;
const LEVEL = /level|stage|\bwl\b|\bh\b|elev|u\s*\/\s*s|upstream|reservoir|lake|head\s*water/i;
const NOT_LEVEL = /d\s*\/\s*s|down\s*stream|tail|flow|dis(charge)?\b|q\b|volume|storage|area|rain|evap|energy|power|mm3|m3/i;
const UPSTREAM = /u\s*\/\s*s|upstream|reservoir|lake|head\s*water/i;

export function findCandidates(sheets: Sheet[]): GaugeCandidate[] {
  const found: GaugeCandidate[] = [];
  for (const sheet of sheets) {
    const width = Math.max(0, ...sheet.rows.map((r) => r.length));
    const count = (col: number, test: (c: Cell | undefined) => boolean) => sheet.rows.reduce((n, r) => n + (test(r[col]) ? 1 : 0), 0);
    const dateCols = Array.from({ length: width }, (_, c) => c).filter((c) => count(c, isDate) >= MIN_POINTS);
    if (!dateCols.length) continue;

    for (let v = 0; v < width; v++) {
      if (dateCols.includes(v) || count(v, isNum) < MIN_POINTS) continue;
      // The block's date column: nearest one to the left, else nearest to the right.
      const d = [...dateCols].reverse().find((c) => c < v) ?? dateCols.find((c) => c > v)!;
      const byDay = new Map<number, number>();
      let firstRow = -1;
      sheet.rows.forEach((r, i) => {
        const [t, x] = [r[d], r[v]];
        if (!isDate(t) || !isNum(x)) return;
        if (firstRow < 0) firstRow = i;
        byDay.set(t.getTime(), x); // a repeated date keeps its last value
      });
      if (byDay.size < MIN_POINTS) continue;

      // Header: nearest text above the first value; context: other text above, between the two columns.
      let label = '';
      let headerRow = firstRow;
      for (let i = firstRow - 1; i >= Math.max(0, firstRow - 6) && !label; i--) if ((label = text(sheet.rows[i]?.[v]))) headerRow = i;
      if (NOT_A_SERIES.test(label)) continue;
      const context: string[] = [];
      for (let i = headerRow - 1; i >= Math.max(0, headerRow - 4); i--)
        for (let c = Math.min(d, v); c <= Math.max(d, v); c++) {
          const s = text(sheet.rows[i]?.[c]);
          if (s && !context.includes(s)) context.push(s);
        }

      const points = [...byDay].sort((a, b) => a[0] - b[0]);
      const values = points.map((p) => p[1]);
      // Years typed as numbers (2014, 2015 …) next to a date are not a series.
      if (values.every((x) => Number.isInteger(x) && x >= 1900 && x <= 2100)) continue;
      const steps = points.slice(1).map((p, i) => (p[0] - points[i]![0]) / DAY).sort((a, b) => a - b);
      const name = label || `Column ${columnName(v)}`;
      found.push({
        id: `${sheet.name}!${columnName(d)}${columnName(v)}`,
        sheet: sheet.name,
        label: name,
        context: context.join(' · '),
        columns: `${columnName(d)} → ${columnName(v)}`,
        points,
        stepDays: steps[steps.length >> 1] ?? 1,
        suggested: false,
      });
    }
  }
  // Tick the upstream (reservoir) levels; failing that, anything that reads as a level.
  const level = found.filter((c) => LEVEL.test(c.label) && !NOT_LEVEL.test(c.label));
  const upstream = level.filter((c) => UPSTREAM.test(c.label));
  for (const c of upstream.length ? upstream : level) c.suggested = true;
  return found;
}

/** Ticked candidates as one series; where they overlap, the later-listed candidate wins. */
export function mergeCandidates(chosen: GaugeCandidate[]): [number, number][] {
  const byDay = new Map<number, number>();
  for (const c of chosen) for (const [t, x] of c.points) byDay.set(t, x);
  return [...byDay].sort((a, b) => a[0] - b[0]);
}
