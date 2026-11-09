import { useLiveQuery } from 'dexie-react-hooks';
import { Activity, Bell, BellRing, Bookmark, Download, History, RefreshCw, Ruler, Scissors, Search, Trash2, type LucideIcon } from 'lucide-react';
import { useState } from 'react';
import { Button, Empty, IconButton, Notice, Section } from '@/components/ui';
import { findProduct } from '@/config/products';
import { fmtWhen } from '@/lib/format';
import { checkSavedSearches, MONITOR_PERIOD_MINUTES, startMonitoring, stopMonitoring } from '@/monitor/monitor';
import { useRunSavedSearch } from '@/state/runSavedSearch';
import { toast } from '@/state/toast';
import { db, type HistoryEntry, type HistoryKind, type Period, type SavedSearch } from '@/storage/db';

const KIND_ICON: Record<HistoryKind, LucideIcon> = { search: Search, download: Download, clip: Scissors, robust: Activity, validation: Ruler };

const describePeriod = (p: Period) => (p.kind === 'last' ? `Last ${p.days} days` : `${p.start} → ${p.end}`);

export function SavedPanel({ onOpenSearch }: { onOpenSearch: () => void }) {
  const saved = useLiveQuery(() => db.savedSearches.orderBy('createdAt').reverse().toArray(), []) ?? [];
  const history = useLiveQuery(() => db.history.orderBy('at').reverse().limit(60).toArray(), []) ?? [];
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const run = useRunSavedSearch();
  const [checking, setChecking] = useState(false);
  const [checkMsg, setCheckMsg] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const load = (s: Parameters<typeof run>[0]) => {
    run(s);
    onOpenSearch();
  };
  const repeat = (h: HistoryEntry) => h.search && load(h.search);

  const toggleMonitor = async (s: SavedSearch) => {
    setTogglingId(s.id);
    try {
      if (s.monitor) await stopMonitoring(s.id);
      else await startMonitoring(s.id);
    } finally {
      setTogglingId(null);
    }
  };

  const checkNow = async () => {
    setChecking(true);
    setCheckMsg(null);
    const found = await checkSavedSearches();
    setChecking(false);
    setCheckMsg(found ? `${found} new ${found === 1 ? 'granule' : 'granules'} found.` : 'No new SWOT passes since the last check.');
  };
  const monitored = saved.filter((s) => s.monitor).length;

  const removeSearch = async (saved: SavedSearch) => {
    await db.savedSearches.delete(saved.id);
    toast(`Deleted “${saved.name}”`, { tone: 'info', action: { label: 'Undo', run: () => db.savedSearches.put(saved) } });
  };

  return (
    <div className="space-y-12">
      <Section
        eyebrow="One click to run again"
        title="Saved searches"
        actions={
          monitored > 0 && (
            <Button variant="ghost" icon={RefreshCw} disabled={checking} onClick={() => void checkNow()}>
              {checking ? 'Checking…' : 'Check now'}
            </Button>
          )
        }
      >
        {monitored > 0 && (
          <p className="text-meta text-ink-2">
            {monitored} {monitored === 1 ? 'search is' : 'searches are'} checked for new SWOT passes every {MONITOR_PERIOD_MINUTES / 60} hours; you get a
            notification when something new arrives.
          </p>
        )}
        {checkMsg && <Notice tone="success">{checkMsg}</Notice>}
        {saved.length === 0 ? (
          <Empty icon={Bookmark}>
            <p>None yet. Set up a search and choose Save search.</p>
            <p>Keep the dates rolling and turn on the bell to be notified when SWOT observes the area again.</p>
          </Empty>
        ) : (
          <ul className="divide-y divide-line border-y border-line">
            {saved.map((s) => (
              <li key={s.id} className="flex items-start gap-3 py-4">
                <div className="min-w-0 flex-1 space-y-1">
                  {(s.newCount ?? 0) > 0 && (
                    <p className="text-meta font-medium text-accent">
                      {s.newCount} new {s.newCount === 1 ? 'granule' : 'granules'}
                    </p>
                  )}
                  {renaming?.id === s.id ? (
                    <input
                      value={renaming.name}
                      autoFocus
                      aria-label="Search name"
                      onChange={(e) => setRenaming({ id: s.id, name: e.target.value })}
                      onBlur={() => {
                        if (renaming.name.trim()) void db.savedSearches.update(s.id, { name: renaming.name.trim() });
                        setRenaming(null);
                      }}
                      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                      className="h-9 w-full rounded-ui border border-accent bg-surface px-2 text-body"
                    />
                  ) : (
                    <button type="button" onClick={() => setRenaming({ id: s.id, name: s.name })} title="Rename" className="block max-w-full truncate text-left text-body font-medium text-ink">
                      {s.name}
                    </button>
                  )}
                  <p className="text-meta text-ink-2">
                    {findProduct(s.productKey).label} · {s.area.name}
                  </p>
                  <p className="tabular text-meta text-ink-3">
                    {describePeriod(s.period)}
                    {s.cycle !== undefined ? ` · Cycle ${s.cycle}` : ''}
                    {s.pass !== undefined ? ` · Pass ${s.pass}` : ''}
                    {s.lastRunAt ? ` · Last run ${fmtWhen(s.lastRunAt)}` : ''}
                  </p>
                  {s.monitor && s.lastCheckedAt && <p className="text-meta text-ink-3">Checked {fmtWhen(s.lastCheckedAt)}</p>}
                </div>
                <IconButton
                  icon={s.monitor ? BellRing : Bell}
                  label={s.monitor ? `Stop new-pass alerts for ${s.name}` : `Alert me about new passes for ${s.name}`}
                  pressed={Boolean(s.monitor)}
                  disabled={togglingId === s.id}
                  className="mt-1.5"
                  onClick={() => void toggleMonitor(s)}
                />
                <Button variant="secondary" onClick={() => load(s)}>
                  Run
                </Button>
                <IconButton icon={Trash2} label={`Delete ${s.name}`} tone="danger" className="mt-1.5" onClick={() => void removeSearch(s)} />
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section
        eyebrow="Last 300 actions"
        title="History"
        actions={
          history.length > 0 && (
            <Button variant="ghost" onClick={() => void db.history.clear()}>
              Clear
            </Button>
          )
        }
      >
        {history.length === 0 ? (
          <Empty icon={History}>
            <p>Searches, downloads, clips and robust analyses appear here.</p>
          </Empty>
        ) : (
          <ol className="space-y-5">
            {history.map((h) => {
              const Icon = KIND_ICON[h.kind];
              return (
                <li key={h.id} className="flex gap-3">
                  <Icon aria-hidden size={16} strokeWidth={1.75} className="mt-1 shrink-0 text-ink-3" />
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <p className="truncate text-meta font-medium text-ink">{h.title}</p>
                    <p className="text-meta text-ink-2">{h.detail}</p>
                    <p className="text-meta text-ink-3">{fmtWhen(h.at)}</p>
                  </div>
                  {h.search && (
                    <Button variant="ghost" onClick={() => repeat(h)}>
                      Repeat
                    </Button>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </Section>
    </div>
  );
}
