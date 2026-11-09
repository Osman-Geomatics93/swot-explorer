/**
 * Publication figures: charts and the map re-drawn on white with dark text, a title and a
 * source line, saved as PNG at 300 dpi (with the resolution written into the file) or SVG.
 * Exports land in Downloads/SWOT/figures/.
 */
import { TitleComponent } from 'echarts/components';
import * as echarts from 'echarts/core';
import { CanvasRenderer, SVGRenderer } from 'echarts/renderers';
import { FONT_BODY } from './tokens';

echarts.use([TitleComponent, CanvasRenderer, SVGRenderer]);

export const FIGURE_DPI = 300;
/** Light print palette, fixed whatever theme is on screen. */
export const PRINT = { paper: '#ffffff', ink: '#1b1a17', ink2: '#57534b', axis: '#8c877d', grid: '#e7e4dc' };

export type FigureFormat = 'png' | 'svg';

/* ------------------------------------------------------------------ PNG resolution */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * Write the print resolution into a PNG (a pHYs chunk right after IHDR), so Word, LaTeX and
 * journals size the figure correctly instead of assuming 72 or 96 dpi.
 */
export function withPngDpi(png: Uint8Array, dpi = FIGURE_DPI): Uint8Array {
  const ihdrEnd = 8 + 4 + 4 + 13 + 4; // signature + IHDR length, type, data, CRC
  const ppm = Math.round(dpi / 0.0254);
  const chunk = new Uint8Array(4 + 4 + 9 + 4);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, 9);
  chunk.set([0x70, 0x48, 0x59, 0x73], 4); // "pHYs"
  view.setUint32(8, ppm);
  view.setUint32(12, ppm);
  chunk[16] = 1; // unit: metre
  view.setUint32(17, crc32(chunk.subarray(4, 17)));
  const out = new Uint8Array(png.length + chunk.length);
  out.set(png.subarray(0, ihdrEnd));
  out.set(chunk, ihdrEnd);
  out.set(png.subarray(ihdrEnd), ihdrEnd + chunk.length);
  return out;
}

const dataUrlBytes = (url: string) => Uint8Array.from(atob(url.slice(url.indexOf(',') + 1)), (c) => c.charCodeAt(0));
const dataUrlText = (url: string) => {
  const body = url.slice(url.indexOf(',') + 1);
  return url.slice(0, url.indexOf(',')).includes(';base64') ? new TextDecoder().decode(dataUrlBytes(url)) : decodeURIComponent(body);
};

/** Save under Downloads/SWOT/figures/ and return the path. */
export async function saveFigure(name: string, format: FigureFormat, data: Uint8Array | string): Promise<string> {
  const filename = `SWOT/figures/${name}.${format}`;
  const blob = new Blob([data as BlobPart], { type: format === 'png' ? 'image/png' : 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  try {
    await browser.downloads.download({ url, filename, conflictAction: 'uniquify' });
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
  return filename;
}

/* ------------------------------------------------------------------ charts */

type Opt = Record<string, unknown>;
const arr = (v: unknown): Opt[] => (Array.isArray(v) ? (v as Opt[]) : v ? [v as Opt] : []);
const plus = (v: unknown, d: number) => (typeof v === 'number' ? v + d : v);

/**
 * The on-screen chart's option, restyled for print: white, dark text, no tooltip or zoom
 * slider (the zoomed range is kept), and room for a title above and a source line below.
 */
export function printOption(option: Opt, title: string, caption: string): Opt {
  const text = { fontFamily: FONT_BODY, color: PRINT.ink, fontSize: 12 };
  const axis = (a: Opt) => ({
    ...a,
    axisLabel: { ...(a.axisLabel as Opt), color: PRINT.ink2 },
    axisLine: { ...(a.axisLine as Opt), lineStyle: { ...((a.axisLine as Opt)?.lineStyle as Opt), color: PRINT.axis } },
    axisTick: { ...(a.axisTick as Opt), lineStyle: { ...((a.axisTick as Opt)?.lineStyle as Opt), color: PRINT.axis } },
    splitLine: { ...(a.splitLine as Opt), lineStyle: { ...((a.splitLine as Opt)?.lineStyle as Opt), color: PRINT.grid } },
    nameTextStyle: { ...(a.nameTextStyle as Opt), color: PRINT.ink2 },
  });
  const hadSlider = arr(option.dataZoom).some((z) => z.type === 'slider' && z.show !== false);
  return {
    ...option,
    animation: false,
    backgroundColor: PRINT.paper,
    textStyle: text,
    title: [
      { text: title, left: 16, top: 12, textStyle: { fontFamily: FONT_BODY, fontSize: 15, fontWeight: 600, color: PRINT.ink } },
      { text: caption, left: 16, bottom: 10, textStyle: { fontFamily: FONT_BODY, fontSize: 10, fontWeight: 'normal', color: PRINT.ink2, width: 660, overflow: 'break' } },
    ],
    tooltip: { show: false },
    grid: arr(option.grid).map((g) => ({ ...g, top: plus(g.top, 36), bottom: plus(g.bottom, hadSlider ? 4 : 36) })),
    legend: arr(option.legend).map((l) => ({ ...l, top: plus(l.top ?? 0, 36), textStyle: { ...(l.textStyle as Opt), color: PRINT.ink } })),
    xAxis: arr(option.xAxis).map(axis),
    yAxis: arr(option.yAxis).map(axis),
    dataZoom: arr(option.dataZoom).map((z) => ({ ...z, show: false })),
  };
}

/** Draw the chart again off screen at print size and save it. Returns the saved path. */
export async function exportChart(chart: echarts.EChartsType, opts: { title: string; caption: string; name: string; format: FigureFormat }): Promise<string> {
  // 7 inches wide at 300 dpi (a full journal page width), keeping the on-screen aspect ratio.
  const width = 700;
  const height = Math.round(Math.min(560, Math.max(320, (width * chart.getHeight()) / Math.max(1, chart.getWidth()))) + 64);
  const host = document.body.appendChild(document.createElement('div'));
  host.style.cssText = `position:fixed;left:-10000px;top:0;width:${width}px;height:${height}px`;
  const print = echarts.init(host, null, { renderer: opts.format === 'svg' ? 'svg' : 'canvas', width, height, devicePixelRatio: FIGURE_DPI / 100 });
  try {
    print.setOption(printOption(chart.getOption() as Opt, opts.title, opts.caption));
    const url = print.getDataURL({ type: opts.format, pixelRatio: FIGURE_DPI / 100, backgroundColor: PRINT.paper });
    const data = opts.format === 'png' ? withPngDpi(dataUrlBytes(url)) : dataUrlText(url);
    return await saveFigure(opts.name, opts.format, data);
  } finally {
    print.dispose();
    host.remove();
  }
}

export { dataUrlBytes };
