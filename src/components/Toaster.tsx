import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';
import { useToasts, type ToastTone } from '@/state/toast';
import { cx } from './ui';

const ICON: Record<ToastTone, { icon: typeof Info; className: string }> = {
  success: { icon: CheckCircle2, className: 'text-ok' },
  info: { icon: Info, className: 'text-ink-2' },
  error: { icon: AlertCircle, className: 'text-error' },
};

/** Toasts stack at the bottom centre; screen readers hear them through the live region. */
export function Toaster() {
  const { toasts, dismiss } = useToasts();
  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-4 bottom-4 z-[60] flex flex-col items-center gap-2">
      {toasts.map((t) => {
        const { icon: Icon, className } = ICON[t.tone];
        return (
          <div
            key={t.id}
            role={t.tone === 'error' ? 'alert' : 'status'}
            className="pointer-events-auto flex max-w-md min-w-0 animate-[rise_0.24s_var(--ease)_both] items-center gap-3 rounded-ui border border-line bg-surface py-2 pr-2 pl-4 shadow-float"
          >
            <Icon aria-hidden size={16} strokeWidth={1.75} className={cx('shrink-0', className)} />
            <p className="min-w-0 flex-1 text-meta text-ink">{t.message}</p>
            {t.action && (
              <button
                type="button"
                onClick={() => {
                  void t.action!.run();
                  dismiss(t.id);
                }}
                className="h-8 shrink-0 rounded-ui px-3 text-meta font-medium text-accent transition-colors duration-200 ease-signature hover:bg-accent-soft"
              >
                {t.action.label}
              </button>
            )}
            <button
              type="button"
              aria-label="Dismiss"
              onClick={() => dismiss(t.id)}
              className="inline-flex size-8 shrink-0 items-center justify-center rounded-ui text-ink-3 transition-colors duration-200 ease-signature hover:bg-sunken hover:text-ink"
            >
              <X aria-hidden size={14} strokeWidth={1.75} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
