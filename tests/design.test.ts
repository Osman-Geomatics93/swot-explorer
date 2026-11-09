import { Droplets } from 'lucide-react';
import { describe, expect, it } from 'vitest';
import { matchCommands, type Command } from '@/features/shell/CommandPalette';
import { crc32, printOption, withPngDpi } from '@/lib/figure';
import { niceLength } from '@/map/exportMap';
import type { MapPreview } from '@/map/MapView';
import { frameAt, historyKey, obsAt, timelineDays, toObs } from '@/preview/timeline';
import type { SeriesPoint } from '@/timeseries/featureSeries';
import { ageLabel, lakeOverview } from '@/timeseries/overview';

const pt = (time: string, wse: number | null, qcPass = true, flag: number | null = 0): SeriesPoint => ({
  time,
  wse,
  wse_u: 0.05,
  area_total: null,
  width: null,
  discharge: null,
  flag,
  partial: null,
  qcPass,
});

describe('reservoir overview', () => {
  const now = Date.parse('2026-11-07T00:00:00Z');
  it('takes the latest passing level and the change since the pass before', () => {
    const o = lakeOverview([pt('2026-10-01T10:00:00Z', 480.1), pt('2026-10-20T10:00:00Z', 480.5), pt('2026-11-01T10:00:00Z', 470, false)], now);
    expect(o.latest).toEqual({ time: '2026-10-20T10:00:00Z', wse: 480.5 });
    expect(o.changeM).toBeCloseTo(0.4);
    expect(o.ageDays).toBe(17);
    expect(o.qcShare).toBeCloseTo(2 / 3);
    expect(o.grade).toBe('insufficient');
  });
  it('keeps one year before the latest pass for the sparkline', () => {
    const o = lakeOverview([pt('2024-01-01T00:00:00Z', 1), pt('2025-06-01T00:00:00Z', 2), pt('2026-01-01T00:00:00Z', 3)], now);
    expect(o.year.map((p) => p.wse)).toEqual([2, 3]);
  });
  it('has nothing to show without a passing level', () => {
    const o = lakeOverview([pt('2026-10-01T00:00:00Z', null)], now);
    expect(o.latest).toBeNull();
    expect(o.changeM).toBeNull();
  });
  it('words the age of the latest pass', () => {
    expect(ageLabel(0)).toBe('today');
    expect(ageLabel(1)).toBe('yesterday');
    expect(ageLabel(5)).toBe('5 days ago');
    expect(ageLabel(21)).toBe('3 weeks ago');
    expect(ageLabel(90)).toBe('3 months ago');
  });
});

describe('pass timeline', () => {
  const DAY = 86_400_000;
  const h = toObs([pt('2025-01-10T08:00:00Z', 420), pt('2025-01-31T08:00:00Z', 421, true, 1), pt('2025-02-05T08:00:00Z', 999, false)]);
  const d = (iso: string) => Date.parse(`${iso}T00:00:00Z`);

  it('keeps passing levels only, one entry per day', () => {
    expect(h.map((o) => o.wse)).toEqual([420, 421]);
    expect(h[0]!.day).toBe(d('2025-01-10'));
  });
  it('holds a level for 21 days after it was measured', () => {
    expect(obsAt(h, d('2025-01-09'))).toBeNull();
    expect(obsAt(h, d('2025-01-10'))?.wse).toBe(420);
    expect(obsAt(h, d('2025-01-31') - DAY)?.wse).toBe(420);
    expect(obsAt(h, d('2025-01-31'))?.wse).toBe(421);
    expect(obsAt(h, d('2025-02-22'))).toBeNull();
  });
  it('lists every observed day across features', () => {
    const other = toObs([pt('2025-01-20T08:00:00Z', 300)]);
    expect(timelineDays(new Map([['a', h], ['b', other]]))).toEqual([d('2025-01-10'), d('2025-01-20'), d('2025-01-31')]);
  });
  it('recolours features for a day: full when measured that day, faint when earlier, none when stale', () => {
    const lake = (id: string) => ({ type: 'Feature' as const, geometry: { type: 'Point' as const, coordinates: [0, 0] }, properties: { lake_id: id, wse: 1 } });
    const preview: MapPreview = { layers: { lakes: { type: 'FeatureCollection', features: [lake('A'), lake('B'), lake('C')] } }, colorBy: 'wse', wseRange: [0, 1] };
    const histories = new Map([
      [historyKey('lakes', 'A'), h],
      [historyKey('lakes', 'B'), toObs([pt('2025-01-20T08:00:00Z', 300)])],
    ]);
    const f = frameAt(preview, histories, d('2025-01-31'), (_k, p) => String(p.lake_id), [410, 430]);
    const props = f.preview.layers.lakes!.features.map((x) => x.properties!);
    expect(props.map((p) => p.wse)).toEqual([421, 300, null]);
    expect(props.map((p) => p.qc_pass)).toEqual([true, false, false]);
    expect(props[0]!.quality_f).toBe(1);
    expect(f).toMatchObject({ observed: 1, shown: 2 });
    expect(f.preview.wseRange).toEqual([410, 430]);
  });
});

describe('publication figures', () => {
  it('computes the PNG CRC-32', () => {
    expect(crc32(new TextEncoder().encode('IEND'))).toBe(0xae426082);
  });
  it('writes 300 dpi into the PNG right after IHDR', () => {
    const png = new Uint8Array(8 + 25 + 12);
    png.set([0x49, 0x48, 0x44, 0x52], 12); // IHDR
    const out = withPngDpi(png);
    expect(out.length).toBe(png.length + 21);
    expect(new TextDecoder().decode(out.subarray(37, 41))).toBe('pHYs');
    const view = new DataView(out.buffer);
    expect(view.getUint32(41)).toBe(11811); // pixels per metre at 300 dpi
    expect(out[49]).toBe(1);
    expect(view.getUint32(50)).toBe(crc32(out.subarray(37, 50)));
  });
  it('restyles a chart for print and keeps its zoomed range without the slider', () => {
    const o = printOption(
      {
        grid: [{ top: 40, bottom: 52 }],
        xAxis: [{ type: 'time' }],
        yAxis: [{ type: 'value', axisLabel: { formatter: 'x' } }],
        dataZoom: [{ type: 'slider', start: 20, end: 80 }],
        tooltip: [{ trigger: 'axis' }],
      },
      'Title',
      'Source',
    );
    expect(o.backgroundColor).toBe('#ffffff');
    expect(o.tooltip).toEqual({ show: false });
    expect(o.dataZoom).toEqual([{ type: 'slider', start: 20, end: 80, show: false }]);
    expect((o.grid as { top: number }[])[0]!.top).toBe(76);
    expect((o.yAxis as { axisLabel: { formatter: string; color: string } }[])[0]!.axisLabel).toEqual({ formatter: 'x', color: '#57534b' });
    expect((o.title as { text: string }[]).map((t) => t.text)).toEqual(['Title', 'Source']);
  });
  it('picks a round scale-bar length', () => {
    expect(niceLength(7300)).toBe(5000);
    expect(niceLength(2500)).toBe(2000);
    expect(niceLength(180)).toBe(100);
    expect(niceLength(1)).toBe(1);
  });
});

describe('command palette search', () => {
  const cmd = (label: string, group: string, keywords?: string): Command => ({ id: label, label, group, keywords, icon: Droplets, run: () => undefined });
  const all = [cmd('Roseires Dam', 'Reservoirs', 'Sudan gauge validation'), cmd('GERD', 'Reservoirs', 'Ethiopia'), cmd('Hide basemap', 'Map', 'imagery')];
  it('matches word starts in label, group and keywords', () => {
    expect(matchCommands(all, 'ros val').map((c) => c.label)).toEqual(['Roseires Dam']);
    expect(matchCommands(all, 'ethi').map((c) => c.label)).toEqual(['GERD']);
    expect(matchCommands(all, 'map').map((c) => c.label)).toEqual(['Hide basemap']);
    expect(matchCommands(all, '')).toHaveLength(3);
    expect(matchCommands(all, 'zzz')).toHaveLength(0);
  });
});
