import { useLiveQuery } from 'dexie-react-hooks';
import { Check, Command as CommandIcon, X } from 'lucide-react';
import { Button, cx } from '@/components/ui';
import { useStudyAreas } from '@/state/studyArea';
import { db } from '@/storage/db';

const DISMISSED = 'swot-guide-dismissed';
const OPENED_RESERVOIR = 'swot-guide-reservoir';

const read = (k: string) => {
  try {
    return localStorage.getItem(k) === '1';
  } catch {
    return false;
  }
};
const write = (k: string, on: boolean) => {
  try {
    if (on) localStorage.setItem(k, '1');
    else localStorage.removeItem(k);
  } catch {
    // Private window: the guide simply shows again next time.
  }
};

export const guideDismissed = () => read(DISMISSED);
export const setGuideDismissed = (on: boolean) => write(DISMISSED, on);
/** Called when a reservoir is opened, which ticks the guide's third step. */
export const markReservoirOpened = () => write(OPENED_RESERVOIR, true);

interface Props {
  onDraw: () => void;
  onSearch: () => void;
  onReservoirs: () => void;
  onDismiss: () => void;
}

/** First-run checklist: three steps that tick themselves as they are done. */
export function GettingStarted({ onDraw, onSearch, onReservoirs, onDismiss }: Props) {
  const hasArea = useStudyAreas((s) => s.areas.length > 0);
  const searched = useLiveQuery(() => db.history.where('kind').equals('search').count(), [], 0) > 0;
  const reservoir = read(OPENED_RESERVOIR);

  const steps = [
    { done: hasArea, title: 'Draw your study area', text: 'A rectangle or polygon around the water you study, or upload a shapefile.', action: 'Draw a rectangle', run: onDraw },
    { done: searched, title: 'Search SWOT', text: 'Pick a product and dates, then preview the passes on the map before downloading.', action: 'Go to search', run: onSearch },
    { done: reservoir, title: 'Open a reservoir', text: 'Latest levels of the Nile reservoirs, their robust level and gauge validation.', action: 'See reservoirs', run: onReservoirs },
  ];
  const done = steps.filter((s) => s.done).length;

  return (
    <section aria-labelledby="guide-title" className="space-y-4 rounded-ui border border-line bg-surface p-5">
      <header className="flex items-start gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-eyebrow font-medium tracking-[0.08em] text-ink-3 uppercase">
            Getting started · {done} of {steps.length}
          </p>
          <h2 id="guide-title" className="text-title">
            Welcome to SWOT Explorer
          </h2>
        </div>
        <button
          type="button"
          aria-label="Hide the getting-started guide"
          title="Hide (Ctrl+K → Getting started brings it back)"
          onClick={onDismiss}
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-ui text-ink-3 transition-colors duration-200 ease-signature hover:bg-sunken hover:text-ink"
        >
          <X aria-hidden size={16} strokeWidth={1.75} />
        </button>
      </header>
      <div className="h-1 overflow-hidden rounded-ui bg-sunken" aria-hidden>
        <div className="h-full origin-left bg-accent transition-transform duration-300 ease-signature" style={{ transform: `scaleX(${done / steps.length})` }} />
      </div>
      <ol className="space-y-3">
        {steps.map((s, i) => (
          <li key={s.title} className="flex items-start gap-3">
            <span
              aria-hidden
              className={cx(
                'tabular mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full text-eyebrow font-medium',
                s.done ? 'bg-accent text-accent-ink' : 'border border-line-strong text-ink-2',
              )}
            >
              {s.done ? <Check size={12} strokeWidth={2.5} /> : i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <p className={cx('text-body', s.done ? 'text-ink-3 line-through decoration-line-strong' : 'text-ink')}>
                {s.title}
                <span className="sr-only">{s.done ? ' (done)' : ''}</span>
              </p>
              {!s.done && <p className="text-meta text-ink-2">{s.text}</p>}
            </div>
            {!s.done && (
              <Button variant="ghost" className="h-8 shrink-0" onClick={s.run}>
                {s.action}
              </Button>
            )}
          </li>
        ))}
      </ol>
      <p className="flex items-center gap-2 border-t border-line pt-3 text-meta text-ink-3">
        <CommandIcon aria-hidden size={14} strokeWidth={1.75} />
        Tip: press <kbd className="rounded-ui border border-line px-1.5 text-eyebrow">Ctrl</kbd>
        <kbd className="rounded-ui border border-line px-1.5 text-eyebrow">K</kbd> to jump to anything.
      </p>
      {done === steps.length && (
        <Button variant="secondary" onClick={onDismiss}>
          All done · hide this guide
        </Button>
      )}
    </section>
  );
}
