/**
 * The map as a publication figure: the current view re-rendered at print resolution, with a
 * title, legend, scale bar, north arrow, reservoir names and a source line, saved as a 300 dpi PNG.
 */
import type { Map as MlMap } from 'maplibre-gl';
import { FIGURE_DPI, PRINT, saveFigure, withPngDpi } from '@/lib/figure';
import { FONT_BODY, token } from '@/lib/tokens';
import type { MapPreview } from './MapView';
import { LEVEL_TOKENS, NO_DATA_TOKEN, QUALITY_CLASSES, levelStops } from './symbology';

export interface MapFigure {
  title: string;
  /** Second line, e.g. the pass or the day shown. */
  subtitle?: string;
  preview?: MapPreview;
  labels?: { name: string; lngLat: [number, number] }[];
  name: string;
}

/** 1, 2 or 5 × 10ⁿ metres: the longest such length that fits in `maxM`. */
export function niceLength(maxM: number): number {
  const p = 10 ** Math.floor(Math.log10(maxM));
  return [5, 2, 1].map((m) => m * p).find((v) => v <= maxM) ?? p;
}

const metresPerPixel = (lat: number, zoom: number) => (40_075_016.686 * Math.cos((lat * Math.PI) / 180)) / (512 * 2 ** zoom);

/** Hover and pin highlights belong on screen, not in the figure: lift them for the capture. */
function liftHighlights(map: MlMap): () => void {
  const saved: { source: string; id: number; state: Record<string, unknown> }[] = [];
  for (const source of ['preview-lakes', 'preview-reaches', 'preview-nodes']) {
    if (!map.getSource(source)) continue;
    const ids = new Set(map.querySourceFeatures(source).map((f) => f.id).filter((id): id is number => typeof id === 'number'));
    for (const id of ids) {
      const state = map.getFeatureState({ source, id });
      if (state.hover || state.pinned) {
        saved.push({ source, id, state });
        map.setFeatureState({ source, id }, { hover: false, pinned: false });
      }
    }
  }
  return () => saved.forEach(({ source, id, state }) => map.getSource(source) && map.setFeatureState({ source, id }, state));
}

/** The largest canvas side this GPU can draw (MapLibre's own cap is 4096), up to 8192. */
function gpuCanvasLimit(map: MlMap): number {
  const canvas = map.getCanvas();
  const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
  if (!gl) return 4096;
  return Math.min(8192, gl.getParameter(gl.MAX_TEXTURE_SIZE) as number, gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) as number);
}

async function captureAt(map: MlMap, ratio: number, limit: number): Promise<HTMLImageElement> {
  const before = map.getPixelRatio();
  const maxBefore = map._maxCanvasSize;
  const restore = liftHighlights(map);
  // Let the canvas grow past MapLibre's default 4096 px just for the capture; otherwise it quietly
  // lowers the pixel ratio (and warns "The canvas is larger than maxCanvasSize").
  map._maxCanvasSize = [limit, limit];
  map.setPixelRatio(ratio);
  try {
    await new Promise<void>((r) => (map.loaded() && map.areTilesLoaded() ? r() : map.once('idle', () => r())));
    // Read the frame inside the render event, before WebGL clears the drawing buffer.
    const url = await new Promise<string>((r) => {
      map.once('render', () => r(map.getCanvas().toDataURL('image/png')));
      map.triggerRepaint();
    });
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    map._maxCanvasSize = maxBefore;
    map.setPixelRatio(before);
    restore();
  }
}

function legend(ctx: CanvasRenderingContext2D, p: MapPreview, right: number, bottom: number) {
  const pad = 10;
  const w = 200;
  const rows = p.colorBy === 'wse' ? 0 : QUALITY_CLASSES.length + 1;
  const h = p.colorBy === 'wse' ? 64 : 30 + rows * 17;
  const x = right - w;
  const y = bottom - h;
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.strokeStyle = PRINT.axis;
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 4);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = PRINT.ink;
  ctx.font = `600 11px ${FONT_BODY}`;
  ctx.textBaseline = 'top';
  ctx.fillText(p.colorBy === 'wse' ? 'Water surface elevation (m)' : 'SWOT quality flag', x + pad, y + pad);
  ctx.font = `10px ${FONT_BODY}`;
  if (p.colorBy === 'wse') {
    const gx = x + pad;
    const gy = y + 28;
    const gw = w - 2 * pad;
    const grad = ctx.createLinearGradient(gx, 0, gx + gw, 0);
    LEVEL_TOKENS.forEach((t, i) => grad.addColorStop(i / (LEVEL_TOKENS.length - 1), token(t)));
    ctx.fillStyle = grad;
    ctx.fillRect(gx, gy, gw, 10);
    const stops = levelStops(p.wseRange ?? [0, 1]);
    ctx.fillStyle = PRINT.ink2;
    stops.forEach((v, i) => {
      const tx = gx + (gw * i) / (stops.length - 1);
      ctx.textAlign = i === 0 ? 'left' : i === stops.length - 1 ? 'right' : 'center';
      ctx.fillText(v.toFixed(stops.at(-1)! - stops[0]! < 5 ? 2 : 1), tx, gy + 14);
    });
    ctx.textAlign = 'left';
  } else {
    [...QUALITY_CLASSES.map((q) => [`${q.code} · ${q.label}`, q.token] as const), ['No flag', NO_DATA_TOKEN] as const].forEach(([label, t], i) => {
      const ry = y + 28 + i * 17;
      ctx.fillStyle = token(t);
      ctx.fillRect(x + pad, ry, 16, 10);
      ctx.fillStyle = PRINT.ink;
      ctx.fillText(label, x + pad + 24, ry);
    });
  }
}

function scaleBar(ctx: CanvasRenderingContext2D, map: MlMap, left: number, bottom: number, mapWidth: number) {
  const mpp = metresPerPixel(map.getCenter().lat, map.getZoom());
  const metres = niceLength(mpp * mapWidth * 0.25);
  const px = metres / mpp;
  const y = bottom - 14;
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.fillRect(left - 8, y - 18, px + 22, 30);
  for (let i = 0; i < 4; i++) {
    ctx.fillStyle = i % 2 ? '#ffffff' : PRINT.ink;
    ctx.fillRect(left + (px * i) / 4, y, px / 4, 5);
  }
  ctx.strokeStyle = PRINT.ink;
  ctx.lineWidth = 0.75;
  ctx.strokeRect(left, y, px, 5);
  ctx.fillStyle = PRINT.ink;
  ctx.font = `10px ${FONT_BODY}`;
  ctx.textBaseline = 'bottom';
  ctx.textAlign = 'left';
  ctx.fillText('0', left - 2, y - 2);
  ctx.textAlign = 'right';
  ctx.fillText(metres >= 1000 ? `${metres / 1000} km` : `${metres} m`, left + px + 6, y - 2);
  ctx.textAlign = 'left';
}

function northArrow(ctx: CanvasRenderingContext2D, bearing: number, cx: number, cy: number) {
  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.beginPath();
  ctx.arc(cx, cy, 18, 0, Math.PI * 2);
  ctx.fill();
  ctx.translate(cx, cy);
  ctx.rotate((-bearing * Math.PI) / 180);
  ctx.fillStyle = PRINT.ink;
  ctx.beginPath();
  ctx.moveTo(0, -12);
  ctx.lineTo(6, 6);
  ctx.lineTo(0, 2);
  ctx.lineTo(-6, 6);
  ctx.closePath();
  ctx.fill();
  ctx.font = `600 9px ${FONT_BODY}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText('N', 0, 7);
  ctx.restore();
}

/** Lines of `text` no wider than `width`. */
function wrap(ctx: CanvasRenderingContext2D, text: string, width: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > width && line) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  return line ? [...lines, line] : lines;
}

export async function exportMapFigure(map: MlMap, fig: MapFigure): Promise<string> {
  const canvasEl = map.getCanvas();
  const w = canvasEl.clientWidth;
  const h = canvasEl.clientHeight;
  // 300 dpi for a figure printed at its on-screen size in CSS inches, within the GPU's canvas limit.
  const limit = gpuCanvasLimit(map);
  const ratio = Math.min(FIGURE_DPI / 96, Math.floor(limit / Math.max(w, h) * 100) / 100);
  const img = await captureAt(map, ratio, limit);

  const margin = 16;
  const head = fig.subtitle ? 52 : 36;
  const out = document.createElement('canvas');
  const measure = out.getContext('2d')!;
  measure.font = `10px ${FONT_BODY}`;
  const attribution = map.getContainer().querySelector('.maplibregl-ctrl-attrib-inner')?.textContent?.trim();
  const caption = [
    fig.preview ? 'SWOT L2 HR LakeSP / RiverSP Version D (NASA/CNES, PO.DAAC)' : null,
    attribution ? `Basemap: ${attribution}` : null,
    `SWOT Explorer, ${new Date().toISOString().slice(0, 10)}`,
  ]
    .filter(Boolean)
    .join(' · ');
  const captionLines = wrap(measure, caption, w);
  const foot = 12 + captionLines.length * 14;
  const W = w + 2 * margin;
  const H = head + h + foot + margin;
  out.width = Math.round(W * ratio);
  out.height = Math.round(H * ratio);
  const ctx = out.getContext('2d')!;
  ctx.scale(ratio, ratio);

  ctx.fillStyle = PRINT.paper;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = PRINT.ink;
  ctx.textBaseline = 'top';
  ctx.font = `600 16px ${FONT_BODY}`;
  ctx.fillText(fig.title, margin, margin);
  if (fig.subtitle) {
    ctx.font = `12px ${FONT_BODY}`;
    ctx.fillStyle = PRINT.ink2;
    ctx.fillText(fig.subtitle, margin, margin + 22);
  }

  const top = head + 4;
  ctx.drawImage(img, margin, top, w, h);

  // Reservoir names (HTML markers on screen, so not in the WebGL image).
  ctx.font = `500 11px ${FONT_BODY}`;
  ctx.textAlign = 'center';
  // Like the screen, names only appear once zoomed in enough for them not to collide.
  for (const l of map.getZoom() >= 5.5 ? (fig.labels ?? []) : []) {
    const p = map.project(l.lngLat);
    if (p.x < 0 || p.y < 0 || p.x > w || p.y > h) continue;
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(27,26,23,0.85)';
    ctx.strokeText(l.name, margin + p.x, top + p.y + 10);
    ctx.fillStyle = '#f6f4ef';
    ctx.fillText(l.name, margin + p.x, top + p.y + 10);
  }
  ctx.textAlign = 'left';

  northArrow(ctx, map.getBearing(), margin + w - 28, top + 28);
  scaleBar(ctx, map, margin + 14, top + h - 8, w);
  if (fig.preview) legend(ctx, fig.preview, margin + w - 10, top + h - 10);
  ctx.strokeStyle = PRINT.axis;
  ctx.lineWidth = 0.75;
  ctx.strokeRect(margin, top, w, h);

  ctx.font = `10px ${FONT_BODY}`;
  ctx.fillStyle = PRINT.ink2;
  ctx.textBaseline = 'top';
  captionLines.forEach((line, i) => ctx.fillText(line, margin, top + h + 8 + i * 14));

  const blob = await new Promise<Blob>((r, reject) => out.toBlob((b) => (b ? r(b) : reject(new Error('The map image could not be encoded.'))), 'image/png'));
  const png = withPngDpi(new Uint8Array(await blob.arrayBuffer()));
  return saveFigure(fig.name, 'png', png);
}
