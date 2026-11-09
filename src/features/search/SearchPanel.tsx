import type { FeatureCollection } from 'geojson';
import { Bookmark, Check as CheckIcon, CircleAlert, Download, FileCode2, FileText, ListOrdered, Scissors, Search, SearchX, Terminal } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Card, Check, Empty, Field, Input, Menu, MenuItem, Notice, Progress, Section, Select, cx } from '@/components/ui';
import { clipGranules, type ClipProgress, type ClipSummary, type QcMode } from '@/clip/clipVector';
import { buildTable, dictionary, type ColumnSet } from '@/clip/table';
import { findProduct, PRODUCTS } from '@/config/products';
import { queue, useQueue } from '@/downloads/queueClient';
import { bashScript, powershellScript, pythonClipScript, saveText, urlList, type ScriptFile } from '@/downloads/scripts';
import { citationMeta } from '@/lib/citation';
import { downloadTable } from '@/lib/exportCsv';
import { fmtSize, slug } from '@/lib/format';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { PreviewPanel, type Describe } from '@/features/preview/PreviewPanel';
import type { MapPreview } from '@/map/MapView';
import { describeRule } from '@/qc/qualityControl';
import { searchProduct, type GranuleResult, type SearchResult } from '@/search/searchProduct';
import { useSearchForm } from '@/state/searchForm';
import { clipPolygon, useStudyAreas } from '@/state/studyArea';
import { addHistory, db, type Period } from '@/storage/db';

const fileOf = (g: GranuleResult) => g.url.split('/').pop()!;
const DAY = 86_400_000;
const monthLabel = (ym: string) =>
  ym ? new Date(`${ym}-01T00:00:00Z`).toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' }) : 'Undated';

export function SearchPanel({
  onFootprints,
  onShowDownloads,
  onPreview,
}: {
  onFootprints: (fc: FeatureCollection | undefined) => void;
  onShowDownloads: () => void;
  onPreview: (preview: MapPreview | undefined, describe: Describe | undefined) => void;
}) {
  const { areas, activeId } = useStudyAreas();
  const area = areas.find((a) => a.id === activeId) ?? null;
  const polygon = area ? clipPolygon(area) : null;

  const form = useSearchForm();
  const { productKey, start, end, cycle, pass } = form;
  const product = findProduct(productKey);

  const [busy, setBusy] = useState<'search' | 'clip' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SearchResult | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [queuedMsg, setQueuedMsg] = useState<string | null>(null);
  const [clipProgress, setClipProgress] = useState<ClipProgress | null>(null);
  const [clipSummary, setClipSummary] = useState<ClipSummary | null>(null);
  const [cut, setCut] = useState(true);
  const [qcMode, setQcMode] = useState<QcMode>('filter');
  const [columnSet, setColumnSet] = useState<ColumnSet>('essential');
  const [saveName, setSaveName] = useState<string | null>(null);
  const [rolling, setRolling] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  const queueState = useQueue();
  const queuedUrls = useMemo(() => new Map(queueState.jobs.map((j) => [j.url, j.state])), [queueState]);

  const granules = result?.granules ?? [];
  const chosen = granules.filter((g) => selected.has(g.id));
  const chosenBytes = chosen.reduce((s, g) => s + (g.sizeBytes ?? 0), 0);
  const spanDays = Math.max(1, Math.round((Date.parse(end) - Date.parse(start)) / DAY));

  const groups = useMemo(() => {
    const m = new Map<string, GranuleResult[]>();
    for (const g of granules) m.set((g.start ?? '').slice(0, 7), [...(m.get((g.start ?? '').slice(0, 7)) ?? []), g]);
    return [...m.entries()];
  }, [granules]);

  const showFootprints = (list: GranuleResult[], sel: Set<string>) =>
    onFootprints({
      type: 'FeatureCollection',
      features: list.flatMap((g) =>
        (g.footprint ?? []).map((ring) => ({
          type: 'Feature' as const,
          geometry: { type: 'Polygon' as const, coordinates: [ring] },
          properties: { id: g.id, selected: sel.has(g.id) },
        })),
      ),
    });

  const updateSelection = (next: Set<string>) => {
    setSelected(next);
    showFootprints(granules, next);
  };

  const run = async () => {
    if (!polygon || !area) return;
    abort.current?.abort(); // a new search replaces any run still going
    const ctl = new AbortController();
    abort.current = ctl;
    setBusy('search');
    setError(null);
    setResult(null);
    setSelected(new Set());
    setQueuedMsg(null);
    setClipSummary(null);
    onFootprints(undefined);
    try {
      const r = await searchProduct(
        { product, area: polygon, start, end, cycle: cycle ? Number(cycle) : undefined, pass: pass ? Number(pass) : undefined },
        ctl.signal,
      );
      if (ctl !== abort.current) return;
      setResult(r);
      const all = new Set(r.granules.map((g) => g.id));
      setSelected(all);
      showFootprints(r.granules, all);
      void addHistory({
        kind: 'search',
        title: `${product.label} · ${area.name}`,
        detail: `${start} → ${end}${cycle ? ` · cycle ${cycle}` : ''}${pass ? ` · pass ${pass}` : ''} · ${r.granules.length} granules`,
        search: {
          productKey,
          area,
          period: { kind: 'fixed', start, end },
          cycle: cycle ? Number(cycle) : undefined,
          pass: pass ? Number(pass) : undefined,
        },
      });
    } catch (err) {
      if (!ctl.signal.aborted) setError(err instanceof Error ? err.message : 'Search failed.');
    } finally {
      if (ctl === abort.current) setBusy(null);
    }
  };

  // Saved searches and history ask for a run by bumping runRequest.
  const lastRun = useRef(form.runRequest);
  useEffect(() => {
    if (form.runRequest === lastRun.current) return;
    lastRun.current = form.runRequest;
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.runRequest, polygon]);

  const enqueue = async () => {
    const added = await queue.add(
      chosen.map((g) => ({
        url: g.url,
        filename: `SWOT/${product.shortName}/${fileOf(g)}`,
        product: product.shortName,
        granule: g.name,
        sizeBytes: g.sizeBytes,
      })),
    );
    const skipped = chosen.length - added;
    setQueuedMsg(`${added} files queued${skipped ? `, ${skipped} were already in the queue` : ''}. They keep downloading after you close this page.`);
    if (added) void addHistory({ kind: 'download', title: `${product.label} · ${area?.name ?? ''}`, detail: `${added} files queued · ${fmtSize(chosenBytes)}` });
  };

  const clip = async () => {
    if (!polygon || !area) return;
    abort.current?.abort();
    const ctl = new AbortController();
    abort.current = ctl;
    setBusy('clip');
    setError(null);
    setClipSummary(null);
    try {
      const { collection, summary, fields } = await clipGranules(chosen, polygon, product, { cut, qcMode }, setClipProgress, ctl.signal);
      setClipSummary(summary);
      if (!collection.features.length) return;
      // One folder per export: data.csv, its README and column dictionary, and the GeoJSON.
      const name = `${slug(area.name)}_${product.key}_${start}_${end}`;
      const base = `SWOT/clipped/${name}/${name}`;
      const meta = {
        product: product.shortName,
        study_area: `${area.name} (${polygon.geometry.type}, coordinates in the GeoJSON file)`,
        period: `${start} to ${end} (UTC)`,
        granules: `${summary.granules} (${summary.failed.length} failed)`,
        geometry: cut
          ? 'cut at the study-area boundary; SWOT values still describe whole features (see clip_fraction)'
          : 'whole features touching the study area',
        quality_control:
          product.qcKind && qcMode !== 'off'
            ? `${describeRule(product.qcKind)} (${qcMode === 'filter' ? 'rejected rows removed' : 'rejected rows kept and flagged in qc_pass'})`
            : 'off',
        columns: columnSet === 'essential' ? 'essential (fields NASA tags Basic) plus identifiers and SWOT Explorer columns' : 'all fields',
        source: 'NASA/CNES SWOT, distributed by PO.DAAC (https://podaac.jpl.nasa.gov/SWOT)',
        generated: `${new Date().toISOString()} by SWOT Explorer`,
        ...(await citationMeta([product.shortName])),
      };
      const table = buildTable(collection, fields, columnSet);
      await downloadTable({ path: base, rows: table.rows, columns: table.columns, meta, dictionary: dictionary(table.columns, fields) });
      await saveText(`${base}.geojson`, JSON.stringify({ ...collection, metadata: meta }), 'application/geo+json');
      void addHistory({ kind: 'clip', title: `${product.label} · ${area.name}`, detail: `${summary.kept} features from ${summary.granules} granules · ${start} → ${end}` });
    } catch (err) {
      if (!ctl.signal.aborted) setError(err instanceof Error ? err.message : 'Clipping failed.');
    } finally {
      if (ctl === abort.current) setBusy(null);
    }
  };

  const exportScript = (kind: 'urls' | 'bash' | 'ps1' | 'python') => {
    const files: ScriptFile[] = chosen.map((g) => ({ url: g.url, path: `${product.shortName}/${fileOf(g)}` }));
    const dir = `SWOT/scripts/${slug(area?.name ?? 'area')}_${product.key}`;
    if (kind === 'urls') void saveText(`${dir}_urls.txt`, urlList(files));
    if (kind === 'bash') void saveText(`${dir}_download.sh`, bashScript(files));
    if (kind === 'ps1') void saveText(`${dir}_download.ps1`, powershellScript(files));
    if (kind === 'python' && polygon) void saveText(`${dir}_clip.py`, pythonClipScript(polygon, files, product.label));
  };

  const saveSearch = async () => {
    if (!area || !saveName?.trim()) return;
    const period: Period = rolling ? { kind: 'last', days: spanDays } : { kind: 'fixed', start, end };
    await db.savedSearches.put({
      id: crypto.randomUUID(),
      name: saveName.trim(),
      productKey,
      area,
      period,
      cycle: cycle ? Number(cycle) : undefined,
      pass: pass ? Number(pass) : undefined,
      createdAt: Date.now(),
    });
    setSaveName(null);
    setSavedMsg(`Saved “${saveName.trim()}”. You'll find it under Saved.`);
  };

  return (
    <div className="space-y-12">
      <Section eyebrow="Step 2" title="What to look for">
        {!polygon && <Notice>Choose a study area first. Points need a buffer above 0 km.</Notice>}

        <div className="grid grid-cols-2 gap-x-3 gap-y-4">
          <Field label="Product" className="col-span-2">
            <Select value={productKey} onChange={(e) => form.set({ productKey: e.target.value })}>
              {(['Rivers', 'Lakes', 'Water mask', 'Ocean'] as const).map((grp) => (
                <optgroup key={grp} label={grp}>
                  {PRODUCTS.filter((p) => p.group === grp).map((p) => (
                    <option key={p.key} value={p.key}>
                      {p.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </Select>
          </Field>
          <Field label="From">
            <Input type="date" value={start} max={end} onChange={(e) => form.set({ start: e.target.value })} />
          </Field>
          <Field label="To">
            <Input type="date" value={end} min={start} onChange={(e) => form.set({ end: e.target.value })} />
          </Field>
          <Field label="Cycle">
            <Input inputMode="numeric" placeholder="Any" value={cycle} onChange={(e) => form.set({ cycle: e.target.value.replace(/\D/g, '') })} />
          </Field>
          <Field label="Pass">
            <Input inputMode="numeric" placeholder="Any" value={pass} onChange={(e) => form.set({ pass: e.target.value.replace(/\D/g, '') })} />
          </Field>
        </div>

        <div className="flex flex-wrap gap-3">
          <Button variant="primary" icon={Search} disabled={!polygon || busy !== null} onClick={() => void run()}>
            {busy === 'search' ? 'Searching…' : 'Search'}
          </Button>
          <Button variant="ghost" icon={Bookmark} disabled={!polygon} onClick={() => setSaveName(saveName === null ? `${product.label} · ${area?.name ?? ''}` : null)}>
            Save search
          </Button>
          {busy && (
            <Button variant="ghost" onClick={() => abort.current?.abort()}>
              Cancel
            </Button>
          )}
        </div>

        {saveName !== null && (
          <Card className="space-y-4 p-6">
            <Field label="Name">
              <Input value={saveName} onChange={(e) => setSaveName(e.target.value)} autoFocus />
            </Field>
            <Check
              checked={rolling}
              onChange={(e) => setRolling(e.target.checked)}
              label={`Keep dates rolling: always search the last ${spanDays} days`}
            />
            <div className="flex gap-3">
              <Button variant="primary" disabled={!saveName.trim()} onClick={() => void saveSearch()}>
                Save
              </Button>
              <Button variant="ghost" onClick={() => setSaveName(null)}>
                Cancel
              </Button>
            </div>
          </Card>
        )}
        {savedMsg && saveName === null && <Notice tone="success">{savedMsg}</Notice>}
        {error && <Notice tone="error">{error}</Notice>}
      </Section>

      {result && (
        <Section eyebrow="Step 3" title={`${granules.length} granules`}>
          {(result.outsideRemoved > 0 || result.duplicatesRemoved > 0 || result.truncated) && (
            <p className="text-meta text-ink-2">
              {[
                result.outsideRemoved && `${result.outsideRemoved} that never observe this area`,
                result.duplicatesRemoved && `${result.duplicatesRemoved} older reprocessed copies`,
              ]
                .filter(Boolean)
                .join(' and ')}
              {(result.outsideRemoved > 0 || result.duplicatesRemoved > 0) && ' were left out.'}
              {result.truncated && ' Results are capped at 2,000; narrow the dates to see everything.'}
            </p>
          )}

          {granules.length === 0 ? (
            <Empty icon={SearchX}>
              <p>No SWOT pass observed this area in these dates. Widen the period or check the cycle and pass.</p>
            </Empty>
          ) : (
            <>
              <div className="flex items-center justify-between gap-3">
                <Check
                  label="Select all"
                  checked={chosen.length === granules.length}
                  onChange={(e) => updateSelection(new Set(e.target.checked ? granules.map((g) => g.id) : []))}
                />
                <span className="tabular text-meta text-ink-2">
                  {chosen.length} selected · {fmtSize(chosenBytes)}
                </span>
              </div>

              <Card className="max-h-80 overflow-auto">
                {groups.map(([month, list]) => (
                  <div key={month}>
                    <div className="sticky top-0 z-[1] flex justify-between bg-surface/95 px-4 py-2 text-eyebrow font-medium tracking-[0.08em] text-ink-3 uppercase backdrop-blur">
                      <span>{monthLabel(month)}</span>
                      <span className="tabular">{list.length}</span>
                    </div>
                    <ul>
                      {list.map((g) => {
                        const qs = queuedUrls.get(g.url);
                        return (
                          <li key={g.id} className="border-t border-line">
                            <label className="flex min-h-10 cursor-pointer items-center gap-3 px-4 text-meta hover:bg-sunken">
                              <input
                                type="checkbox"
                                aria-label={`Select ${g.name}`}
                                checked={selected.has(g.id)}
                                onChange={(e) => {
                                  const next = new Set(selected);
                                  if (e.target.checked) next.add(g.id);
                                  else next.delete(g.id);
                                  updateSelection(next);
                                }}
                              />
                              <span className="tabular w-11 text-ink">{(g.start ?? '').slice(5, 10).replace('-', ' / ')}</span>
                              <span className="tabular text-ink-2">
                                Cycle {Number(g.cycle ?? 0)}
                                {g.pass ? ` · Pass ${Number(g.pass)}` : ''}
                                {g.tile ? ` · ${g.tile}` : ''}
                              </span>
                              <span className="tabular ml-auto text-ink-3">{g.sizeBytes ? fmtSize(g.sizeBytes) : ''}</span>
                              {qs && (
                                <span title={`Download ${qs}`} className={cx('shrink-0', qs === 'done' ? 'text-ok' : qs === 'failed' ? 'text-error' : 'text-ink-3')}>
                                  {qs === 'done' ? <CheckIcon size={14} /> : qs === 'failed' ? <CircleAlert size={14} /> : <Download size={14} />}
                                </span>
                              )}
                            </label>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
              </Card>

              {product.clip && (
                <Card className="space-y-4 p-6">
                  <div className="space-y-1">
                    <h3 className="text-title">Clip & merge</h3>
                    <p className="text-meta text-ink-2">
                      One GeoJSON and one CSV with the {product.group === 'Rivers' ? 'river data' : 'lakes'} inside your polygon, from all selected
                      dates. This is the way to get only data inside your study area.
                    </p>
                  </div>
                  <Check
                    checked={cut}
                    onChange={(e) => setCut(e.target.checked)}
                    label="Keep only the part inside my polygon (cut rivers and lakes at the boundary)"
                  />
                  <p className="text-meta text-ink-3">
                    {cut
                      ? 'Cut features are marked clipped = true with clip_fraction. Their SWOT values (height, width, area) still describe the whole reach or lake.'
                      : 'Whole reaches and lakes that touch your polygon are kept, so some extend outside it.'}
                  </p>
                  {product.qcKind && (
                    <Field label="Quality control" hint={qcMode !== 'off' ? describeRule(product.qcKind) : undefined}>
                      <Select value={qcMode} onChange={(e) => setQcMode(e.target.value as QcMode)}>
                        <option value="filter">Remove rejected rows</option>
                        <option value="flag">Keep all rows, add a qc_pass column</option>
                        <option value="off">Off</option>
                      </Select>
                    </Field>
                  )}
                  <Field label="CSV columns" hint={columnSet === 'essential' ? 'The fields NASA tags as Basic (about 50 for rivers), plus IDs, location and quality columns.' : 'Every field in the SWOT product (about 130 for rivers).'}>
                    <Select value={columnSet} onChange={(e) => setColumnSet(e.target.value as ColumnSet)}>
                      <option value="essential">Essential</option>
                      <option value="all">All fields</option>
                    </Select>
                  </Field>
                  {clipProgress && busy === 'clip' && (
                    <Progress
                      value={clipProgress.done}
                      max={clipProgress.total}
                      label={`${clipProgress.done} of ${clipProgress.total} granules · ${clipProgress.features} features${clipProgress.failed ? ` · ${clipProgress.failed} failed` : ''}. Keep this page open.`}
                    />
                  )}
                  {clipSummary && (
                    <Notice tone={clipSummary.kept ? 'success' : 'warning'}>
                      {clipSummary.kept ? `Saved ${clipSummary.kept} rows to Downloads/SWOT/clipped: a CSV with its README and column dictionary, and a GeoJSON for GIS.` : 'No features inside the study area passed the filters.'}
                      {Object.keys(clipSummary.rejected).length > 0 &&
                        ` Quality control rejected ${Object.entries(clipSummary.rejected)
                          .map(([k, v]) => `${v} (${k.replace(/_/g, ' ')})`)
                          .join(', ')}.`}
                      {clipSummary.failed.length > 0 && ` ${clipSummary.failed.length} granules failed: ${clipSummary.failed[0]!.error}`}
                    </Notice>
                  )}
                </Card>
              )}

              <div className="flex flex-wrap gap-3">
                {product.clip ? (
                  <>
                    <Button variant="primary" icon={Scissors} disabled={!chosen.length || busy !== null} onClick={() => void clip()}>
                      {busy === 'clip' ? 'Clipping…' : `Clip ${chosen.length}`}
                    </Button>
                    <Button icon={Download} disabled={!chosen.length} onClick={() => void enqueue()}>
                      Download full files
                    </Button>
                  </>
                ) : (
                  <Button variant="primary" icon={Download} disabled={!chosen.length} onClick={() => void enqueue()}>
                    Download {chosen.length} full files
                  </Button>
                )}
                <Menu label="Export" align="right" variant="ghost">
                  {(close) => (
                    <>
                      <MenuItem icon={ListOrdered} disabled={!chosen.length} onClick={() => (exportScript('urls'), close())}>
                        URL list
                      </MenuItem>
                      <MenuItem icon={Terminal} disabled={!chosen.length} onClick={() => (exportScript('bash'), close())}>
                        curl script (macOS, Linux)
                      </MenuItem>
                      <MenuItem icon={FileText} disabled={!chosen.length} onClick={() => (exportScript('ps1'), close())}>
                        PowerShell script (Windows)
                      </MenuItem>
                      {!product.clip && (
                        <MenuItem icon={FileCode2} disabled={!chosen.length} onClick={() => (exportScript('python'), close())}>
                          Python clip script
                        </MenuItem>
                      )}
                    </>
                  )}
                </Menu>
              </div>

              <Notice title="Full files cover more than your polygon">
                {product.clip
                  ? `Each ${product.group === 'Rivers' ? 'river' : 'lake'} file holds a whole satellite pass across the continent. Use Clip to keep only the data inside your polygon.`
                  : `SWOT ${product.family === 'swath' ? 'ocean files cover a whole half-orbit' : 'files are tiles up to 128 km across'}, so they extend beyond your polygon. After downloading, run the Python clip script (Export menu) in the same folder to cut them to your polygon.`}
              </Notice>
              {queuedMsg && (
                <Notice tone="success">
                  {queuedMsg}{' '}
                  <button type="button" onClick={onShowDownloads} className="font-medium text-accent underline underline-offset-2">
                    Show downloads
                  </button>
                </Notice>
              )}
            </>
          )}
        </Section>
      )}

      {result && polygon && granules.length > 0 && (
        <ErrorBoundary label="Preview">
          <PreviewPanel granules={granules} area={polygon} onPreview={onPreview} />
        </ErrorBoundary>
      )}
    </div>
  );
}
