import type { Feature, FeatureCollection, MultiPolygon, Polygon } from 'geojson';
import { ChevronDown, ChevronUp, Eye, EyeOff, Layers } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { isArchiveFileCached } from '@/api/archive';
import type { GranuleRef } from '@/api/cmr';
import { Button, Card, Check, Field, IconButton, Notice, Section, Select } from '@/components/ui';
import type { FieldMap } from '@/clip/fieldMeta';
import reservoirsConfig from '@/config/reservoirs.json';
import { fmtSize } from '@/lib/format';
import type { MapPreview, PreviewKind } from '@/map/MapView';
import { levelRange } from '@/map/symbology';
import { findPassGranule, LAYERS, loadPreviewLayer, passesOf, type PassKey, type PreviewLayer } from '@/preview/passPreview';
import type { GranuleResult } from '@/search/searchProduct';
import { completeOrder, useLayers } from '@/state/layers';
import { PreviewLegend } from './PreviewLegend';

const KINDS: PreviewKind[] = ['lakes', 'reaches', 'nodes'];
/** Layer-store ids of the three SWOT layers; their order is shared with the map's Layers menu. */
const SWOT_GROUPS = KINDS.map((k) => `preview-${k}`);

/** Names for the reservoirs we know, since many PLD lakes have no name (GERD among them). */
const KNOWN_LAKES = new Map(reservoirsConfig.reservoirs.map((r) => [r.lake_id, r.name]));

export type Describe = (kind: PreviewKind, p: Record<string, unknown>) => { title: string; rows: [string, string][] };

const passLabel = (p: PassKey) => `${(p.start ?? '').slice(0, 10)} · Cycle ${Number(p.cycle)} · Pass ${Number(p.pass)}`;

function fmt(v: unknown, digits = 2): string {
  if (v === null || v === undefined || v === '') return '–';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(digits);
  return String(v);
}

/** Popup rows, with units from the product's own field descriptions. */
function makeDescribe(fields: Partial<Record<PreviewKind, FieldMap>>): Describe {
  return (kind, p) => {
    const unit = (k: string) => fields[kind]?.get(k)?.units ?? '';
    const value = (k: string, digits = 2) => {
      const v = fmt(p[k], digits);
      const u = unit(k);
      return v === '–' || !u || u === '1' ? v : `${v} ${u.replace('km^2', 'km²').replace('m^2', 'm²')}`;
    };
    const level = p.wse === null || p.wse === undefined ? '–' : `${value('wse')}${p.wse_u !== null && p.wse_u !== undefined ? ` ± ${fmt(p.wse_u)}` : ''}`;
    const inside = `${Math.round(Number(p.clip_fraction ?? 1) * 100)} %`;
    // Pass history frames mark levels measured on an earlier day, or none at all.
    const qc =
      p.qc_reason === 'measured_earlier'
        ? 'passes (measured on an earlier day)'
        : p.qc_reason === 'not_observed'
          ? 'no level in the last 21 days'
          : p.qc_pass === true
            ? 'passes'
            : `fails (${String(p.qc_reason ?? '').replace(/_/g, ' ')})`;
    const time = String(p.time_str ?? '').replace('T', ' ').replace('Z', ' UTC');

    if (kind === 'lakes')
      return {
        title: KNOWN_LAKES.get(String(p.lake_id)) ?? (String(p.lake_name || '').split(';')[0] || `Lake ${fmt(p.lake_id)}`),
        rows: [
          ['Lake ID', fmt(p.lake_id)],
          ['Water level', level],
          ['Water area (whole lake)', value('area_total')],
          ['Quality flag', fmt(p.quality_f)],
          ['Inside your area', inside],
          ['Quality control', qc],
          ['Observed', time || '–'],
        ],
      };
    if (kind === 'reaches')
      return {
        title: String(p.river_name || 'Unnamed river').split(';')[0]!,
        rows: [
          ['Reach ID', fmt(p.reach_id)],
          ['Water level', level],
          ['Width', value('width', 0)],
          ['Slope', value('slope', 6)],
          ['Quality flag', fmt(p.reach_q)],
          ['Inside your area', inside],
          ['Quality control', qc],
          ['Observed', time || '–'],
        ],
      };
    return {
      title: `Node ${fmt(p.node_id)}`,
      rows: [
        ['Reach ID', fmt(p.reach_id)],
        ['River', String(p.river_name || '–').split(';')[0]!],
        ['Water level', level],
        ['Width', value('width', 0)],
        ['Quality flag', fmt(p.node_q)],
        ['Quality control', qc],
        ['Observed', time || '–'],
      ],
    };
  };
}

export function PreviewPanel({
  granules,
  area,
  onPreview,
}: {
  granules: GranuleResult[];
  area: Feature<Polygon | MultiPolygon>;
  onPreview: (preview: MapPreview | undefined, describe: Describe | undefined) => void;
}) {
  const passes = useMemo(() => passesOf(granules), [granules]);
  const [passId, setPassId] = useState(0);
  const pass = passes[passId] ?? null;
  const [want, setWant] = useState<Record<PreviewKind, boolean>>({ lakes: true, reaches: true, nodes: false });
  const [files, setFiles] = useState<Partial<Record<PreviewKind, GranuleRef | null>>>({});
  const [layers, setLayers] = useState<Partial<Record<PreviewKind, PreviewLayer>>>({});
  const [visible, setVisible] = useState(true);
  const [colorBy, setColorBy] = useState<MapPreview['colorBy']>('wse');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const layerOrder = useLayers((st) => st.order);
  const moveLayer = useLayers((st) => st.move);
  const orderedKinds = useMemo(
    () => completeOrder(layerOrder).filter((id) => SWOT_GROUPS.includes(id)).map((id) => id.replace('preview-', '') as PreviewKind),
    [layerOrder],
  );

  // Look up the three files for the chosen pass, to show their sizes before downloading anything.
  useEffect(() => {
    if (!pass) return;
    const ctl = new AbortController();
    setFiles({});
    void Promise.all(KINDS.map(async (k) => [k, await findPassGranule(k, pass, ctl.signal).catch(() => null)] as const)).then((entries) => {
      if (!ctl.signal.aborted) setFiles(Object.fromEntries(entries));
    });
    return () => ctl.abort();
  }, [pass?.cycle, pass?.pass, pass?.continent]);

  // Colours span the 2nd–98th percentile of levels, so one outlier doesn't wash out the rest.
  const levels = useMemo(
    () =>
      levelRange(
        Object.values(layers).flatMap((l) => (l ? l.features.map((f) => f.properties?.wse).filter((v): v is number => typeof v === 'number') : [])),
      ),
    [layers],
  );
  const wseRange = levels?.range ?? null;

  // Push to the map whenever data, colouring or visibility changes.
  useEffect(() => {
    const loaded = Object.values(layers).filter(Boolean) as PreviewLayer[];
    if (!loaded.length || !visible) return onPreview(undefined, undefined);
    const fc = (l: PreviewLayer): FeatureCollection => ({ type: 'FeatureCollection', features: l.features });
    onPreview(
      { layers: Object.fromEntries(loaded.map((l) => [l.kind, fc(l)])), colorBy, wseRange },
      makeDescribe(Object.fromEntries(loaded.map((l) => [l.kind, l.fields]))),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layers, colorBy, wseRange, visible]);

  // When the results go away: stop downloads and clear the map.
  useEffect(
    () => () => {
      abort.current?.abort();
      onPreview(undefined, undefined);
    },
    [],
  );

  if (!passes.length)
    return (
      <Section eyebrow="Before you download" title="Preview">
        <Notice>Search a River or Lake product to preview the lakes, reaches and nodes of a pass inside your study area.</Notice>
      </Section>
    );

  const show = async () => {
    if (!pass) return;
    abort.current?.abort();
    abort.current = new AbortController();
    setLoading(true);
    setError(null);
    setLayers({});
    setVisible(true);
    try {
      const kinds = KINDS.filter((k) => want[k]);
      const results = await Promise.all(kinds.map((k) => loadPreviewLayer(k, pass, area, abort.current!.signal)));
      setLayers(Object.fromEntries(results.map((r) => [r.kind, r])));
    } catch (err) {
      if (!abort.current.signal.aborted) setError(err instanceof Error ? err.message : 'The preview could not be loaded.');
    } finally {
      setLoading(false);
    }
  };

  const toDownload = KINDS.filter((k) => want[k] && files[k] && !isArchiveFileCached(files[k]!.url)).reduce((s, k) => s + (files[k]?.sizeBytes ?? 0), 0);
  const hasData = Object.keys(layers).length > 0;

  return (
    <Section
      eyebrow="Before you download"
      title="Preview on the map"
      actions={
        hasData && (
          <Button variant="ghost" icon={visible ? EyeOff : Eye} onClick={() => setVisible((v) => !v)}>
            {visible ? 'Hide' : 'Show'}
          </Button>
        )
      }
    >
      <p className="text-meta text-ink-2">
        See the lakes, river reaches and nodes SWOT measured inside your polygon on one pass, then click any of them for its values.
      </p>

      <Field label="Pass">
        <Select value={passId} onChange={(e) => setPassId(Number(e.target.value))}>
          {passes.map((p, i) => (
            <option key={`${p.cycle}_${p.pass}_${p.continent}`} value={i}>
              {passLabel(p)}
            </option>
          ))}
        </Select>
      </Field>

      <fieldset className="space-y-1">
        <legend className="mb-1 text-meta font-medium text-ink-2">Layers · top is drawn on top</legend>
        <ol className="divide-y divide-line border-y border-line">
          {orderedKinds.map((k, i) => (
            <li key={k} className="flex items-center gap-2 py-1">
              <Check
                className="min-w-0 flex-1"
                checked={want[k]}
                onChange={(e) => setWant((w) => ({ ...w, [k]: e.target.checked }))}
                label={
                  <>
                    {LAYERS[k].label}
                    <span className="tabular ml-2 text-ink-3">
                      {files[k] === undefined
                        ? '…'
                        : files[k] === null
                          ? 'not available'
                          : isArchiveFileCached(files[k]!.url)
                            ? 'loaded'
                            : files[k]!.sizeBytes
                              ? fmtSize(files[k]!.sizeBytes!)
                              : ''}
                    </span>
                  </>
                }
              />
              <IconButton
                icon={ChevronUp}
                label={`Move ${LAYERS[k].label} up`}
                disabled={i === 0}
                className="disabled:opacity-30"
                onClick={() => moveLayer(`preview-${k}`, -1, SWOT_GROUPS)}
              />
              <IconButton
                icon={ChevronDown}
                label={`Move ${LAYERS[k].label} down`}
                disabled={i === orderedKinds.length - 1}
                className="disabled:opacity-30"
                onClick={() => moveLayer(`preview-${k}`, 1, SWOT_GROUPS)}
              />
            </li>
          ))}
        </ol>
      </fieldset>

      <Button variant="primary" icon={Layers} disabled={loading || !KINDS.some((k) => want[k])} onClick={() => void show()}>
        {loading ? 'Loading…' : toDownload ? `Show on map · ${fmtSize(toDownload)}` : 'Show on map'}
      </Button>
      {want.nodes && <p className="text-meta text-ink-3">Node files are large; they can take a minute on a slow connection.</p>}
      {error && <Notice tone="error">{error}</Notice>}

      {hasData && (
        <Card className="p-6">
          <PreviewLegend
            layers={KINDS.filter((k) => layers[k]).map((k) => layers[k]!)}
            colorBy={colorBy}
            onColorBy={setColorBy}
            levels={levels}
          />
        </Card>
      )}
    </Section>
  );
}
