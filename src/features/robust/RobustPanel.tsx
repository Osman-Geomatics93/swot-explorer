import { LineChart, ScatterChart } from 'echarts/charts';
import { DataZoomComponent, GridComponent, LegendComponent, TooltipComponent } from 'echarts/components';
import * as echarts from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import type { FeatureCollection } from 'geojson';
import { Activity, FileDown } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { getTimeseries } from '@/api/hydrocron';
import { AuthError } from '@/auth/token';
import { ChartFigure } from '@/components/ChartFigure';
import { Button, Card, Notice, Progress, Section, cx } from '@/components/ui';
import { citationMeta } from '@/lib/citation';
import { downloadTable } from '@/lib/exportCsv';
import { FONT_BODY, token } from '@/lib/tokens';
import { applyQc, describeRule } from '@/qc/qualityControl';
import { fetchLakePieces, piecesToFeatures, type FetchProgress } from '@/robust/fetchPieces';
import { lakePasses } from '@/robust/lakePasses';
import { robustLevels, type Reliability, type RobustResult } from '@/robust/robustLevel';
import { useThemeKey } from '@/state/theme';
import { addHistory } from '@/storage/db';

echarts.use([LineChart, ScatterChart, GridComponent, TooltipComponent, LegendComponent, DataZoomComponent, CanvasRenderer]);

export interface Reservoir {
  id: string;
  name: string;
  country: string;
  lake_id: string;
  afr_passes: string[];
  confidence: string;
  note?: string;
}

type Pieces = Awaited<ReturnType<typeof fetchLakePieces>>;

const GRADE: Record<Reliability, { label: string; className: string; text: string }> = {
  good: { label: 'Good', className: 'text-ok', text: 'Consecutive passes agree closely.' },
  questionable: {
    label: 'Questionable',
    className: 'text-caution',
    text: 'Passes typically disagree by 0.5–2 m. Check the pieces on the map before using this series.',
  },
  unreliable: {
    label: 'Unreliable',
    className: 'text-error',
    text: 'Levels jump by more than 2 m between passes even after robust filtering. The error is in the SWOT heights themselves; do not use this series without independent validation.',
  },
  insufficient: { label: 'Too few passes', className: 'text-ink-2', text: 'Fewer than 5 usable passes.' },
};

export function RobustPanel({ reservoir, onPieces }: { reservoir: Reservoir; onPieces: (fc: FeatureCollection | undefined) => void }) {
  const [progress, setProgress] = useState<FetchProgress | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pieces, setPieces] = useState<Pieces>([]);
  const [result, setResult] = useState<RobustResult | null>(null);
  const [hydrocron, setHydrocron] = useState<[string, number][]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []); // switching reservoir stops this run's downloads

  const run = async () => {
    abort.current = new AbortController();
    const signal = abort.current.signal;
    setRunning(true);
    setError(null);
    setResult(null);
    setSelected(null);
    onPieces(undefined);
    try {
      const [all, hc] = await Promise.all([
        lakePasses(reservoir.lake_id, reservoir.afr_passes, signal).then((passes) => fetchLakePieces(reservoir.lake_id, passes, setProgress, signal)),
        getTimeseries(
          {
            feature: 'PriorLake',
            featureId: reservoir.lake_id,
            start: '2023-07-01T00:00:00Z',
            end: new Date().toISOString().slice(0, 19) + 'Z',
            fields: ['lake_id', 'time_str', 'wse', 'wse_u', 'quality_f'],
            collection: 'SWOT_L2_HR_LakeSP_D',
          },
          signal,
        ),
      ]);
      setPieces(all);
      const robust = robustLevels(all);
      setResult(robust);
      void addHistory({
        kind: 'robust',
        title: `Robust level · ${reservoir.name}`,
        detail: `${robust.levels.length} passes · ${robust.reliability} (median jump ${robust.medianJumpM?.toFixed(2) ?? '–'} m)`,
      });
      setHydrocron(applyQc(hc, 'lake').rows.map((r) => [r.time_str!, Number(r.wse)]));
    } catch (err) {
      if (!signal.aborted) setError(err instanceof AuthError || err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setRunning(false);
    }
  };

  const showPass = (granule: string) => {
    if (!result) return;
    setSelected(granule);
    const level = result.levels.find((l) => l.granule === granule);
    const kept = new Set((level?.kept_obs_ids ?? []).map((id) => `${granule}|${id}`));
    const ref = new Map(level ? [[granule, level.wse]] : []);
    onPieces(piecesToFeatures(pieces.filter((p) => p.granule === granule), kept, ref));
  };

  const exportCsv = async () => {
    if (!result) return;
    const DICT: Record<string, [string, string]> = {
      time_str: ['Pass time (UTC)', ''],
      cycle: ['SWOT repeat cycle', ''],
      pass: ['SWOT pass number', ''],
      wse: ['Robust water surface elevation: area-weighted median of the kept pieces', 'm'],
      spread_m: ['Area-weighted standard deviation of the kept pieces around the robust level', 'm'],
      area_used_km2: ['Total area of the kept pieces', 'km2'],
      n_pieces: ['Observed pieces linked to the lake in this pass', ''],
      n_qc: ['Pieces passing quality control and the minimum area', ''],
      n_kept: ['Pieces kept after outlier removal', ''],
      spike: ['true if the Hampel filter flags this pass as a spike', ''],
      kept_obs_ids: ['LakeSP obs_id of the kept pieces (semicolon-separated)', ''],
      granule: ['Source LakeSP_obs granule', ''],
    };
    const columns = Object.keys(DICT);
    void downloadTable({
      path: `SWOT/robust/${reservoir.id}_robust_wse/${reservoir.id}_robust_wse`,
      rows: result.levels.map((l) => ({ ...l })),
      columns,
      meta: {
        reservoir: `${reservoir.name} (${reservoir.country})`,
        pld_lake_id: reservoir.lake_id,
        product: 'SWOT_L2_HR_LakeSP_obs_D (observed pieces), robust area-weighted median per pass',
        quality_control: describeRule('lake'),
        method: 'pieces >= 1 km2; outliers > 3 sigma removed (sigma = max(1.4826*MAD, 0.25 m)); Hampel spike flag, window 3',
        reliability: `${result.reliability} (median jump ${result.medianJumpM?.toFixed(2)} m, p90 ${result.p90JumpM?.toFixed(2)} m)`,
        duplicates_removed: String(result.duplicatesRemoved),
        source: 'NASA/CNES SWOT, distributed by PO.DAAC (https://podaac.jpl.nasa.gov/SWOT)',
        generated: `${new Date().toISOString()} by SWOT Explorer`,
        ...(await citationMeta(['SWOT_L2_HR_LakeSP_obs_D'])),
      },
      dictionary: columns.map((c) => ({ column: c, description: DICT[c]![0], units: DICT[c]![1], source: 'SWOT Explorer' })),
    });
  };

  const themeKey = useThemeKey();
  const option = useMemo(() => {
    if (!result) return null;
    const ok = result.levels.filter((l) => !l.spike);
    const spikes = result.levels.filter((l) => l.spike);
    const ink2 = token('ink-2');
    const ink3 = token('ink-3');
    const line = token('line');
    const text = { fontFamily: FONT_BODY, color: ink2, fontSize: 12 };
    return {
      animation: false,
      textStyle: text,
      tooltip: {
        trigger: 'axis',
        backgroundColor: token('surface'),
        borderColor: token('line-strong'),
        textStyle: { ...text, color: token('ink') },
        valueFormatter: (v: number) => `${v.toFixed(2)} m`,
      },
      legend: { top: 0, left: 0, icon: 'circle', itemWidth: 8, itemHeight: 8, itemGap: 16, textStyle: text },
      grid: { left: 52, right: 8, top: 36, bottom: 52 },
      xAxis: { type: 'time', axisLine: { lineStyle: { color: line } }, axisLabel: text, splitLine: { show: false } },
      yAxis: {
        type: 'value',
        name: 'Water surface elevation (m)',
        nameTextStyle: { ...text, align: 'left' },
        scale: true,
        axisLabel: text,
        splitLine: { lineStyle: { color: line } },
      },
      dataZoom: [
        { type: 'inside' },
        { type: 'slider', height: 18, bottom: 8, borderColor: line, fillerColor: token('accent-soft'), textStyle: text, handleStyle: { color: token('accent') } },
      ],
      series: [
        { name: 'Hydrocron (QC)', type: 'scatter', symbolSize: 4, itemStyle: { color: ink3, opacity: 0.6 }, data: hydrocron },
        {
          name: 'Robust',
          type: 'line',
          symbolSize: 5,
          lineStyle: { width: 1.5, color: token('accent') },
          itemStyle: { color: token('accent') },
          data: ok.map((l) => [l.time_str, l.wse, l.granule]),
        },
        {
          name: 'Spike (flagged)',
          type: 'scatter',
          symbol: 'triangle',
          symbolSize: 8,
          itemStyle: { color: token('error') },
          data: spikes.map((l) => [l.time_str, l.wse, l.granule]),
        },
      ],
    };
  }, [result, hydrocron, themeKey]);

  const grade = result ? GRADE[result.reliability] : null;

  return (
    <Section
      eyebrow={`PLD ${reservoir.lake_id}`}
      title={`Robust level · ${reservoir.name}`}
      actions={
        running ? (
          <Button variant="ghost" onClick={() => abort.current?.abort()}>
            Cancel
          </Button>
        ) : (
          <Button variant="primary" icon={Activity} onClick={() => void run()}>
            {result ? 'Run again' : 'Analyse'}
          </Button>
        )
      }
    >
      {reservoir.note && <p className="text-meta text-ink-2">{reservoir.note}</p>}

      {progress && running && (
        <Progress
          value={progress.done}
          max={progress.total}
          label={`${progress.done} of ${progress.total} passes · ${progress.cached} from cache${progress.failed ? ` · ${progress.failed} failed` : ''}. The first run downloads about 10 MB per pass.`}
        />
      )}

      {error && <Notice tone="error">{error}</Notice>}

      {result && grade && (
        <>
          <div className="space-y-2">
            <p className={cx('font-display text-display', grade.className)}>{grade.label}</p>
            <p className="text-body text-ink-2">{grade.text}</p>
            <dl className="tabular grid grid-cols-3 gap-4 pt-2">
              {[
                ['Median jump', result.medianJumpM !== null ? `${result.medianJumpM.toFixed(2)} m` : '–'],
                ['90th percentile', result.p90JumpM !== null ? `${result.p90JumpM.toFixed(2)} m` : '–'],
                ['Passes', String(result.levels.length)],
              ].map(([k, v]) => (
                <div key={k}>
                  <dt className="text-eyebrow font-medium tracking-[0.08em] text-ink-3 uppercase">{k}</dt>
                  <dd className="text-title text-ink">{v}</dd>
                </div>
              ))}
            </dl>
            <p className="text-meta text-ink-3">
              {result.duplicatesRemoved} reprocessed duplicates removed · {result.passesWithoutData} passes without a usable piece
            </p>
          </div>

          {option && (
            <ChartFigure
              title={`${reservoir.name} · robust SWOT water level`}
              caption={`SWOT LakeSP_obs Version D pieces, robust per-pass level · ${describeRule('lake')}`}
              name={`${reservoir.id}_robust_level`}
              option={option}
              style={{ height: 280 }}
              onEvents={{ click: (e: { data?: unknown[] }) => typeof e.data?.[2] === 'string' && showPass(e.data[2]) }}
            />
          )}
          <p className="text-meta text-ink-2">
            Select a point or a row to see that pass on the map. Kept pieces are shaded by their height difference from the robust level (teal lower,
            brick higher); rejected pieces are grey.
          </p>

          <Card className="max-h-64 overflow-auto">
            <table className="w-full text-meta">
              <thead className="sticky top-0 bg-surface/95 text-left backdrop-blur">
                <tr className="text-eyebrow tracking-[0.08em] text-ink-3 uppercase">
                  <th className="px-4 py-2 font-medium">Date</th>
                  <th className="px-2 py-2 font-medium">Pass</th>
                  <th className="px-2 py-2 text-right font-medium">WSE (m)</th>
                  <th className="px-2 py-2 text-right font-medium">Spread</th>
                  <th className="px-4 py-2 text-right font-medium" title="Kept / passed QC / total">
                    Pieces
                  </th>
                </tr>
              </thead>
              <tbody>
                {result.levels.map((l) => (
                  <tr
                    key={l.granule}
                    onClick={() => showPass(l.granule)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        showPass(l.granule);
                      }
                    }}
                    tabIndex={0}
                    aria-selected={selected === l.granule}
                    className={cx(
                      'cursor-pointer border-t border-line transition-colors duration-200 hover:bg-sunken',
                      selected === l.granule && 'bg-accent-soft',
                      l.spike ? 'text-error' : 'text-ink',
                    )}
                  >
                    <td className="px-4 py-2">{l.time_str.slice(0, 10)}</td>
                    <td className="px-2 py-2 text-ink-2">{Number(l.pass)}</td>
                    <td className="px-2 py-2 text-right">{l.wse.toFixed(2)}</td>
                    <td className="px-2 py-2 text-right text-ink-2">{l.spread_m.toFixed(2)}</td>
                    <td className="px-4 py-2 text-right text-ink-2">
                      {l.n_kept}/{l.n_qc}/{l.n_pieces}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <Button icon={FileDown} onClick={() => void exportCsv()}>
            Export CSV
          </Button>
        </>
      )}
    </Section>
  );
}
