/**
 * Save a table as clean CSV plus companions, all through chrome.downloads:
 *   <name>.csv          data only: header on line 1, ready for Excel / pandas / R / QGIS
 *   <name>_README.txt   where the data came from and how it was filtered
 *   <name>_columns.csv  column dictionary: description, units, source (when known)
 */
import { columnsOf, toCsv } from './csv';

export interface TableExport {
  /** Path below Downloads, without extension, e.g. SWOT/clipped/gerd_lake-prior_2025-01-01_2025-03-31 */
  path: string;
  rows: Record<string, unknown>[];
  columns?: string[];
  meta: Record<string, string>;
  dictionary?: { column: string; description: string; units: string; source: string }[];
}

async function save(filename: string, text: string, type: string): Promise<void> {
  const url = URL.createObjectURL(new Blob([text], { type }));
  try {
    await browser.downloads.download({ url, filename, conflictAction: 'uniquify' });
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}

export function readme(meta: Record<string, string>, columns: string[], rows: number): string {
  const width = Math.max(...Object.keys(meta).map((k) => k.length));
  return [
    'SWOT Explorer export',
    '====================',
    '',
    ...Object.entries(meta).map(([k, v]) => `${k.padEnd(width)}  ${v}`),
    '',
    `rows      ${rows}`,
    `columns   ${columns.length}`,
    '',
    'Notes',
    '- Empty cells are SWOT fill values (no observation), not zero.',
    '- One row per feature per satellite pass (long format). Use time_str and the ID column to build time series.',
    '- Times are UTC. Heights are relative to the geoid given in the SWOT product.',
    '- Column descriptions and units: see the _columns.csv file next to this one.',
    '',
  ].join('\r\n');
}

export async function downloadTable(t: TableExport): Promise<void> {
  const columns = t.columns ?? columnsOf(t.rows);
  await save(`${t.path}.csv`, toCsv(columns, t.rows), 'text/csv');
  await save(`${t.path}_README.txt`, readme(t.meta, columns, t.rows.length), 'text/plain');
  if (t.dictionary) {
    const cols = ['column', 'description', 'units', 'source'];
    await save(`${t.path}_columns.csv`, toCsv(cols, t.dictionary), 'text/csv');
  }
}
