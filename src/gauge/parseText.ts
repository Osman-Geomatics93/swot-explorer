/**
 * Dates and levels typed or pasted as text (e.g. copied from Excel, which copies what the
 * cell shows). Pure functions, unit-tested.
 */

export type DateOrder = 'auto' | 'dmy' | 'mdy';

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const month = (s: string) => MONTHS.indexOf(s.slice(0, 3).toLowerCase());
const year = (s: string) => (s.length <= 2 ? 2000 + Number(s) - (Number(s) > 69 ? 100 : 0) : Number(s));

function utc(y: number, m: number, d: number, hh = 0, mm = 0, ss = 0): number | null {
  if (m < 0 || m > 11 || d < 1 || d > 31 || y < 1800 || y > 2200) return null;
  const t = Date.UTC(y, m, d, hh, mm, ss);
  return new Date(t).getUTCDate() === d ? t : null; // rejects 31/02
}

const ISO = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?)?Z?$/;
const NUMERIC = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})(?: (\d{1,2}):(\d{2})(?::(\d{2}))?)?$/;
const DAY_MON = /^(\d{1,2})[\s-]([a-z]{3,9})\.?[\s-,]+(\d{2}|\d{4})$/i;
const MON_DAY = /^([a-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})$/i;

/** Which way round "03/04/2024" is, decided from all the numeric dates in a column. */
export function detectOrder(texts: string[]): { order: 'dmy' | 'mdy'; certain: boolean; conflict: boolean } {
  let dmy = false;
  let mdy = false;
  for (const s of texts) {
    const m = NUMERIC.exec(s.trim());
    if (!m) continue;
    if (Number(m[1]) > 12) dmy = true;
    if (Number(m[2]) > 12) mdy = true;
  }
  return { order: mdy && !dmy ? 'mdy' : 'dmy', certain: dmy !== mdy, conflict: dmy && mdy };
}

/** A date as UTC ms (midnight for date-only text), or null. Excel serial numbers are accepted. */
export function parseDateText(raw: string, order: 'dmy' | 'mdy'): number | null {
  const s = raw.trim();
  if (!s) return null;
  let m = ISO.exec(s);
  if (m) return utc(+m[1]!, +m[2]! - 1, +m[3]!, +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0));
  m = NUMERIC.exec(s);
  if (m) {
    const [a, b] = [+m[1]!, +m[2]!];
    const [d, mo] = order === 'dmy' ? [a, b] : [b, a];
    return utc(year(m[3]!), mo - 1, d, +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0));
  }
  m = DAY_MON.exec(s);
  if (m && month(m[2]!) >= 0) return utc(year(m[3]!), month(m[2]!), +m[1]!);
  m = MON_DAY.exec(s);
  if (m && month(m[1]!) >= 0) return utc(+m[3]!, month(m[1]!), +m[2]!);
  // Excel serial day (a date cell copied with a number format): 1955 … 2119.
  if (/^\d{5}(\.\d+)?$/.test(s)) {
    const n = Number(s);
    if (n >= 20000 && n <= 80000) return Math.round((n - 25569) * 86_400_000);
  }
  return null;
}

/** A level in metres: "487.5", "487,5", " 487.50 m", "1 234.5". */
export function parseLevelText(raw: string): number | null {
  const s = raw.trim().replace(/\s*m$/i, '').replace(/[\s ]/g, '');
  if (!s) return null;
  const normal = /^-?\d+,\d+$/.test(s) ? s.replace(',', '.') : s.replace(/,(?=\d{3}\b)/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(normal)) return null;
  return Number(normal);
}

/** Excel copies cells as tab-separated lines; quoted cells may hold tabs or line breaks. */
export function parseClipboard(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') (cell += '"'), i++;
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === '\t') row.push(cell), (cell = '');
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      (row = []), (cell = '');
    } else cell += ch;
  }
  if (cell !== '' || row.length) row.push(cell), rows.push(row);
  return rows.map((r) => r.map((c) => c.trim()));
}

export interface GridRow {
  date: string;
  level: string;
}

export type RowIssue = { kind: 'error' | 'warning'; text: string };

export interface CheckedRows {
  order: 'dmy' | 'mdy';
  orderCertain: boolean;
  orderConflict: boolean;
  /** Per row index: null for empty rows, else the parsed values and any issues. */
  rows: ({ t: number | null; level: number | null; issues: RowIssue[] } | null)[];
  /** Valid readings, sorted, one per date. */
  points: [number, number][];
  errors: number;
  warnings: number;
}

/** Large day-to-day jumps are usually typing errors (a dam level rarely moves metres a day). */
const JUMP_M_PER_DAY = 2;

export function checkRows(rows: GridRow[], order: DateOrder): CheckedRows {
  const detected = detectOrder(rows.map((r) => r.date));
  const use = order === 'auto' ? detected.order : order;
  const seen = new Map<number, number>();
  const out: CheckedRows['rows'] = rows.map((r, i) => {
    if (!r.date.trim() && !r.level.trim()) return null;
    const issues: RowIssue[] = [];
    const t = parseDateText(r.date, use);
    const level = parseLevelText(r.level);
    if (!r.date.trim()) issues.push({ kind: 'error', text: 'Missing date' });
    else if (t === null) issues.push({ kind: 'error', text: `Date not recognised: “${r.date.trim()}”` });
    if (!r.level.trim()) issues.push({ kind: 'error', text: 'Missing level' });
    else if (level === null) issues.push({ kind: 'error', text: `Level is not a number: “${r.level.trim()}”` });
    if (t !== null) {
      const first = seen.get(t);
      if (first !== undefined) issues.push({ kind: 'error', text: `Same date as row ${first + 1}` });
      else seen.set(t, i);
    }
    return { t, level, issues };
  });

  const valid = out
    .map((r, i) => ({ r, i }))
    .filter((x): x is { r: NonNullable<typeof x.r>; i: number } => !!x.r && x.r.t !== null && x.r.level !== null && !x.r.issues.length)
    .sort((a, b) => a.r.t! - b.r.t!);
  for (let k = 1; k < valid.length; k++) {
    const [a, b] = [valid[k - 1]!, valid[k]!];
    const days = Math.max(1, (b.r.t! - a.r.t!) / 86_400_000);
    const jump = Math.abs(b.r.level! - a.r.level!);
    if (jump / days > JUMP_M_PER_DAY) b.r.issues.push({ kind: 'warning', text: `Jumps ${jump.toFixed(2)} m from the reading before; check for a typing error` });
  }
  const all = out.flatMap((r) => r?.issues ?? []);
  return {
    order: use,
    orderCertain: detected.certain,
    orderConflict: detected.conflict,
    rows: out,
    points: valid.map((x) => [x.r.t!, x.r.level!]),
    errors: all.filter((x) => x.kind === 'error').length,
    warnings: all.filter((x) => x.kind === 'warning').length,
  };
}
