import { ExternalLink, LogIn, LogOut, Settings } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { EDL_LINKS } from '@/auth/earthdataLogin';
import { removeToken, type TokenInfo } from '@/auth/token';
import { cx } from '@/components/ui';

/** Header account control: initials when signed in, a sign-in link otherwise. */
/** `side`: the menu opens below (header) or to the right (bottom of the navigation rail). */
export function AccountMenu({ info, onSignIn, side = 'below' }: { info: TokenInfo | null; onSignIn: () => void; side?: 'below' | 'right' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!info || info.expired) {
    const text = info?.expired ? 'Sign in again' : 'Sign in';
    if (side === 'right') {
      return (
        <button
          type="button"
          onClick={onSignIn}
          title={text}
          className="flex w-16 flex-col items-center gap-1 rounded-ui py-2 text-accent transition-colors duration-200 ease-signature hover:bg-accent-soft"
        >
          <LogIn aria-hidden size={18} strokeWidth={1.75} />
          <span className="text-eyebrow font-medium">Sign in</span>
        </button>
      );
    }
    return (
      <button
        type="button"
        onClick={onSignIn}
        className="inline-flex h-8 items-center gap-2 rounded-ui px-3 text-meta font-medium whitespace-nowrap text-accent transition-colors duration-200 ease-signature hover:bg-accent-soft"
      >
        <LogIn aria-hidden size={16} strokeWidth={1.75} />
        {text}
      </button>
    );
  }

  const item = 'flex h-10 w-full items-center gap-3 rounded-ui px-3 text-left text-meta text-ink transition-colors duration-200 ease-signature hover:bg-sunken';
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-label={`Account: ${info.uid}`}
        onClick={() => setOpen((v) => !v)}
        className={cx(
          'flex size-8 items-center justify-center rounded-ui text-meta font-semibold uppercase transition-colors duration-200 ease-signature',
          open ? 'bg-accent text-accent-ink' : 'bg-accent-soft text-accent hover:bg-accent hover:text-accent-ink',
        )}
      >
        {info.uid.slice(0, 2)}
      </button>
      {open && (
        <div className={cx('absolute z-40 w-64', side === 'right' ? 'bottom-0 left-full ml-3' : 'right-0 mt-2')}>
          <div className="w-64 animate-[rise_0.24s_var(--ease)_both] rounded-ui border border-line bg-surface p-2 shadow-float">
            <div className="space-y-0.5 px-3 pt-2 pb-3">
              <p className="text-meta text-ink-3">Signed in to Earthdata as</p>
              <p className="truncate text-body font-medium text-ink">{info.uid}</p>
              <p className={cx('tabular text-meta', info.daysLeft < 7 ? 'text-caution' : 'text-ink-3')}>
                Token expires {info.expiresAt.toLocaleDateString()} · {info.daysLeft} days
              </p>
            </div>
            <div className="border-t border-line pt-2">
              <a className={item} href={EDL_LINKS.profile} target="_blank" rel="noreferrer">
                <ExternalLink aria-hidden size={16} strokeWidth={1.75} className="text-ink-3" />
                Earthdata profile
              </a>
              <button type="button" className={item} onClick={() => void browser.runtime.openOptionsPage()}>
                <Settings aria-hidden size={16} strokeWidth={1.75} className="text-ink-3" />
                Options
              </button>
              <button
                type="button"
                className={item}
                onClick={() => {
                  setOpen(false);
                  void removeToken();
                }}
              >
                <LogOut aria-hidden size={16} strokeWidth={1.75} className="text-ink-3" />
                Sign out
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
