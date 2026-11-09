import { LineChart, ScatterChart } from 'echarts/charts';
import { DataZoomComponent, GridComponent, LegendComponent, TooltipComponent } from 'echarts/components';
import * as echarts from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { FileDown, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { ChartFigure } from '@/components/ChartFigure';
import { Button, Check, IconButton, Notice, Select, cx } from '@/components/ui';
import reservoirsConfig from '@/config/reservoirs.json';
import { findCandidates, SOURCE_LABEL, type Candidate, type CandidateSearch } from '@/independent/sources';
import { citationMeta } from '@/lib/citation';
import { downloadTable } from '@/lib/exportCsv';
import { slug } from '@/lib/format';
import { FONT_BODY, token } from '@/lib/tokens';
import type { PreviewKind } from '@/map/MapView';
import { describeRule } from '@/qc/qualityControl';
import { gradeReliability, type Reliability } from '@/robust/robustLevel';
import { useThemeKey } from '@/state/theme';
import { compareSeries, fitAreaLevel, MIN_FULL_PASSES, storageChangeMcm, type AreaLevelFit, type Comparison, type LevelPoint } from '@/timeseries/analysis';
import { fetchFeatureSeries, SERIES_START, type FeatureSeries, type SeriesPoint } from '@/timeseries/featureSeries';

echarts.use([LineChart, ScatterChart, GridComponent, TooltipComponent, LegendComponent, DataZoomComponent, CanvasRenderer]);

export interface SeriesTarget {
  kind: PreviewKind;
  id: string;
  name: string;
  /** Where the feature was clicked; used to find independent altimetry nearby. */
  lngLat?: [number, number];
}

type View = 'wse' | 'area_total' | 'storage' | 'width' | 'discharge';

const KIND_LABEL: Record<PreviewKind, string> = { lakes: 'Lake', reaches: 'River reach', nodes: 'River node' };
const VIEW_LABEL: Record<View, string> = { wse: 'Water level', area_total: 'Area', storage: 'Storage', width: 'Width', discharge: 'Discharge' };
const VIEWS: Record<PreviewKind, View[]> = { lakes: ['wse', 'area_total', 'storage'], reaches: ['wse', 'width', 'discharge'], nodes: ['wse', 'width'] };
const QC_KIND = { lakes: 'lake', reaches: 'reach', nodes: 'node' } as const;
const COLLECTION = { lakes: 'SWOT_L2_HR_LakeSP_D', reaches: 'SWOT_L2_HR_RiverSP_D', nodes: 'SWOT_L2_HR_RiverSP_D' } as const;
const GRADE: Record<Reliability, { label: string; className: string }> = {
  good: { label: 'Consistent', className: 'text-ok' },
  questionable: { label: 'Questionable', className: 'text-caution' },
  unreliable: { label: 'Unreliable', className: 'text-error' },
  insufficient: { label: 'Too few points', className: 'text-ink-3' },
};
const KNOWN = new Map(reservoirsConfig.reservoirs.map((r) => [r.lake_id, r]));
const pretty = (u?: string) => (u ?? '').replace('km^2', 'km²').replace('m^3/s', 'm³/s').replace('m^2', 'm²');
const fmtMcm = (v: number) => (Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(2)} km³` : `${Math.round(v).toLocaleString()} MCM`);
/** Both ends in one unit, chosen by the larger value. */
const fmtRange = (lo: number, hi: number) =>
  Math.max(Math.abs(lo), Math.abs(hi)) >= 1000 ? `${(lo / 1000).toFixed(2)}–${(hi / 1000).toFixed(2)} km³` : `${Math.round(lo).toLocaleString()}–${Math.round(hi).toLocaleString()} MCM`;
/** Independent altimetry stations near the feature (Hydroweb, DAHITI), and the chosen one's series. */
function useIndependent(target: SeriesTarget, enabled: boolean) {
  const [search, setSearch] = useState<CandidateSearch | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [obs, setObs] = useState<LevelPoint[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const kind = target.kind === 'lakes' ? 'lakes' : 'reaches';

  useEffect(() => {
    if (!enabled || !target.lngLat) return;
    let stale = false;
    setError(null);
    setSearch(null);
    findCandidates(kind, target.lngLat)
      .then((r) => {
        if (stale) return;
        setSearch(r);
        setChosen(r.candidates[0]?.key ?? null);
      })
      .catch(() => !stale && setError('Could not search for independent stations.'));
    return () => {
      stale = true;
    };
  }, [enabled, target.id, kind, target.lngLat?.[0], target.lngLat?.[1]]);

  const candidate: Candidate | null = search?.candidates.find((c) => c.key === chosen) ?? null;

  useEffect(() => {
    if (!enabled || !candidate) return setObs(null);
    let stale = false;
    setObs(null);
    setError(null);
    candidate
      .load()
      .then((o) => !stale && setObs(o))
      .catch((err) => !stale && setError(err instanceof Error ? err.message : 'Could not load that station.'));
    return () => {
      stale = true;
    };
  }, [enabled, candidate?.key]);

  return { search, chosen, setChosen, candidate, obs, error };
}

export function TimeSeriesPanel({ target, onClose, layout }: { target: SeriesTarget; onClose: () => void; layout: 'overlay' | 'inline' }) {
  const [series, setSeries] = useState<FeatureSeries | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>('wse');
  const [showRejected, setShowRejected] = useState(false);
  const [compare, setCompare] = useState(false);
  const known = target.kind === 'lakes' ? KNOWN.get(target.id) : undefined;
  const indep = useIndependent(target, compare && view === 'wse');
  const otherName = indep.candidate ? SOURCE_LABEL[indep.candidate.source] : 'Independent';

  useEffect(() => {
    const ctl = new AbortController();
    setSeries(null);
    setError(null);
    setView('wse');
    fetchFeatureSeries(target.kind, target.id, ctl.signal)
      .then((s) => !ctl.signal.aborted && setSeries(s))
      .catch((err) => !ctl.signal.aborted && setError(err instanceof Error ? err.message : 'Could not load the time series.'));
    return () => ctl.abort();
  }, [target.kind, target.id]);

  const pts = series?.points ?? [];
  const good = pts.filter((p) => p.qcPass);
  const levels = good.filter((p) => p.wse !== null);

  // Storage: area–level fit on full-coverage passes only (partial passes understate area).
  const fullPasses = good.filter((p) => p.wse !== null && p.area_total !== null && p.partial === false);
  const fit: AreaLevelFit | null = useMemo(
    () => (target.kind === 'lakes' && fullPasses.length >= MIN_FULL_PASSES ? fitAreaLevel(fullPasses.map((p) => ({ wse: p.wse!, area: p.area_total! }))) : null),
    [series],
  );
  // Storage above the lowest observed level (any QC pass), so values start at zero.
  const hMin = levels.length ? Math.min(...levels.map((p) => p.wse!)) : 0;
  const storageAt = (h: number) => (fit ? storageChangeMcm(h, fit) - storageChangeMcm(hMin, fit) : 0);
  const storage = fit ? levels.map((p) => ({ time: p.time, v: storageAt(p.wse!) })) : [];
  const grade = levels.length ? gradeReliability(levels.map((p) => p.wse!)) : null;

  const comparison: Comparison | null = useMemo(
    () =>
      indep.obs && compare
        ? compareSeries(
            levels.map((p) => ({ time: p.time, wse: p.wse! })),
            indep.obs,
          )
        : null,
    [indep.obs, compare, series],
  );

  const valuesOf = (v: View): { p: SeriesPoint; value: number }[] => {
    if (v === 'storage') return [];
    return (showRejected ? pts : good).filter((p) => p[v] !== null).map((p) => ({ p, value: p[v]! }));
  };
  const unit = view === 'storage' ? 'MCM' : pretty(series?.units[view]);

  const themeKey = useThemeKey();
  const option = useMemo(() => {
    if (!series) return null;
    const text = { fontFamily: FONT_BODY, color: token('ink-2'), fontSize: 12 };
    const line = token('line');
    const base = {
      animation: false,
      textStyle: text,
      grid: { left: 64, right: comparison ? 64 : 16, top: 36, bottom: 52 },
      tooltip: {
        trigger: 'axis',
        backgroundColor: token('surface'),
        borderColor: token('line-strong'),
        textStyle: { ...text, color: token('ink') },
        valueFormatter: (v: number) => (view === 'storage' ? fmtMcm(v) : `${v.toFixed(view === 'wse' ? 2 : 1)} ${unit}`),
      },
      legend: { top: 0, left: 0, icon: 'roundRect', itemWidth: 12, itemHeight: 4, textStyle: text },
      xAxis: { type: 'time', axisLine: { lineStyle: { color: line } }, axisLabel: text, splitLine: { show: false } },
      yAxis: { type: 'value', scale: view !== 'storage', axisLabel: text, splitLine: { lineStyle: { color: line } } },
      dataZoom: [{ type: 'inside' }, { type: 'slider', height: 18, bottom: 8, borderColor: line, fillerColor: token('accent-soft'), textStyle: text }],
    };
    const lineSeries = (name: string, color: string, data: [string, number][], label = false) => ({
      name,
      type: 'line',
      symbolSize: 6,
      lineStyle: { width: 2, color },
      itemStyle: { color },
      // Direct end labels only when there are several series to tell apart.
      endLabel: { show: label, formatter: name, color: token('ink-2'), fontFamily: FONT_BODY, fontSize: 11 },
      data,
    });

    if (view === 'storage')
      return {
        ...base,
        legend: { show: false },
        yAxis: { ...base.yAxis, axisLabel: { ...text, formatter: (v: number) => `${(v / 1000).toFixed(v % 1000 ? 1 : 0)} km³` } },
        series: [lineSeries('Storage change', token('accent'), storage.map((s) => [s.time, s.v]))],
      };

    if (view === 'area_total') {
      const full = valuesOf('area_total').filter((x) => x.p.partial === false);
      const partial = valuesOf('area_total').filter((x) => x.p.partial !== false);
      return {
        ...base,
        tooltip: { ...base.tooltip, trigger: 'item' },
        series: [
          { name: 'Partial coverage', type: 'scatter', symbolSize: 6, itemStyle: { color: token('ink-3'), opacity: 0.5 }, data: partial.map((x) => [x.p.time, x.value]) },
          { name: 'Full coverage', type: 'scatter', symbolSize: 8, itemStyle: { color: token('accent') }, data: full.map((x) => [x.p.time, x.value]) },
        ],
      };
    }

    const own = valuesOf(view);
    const swotColor = comparison ? token('series-1') : token('accent');
    const rejected = showRejected ? own.filter((x) => !x.p.qcPass) : [];
    return {
      ...base,
      legend: { ...base.legend, show: Boolean(comparison) || rejected.length > 0 },
      series: [
        lineSeries(comparison ? 'SWOT' : VIEW_LABEL[view], swotColor, own.filter((x) => x.p.qcPass).map((x) => [x.p.time, x.value]), Boolean(comparison)),
        ...(rejected.length
          ? [{ name: 'Rejected by QC', type: 'scatter', symbolSize: 5, itemStyle: { color: token('ink-3'), opacity: 0.45 }, data: rejected.map((x) => [x.p.time, x.value]) }]
          : []),
        ...(comparison && indep.obs
          ? [lineSeries(otherName, token('series-2'), indep.obs.map((o) => [o.time, o.wse] as [string, number]).filter(([t]) => t >= SERIES_START.slice(0, 10)), true)]
          : []),
      ],
    };
  }, [series, view, showRejected, comparison, indep.obs, storage.length, themeKey]);

  const exportCsv = async () => {
    if (!series) return;
    const name = `${slug(target.name)}_${target.id}_timeseries`;
    const pair = new Map(comparison?.pairs.map((p) => [p.time, p]) ?? []);
    const rows = pts.map((p) => ({
      time_str: p.time,
      wse: p.wse,
      wse_u: p.wse_u,
      area_total: p.area_total,
      partial_coverage: p.partial,
      width: p.width,
      discharge: p.discharge,
      storage_change_mcm: fit && p.qcPass && p.wse !== null ? Math.round(storageAt(p.wse) * 10) / 10 : null,
      independent_wse: pair.get(p.time)?.other ?? null,
      quality_flag: p.flag,
      qc_pass: p.qcPass,
      qc_reason: p.qcReason ?? '',
    }));
    const lake = target.kind === 'lakes';
    const columns = [
      'time_str', 'wse', 'wse_u',
      ...(lake ? ['area_total', 'partial_coverage', ...(fit ? ['storage_change_mcm'] : [])] : ['width', ...(target.kind === 'reaches' ? ['discharge'] : [])]),
      ...(comparison ? ['independent_wse'] : []),
      'quality_flag', 'qc_pass', 'qc_reason',
    ];
    const dict: Record<string, [string, string, string]> = {
      time_str: ['Observation time (UTC)', '', 'SWOT'],
      wse: ['Water surface elevation relative to the geoid', series.units.wse ?? 'm', 'SWOT'],
      wse_u: ['Total uncertainty of wse', series.units.wse_u ?? 'm', 'SWOT'],
      area_total: ['Total water area observed in this pass', pretty(series.units.area_total) || 'km²', 'SWOT'],
      partial_coverage: ['true if SWOT saw only part of the lake (area understated)', '', 'SWOT (partial_f)'],
      width: ['River width', series.units.width ?? 'm', 'SWOT'],
      discharge: ['River discharge, consensus of SWOT algorithms (dschg_c)', pretty(series.units.discharge) || 'm³/s', 'SWOT'],
      storage_change_mcm: ['Storage above the lowest observed level, from the area–level fit in the README', 'million m³', 'SWOT Explorer'],
      independent_wse: [`${otherName} water level (${indep.candidate?.name ?? ''}) matched within 3 days`, 'm', otherName],
      quality_flag: ['SWOT summary quality flag: 0 good, 1 suspect, 2 degraded, 3 bad', '', 'SWOT'],
      qc_pass: ['true if the observation passes the quality-control rule in the README', '', 'SWOT Explorer'],
      qc_reason: ['Why the observation failed quality control', '', 'SWOT Explorer'],
    };
    await downloadTable({
      path: `SWOT/timeseries/${name}/${name}`,
      columns,
      rows,
      meta: {
        feature: `${KIND_LABEL[target.kind]} ${target.id} (${target.name})`,
        source: `Hydrocron (PO.DAAC), ${COLLECTION[target.kind]}${comparison && indep.candidate ? `; ${otherName} station ${indep.candidate.name} for comparison` : ''}`,
        period: `${SERIES_START.slice(0, 10)} to ${new Date().toISOString().slice(0, 10)} (UTC)`,
        quality_control: `${describeRule(QC_KIND[target.kind])}; all rows included, see qc_pass`,
        ...(fit
          ? {
              storage_method: `Theil-Sen fit of area_total on wse over ${fit.n} full-coverage QC passes: A = ${fit.intercept.toFixed(1)} + ${fit.slope.toFixed(2)}·h km² (R² ${fit.r2.toFixed(2)}); storage = integral of A dh from the lowest observed QC level, ${hMin.toFixed(2)} m`,
            }
          : {}),
        ...(comparison && comparison.n
          ? { comparison: `${comparison.n} SWOT passes matched to ${otherName} within 3 days; bias (median SWOT - ${otherName}) ${comparison.bias!.toFixed(2)} m; RMSE ${comparison.rmse!.toFixed(2)} m, ${comparison.rmseUnbiased!.toFixed(2)} m after removing the bias` }
          : {}),
        generated: `${new Date().toISOString()} by SWOT Explorer`,
        ...(await citationMeta([COLLECTION[target.kind]], comparison && indep.candidate ? [indep.candidate.citation] : [])),
      },
      dictionary: columns.map((c) => ({ column: c, description: dict[c]![0], units: dict[c]![1], source: dict[c]![2] })),
    });
  };

  const stat = (label: string, value: string, sub?: string, cls?: string) => (
    <div key={label}>
      <dt className="text-eyebrow font-medium tracking-[0.08em] text-ink-3 uppercase">{label}</dt>
      <dd className={cx('text-body', cls ?? 'text-ink')}>{value}</dd>
      {sub && <dd className="text-meta text-ink-3">{sub}</dd>}
    </div>
  );

  const viewValues = view === 'storage' ? storage.map((s) => s.v) : good.filter((p) => p[view] !== null).map((p) => p[view]!);
  const latest = view === 'storage' ? storage[storage.length - 1] : good.filter((p) => p[view] !== null).at(-1);
  const latestValue = view === 'storage' ? (latest as { v: number } | undefined)?.v : (latest as SeriesPoint | undefined)?.[view];

  const stats =
    view === 'storage' && fit
      ? [
          stat('Storage now', latestValue !== undefined && latestValue !== null ? fmtMcm(latestValue) : '–', `above the lowest level, ${hMin.toFixed(1)} m`),
          stat('Range', viewValues.length ? fmtRange(Math.min(...viewValues), Math.max(...viewValues)) : '–'),
          stat('Area–level fit', `R² ${fit.r2.toFixed(2)}`, `${fit.n} full-coverage passes · ${fit.slope.toFixed(1)} km²/m`, fit.r2 < 0.3 || !fit.physical ? 'text-caution' : undefined),
        ]
      : view === 'wse' && comparison
        ? [
            stat(`Matched with ${otherName}`, `${comparison.n} passes`, 'within 3 days'),
            stat('Bias', comparison.bias !== null ? `${comparison.bias >= 0 ? '+' : ''}${comparison.bias.toFixed(2)} m` : '–', `median SWOT − ${otherName}`),
            stat('RMSE', comparison.rmseUnbiased !== null ? `${comparison.rmseUnbiased.toFixed(2)} m` : '–', comparison.rmse !== null ? `${comparison.rmse.toFixed(2)} m before removing bias` : undefined),
          ]
        : [
            stat('Observations', `${good.length} pass QC · ${pts.length} total`),
            stat('Latest', latestValue !== undefined && latestValue !== null ? `${latestValue.toFixed(view === 'wse' ? 2 : 1)} ${unit}` : '–', (latest as SeriesPoint | undefined)?.time.slice(0, 10)),
            stat('Range', viewValues.length ? `${Math.min(...viewValues).toFixed(1)}–${Math.max(...viewValues).toFixed(1)} ${unit}` : '–'),
            ...(view === 'wse' && grade
              ? [stat('Pass-to-pass', GRADE[grade.reliability].label, grade.medianJumpM !== null ? `median jump ${grade.medianJumpM.toFixed(2)} m` : undefined, GRADE[grade.reliability].className)]
              : []),
          ];

  const blocked =
    view === 'storage' && !fit
      ? `SWOT saw the whole lake on only ${fullPasses.length} passes; at least ${MIN_FULL_PASSES} are needed to fit how area changes with level. ${fullPasses.length <= 1 ? 'The lake is wider than the SWOT swath, so storage needs an area–elevation curve from another source.' : ''}`
      : view === 'discharge' && !good.some((p) => p.discharge !== null)
        ? 'SWOT has not computed discharge for this reach. The SWOT L4 discharge product exists for Africa only as one 4.4 GB file with no subsetting service, so it cannot be read from the browser.'
        : null;

  return (
    <section
      aria-label={`Time series for ${target.name}`}
      className={cx(
        'max-h-[70vh] animate-[rise_0.32s_var(--ease)_both] space-y-4 overflow-y-auto bg-surface p-6',
        layout === 'overlay' ? 'absolute inset-x-3 bottom-3 z-20 rounded-ui border border-line shadow-float' : 'border-b border-line',
      )}
    >
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <p className="text-eyebrow font-medium tracking-[0.08em] text-ink-3 uppercase">
            {KIND_LABEL[target.kind]} · {target.id}
          </p>
          <h2 className="truncate text-title">{target.name}</h2>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <div role="tablist" aria-label="Measurement" className="flex flex-wrap gap-1 rounded-ui bg-sunken p-1">
            {VIEWS[target.kind].map((v) => (
              <button
                key={v}
                type="button"
                role="tab"
                aria-selected={view === v}
                onClick={() => setView(v)}
                className={cx(
                  'h-8 rounded-ui px-3 text-meta font-medium transition-[background-color,color] duration-200 ease-signature',
                  view === v ? 'bg-surface text-ink shadow-float' : 'text-ink-2 hover:text-ink',
                )}
              >
                {VIEW_LABEL[v]}
              </button>
            ))}
          </div>
          <IconButton icon={X} label="Close time series" onClick={onClose} />
        </div>
      </header>

      {known?.note && <Notice tone={known.confidence === 'high' ? 'info' : 'warning'}>{known.note}</Notice>}
      {error && <Notice tone="error">{error}</Notice>}
      {!series && !error && <p className="text-meta text-ink-3">Loading the full SWOT record…</p>}
      {series && pts.length === 0 && <Notice>SWOT has no observations of this feature yet.</Notice>}

      {series && pts.length > 0 && (
        <>
          {blocked ? (
            <Notice tone="warning" title={`${VIEW_LABEL[view]} not available`}>
              {blocked}
            </Notice>
          ) : (
            <>
              <dl className="tabular grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">{stats}</dl>
              {view === 'storage' && fit && (fit.r2 < 0.3 || !fit.physical || grade?.reliability === 'unreliable') && (
                <Notice tone="warning" title="Treat these storage values with caution">
                  {!fit.physical
                    ? 'The fitted area shrinks as the level rises, which is not physical.'
                    : fit.r2 < 0.3
                      ? `Area explains little of the level changes (R² ${fit.r2.toFixed(2)}).`
                      : ''}{' '}
                  {grade?.reliability === 'unreliable' && 'The water levels themselves jump between passes, and storage inherits that.'}
                </Notice>
              )}
              {option && (
                <ChartFigure
                  option={option}
                  style={{ height: layout === 'overlay' ? 220 : 240 }}
                  title={`${target.name} · SWOT ${VIEW_LABEL[view].toLowerCase()}`}
                  caption={`SWOT ${target.kind === 'lakes' ? 'LakeSP' : 'RiverSP'} Version D via PO.DAAC Hydrocron · ${KIND_LABEL[target.kind]} ${target.id} · ${describeRule(QC_KIND[target.kind])}`}
                  name={`${slug(target.name)}_${target.id}_${view}`}
                />
              )}
              {view === 'area_total' && (
                <p className="text-meta text-ink-3">
                  Faint points are passes where SWOT saw only part of the lake, so their area is too small. Storage uses full-coverage passes only.
                </p>
              )}
            </>
          )}

          {view === 'wse' && target.kind !== 'nodes' && (
            <div className="space-y-3 border-t border-line pt-4">
              <Check
                checked={compare}
                onChange={(e) => setCompare(e.target.checked)}
                label="Compare with independent altimetry (Hydroweb, DAHITI)"
              />
              {compare && !target.lngLat && <Notice>Open the time series by clicking the feature on the map to search for stations near it.</Notice>}
              {compare && target.lngLat && !indep.search && !indep.error && <p className="text-meta text-ink-3">Looking for stations nearby…</p>}
              {compare && indep.search && indep.search.candidates.length === 0 && (
                <Notice>No active Hydroweb or DAHITI station within about 60 km{indep.search.tooOld ? ` (${indep.search.tooOld} older stations stopped before SWOT began)` : ''}.</Notice>
              )}
              {compare && indep.search && indep.search.candidates.length > 0 && (
                <label className="flex flex-wrap items-center gap-3 text-meta text-ink-2">
                  Station
                  <Select value={indep.chosen ?? ''} onChange={(e) => indep.setChosen(e.target.value)} className="h-9 min-w-64">
                    {indep.search.candidates.map((c) => (
                      <option key={c.key} value={c.key}>
                        {SOURCE_LABEL[c.source]} · {c.name} · {c.type} · {c.km.toFixed(0)} km
                      </option>
                    ))}
                  </Select>
                </label>
              )}
              {compare && indep.search && (indep.search.tooOld > 0 || indep.search.notes.length > 0) && indep.search.candidates.length > 0 && (
                <p className="text-meta text-ink-3">
                  {indep.search.tooOld > 0 && `${indep.search.tooOld} older stations that stopped before SWOT began are not listed. `}
                  {indep.search.notes.join(' ')}
                </p>
              )}
              {compare && indep.error && (
                <Notice tone="error">
                  {indep.error}{' '}
                  <button type="button" className="font-medium text-accent underline underline-offset-2" onClick={() => void browser.runtime.openOptionsPage()}>
                    Open Options
                  </button>
                </Notice>
              )}
              {comparison && comparison.n === 0 && <Notice>No SWOT and {otherName} observations fall within 3 days of each other.</Notice>}
              {comparison && comparison.n > 0 && (
                <p className="text-meta text-ink-3">
                  A constant bias usually comes from a different geoid or reference point; the RMSE after removing it is the disagreement that matters.
                </p>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3">
            {view !== 'storage' && view !== 'area_total' ? (
              <Check checked={showRejected} onChange={(e) => setShowRejected(e.target.checked)} label={`Show ${pts.length - good.length} observations rejected by QC`} />
            ) : (
              <span />
            )}
            <Button icon={FileDown} onClick={() => void exportCsv()}>
              Export CSV
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
