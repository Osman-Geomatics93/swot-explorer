import { LineChart } from 'echarts/charts';
import { DataZoomComponent, GridComponent, LegendComponent, TooltipComponent } from 'echarts/components';
import * as echarts from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { FileDown } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { ChartFigure } from '@/components/ChartFigure';
import { Button, Card, Check, Notice, Section, cx } from '@/components/ui';
import reservoirsConfig from '@/config/reservoirs.json';
import { citationMeta } from '@/lib/citation';
import { downloadTable } from '@/lib/exportCsv';
import { FONT_BODY, token } from '@/lib/tokens';
import { describeRule } from '@/qc/qualityControl';
import { gradeReliability, type Reliability } from '@/robust/robustLevel';
import { useThemeKey } from '@/state/theme';
import { median } from '@/timeseries/analysis';
import { cachedFeatureSeries, SERIES_START } from '@/timeseries/featureSeries';

echarts.use([LineChart, GridComponent, TooltipComponent, LegendComponent, DataZoomComponent, CanvasRenderer]);

/** Reservoirs grouped by river system, upstream first. Position fixes each reservoir's colour. */
export const CASCADES = [
  {
    id: 'blue',
    label: 'Blue Nile → Main Nile',
    reservoirs: ['gerd', 'roseires', 'sennar', 'merowe', 'aswan'],
  },
  {
    id: 'atbara',
    label: 'Atbara',
    reservoirs: ['tekeze', 'upper-atbara-setit', 'khashm-el-girba'],
  },
  {
    id: 'white',
    label: 'White Nile',
    reservoirs: ['victoria-jinja', 'jebel-aulia'],
  },
] as const;

type Mode = 'anomaly' | 'level';
const BY_ID = new Map(reservoirsConfig.reservoirs.map((r) => [r.id, r]));
const GRADE: Record<Reliability, { label: string; className: string }> = {
  good: { label: 'Consistent', className: 'text-ok' },
  questionable: { label: 'Questionable', className: 'text-caution' },
  unreliable: { label: 'Unreliable', className: 'text-error' },
  insufficient: { label: 'Too few', className: 'text-ink-3' },
};

interface Loaded {
  id: string;
  points: { time: string; wse: number }[];
  median: number;
}

export function CascadePanel() {
  const [cascadeId, setCascadeId] = useState<(typeof CASCADES)[number]['id']>('blue');
  const cascade = CASCADES.find((c) => c.id === cascadeId)!;
  const [off, setOff] = useState<string[]>([]);
  const [mode, setMode] = useState<Mode>('anomaly');
  const [data, setData] = useState<Record<string, Loaded | { error: string }>>({});
  const themeKey = useThemeKey();

  // Fetch each reservoir once (Hydrocron, ~1 s each, in parallel).
  useEffect(() => {
    const ctl = new AbortController();
    for (const id of cascade.reservoirs) {
      if (data[id]) continue;
      const lakeId = BY_ID.get(id)!.lake_id;
      cachedFeatureSeries('lakes', lakeId)
        .then((s) => {
          const points = s.points.filter((p) => p.qcPass && p.wse !== null).map((p) => ({ time: p.time, wse: p.wse! }));
          setData((d) => ({
            ...d,
            [id]: {
              id,
              points,
              median: points.length ? median(points.map((p) => p.wse)) : 0,
            },
          }));
        })
        .catch(
          (err) =>
            !ctl.signal.aborted &&
            setData((d) => ({
              ...d,
              [id]: { error: err instanceof Error ? err.message : 'failed' },
            })),
        );
    }
    return () => ctl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cascadeId]);

  const slot = (id: string) => `series-${cascade.reservoirs.indexOf(id as never) + 1}`;
  const shown = cascade.reservoirs.filter((id) => !off.includes(id) && data[id] && 'points' in data[id]!) as string[];
  const loading = cascade.reservoirs.some((id) => !data[id]);

  const option = useMemo(() => {
    const text = { fontFamily: FONT_BODY, color: token('ink-2'), fontSize: 12 };
    const line = token('line');
    return {
      animation: false,
      textStyle: text,
      // Room for a legend that wraps onto two rows in the narrow side panel.
      grid: {
        left: 48,
        right: shown.length <= 4 ? 96 : 16,
        top: shown.length > 3 ? 64 : 40,
        bottom: 52,
      },
      tooltip: {
        trigger: 'axis',
        backgroundColor: token('surface'),
        borderColor: token('line-strong'),
        textStyle: { ...text, color: token('ink') },
        valueFormatter: (v: number) => `${mode === 'anomaly' && v > 0 ? '+' : ''}${v.toFixed(2)} m`,
      },
      legend: {
        top: 0,
        left: 0,
        icon: 'roundRect',
        itemWidth: 12,
        itemHeight: 4,
        textStyle: text,
      },
      xAxis: {
        type: 'time',
        axisLine: { lineStyle: { color: line } },
        axisLabel: text,
        splitLine: { show: false },
      },
      yAxis: {
        type: 'value',
        scale: true,
        axisLabel: {
          ...text,
          formatter: (v: number) => `${mode === 'anomaly' && v > 0 ? '+' : ''}${v} m`,
        },
        splitLine: { lineStyle: { color: line } },
      },
      dataZoom: [
        { type: 'inside' },
        {
          type: 'slider',
          height: 18,
          bottom: 8,
          borderColor: line,
          fillerColor: token('accent-soft'),
          textStyle: text,
        },
      ],
      series: shown.map((id) => {
        const d = data[id] as Loaded;
        const color = token(slot(id));
        const name = BY_ID.get(id)!.name;
        return {
          name,
          type: 'line',
          showSymbol: false,
          lineStyle: { width: 2, color },
          itemStyle: { color },
          // Direct labels while they stay legible (the light palette needs labels, not colour alone).
          endLabel: {
            show: shown.length <= 4,
            formatter: name,
            color: token('ink-2'),
            fontFamily: FONT_BODY,
            fontSize: 11,
          },
          data: d.points.map((p) => [p.time, mode === 'anomaly' ? p.wse - d.median : p.wse]),
        };
      }),
    };
  }, [data, shown.join(), mode, cascadeId, themeKey]);

  const exportCsv = async () => {
    const rows = shown.flatMap((id) => {
      const d = data[id] as Loaded;
      const r = BY_ID.get(id)!;
      return d.points.map((p) => ({
        reservoir: r.name,
        lake_id: r.lake_id,
        time_str: p.time,
        wse: p.wse,
        change_from_median: Math.round((p.wse - d.median) * 1000) / 1000,
      }));
    });
    const name = `cascade_${cascade.id}`;
    await downloadTable({
      path: `SWOT/cascade/${name}/${name}`,
      rows,
      columns: ['reservoir', 'lake_id', 'time_str', 'wse', 'change_from_median'],
      meta: {
        cascade: `${cascade.label}: ${shown.map((id) => BY_ID.get(id)!.name).join(' → ')}`,
        source: 'Hydrocron (PO.DAAC), SWOT_L2_HR_LakeSP_D, PriorLake time series',
        period: `${SERIES_START.slice(0, 10)} to ${new Date().toISOString().slice(0, 10)} (UTC)`,
        quality_control: `${describeRule('lake')}; only passing rows are included`,
        change_from_median: 'wse minus the median of that reservoir’s QC-passing levels',
        generated: `${new Date().toISOString()} by SWOT Explorer`,
        ...(await citationMeta(['SWOT_L2_HR_LakeSP_D'])),
      },
      dictionary: [
        {
          column: 'reservoir',
          description: 'Reservoir name',
          units: '',
          source: 'SWOT Explorer',
        },
        {
          column: 'lake_id',
          description: 'SWOT Prior Lake Database ID',
          units: '',
          source: 'SWOT',
        },
        {
          column: 'time_str',
          description: 'Observation time (UTC)',
          units: '',
          source: 'SWOT',
        },
        {
          column: 'wse',
          description: 'Water surface elevation relative to the geoid',
          units: 'm',
          source: 'SWOT',
        },
        {
          column: 'change_from_median',
          description: 'wse minus the reservoir’s median QC-passing level',
          units: 'm',
          source: 'SWOT Explorer',
        },
      ],
    });
  };

  return (
    <Section eyebrow="Compare reservoirs" title="Cascade">
      <p className="text-meta text-ink-2">
        Water levels of connected reservoirs on one time axis, upstream first, to see whether fills and releases travel downstream.
      </p>

      <div role="tablist" aria-label="Cascade" className="flex flex-wrap gap-1 rounded-ui bg-sunken p-1">
        {CASCADES.map((c) => (
          <button
            key={c.id}
            type="button"
            role="tab"
            aria-selected={cascadeId === c.id}
            onClick={() => {
              setCascadeId(c.id);
              setOff([]);
            }}
            className={cx(
              'h-8 rounded-ui px-3 text-meta font-medium transition-[background-color,color] duration-200 ease-signature',
              cascadeId === c.id ? 'bg-surface text-ink shadow-float' : 'text-ink-2 hover:text-ink',
            )}
          >
            {c.label}
          </button>
        ))}
      </div>

      <div role="radiogroup" aria-label="Values" className="flex gap-6 text-meta text-ink-2">
        {(
          [
            ['anomaly', 'Change from median'],
            ['level', 'Water level'],
          ] as const
        ).map(([m, label]) => (
          <label key={m} className="flex items-center gap-2">
            <input type="radio" name="cascade-mode" checked={mode === m} onChange={() => setMode(m)} />
            {label}
          </label>
        ))}
      </div>

      {loading && <p className="text-meta text-ink-3">Loading SWOT records…</p>}
      {shown.length > 0 && (
        <ChartFigure
          option={option}
          style={{ height: 300 }}
          title={`${cascade.label} · SWOT reservoir levels${mode === 'anomaly' ? ', change from median' : ''}`}
          caption={`SWOT LakeSP Version D via PO.DAAC Hydrocron · ${describeRule('lake')}; only passing observations`}
          name={`cascade_${cascade.id}_${mode}`}
        />
      )}
      {mode === 'level' && shown.length > 1 && (
        <p className="text-meta text-ink-3">Reservoirs at very different elevations flatten each other here; “Change from median” compares them better.</p>
      )}

      {/* The table names every series beside its colour, so identity never rests on colour alone. */}
      <Card className="overflow-x-auto">
        <table className="w-full text-meta">
          <thead className="text-left">
            <tr className="text-eyebrow tracking-[0.08em] text-ink-3 uppercase">
              <th className="py-2 pr-2 pl-3 font-medium">Reservoir · pass-to-pass</th>
              <th className="px-2 py-2 text-right font-medium">Passes</th>
              <th className="px-2 py-2 text-right font-medium">Latest</th>
              <th className="py-2 pr-3 pl-2 text-right font-medium whitespace-nowrap">vs median</th>
            </tr>
          </thead>
          <tbody>
            {cascade.reservoirs.map((id) => {
              const d = data[id];
              const r = BY_ID.get(id)!;
              const loaded = d && 'points' in d ? d : null;
              const last = loaded?.points.at(-1);
              const grade = loaded && loaded.points.length ? gradeReliability(loaded.points.map((p) => p.wse)) : null;
              return (
                <tr key={id} className="border-t border-line">
                  <td className="py-2 pr-2 pl-3">
                    <Check
                      checked={!off.includes(id)}
                      onChange={(e) => setOff((o) => (e.target.checked ? o.filter((x) => x !== id) : [...o, id]))}
                      label={
                        <span className="block">
                          <span className="flex items-center gap-2">
                            <span aria-hidden className="h-1 w-4 shrink-0 rounded-ui" style={{ background: `var(--${slot(id)})` }} />
                            {r.name}
                          </span>
                          {/* The reliability grade sits under the name so the table fits a narrow panel. */}
                          <span className={cx('block pl-6 text-eyebrow', grade ? GRADE[grade.reliability].className : 'text-ink-3')}>
                            {d && 'error' in d ? 'Failed to load' : grade ? GRADE[grade.reliability].label : d ? '' : 'Loading…'}
                          </span>
                        </span>
                      }
                    />
                  </td>
                  <td className="tabular px-2 py-2 text-right text-ink-2">{loaded ? loaded.points.length : d ? '–' : '…'}</td>
                  <td className="tabular px-2 py-2 text-right whitespace-nowrap text-ink">{last ? `${last.wse.toFixed(2)} m` : '–'}</td>
                  <td className="tabular py-2 pr-3 pl-2 text-right whitespace-nowrap text-ink-2">
                    {last && loaded ? `${last.wse - loaded.median >= 0 ? '+' : ''}${(last.wse - loaded.median).toFixed(2)} m` : '–'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
      {cascade.reservoirs.some((id) => BY_ID.get(id)!.confidence !== 'high') && (
        <Notice tone="warning">
          {cascade.reservoirs
            .filter((id) => BY_ID.get(id)!.confidence !== 'high')
            .map((id) => BY_ID.get(id)!.name)
            .join(' and ')}{' '}
          {cascade.reservoirs.filter((id) => BY_ID.get(id)!.confidence !== 'high').length > 1 ? 'have' : 'has'} lower-confidence SWOT records; read
          {cascade.reservoirs.filter((id) => BY_ID.get(id)!.confidence !== 'high').length > 1 ? ' their' : ' its'} line with care.
        </Notice>
      )}
      <Button icon={FileDown} disabled={!shown.length} onClick={() => void exportCsv()}>
        Export CSV
      </Button>
    </Section>
  );
}
