import { AlertCircle, ArrowDownUp, Eraser, Plus, TriangleAlert, Undo2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react';
import { Button, Check, Field, Notice, Select, cx } from '@/components/ui';
import { checkRows, parseClipboard, parseDateText, parseLevelText, type DateOrder, type GridRow } from '@/gauge/parseText';
import { SERIES_START } from '@/timeseries/featureSeries';

const ROW_H = 32;
const VIEW_H = 448;
const OVERSCAN = 8;
const MIN_ROWS = 30;
const COLS = ['date', 'level'] as const;
type Col = 0 | 1;
type Pos = { r: number; c: Col };
const SWOT_START = Date.parse(SERIES_START);
const day = (t: number) => new Date(t).toISOString().slice(0, 10);
const empty = (): GridRow => ({ date: '', level: '' });

/** Always some blank rows below the data, so there is room to type or paste. */
const padded = (rows: GridRow[]) => {
  let last = rows.length - 1;
  while (last >= 0 && !rows[last]!.date && !rows[last]!.level) last--;
  const keep = rows.slice(0, last + 1);
  return [...keep, ...Array.from({ length: Math.max(MIN_ROWS - keep.length, 10) }, empty)];
};

interface Props {
  reservoirName: string;
  initial: GridRow[];
  /** Readings already saved for this reservoir (offered to keep when pasting new ones). */
  existingCount: number;
  editingExisting: boolean;
  onSave: (points: [number, number][], keepExisting: boolean) => void;
  onCancel: () => void;
}

/** Spreadsheet-style entry for gauge readings: paste straight from Excel, check, save. */
export function GaugeGrid({ reservoirName, initial, existingCount, editingExisting, onSave, onCancel }: Props) {
  const [rows, setRows] = useState<GridRow[]>(() => padded(initial));
  const [order, setOrder] = useState<DateOrder>('auto');
  const [active, setActive] = useState<Pos>({ r: 0, c: 0 });
  const [anchor, setAnchor] = useState<Pos>({ r: 0, c: 0 });
  const [editing, setEditingState] = useState<string | null>(null);
  // The editor's text, readable synchronously: blur, Enter and a click elsewhere can all end an edit in one tick.
  const editRef = useRef<{ pos: Pos; text: string } | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [keepExisting, setKeepExisting] = useState(!editingExisting && existingCount > 0);
  const [wide, setWide] = useState<{ cells: string[][]; at: number; dateCol: number; levelCol: number; header: boolean } | null>(null);
  const history = useRef<GridRow[][]>([]);
  const grid = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);

  const checked = useMemo(() => checkRows(rows, order), [rows, order]);
  const points = checked.points;
  const inSwot = points.filter((p) => p[0] >= SWOT_START).length;
  const firstProblem = checked.rows.findIndex((r) => r?.issues.length);

  const commit = (next: GridRow[]) => {
    history.current = [...history.current.slice(-49), rows];
    setRows(padded(next));
  };
  const undo = () => {
    const prev = history.current.pop();
    if (prev) setRows(prev);
  };
  const focusGrid = () => grid.current?.focus({ preventScroll: true });

  const sel = {
    r0: Math.min(active.r, anchor.r),
    r1: Math.max(active.r, anchor.r),
    c0: Math.min(active.c, anchor.c) as Col,
    c1: Math.max(active.c, anchor.c) as Col,
  };
  const inSel = (r: number, c: number) => r >= sel.r0 && r <= sel.r1 && c >= sel.c0 && c <= sel.c1;

  // Keep the active cell in view.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const top = active.r * ROW_H;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (top + ROW_H > el.scrollTop + VIEW_H - ROW_H) el.scrollTop = top + 2 * ROW_H - VIEW_H;
  }, [active.r]);

  const move = (r: number, c: number, extend = false) => {
    const next = { r: Math.max(0, Math.min(rows.length - 1, r)), c: Math.max(0, Math.min(1, c)) as Col };
    setActive(next);
    if (!extend) setAnchor(next);
  };

  const setCell = (r: number, c: Col, value: string) => {
    const next = rows.map((x) => ({ ...x }));
    while (next.length <= r) next.push(empty());
    next[r]![COLS[c]] = value;
    commit(next);
  };

  const setEditing = (text: string | null, pos: Pos = active) => {
    editRef.current = text === null ? null : { pos, text };
    setEditingState(text);
  };

  const finishEdit = (save: boolean, then?: Pos) => {
    const edit = editRef.current;
    editRef.current = null;
    setEditingState(null);
    if (edit && save && edit.text !== rows[edit.pos.r]?.[COLS[edit.pos.c]]) setCell(edit.pos.r, edit.pos.c, edit.text);
    if (then) move(then.r, then.c);
    focusGrid();
  };

  const clearSelection = () => {
    const next = rows.map((x, r) => (r >= sel.r0 && r <= sel.r1 ? { date: sel.c0 === 0 ? '' : x.date, level: sel.c1 === 1 ? '' : x.level } : x));
    commit(next);
  };

  /** Write pasted cells from the active cell down and to the right. */
  const writeBlock = (cells: string[][], at: number, startCol: Col) => {
    const next = rows.map((x) => ({ ...x }));
    cells.forEach((line, i) => {
      while (next.length <= at + i) next.push(empty());
      line.slice(0, 2 - startCol).forEach((v, j) => (next[at + i]![COLS[startCol + j]!] = v));
    });
    commit(next);
    move(at + cells.length - 1, startCol);
    setAnchor({ r: at, c: startCol });
  };

  const onPaste = (e: ClipboardEvent) => {
    const text = e.clipboardData.getData('text/plain');
    if (!text) return;
    // A single value typed into the cell editor is a normal paste.
    if (editing !== null && !/[\t\n]/.test(text.trim())) return;
    e.preventDefault();
    setEditing(null);
    const cells = parseClipboard(text).filter((r) => r.some((c) => c !== ''));
    if (!cells.length) return;
    const width = Math.max(...cells.map((r) => r.length));
    const isHeader = (r: string[]) => r.every((c) => c === '' || (parseDateText(c, 'dmy') === null && parseLevelText(c) === null));
    const header = isHeader(cells[0]!);
    if (width > 2) {
      // Several columns: ask which is the date and which is the level.
      const body = header ? cells.slice(1) : cells;
      const dateCol = Math.max(0, [...Array(width).keys()].find((c) => body.slice(0, 20).filter((r) => parseDateText(r[c] ?? '', 'dmy') !== null).length > 10) ?? 0);
      // Level: a numeric column, preferring one headed like a level and never a day-of-month counter.
      const numeric = [...Array(width).keys()].filter((c) => c !== dateCol && body.slice(0, 20).every((r) => parseLevelText(r[c] ?? '') !== null));
      const named = numeric.find((c) => header && /level|stage|u\s*\/\s*s|upstream|\bwl\b|\bh\b/i.test(cells[0]![c] ?? '') && !/d\s*\/\s*s|down/i.test(cells[0]![c] ?? ''));
      const notDayCount = numeric.find((c) => !body.slice(0, 40).every((r) => /^\d{1,2}$/.test(r[c] ?? '')));
      const levelCol = named ?? notDayCount ?? numeric[0] ?? (dateCol + 1) % width;
      setWide({ cells, at: active.r, dateCol, levelCol, header });
      return;
    }
    writeBlock(header ? cells.slice(1) : cells, active.r, width === 2 ? 0 : active.c);
  };

  const onCopy = (e: ClipboardEvent) => {
    if (editing !== null) return;
    e.preventDefault();
    const lines = rows.slice(sel.r0, sel.r1 + 1).map((x) => COLS.slice(sel.c0, sel.c1 + 1).map((k) => x[k]).join('\t'));
    e.clipboardData.setData('text/plain', lines.join('\r\n'));
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (editing !== null) return; // the cell editor handles its own keys
    const { r, c } = active;
    const mod = e.ctrlKey || e.metaKey;
    const keys: Record<string, () => void> = {
      ArrowUp: () => move(mod ? 0 : r - 1, c, e.shiftKey),
      ArrowDown: () => move(mod ? checked.rows.findLastIndex((x) => x) : r + 1, c, e.shiftKey),
      ArrowLeft: () => move(r, c - 1, e.shiftKey),
      ArrowRight: () => move(r, c + 1, e.shiftKey),
      PageDown: () => move(r + Math.floor(VIEW_H / ROW_H) - 2, c, e.shiftKey),
      PageUp: () => move(r - Math.floor(VIEW_H / ROW_H) + 2, c, e.shiftKey),
      Home: () => move(mod ? 0 : r, 0, e.shiftKey),
      End: () => move(mod ? checked.rows.findLastIndex((x) => x) : r, 1, e.shiftKey),
      Tab: () => move(c === 0 ? r : r + 1, e.shiftKey ? 0 : c === 0 ? 1 : 0),
      Enter: () => move(e.shiftKey ? r - 1 : r + 1, c),
      F2: () => setEditing(rows[r]?.[COLS[c]] ?? ''),
      Delete: clearSelection,
      Backspace: clearSelection,
    };
    if (mod && e.key.toLowerCase() === 'z') return e.preventDefault(), undo();
    if (mod && e.key.toLowerCase() === 'a') return e.preventDefault(), setAnchor({ r: 0, c: 0 }), setActive({ r: Math.max(0, checked.rows.findLastIndex((x) => x)), c: 1 });
    const action = keys[e.key];
    if (action) {
      e.preventDefault();
      action();
    } else if (e.key.length === 1 && !mod && !e.altKey) {
      e.preventDefault();
      setEditing(e.key); // typing replaces the cell, as in Excel
    }
  };

  const first = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN);
  const last = Math.min(rows.length, Math.ceil((scrollTop + VIEW_H) / ROW_H) + OVERSCAN);
  const values = points.map((p) => p[1]);
  const save = () => onSave(points, keepExisting);

  return (
    <div className="space-y-4">
      <p className="text-meta text-ink-2">
        In Excel, select the date and level columns and copy (Ctrl+C). Click the first cell below and paste (Ctrl+V). You can also type, edit and delete as in
        Excel; Ctrl+Z undoes.
      </p>

      <div className="flex flex-wrap items-end gap-3">
        <Field label="Dates are written" className="w-56">
          <Select value={order} onChange={(e) => setOrder(e.target.value as DateOrder)}>
            <option value="auto">Automatic ({checked.order === 'dmy' ? 'day first' : 'month first'})</option>
            <option value="dmy">Day first: 31/01/2024</option>
            <option value="mdy">Month first: 01/31/2024</option>
          </Select>
        </Field>
        <div className="ml-auto flex gap-1">
          <Button variant="ghost" icon={Undo2} disabled={!history.current.length} onClick={undo}>
            Undo
          </Button>
          <Button
            variant="ghost"
            icon={ArrowDownUp}
            disabled={points.length < 2}
            onClick={() => commit([...rows].filter((x) => x.date || x.level).sort((a, b) => (parseDateText(a.date, checked.order) ?? Infinity) - (parseDateText(b.date, checked.order) ?? Infinity)))}
          >
            Sort by date
          </Button>
          <Button variant="ghost" icon={Eraser} onClick={() => (commit([]), move(0, 0))}>
            Clear
          </Button>
        </div>
      </div>

      {checked.orderConflict && order === 'auto' && (
        <Notice tone="warning">Some dates only make sense day-first and others month-first. Choose how the dates are written above.</Notice>
      )}

      {wide && (
        <Notice tone="info" title={`You pasted ${Math.max(...wide.cells.map((r) => r.length))} columns`}>
          <div className="mt-2 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              {(['dateCol', 'levelCol'] as const).map((k) => (
                <Field key={k} label={k === 'dateCol' ? 'Date column' : 'Level column'}>
                  <Select value={wide[k]} onChange={(e) => setWide({ ...wide, [k]: Number(e.target.value) })}>
                    {[...Array(Math.max(...wide.cells.map((r) => r.length))).keys()].map((c) => (
                      <option key={c} value={c}>
                        {wide.header && wide.cells[0]![c] ? wide.cells[0]![c] : `Column ${c + 1}`} · e.g. {wide.cells[wide.header ? 1 : 0]?.[c] || '–'}
                      </option>
                    ))}
                  </Select>
                </Field>
              ))}
            </div>
            <div className="flex gap-3">
              <Button
                variant="primary"
                disabled={wide.dateCol === wide.levelCol}
                onClick={() => {
                  const body = wide.header ? wide.cells.slice(1) : wide.cells;
                  writeBlock(
                    body.map((r) => [r[wide.dateCol] ?? '', r[wide.levelCol] ?? '']),
                    wide.at,
                    0,
                  );
                  setWide(null);
                  focusGrid();
                }}
              >
                Use these columns
              </Button>
              <Button variant="ghost" onClick={() => setWide(null)}>
                Cancel
              </Button>
            </div>
          </div>
        </Notice>
      )}

      <div
        ref={grid}
        role="grid"
        aria-label="Gauge readings"
        aria-rowcount={rows.length + 1}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        onCopy={onCopy}
        className="overflow-hidden rounded-ui border border-line bg-surface outline-none focus-visible:border-accent"
      >
        <div role="row" className="grid grid-cols-[3.5rem_1fr_1fr_2.5rem] border-b border-line bg-sunken text-eyebrow font-medium tracking-[0.08em] text-ink-3 uppercase">
          <div role="columnheader" className="px-2 py-2 text-right">
            #
          </div>
          <div role="columnheader" className="border-l border-line px-3 py-2">
            Date
          </div>
          <div role="columnheader" className="border-l border-line px-3 py-2">
            Level (m)
          </div>
          <div role="columnheader" className="border-l border-line py-2" aria-label="Check" />
        </div>
        <div ref={scroller} onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)} className="relative overflow-y-auto" style={{ height: VIEW_H }}>
          <div style={{ height: rows.length * ROW_H }}>
            {rows.slice(first, last).map((row, k) => {
              const r = first + k;
              const info = checked.rows[r];
              const issue = info?.issues[0];
              return (
                <div
                  key={r}
                  role="row"
                  aria-rowindex={r + 2}
                  className="absolute inset-x-0 grid grid-cols-[3.5rem_1fr_1fr_2.5rem] border-b border-line/60"
                  style={{ top: r * ROW_H, height: ROW_H }}
                >
                  <div className={cx('tabular px-2 text-right text-meta leading-8', active.r === r ? 'text-ink' : 'text-ink-3')}>{r + 1}</div>
                  {COLS.map((key, c) => {
                    const isActive = active.r === r && active.c === c;
                    const bad = info?.issues.some((x) => x.kind === 'error' && (c === 0 ? /date/i.test(x.text) : /level/i.test(x.text)));
                    return (
                      <div
                        key={key}
                        role="gridcell"
                        aria-selected={inSel(r, c)}
                        onMouseDown={(e) => {
                          if (editRef.current) finishEdit(true);
                          e.preventDefault();
                          move(r, c, e.shiftKey);
                          focusGrid();
                        }}
                        onDoubleClick={() => setEditing(row[key], { r, c: c as Col })}
                        className={cx(
                          'tabular relative cursor-cell truncate border-l border-line/60 px-3 text-meta leading-8',
                          inSel(r, c) && 'bg-accent-soft',
                          bad ? 'text-error' : 'text-ink',
                          isActive && 'outline-2 -outline-offset-2 outline-accent',
                        )}
                      >
                        {isActive && editing !== null ? (
                          <input
                            autoFocus
                            aria-label={`${key === 'date' ? 'Date' : 'Level'}, row ${r + 1}`}
                            value={editing}
                            onChange={(e) => setEditing(e.target.value, { r, c: c as Col })}
                            onFocus={(e) => e.currentTarget.setSelectionRange(e.currentTarget.value.length, e.currentTarget.value.length)}
                            onBlur={() => editRef.current && finishEdit(true)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') e.preventDefault(), finishEdit(true, { r: r + 1, c: c as Col });
                              else if (e.key === 'Tab') e.preventDefault(), finishEdit(true, c === 0 ? { r, c: 1 } : { r: r + 1, c: 0 });
                              else if (e.key === 'Escape') e.preventDefault(), finishEdit(false);
                              else if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && !e.shiftKey)
                                e.preventDefault(), finishEdit(true, { r: r + (e.key === 'ArrowUp' ? -1 : 1), c: c as Col });
                            }}
                            className="absolute inset-0 w-full bg-surface px-3 text-meta text-ink outline-2 -outline-offset-2 outline-accent"
                          />
                        ) : (
                          row[key]
                        )}
                      </div>
                    );
                  })}
                  <div className="flex items-center justify-center border-l border-line/60" title={info?.issues.map((x) => x.text).join('\n')}>
                    {issue?.kind === 'error' && <AlertCircle aria-label={issue.text} size={14} strokeWidth={1.75} className="text-error" />}
                    {issue?.kind === 'warning' && <TriangleAlert aria-label={issue.text} size={14} strokeWidth={1.75} className="text-caution" />}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 text-meta">
        <p className="tabular text-ink-2" role="status">
          {points.length ? (
            <>
              <span className="text-ink">{points.length.toLocaleString()} readings ready</span> · {day(points[0]![0])} → {day(points.at(-1)![0])} ·{' '}
              {Math.min(...values).toFixed(2)}–{Math.max(...values).toFixed(2)} m · {inSwot.toLocaleString()} in the SWOT period (from July 2023)
            </>
          ) : (
            'No readings yet.'
          )}
        </p>
        <Button variant="ghost" icon={Plus} onClick={() => setRows((x) => [...x, ...Array.from({ length: 50 }, empty)])}>
          50 more rows
        </Button>
      </div>

      {(checked.errors > 0 || checked.warnings > 0) && (
        <Notice tone={checked.errors ? 'error' : 'warning'}>
          {checked.errors > 0 && `${checked.errors} problem${checked.errors > 1 ? 's' : ''} to fix (red); those rows are left out. `}
          {checked.warnings > 0 && `${checked.warnings} reading${checked.warnings > 1 ? 's look' : ' looks'} suspicious (amber) but will be saved. `}
          <button
            type="button"
            className="underline underline-offset-2"
            onClick={() => {
              move(firstProblem, checked.rows[firstProblem]?.issues.some((x) => /level/i.test(x.text)) ? 1 : 0);
              focusGrid();
            }}
          >
            Go to row {firstProblem + 1}
          </button>{' '}
          · {checked.rows[firstProblem]?.issues[0]?.text}
        </Notice>
      )}

      {!editingExisting && existingCount > 0 && (
        <Check
          label={`Keep the ${existingCount.toLocaleString()} readings already saved and add these (these win on the same date)`}
          checked={keepExisting}
          onChange={(e) => setKeepExisting(e.target.checked)}
        />
      )}

      <div className="flex gap-3">
        <Button variant="primary" disabled={!points.length} onClick={save}>
          Save {points.length ? points.length.toLocaleString() : ''} readings for {reservoirName}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
