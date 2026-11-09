import type { EChartsType } from 'echarts/core';
import * as echarts from 'echarts/core';
import ReactECharts from 'echarts-for-react/esm/core';
import { FileImage, ImageDown, PenTool } from 'lucide-react';
import { useRef, type CSSProperties } from 'react';
import { exportChart, type FigureFormat } from '@/lib/figure';
import { slug } from '@/lib/format';
import { toast } from '@/state/toast';
import { Menu, MenuItem } from './ui';

interface Props {
  option: object;
  style: CSSProperties;
  /** Figure title in exports, e.g. "Roseires Dam · SWOT water level". */
  title: string;
  /** Source line under exported figures (data, QC rule, product). */
  caption: string;
  /** File name in Downloads/SWOT/figures/ (no extension); defaults to the title. */
  name?: string;
  onEvents?: Record<string, (e: never) => void>;
  notMerge?: boolean;
}

/** An ECharts chart with "Export figure": the same chart redrawn for print, as PNG at 300 dpi or SVG. */
export function ChartFigure({ option, style, title, caption, name, onEvents, notMerge = true }: Props) {
  const ref = useRef<ReactECharts>(null);

  const save = async (format: FigureFormat) => {
    const chart = ref.current?.getEchartsInstance() as EChartsType | undefined;
    if (!chart) return;
    try {
      const path = await exportChart(chart, { title, caption, format, name: `${slug(name ?? title)}_${new Date().toISOString().slice(0, 10)}` });
      toast(`Figure saved to Downloads/${path}`);
    } catch (err) {
      toast(err instanceof Error ? `Figure not saved: ${err.message}` : 'Figure not saved.', { tone: 'error' });
    }
  };

  return (
    <figure className="@container m-0 space-y-1">
      <div className="flex justify-end">
        <Menu label="Export figure" labelClassName="hidden @[24rem]:inline" icon={ImageDown} align="right" variant="ghost">
          {(close) => (
            <>
              <MenuItem
                icon={FileImage}
                onClick={() => {
                  close();
                  void save('png');
                }}
              >
                PNG · 300 dpi, for Word and slides
              </MenuItem>
              <MenuItem
                icon={PenTool}
                onClick={() => {
                  close();
                  void save('svg');
                }}
              >
                SVG · vector, for LaTeX and editing
              </MenuItem>
            </>
          )}
        </Menu>
      </div>
      <ReactECharts ref={ref} echarts={echarts} option={option} style={style} notMerge={notMerge} onEvents={onEvents} />
    </figure>
  );
}
