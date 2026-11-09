import { Bookmark, ChartSpline, Download, Droplets, Search, type LucideIcon } from 'lucide-react';
import { cx } from '@/components/ui';

export type Tab = 'search' | 'reservoirs' | 'compare' | 'downloads' | 'saved';

export const TABS: {
  id: Tab;
  label: string;
  icon: LucideIcon;
  hint: string;
}[] = [
  {
    id: 'search',
    label: 'Search',
    icon: Search,
    hint: 'Study area, search, preview and clip',
  },
  {
    id: 'reservoirs',
    label: 'Reservoirs',
    icon: Droplets,
    hint: 'Nile reservoirs and their robust water level',
  },
  {
    id: 'compare',
    label: 'Compare',
    icon: ChartSpline,
    hint: 'Cascade: connected reservoirs on one time axis',
  },
  {
    id: 'downloads',
    label: 'Downloads',
    icon: Download,
    hint: 'Background download queue',
  },
  {
    id: 'saved',
    label: 'Saved',
    icon: Bookmark,
    hint: 'Saved searches and history',
  },
];

interface NavProps {
  tab: Tab;
  /** Downloads still to run, shown as a badge. */
  pending: number;
  onTab: (tab: Tab) => void;
}

function Badge({ n, className }: { n: number; className?: string }) {
  return (
    <span className={cx('tabular rounded-ui bg-accent px-1.5 text-eyebrow leading-4 font-medium text-accent-ink', className)} aria-label={`${n} pending`}>
      {n}
    </span>
  );
}

/** Vertical icon rail for the full page. Pressing the open section again collapses the panel. */
export function NavRail({ tab, pending, onTab, panelOpen }: NavProps & { panelOpen: boolean }) {
  return (
    <nav aria-label="Sections" className="flex flex-col items-center gap-1">
      {TABS.map((t) => {
        const current = t.id === tab;
        return (
          <button
            key={t.id}
            type="button"
            title={current && panelOpen ? `${t.hint} · press again to hide the panel` : t.hint}
            aria-current={current ? 'page' : undefined}
            onClick={() => onTab(t.id)}
            className={cx(
              'group relative flex w-16 flex-col items-center gap-1 rounded-ui py-2 transition-colors duration-200 ease-signature',
              current ? 'text-ink' : 'text-ink-3 hover:text-ink',
            )}
          >
            <span
              className={cx(
                'flex h-8 w-12 items-center justify-center rounded-ui transition-colors duration-200 ease-signature',
                current && panelOpen ? 'bg-accent-soft text-accent' : current ? 'bg-sunken' : 'group-hover:bg-sunken',
              )}
            >
              <t.icon aria-hidden size={18} strokeWidth={1.75} />
            </span>
            <span className="text-eyebrow font-medium">{t.label}</span>
            {t.id === 'downloads' && pending > 0 && <Badge n={pending} className="absolute top-1 right-1" />}
          </button>
        );
      })}
    </nav>
  );
}

/** Horizontal icon tabs for the narrow side panel. */
export function NavTabs({ tab, pending, onTab }: NavProps) {
  return (
    <div role="tablist" aria-label="Sections" className="grid grid-cols-5 border-b border-line bg-paper">
      {TABS.map((t) => {
        const current = t.id === tab;
        return (
          <button
            key={t.id}
            role="tab"
            type="button"
            title={t.hint}
            aria-selected={current}
            onClick={() => onTab(t.id)}
            className={cx(
              'relative -mb-px flex h-14 flex-col items-center justify-center gap-1 border-b-2 transition-colors duration-200 ease-signature',
              current ? 'border-accent text-ink' : 'border-transparent text-ink-3 hover:text-ink',
            )}
          >
            <t.icon aria-hidden size={18} strokeWidth={1.75} className={current ? 'text-accent' : undefined} />
            <span className="text-eyebrow font-medium">{t.label}</span>
            {t.id === 'downloads' && pending > 0 && <Badge n={pending} className="absolute top-1.5 right-2" />}
          </button>
        );
      })}
    </div>
  );
}
