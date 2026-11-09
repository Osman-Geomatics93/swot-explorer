/**
 * RFC 4180 CSV that opens correctly in Excel, LibreOffice, pandas and R:
 * header on the first line, CRLF line endings, UTF-8 with BOM (so Excel reads non-ASCII
 * names correctly), empty cells for missing values, quotes only where needed.
 */
const BOM = '﻿';

function cell(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  const s = Array.isArray(v) ? v.join(';') : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(columns: string[], rows: Record<string, unknown>[]): string {
  return BOM + [columns.map(cell).join(','), ...rows.map((r) => columns.map((c) => cell(r[c])).join(','))].join('\r\n') + '\r\n';
}

/** Union of keys across rows, in first-seen order (rows from different granules may differ). */
export function columnsOf(rows: Record<string, unknown>[]): string[] {
  const seen = new Set<string>();
  for (const r of rows) for (const k of Object.keys(r)) seen.add(k);
  return [...seen];
}
