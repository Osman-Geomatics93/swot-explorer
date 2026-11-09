/**
 * Shared UI primitives. Every screen is built from these so that radius, spacing,
 * type and motion stay consistent (DESIGN_RULES.md §12).
 */
import { AlertCircle, CheckCircle2, ChevronDown, Info, TriangleAlert, type LucideIcon } from 'lucide-react';
import {
  forwardRef,
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react';

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

const MOTION = 'transition-[background-color,border-color,color,transform,opacity] duration-200 ease-signature';

/* ------------------------------------------------------------------ buttons */

type Variant = 'primary' | 'secondary' | 'ghost';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  icon?: LucideIcon;
  /** Full-width buttons close a form or a panel. */
  block?: boolean;
}

const VARIANT: Record<Variant, string> = {
  primary: 'bg-accent text-accent-ink hover:bg-accent-hover hover:-translate-y-px active:translate-y-0 px-7',
  secondary: 'border border-line-strong text-ink hover:border-ink-3 hover:bg-surface px-5',
  ghost: 'text-ink-2 hover:text-ink hover:bg-sunken px-3',
};

/** 44px-tall command button. One primary per view; everything else secondary or ghost. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', icon: Icon, block, className, children, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cx(
        'inline-flex h-11 items-center justify-center gap-2 rounded-ui text-meta font-medium whitespace-nowrap',
        'disabled:pointer-events-none disabled:opacity-45',
        MOTION,
        VARIANT[variant],
        block && 'w-full',
        className,
      )}
      {...rest}
    >
      {Icon && <Icon aria-hidden size={16} strokeWidth={1.75} />}
      {children}
    </button>
  );
});

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: LucideIcon;
  label: string;
  tone?: 'default' | 'danger';
  pressed?: boolean;
}

/** Compact icon action for dense lists (pointer-sized: 32px). */
export function IconButton({ icon: Icon, label, tone = 'default', pressed, className, ...rest }: IconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      className={cx(
        'inline-flex size-8 shrink-0 items-center justify-center rounded-ui',
        MOTION,
        pressed ? 'bg-accent text-accent-ink' : 'text-ink-2 hover:bg-sunken',
        !pressed && (tone === 'danger' ? 'hover:text-error' : 'hover:text-ink'),
        className,
      )}
      {...rest}
    >
      <Icon aria-hidden size={16} strokeWidth={1.75} />
    </button>
  );
}

/* ------------------------------------------------------------------ layout */

export function Section({
  title,
  eyebrow,
  actions,
  children,
  className,
}: {
  title: string;
  eyebrow?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const id = `s-${title.toLowerCase().replace(/\W+/g, '-')}`;
  return (
    <section aria-labelledby={id} className={cx('space-y-4', className)}>
      <header className="flex items-end justify-between gap-4">
        <div className="space-y-1">
          {eyebrow && <p className="text-eyebrow font-medium tracking-[0.08em] text-ink-3 uppercase">{eyebrow}</p>}
          <h2 id={id} className="text-title">
            {title}
          </h2>
        </div>
        {actions}
      </header>
      {children}
    </section>
  );
}

/** Elevated surface. Background + hairline only, never a shadow too. */
export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('rounded-ui border border-line bg-surface', className)}>{children}</div>;
}

export function Divider() {
  return <hr className="border-0 border-t border-line" />;
}

/* ------------------------------------------------------------------ form */

const CONTROL = cx(
  'h-11 w-full rounded-ui border border-line-strong bg-surface px-3 text-body text-ink',
  'placeholder:text-ink-3 hover:border-ink-3 focus-visible:border-accent',
  MOTION,
);

export function Field({ label, hint, children, className }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <label className={cx('block space-y-1.5', className)}>
      <span className="text-meta font-medium text-ink-2">{label}</span>
      {children}
      {hint && <span className="block text-meta text-ink-3">{hint}</span>}
    </label>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={cx(CONTROL, 'tabular', className)} {...rest} />;
});

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <span className="relative block">
      <select className={cx(CONTROL, 'appearance-none pr-9', className)} {...rest}>
        {children}
      </select>
      <ChevronDown aria-hidden size={16} strokeWidth={1.75} className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-ink-3" />
    </span>
  );
}

export function Check({ label, className, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode }) {
  return (
    <label className={cx('flex min-h-8 cursor-pointer items-center gap-3 text-meta text-ink', className)}>
      <input type="checkbox" {...rest} />
      <span>{label}</span>
    </label>
  );
}

/* ------------------------------------------------------------------ feedback */

type Tone = 'info' | 'success' | 'warning' | 'error';
const TONE: Record<Tone, { icon: LucideIcon; text: string; bar: string }> = {
  info: { icon: Info, text: 'text-ink-2', bar: 'bg-line-strong' },
  success: { icon: CheckCircle2, text: 'text-ok', bar: 'bg-ok' },
  warning: { icon: TriangleAlert, text: 'text-caution', bar: 'bg-caution' },
  error: { icon: AlertCircle, text: 'text-error', bar: 'bg-error' },
};

/** Inline message: a coloured rule and icon, not a coloured box. */
export function Notice({ tone = 'info', title, children }: { tone?: Tone; title?: string; children: ReactNode }) {
  const t = TONE[tone];
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className="flex gap-3 rounded-ui bg-sunken py-3 pr-4 pl-3">
      <span aria-hidden className={cx('w-0.5 shrink-0 rounded-ui', t.bar)} />
      <t.icon aria-hidden size={16} strokeWidth={1.75} className={cx('mt-0.5 shrink-0', t.text)} />
      <div className="min-w-0 space-y-1 text-meta text-ink-2">
        {title && <p className={cx('font-medium', t.text)}>{title}</p>}
        <div>{children}</div>
      </div>
    </div>
  );
}

export function Progress({ value, max, label }: { value: number; max: number; label?: string }) {
  const ratio = max > 0 ? Math.min(1, value / max) : 0;
  return (
    <div className="space-y-1.5">
      <div role="progressbar" aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} aria-label={label} className="h-1 overflow-hidden rounded-ui bg-sunken">
        <div className="h-full origin-left bg-accent transition-transform duration-300 ease-signature" style={{ transform: `scaleX(${ratio})` }} />
      </div>
      {label && <p className="tabular text-meta text-ink-3">{label}</p>}
    </div>
  );
}

/** Placeholder in the shape of content that is still loading. */
export function Skeleton({ className }: { className?: string }) {
  return <span aria-hidden className={cx('skeleton block', className)} />;
}

export function Empty({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return (
    <div className="flex gap-3 py-2 text-meta text-ink-2">
      <Icon aria-hidden size={18} strokeWidth={1.5} className="mt-0.5 shrink-0 text-ink-3" />
      <div className="space-y-1">{children}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ menu */

/** Disclosure popover for secondary choices (exports, map layers). Closes on outside click / Escape. */
export function Menu({
  label,
  icon,
  align = 'left',
  children,
  variant = 'secondary',
  labelClassName,
}: {
  label: string;
  /** Classes for the visible label, e.g. to hide it in narrow containers (the button keeps its name). */
  labelClassName?: string;
  icon?: LucideIcon;
  align?: 'left' | 'right';
  children: (close: () => void) => ReactNode;
  variant?: Variant;
}) {
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
  return (
    <div ref={ref} className="relative">
      <Button variant={variant} icon={icon} aria-label={label} title={label} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span className={labelClassName}>{label}</span>
        <ChevronDown aria-hidden size={14} strokeWidth={1.75} className={cx('transition-transform duration-200 ease-signature', open && 'rotate-180')} />
      </Button>
      {open && (
        <div
          className={cx(
            'absolute z-20 mt-2 min-w-56 rounded-ui border border-line bg-surface p-2 shadow-float',
            'animate-[rise_0.24s_var(--ease)_both]',
            align === 'right' ? 'right-0' : 'left-0',
          )}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

export function MenuItem({ icon: Icon, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { icon?: LucideIcon }) {
  return (
    <button
      type="button"
      className={cx('flex h-10 w-full items-center gap-3 rounded-ui px-3 text-left text-meta text-ink hover:bg-sunken disabled:opacity-45', MOTION)}
      {...rest}
    >
      {Icon && <Icon aria-hidden size={16} strokeWidth={1.75} className="text-ink-3" />}
      {children}
    </button>
  );
}

export { cx };
