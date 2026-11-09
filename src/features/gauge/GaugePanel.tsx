import { LineChart, ScatterChart } from 'echarts/charts';
import { DataZoomComponent, GridComponent, LegendComponent, MarkLineComponent, TooltipComponent } from 'echarts/components';
import * as echarts from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { useLiveQuery } from 'dexie-react-hooks';
import { ClipboardPaste, Download, FileDown, FileSpreadsheet, Table2, Trash2, Upload } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ChartFigure } from '@/components/ChartFigure';
import { Button, Card, Check, Empty, Field, IconButton, Notice, Progress, Section, Select, cx } from '@/components/ui';
import { GaugeGrid } from '@/features/gauge/GaugeGrid';
import type { Reservoir } from '@/features/robust/RobustPanel';
import type { GridRow } from '@/gauge/parseText';
import { levelsInArea, type AreaLevels } from '@/gauge/areaLevels';
import { findCandidates, mergeCandidates, readTableFile, type GaugeCandidate } from '@/gauge/table';
import { defaultMaxGapDays, gaugePoints, validateAgainstGauge } from '@/gauge/validate';
import { citationMeta } from '@/lib/citation';
import { downloadTable } from '@/lib/exportCsv';
import { FONT_BODY, token } from '@/lib/tokens';
import { describeRule } from '@/qc/qualityControl';
import { fetchLakePieces, type FetchProgress } from '@/robust/fetchPieces';
import { lakePasses } from '@/robust/lakePasses';
import { areaKm2, clipPolygon, useStudyAreas } from '@/state/studyArea';
import { useThemeKey } from '@/state/theme';
import { toast } from '@/state/toast';
import { addHistory, db } from '@/storage/db';
import { median, type LevelPoint } from '@/timeseries/analysis';
import { fetchFeatureSeries, SERIES_START } from '@/timeseries/featureSeries';

echarts.use([LineChart, ScatterChart, GridComponent, TooltipComponent, LegendComponent, DataZoomComponent, MarkLineComponent, CanvasRenderer]);

/** Local time of dam readings: a date-only reading is taken as local midday. */
const UTC_OFFSET: Record<string, number> = { Sudan: 2, Egypt: 2, 'South Sudan': 2, Ethiopia: 3, Uganda: 3, Kenya: 3, Tanzania: 3 };
const SWOT_START = Date.parse(SERIES_START);
const day = (t: number | string) => new Date(t).toISOString().slice(0, 10);
const m = (v: number | null, digits = 2, signed = false) => (v === null ? '–' : `${signed && v > 0 ? '+' : ''}${v.toFixed(digits)} m`);
const pct = (v: number | null) => (v === null ? '–' : `${Math.round(v * 100)} %`);
const cadence = (stepDays: number) => (stepDays <= 1.01 ? 'daily' : `every ${Math.round(stepDays)} days`);

type Swot = { points: LevelPoint[] } | { error: string } | null;
/** Where the SWOT levels come from: inside a drawn study area (LakeSP_Obs), or the whole PLD lake (Hydrocron). */
type Source = 'area' | 'lake';
type AreaRun = { areaId: string; result: AreaLevels } | null;

export function GaugePanel({ reservoir }: { reservoir: Reservoir }) {
  // undefined while loading, null when this reservoir has no gauge yet.
  const record = useLiveQuery(() => db.gauges.get(reservoir.id).then((r) => r ?? null), [reservoir.id]);
  const [pending, setPending] = useState<{ fileName: string; candidates: GaugeCandidate[]; chosen: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The spreadsheet-style editor: empty for pasting, or filled with the saved readings for editing.
  const [grid, setGrid] = useState<{ initial: GridRow[]; editingExisting: boolean } | null>(null);
  const [swot, setSwot] = useState<Swot>(null);
  const [excludeOutliers, setExcludeOutliers] = useState(false);
  const [shift, setShift] = useState(true);
  const { areas, activeId } = useStudyAreas();
  const [source, setSource] = useState<Source>('area');
  const [areaId, setAreaId] = useState<string | null>(null);
  const zoneArea = areas.find((a) => a.id === (areaId ?? activeId)) ?? areas.find((a) => clipPolygon(a)) ?? null;
  const zone = useMemo(() => (zoneArea ? clipPolygon(zoneArea) : null), [zoneArea]);
  const [areaRun, setAreaRun] = useState<AreaRun>(null);
  const [areaProgress, setAreaProgress] = useState<FetchProgress | null>(null);
  const [areaError, setAreaError] = useState<string | null>(null);
  const areaAbort = useRef<AbortController | null>(null);
  useEffect(() => () => areaAbort.current?.abort(), []);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!record) return;
    const ctl = new AbortController();
    setSwot(null);
    fetchFeatureSeries('lakes', reservoir.lake_id, ctl.signal)
      .then((s) => setSwot({ points: s.points.filter((p) => p.qcPass && p.wse !== null).map((p) => ({ time: p.time, wse: p.wse! })) }))
      .catch((err) => !ctl.signal.aborted && setSwot({ error: err instanceof Error ? err.message : 'SWOT request failed' }));
    return () => ctl.abort();
  }, [record?.importedAt, reservoir.lake_id]);

  const gauge = useMemo(() => (record ? gaugePoints(record.points, UTC_OFFSET[reservoir.country] ?? 2) : []), [record, reservoir.country]);
  const maxGapDays = useMemo(() => defaultMaxGapDays(gauge), [gauge]);
  const areaResult = areaRun && zoneArea && areaRun.areaId === zoneArea.id ? areaRun.result : null;
  const swotPoints = useMemo(
    () =>
      source === 'area'
        ? (areaResult?.levels.map((l) => ({ time: l.time, wse: l.wse })) ?? null)
        : swot && 'points' in swot
          ? swot.points
          : null,
    [source, areaResult, swot],
  );
  const result = useMemo(
    () => (swotPoints && gauge.length ? validateAgainstGauge(swotPoints, gauge, { maxGapDays, excludeOutliers }) : null),
    [swotPoints, gauge, maxGapDays, excludeOutliers],
  );

  /** Download (or read from cache) the lake's observation polygons and keep the parts inside the study area. */
  const loadArea = async () => {
    if (!zone || !zoneArea) return;
    areaAbort.current?.abort();
    const ctl = (areaAbort.current = new AbortController());
    setAreaError(null);
    setAreaProgress({ total: 0, done: 0, cached: 0, failed: 0 });
    try {
      const passes = await lakePasses(reservoir.lake_id, reservoir.afr_passes, ctl.signal);
      const pieces = await fetchLakePieces(reservoir.lake_id, passes, setAreaProgress, ctl.signal);
      setAreaRun({ areaId: zoneArea.id, result: levelsInArea(pieces, zone) });
    } catch (err) {
      if (!ctl.signal.aborted) setAreaError(err instanceof Error ? err.message : 'Could not load the SWOT observations.');
    } finally {
      if (areaAbort.current === ctl) setAreaProgress(null);
    }
  };
  const swotSource =
    source === 'area' && zoneArea
      ? `SWOT LakeSP_Obs observations of PLD lake ${reservoir.lake_id} inside study area "${zoneArea.name}" (${areaKm2(zoneArea).toFixed(1)} km2): per pass, area-weighted median height of the observations passing QC, weighted by their surface inside the area`
      : `SWOT LakeSP prior-lake series of PLD lake ${reservoir.lake_id} from Hydrocron (whole lake)`;
  const s = result?.stats;
  const figureCaption = `${source === 'area' && zoneArea ? `SWOT LakeSP_obs Version D inside "${zoneArea.name}"` : 'SWOT LakeSP Version D (whole lake) via Hydrocron'} · gauge: ${record?.label ?? ''} · ${describeRule('lake')}`;

  const removeGauge = async () => {
    if (!record) return;
    const removed = record;
    await db.gauges.delete(reservoir.id);
    toast(`Gauge levels of ${reservoir.name} removed`, { tone: 'info', action: { label: 'Undo', run: () => db.gauges.put(removed) } });
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    try {
      const candidates = findCandidates(readTableFile(file.name, new Uint8Array(await file.arrayBuffer())));
      if (!candidates.length) throw new Error('No column of dates next to a column of numbers was found. The file needs one date column and one level column.');
      setGrid(null);
      setPending({ fileName: file.name, candidates, chosen: candidates.filter((c) => c.suggested).map((c) => c.id) });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read this file.');
    } finally {
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const saveGrid = async (points: [number, number][], keepExisting: boolean) => {
    const merged = new Map(keepExisting && record ? record.points : []);
    for (const [t, v] of points) merged.set(t, v);
    await db.gauges.put({
      reservoirId: reservoir.id,
      label: grid?.editingExisting && record ? record.label : 'Level entered in the table',
      fileName: grid?.editingExisting && record ? record.fileName : 'Pasted from Excel',
      importedAt: Date.now(),
      points: [...merged].sort((a, b) => a[0] - b[0]),
    });
    toast(`Saved ${merged.size.toLocaleString()} gauge readings for ${reservoir.name}`);
    setGrid(null);
  };

  const openGrid = (editingExisting: boolean) => {
    setError(null);
    setPending(null);
    setGrid({
      editingExisting,
      initial:
        editingExisting && record
          ? record.points.map(([t, v]) => ({ date: t % 86_400_000 === 0 ? day(t) : new Date(t).toISOString().slice(0, 16).replace('T', ' '), level: String(v) }))
          : [],
    });
  };

  const save = async () => {
    if (!pending) return;
    const chosen = pending.candidates.filter((c) => pending.chosen.includes(c.id));
    const labels = [...new Set(chosen.map((c) => c.label))].join(' + ');
    await db.gauges.put({
      reservoirId: reservoir.id,
      label: `${labels} (${chosen.map((c) => `${c.sheet} ${c.columns}`).join(', ')})`,
      fileName: pending.fileName,
      importedAt: Date.now(),
      points: mergeCandidates(chosen),
    });
    toast(`Imported ${labels} for ${reservoir.name}`);
    setPending(null);
  };

  const exportCsv = async () => {
    if (!result || !s || !record) return;
    const bias = s.bias ?? 0;
    await downloadTable({
      path: `SWOT/validation/${reservoir.id}_gauge_validation_${day(Date.now())}`,
      rows: result.pairs.map((p) => ({
        time_utc: p.time,
        swot_wse_m: +p.swot.toFixed(3),
        gauge_level_m: +p.gauge.toFixed(3),
        swot_minus_gauge_m: +p.diff.toFixed(3),
        diff_minus_bias_m: +(p.diff - bias).toFixed(3),
        gauge_gap_days: +p.gapDays.toFixed(2),
        outlier: p.outlier,
        used_in_stats: !(excludeOutliers && p.outlier),
      })),
      meta: {
        reservoir: `${reservoir.name} (PLD lake ${reservoir.lake_id})`,
        gauge: `${record.label}, file ${record.fileName}`,
        matching: `gauge interpolated linearly to each SWOT pass; no pair where gauge readings are more than ${maxGapDays.toFixed(1)} days apart; date-only readings taken at local midday (UTC+${UTC_OFFSET[reservoir.country] ?? 2})`,
        swot_source: swotSource,
        swot_qc: describeRule('lake'),
        outliers: `${result.outliers} beyond robust 3 sigma; ${excludeOutliers ? 'excluded from' : 'included in'} the statistics`,
        statistics: `n ${s.n}; bias (median SWOT - gauge) ${m(s.bias, 3)}; mean bias ${m(s.meanBias, 3)}; RMSE ${m(s.rmse, 3)}; RMSE bias removed ${m(s.rmseUnbiased, 3)}; MAE bias removed ${m(s.maeUnbiased, 3)}; r ${s.r?.toFixed(4) ?? '-'}; within 10 cm ${pct(s.within10)}; within 25 cm ${pct(s.within25)}`,
        datum: 'SWOT heights are relative to the EGM2008 geoid; gauge levels use the dam datum, so a constant bias is expected',
        ...(await citationMeta([source === 'area' ? 'SWOT_L2_HR_LakeSP_obs_D' : 'SWOT_L2_HR_LakeSP_D'])),
      },
    });
    await addHistory({
      kind: 'validation',
      title: `Gauge validation · ${reservoir.name}`,
      detail: `${source === 'area' && zoneArea ? `inside ${zoneArea.name} · ` : ''}${s.n} passes · bias ${m(s.bias)} · RMSE without bias ${m(s.rmseUnbiased)}`,
    });
  };

  const themeKey = useThemeKey();
  const charts = useMemo(() => {
    if (!result || !s?.n || s.bias === null) return null;
    const bias = s.bias;
    const text = { fontFamily: FONT_BODY, color: token('ink-2'), fontSize: 12 };
    const line = token('line');
    const [c1, c2] = [token('series-1'), token('series-2')];
    const tooltip = { backgroundColor: token('surface'), borderColor: token('line-strong'), textStyle: { ...text, color: token('ink') } };
    const used = result.pairs.filter((p) => !(excludeOutliers && p.outlier));
    const flagged = result.pairs.filter((p) => p.outlier);
    const swotY = (p: (typeof result.pairs)[number]) => +(p.swot - (shift ? bias : 0)).toFixed(3);
    const t0 = Date.parse(s.start!) - 20 * 86_400_000;
    const t1 = Date.parse(s.end!) + 20 * 86_400_000;
    const swotName = shift ? `SWOT − bias (${m(bias, 2, true)})` : 'SWOT';
    const axisY = { type: 'value', scale: true, axisLabel: { ...text, formatter: (v: number) => `${v} m` }, splitLine: { lineStyle: { color: line } } };
    const axisT = { type: 'time', min: t0, max: t1, axisLine: { lineStyle: { color: line } }, axisLabel: text, splitLine: { show: false } };

    const series = {
      animation: false,
      textStyle: text,
      grid: { left: 56, right: 16, top: 40, bottom: 52 },
      tooltip: { ...tooltip, trigger: 'axis', valueFormatter: (v: number) => `${v.toFixed(2)} m` },
      legend: { top: 0, left: 0, icon: 'roundRect', itemWidth: 12, itemHeight: 4, textStyle: text },
      xAxis: axisT,
      yAxis: axisY,
      dataZoom: [{ type: 'inside' }, { type: 'slider', height: 18, bottom: 4, borderColor: line, textStyle: text }],
      series: [
        {
          name: 'Gauge',
          type: 'line',
          showSymbol: false,
          lineStyle: { width: 2, color: c2 },
          itemStyle: { color: c2 },
          data: gauge.filter((g) => g.t >= Math.max(t0, SWOT_START - 20 * 86_400_000) && g.t <= t1).map((g) => [g.t, g.level]),
        },
        {
          name: swotName,
          type: 'scatter',
          symbolSize: 8,
          itemStyle: { color: c1, borderColor: token('surface'), borderWidth: 2 },
          data: used.filter((p) => !p.outlier).map((p) => [p.time, swotY(p)]),
        },
        ...(flagged.length
          ? [
              {
                name: excludeOutliers ? 'Outliers (excluded)' : 'Outliers',
                type: 'scatter',
                symbolSize: 8,
                itemStyle: { color: 'transparent', borderColor: c1, borderWidth: 1.5 },
                data: flagged.map((p) => [p.time, swotY(p)]),
              },
            ]
          : []),
      ],
    };

    const residuals = {
      animation: false,
      textStyle: text,
      grid: { left: 56, right: 16, top: 16, bottom: 28 },
      tooltip: { ...tooltip, trigger: 'item', formatter: (p: { value: [string, number] }) => `${day(p.value[0])}<br/>${m(p.value[1], 2, true)}` },
      xAxis: axisT,
      yAxis: { ...axisY, scale: false },
      series: [
        {
          name: 'SWOT − gauge − bias',
          type: 'scatter',
          symbolSize: 7,
          itemStyle: { color: c1 },
          data: result.pairs.map((p) => ({
            value: [p.time, +(p.diff - bias).toFixed(3)],
            itemStyle: p.outlier ? { color: 'transparent', borderColor: c1, borderWidth: 1.5 } : undefined,
          })),
          markLine: {
            silent: true,
            symbol: 'none',
            label: { ...text, fontSize: 11, position: 'insideEndTop', formatter: (p: { value: number }) => (p.value > 0 ? '±10 cm' : '') },
            lineStyle: { color: token('line-strong'), type: 'dashed', width: 1 },
            data: [{ yAxis: 0.1 }, { yAxis: -0.1 }, { yAxis: 0, lineStyle: { type: 'solid', color: token('ink-3') }, label: { show: false } }],
          },
        },
      ],
    };

    const lo = Math.min(...used.map((p) => Math.min(p.gauge, p.swot - bias)));
    const hi = Math.max(...used.map((p) => Math.max(p.gauge, p.swot - bias)));
    // Whole-metre limits, identical on both axes, so the 1:1 line runs corner to corner.
    const [min, max] = [Math.floor(lo - 0.1), Math.ceil(hi + 0.1)];
    const scatter = {
      animation: false,
      textStyle: text,
      grid: { left: 56, right: 32, top: 16, bottom: 44 },
      tooltip: { ...tooltip, trigger: 'item', formatter: (p: { value: [number, number] }) => `Gauge ${m(p.value[0])}<br/>SWOT − bias ${m(p.value[1])}` },
      xAxis: { ...axisY, min, max, name: 'Gauge level', nameLocation: 'middle', nameGap: 28, nameTextStyle: text },
      yAxis: { ...axisY, min, max },
      series: [
        {
          name: '1:1',
          type: 'line',
          silent: true,
          showSymbol: false,
          lineStyle: { color: token('ink-3'), type: 'dashed', width: 1 },
          endLabel: { show: true, formatter: '1:1', ...text, fontSize: 11 },
          data: [
            [min, min],
            [max, max],
          ],
        },
        {
          type: 'scatter',
          symbolSize: 7,
          itemStyle: { color: c1, opacity: 0.85 },
          data: used.map((p) => [+p.gauge.toFixed(3), +(p.swot - bias).toFixed(3)]),
        },
      ],
    };
    return { series, residuals, scatter };
  }, [result, s, gauge, shift, excludeOutliers, themeKey]);

  const stat = (label: string, value: string, sub?: string, cls?: string) => (
    <div key={label}>
      <dt className="text-eyebrow font-medium tracking-[0.08em] text-ink-3 uppercase">{label}</dt>
      <dd className={cx('text-body', cls ?? 'text-ink')}>{value}</dd>
      {sub && <dd className="text-meta text-ink-3">{sub}</dd>}
    </div>
  );

  const fileInputEl = (
    <input ref={fileInput} type="file" accept=".xlsx,.csv,.txt,.tsv" className="hidden" onChange={(e) => void onFile(e.target.files?.[0])} />
  );

  // @container: the statistics use four columns only when the panel is wide enough.
  return (
    <Section
      className="@container"
      eyebrow={`PLD ${reservoir.lake_id}`}
      title={`Gauge validation · ${reservoir.name}`}
    >
      {fileInputEl}
      <p className="text-meta text-ink-2">
        Compare SWOT water levels with your own gauge readings. Paste them from Excel into a table, or import an Excel or CSV file. They stay in this browser
        only.
      </p>
      {error && <Notice tone="error">{error}</Notice>}

      {grid && (
        <GaugeGrid
          reservoirName={reservoir.name}
          initial={grid.initial}
          existingCount={record?.points.length ?? 0}
          editingExisting={grid.editingExisting}
          onSave={(points, keep) => void saveGrid(points, keep)}
          onCancel={() => setGrid(null)}
        />
      )}

      {pending && (
        <div className="space-y-4">
          <p className="text-meta text-ink-2">
            Found in <span className="text-ink">{pending.fileName}</span>. Tick the columns that make up the reservoir level; where they overlap, the lower one in the
            list wins.
          </p>
          <Card className="divide-y divide-line">
            {pending.candidates.map((c) => {
              const [first, last] = [c.points[0]![0], c.points.at(-1)![0]];
              const values = c.points.map((p) => p[1]);
              return (
                <div key={c.id} className="px-4 py-3">
                  <Check
                    checked={pending.chosen.includes(c.id)}
                    onChange={(e) =>
                      setPending({ ...pending, chosen: e.target.checked ? [...pending.chosen, c.id] : pending.chosen.filter((x) => x !== c.id) })
                    }
                    label={
                      <span className="block">
                        <span className="text-body text-ink">{c.label}</span>
                        <span className="block text-meta text-ink-3">
                          {c.sheet} · {c.columns}
                          {c.context && ` · ${c.context}`}
                        </span>
                        <span className="tabular block text-meta text-ink-2">
                          {day(first)} → {day(last)} · {c.points.length.toLocaleString()} {cadence(c.stepDays)} · {Math.min(...values).toFixed(2)}–
                          {Math.max(...values).toFixed(2)}
                          {last >= SWOT_START ? <span className="text-ok"> · overlaps SWOT</span> : <span className="text-ink-3"> · before SWOT</span>}
                        </span>
                      </span>
                    }
                  />
                </div>
              );
            })}
          </Card>
          <div className="flex gap-3">
            <Button variant="primary" disabled={!pending.chosen.length} onClick={() => void save()}>
              Save for {reservoir.name}
            </Button>
            <Button variant="ghost" onClick={() => setPending(null)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {!pending && !grid && record === null && (
        <>
          <Empty icon={FileSpreadsheet}>No gauge levels for {reservoir.name} yet. Add them to see bias, RMSE and agreement with every SWOT pass.</Empty>
          <div className="flex flex-wrap gap-3">
            <Button variant="primary" icon={ClipboardPaste} onClick={() => openGrid(false)}>
              Paste from Excel
            </Button>
            <Button icon={Upload} onClick={() => fileInput.current?.click()}>
              Import file
            </Button>
          </div>
        </>
      )}

      {!pending && !grid && record && (
        <>
          <div className="flex items-start justify-between gap-3 border-y border-line py-3">
            <div className="min-w-0 text-meta">
              <p className="text-ink">{record.label}</p>
              <p className="tabular text-ink-3">
                {record.fileName} · {day(record.points[0]![0])} → {day(record.points.at(-1)![0])} · {record.points.length.toLocaleString()} readings
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <IconButton icon={Table2} label="Edit in table" onClick={() => openGrid(true)} />
              <IconButton icon={ClipboardPaste} label="Paste more readings from Excel" onClick={() => openGrid(false)} />
              <IconButton icon={Upload} label="Import a file instead" onClick={() => fileInput.current?.click()} />
              <IconButton icon={Trash2} tone="danger" label="Remove gauge levels" onClick={() => void removeGauge()} />
            </div>
          </div>

          <div className="space-y-3">
            <div role="radiogroup" aria-label="SWOT data" className="flex gap-1 rounded-ui bg-sunken p-1">
              {(
                [
                  ['area', 'Inside my study area'],
                  ['lake', 'Whole lake'],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={source === id}
                  onClick={() => setSource(id)}
                  className={cx(
                    'h-8 flex-1 rounded-ui px-3 text-meta font-medium transition-[background-color,color] duration-200 ease-signature',
                    source === id ? 'bg-surface text-ink shadow-float' : 'text-ink-2 hover:text-ink',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>

            {source === 'lake' && (
              <>
                <p className="text-meta text-ink-3">SWOT’s level for the whole PLD lake, one value per pass (Hydrocron).</p>
                {swot === null && <p className="text-meta text-ink-3">Loading SWOT passes…</p>}
                {swot && 'error' in swot && <Notice tone="error">{swot.error}</Notice>}
              </>
            )}

            {source === 'area' && !areas.length && (
              <Notice tone="info" title="No study area yet">
                Draw the part of the reservoir you want to compare on the map (rectangle or polygon tools at the top left), then come back here.
              </Notice>
            )}

            {source === 'area' && areas.length > 0 && (
              <>
                <div className="flex flex-wrap items-end gap-3">
                  <Field label="Study area" className="min-w-0 flex-1">
                    <Select value={zoneArea?.id ?? ''} onChange={(e) => setAreaId(e.target.value)}>
                      {areas.map((a) => (
                        <option key={a.id} value={a.id} disabled={!clipPolygon(a)}>
                          {a.name} · {areaKm2(a).toFixed(1)} km²{clipPolygon(a) ? '' : ' (a point without buffer)'}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  {areaProgress ? (
                    <Button variant="ghost" onClick={() => areaAbort.current?.abort()}>
                      Cancel
                    </Button>
                  ) : (
                    <Button variant={areaResult ? 'secondary' : 'primary'} icon={Download} disabled={!zone} onClick={() => void loadArea()}>
                      {areaResult ? 'Load again' : 'Load SWOT in this area'}
                    </Button>
                  )}
                </div>
                <p className="text-meta text-ink-3">
                  Each pass uses only the SWOT water observations inside this area: their heights are combined by an area-weighted median, after your QC rule.
                  The first run downloads about 10 MB per pass; later runs, and the Robust level tab, reuse the cache.
                </p>
                {areaProgress && areaProgress.total > 0 && (
                  <Progress
                    value={areaProgress.done}
                    max={areaProgress.total}
                    label={`${areaProgress.done} of ${areaProgress.total} passes · ${areaProgress.cached} from cache${areaProgress.failed ? ` · ${areaProgress.failed} failed` : ''}`}
                  />
                )}
                {areaError && <Notice tone="error">{areaError}</Notice>}
                {areaResult && (
                  <p className="tabular text-meta text-ink-2" role="status">
                    {areaResult.levels.length} passes with water inside {zoneArea?.name}
                    {areaResult.levels.length > 0 &&
                      (() => {
                        const pieces = median(areaResult.levels.map((l) => l.pieces));
                        return ` · typically ${median(areaResult.levels.map((l) => l.insideKm2)).toFixed(1)} km² of water from ${pieces} observation${pieces === 1 ? '' : 's'} per pass`;
                      })()}
                    {areaResult.passesWithoutData > 0 &&
                      ` · ${areaResult.passesWithoutData} passes saw the lake but had no water passing QC inside this area (often a pass that covers another part of the reservoir)`}
                  </p>
                )}
                {areaResult && !areaResult.levels.length && (
                  <Notice tone="warning" title={`No SWOT water of ${reservoir.name} inside ${zoneArea?.name}`}>
                    Check that the study area covers part of the reservoir’s water surface.
                  </Notice>
                )}
              </>
            )}
          </div>
          {result && s && s.n === 0 && (
            <Notice tone="warning" title="No SWOT pass falls inside the gauge record">
              SWOT measures from July 2023, and the gauge readings end on {day(record.points.at(-1)![0])}. Add readings from after July 2023 to validate.
            </Notice>
          )}

          {result && s && s.n > 0 && (
            <>
              <dl className="tabular grid grid-cols-2 gap-x-6 gap-y-4 @[36rem]:grid-cols-4">
                {stat('Matched passes', String(s.n), `${day(s.start!)} → ${day(s.end!)}`)}
                {stat('Bias', m(s.bias, 2, true), `SWOT − gauge, median · mean ${m(s.meanBias, 2, true)}`)}
                {stat('RMSE', m(s.rmse), 'including the bias')}
                {stat('RMSE, bias removed', m(s.rmseUnbiased), 'the agreement that counts', 'text-ink font-medium')}
                {stat('MAE, bias removed', m(s.maeUnbiased))}
                {stat('Correlation r', s.r === null ? '–' : s.r.toFixed(3), s.r === null ? undefined : `R² ${(s.r * s.r).toFixed(3)}`)}
                {stat('Within ±10 cm', pct(s.within10), 'after bias removal')}
                {stat('Within ±25 cm', pct(s.within25), 'after bias removal')}
              </dl>

              <p className="text-meta text-ink-3">
                {result.unmatched > 0 && `${result.unmatched} SWOT passes fall outside the gauge record or in a gap and are not compared. `}
                SWOT heights are relative to the EGM2008 geoid and the gauge uses the dam’s own datum, so a constant bias is expected; judge the agreement by the
                bias-removed values.
              </p>

              <div className="flex flex-wrap gap-x-6 gap-y-2">
                <Check label="Shift SWOT by the bias in the chart" checked={shift} onChange={(e) => setShift(e.target.checked)} />
                {result.outliers > 0 && (
                  <Check
                    label={`Exclude ${result.outliers} outlier${result.outliers > 1 ? 's' : ''} (beyond robust 3σ)`}
                    checked={excludeOutliers}
                    onChange={(e) => setExcludeOutliers(e.target.checked)}
                  />
                )}
              </div>

              {charts && record && (
                <>
                  <ChartFigure
                    option={charts.series}
                    style={{ height: 280 }}
                    title={`${reservoir.name} · SWOT against gauge`}
                    caption={figureCaption}
                    name={`${reservoir.id}_gauge_series`}
                  />
                  <div className="space-y-1">
                    <p className="text-eyebrow font-medium tracking-[0.08em] text-ink-3 uppercase">Difference after bias removal</p>
                    <ChartFigure
                      option={charts.residuals}
                      style={{ height: 160 }}
                      title={`${reservoir.name} · SWOT − gauge after bias removal`}
                      caption={figureCaption}
                      name={`${reservoir.id}_gauge_residuals`}
                    />
                  </div>
                  <div className="space-y-1">
                    <p className="text-eyebrow font-medium tracking-[0.08em] text-ink-3 uppercase">SWOT − bias against gauge</p>
                    <ChartFigure
                      option={charts.scatter}
                      style={{ height: 300 }}
                      title={`${reservoir.name} · SWOT (bias removed) against gauge`}
                      caption={figureCaption}
                      name={`${reservoir.id}_gauge_scatter`}
                    />
                  </div>
                </>
              )}

              <Button icon={FileDown} onClick={() => void exportCsv()}>
                Export matched pairs (CSV)
              </Button>
            </>
          )}
        </>
      )}
    </Section>
  );
}
