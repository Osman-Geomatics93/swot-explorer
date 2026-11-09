import type { FeatureCollection } from 'geojson';
import { ArrowLeft } from 'lucide-react';
import { useState } from 'react';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { cx } from '@/components/ui';
import { GaugePanel } from '@/features/gauge/GaugePanel';
import { RobustPanel, type Reservoir } from '@/features/robust/RobustPanel';
import { ReservoirCards } from './ReservoirCards';

type View = 'robust' | 'gauge';
const VIEWS: { id: View; label: string }[] = [
  { id: 'robust', label: 'Robust level' },
  { id: 'gauge', label: 'Gauge validation' },
];

/** Reservoirs as a list; picking one opens its analyses in place, with a way back. */
export function ReservoirsSection({
  reservoirs,
  selected,
  onSelect,
  onBack,
  onPieces,
}: {
  reservoirs: Reservoir[];
  selected: Reservoir | null;
  onSelect: (id: string) => void;
  onBack: () => void;
  onPieces: (fc: FeatureCollection | undefined) => void;
}) {
  const [view, setView] = useState<View>('robust');

  if (selected) {
    return (
      <div className="space-y-8">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-4">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex h-8 items-center gap-2 rounded-ui pr-3 text-meta font-medium text-ink-2 transition-colors duration-200 ease-signature hover:text-ink"
          >
            <ArrowLeft aria-hidden size={16} strokeWidth={1.75} />
            All reservoirs
          </button>
          <div role="tablist" aria-label="Analysis" className="flex gap-1 rounded-ui bg-sunken p-1">
            {VIEWS.map((v) => (
              <button
                key={v.id}
                type="button"
                role="tab"
                aria-selected={view === v.id}
                onClick={() => setView(v.id)}
                className={cx(
                  'h-8 rounded-ui px-3 text-meta font-medium transition-[background-color,color] duration-200 ease-signature',
                  view === v.id ? 'bg-surface text-ink shadow-float' : 'text-ink-2 hover:text-ink',
                )}
              >
                {v.label}
              </button>
            ))}
          </div>
        </div>
        {/* Both stay mounted, so a running analysis survives switching views. */}
        <div hidden={view !== 'robust'}>
          <ErrorBoundary label="Robust analysis">
            <RobustPanel key={selected.id} reservoir={selected} onPieces={onPieces} />
          </ErrorBoundary>
        </div>
        <div hidden={view !== 'gauge'}>
          <ErrorBoundary label="Gauge validation">
            <GaugePanel key={selected.id} reservoir={selected} />
          </ErrorBoundary>
        </div>
      </div>
    );
  }

  return <ReservoirCards reservoirs={reservoirs} onSelect={onSelect} />;
}
