import { CornerDownLeft, Search, type LucideIcon } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { cx } from '@/components/ui';

export interface Command {
  id: string;
  group: string;
  label: string;
  icon: LucideIcon;
  /** Extra words that should find this command. */
  keywords?: string;
  /** Shown on the right, e.g. the current state. */
  hint?: string;
  run: () => void;
}

/** Every word typed must start a word of the label or keywords ("ros val" finds "Roseires Dam · gauge validation"). */
export function matchCommands(commands: Command[], query: string): Command[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return commands;
  return commands.filter((c) => {
    const hay = `${c.label} ${c.group} ${c.keywords ?? ''}`.toLowerCase();
    const starts = hay.split(/[^a-z0-9]+/);
    return words.every((w) => starts.some((s) => s.startsWith(w)) || hay.includes(w));
  });
}

/** Ctrl+K: jump to any section, reservoir, tool or setting by typing. */
export function CommandPalette({ open, commands, onClose }: { open: boolean; commands: Command[]; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const found = useMemo(() => matchCommands(commands, query), [commands, query]);

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) {
      setQuery('');
      setActive(0);
      d.showModal();
    } else if (!open && d.open) d.close();
  }, [open]);

  // Braces matter: an effect may only return a cleanup function, and newer Chrome makes
  // scrollIntoView return a Promise, which React would then try to call on unmount.
  useEffect(() => {
    setActive(0);
  }, [query]);
  useEffect(() => {
    list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const run = (c: Command | undefined) => {
    if (!c) return;
    onClose();
    c.run();
  };

  let lastGroup = '';
  return (
    <dialog
      ref={dialog}
      aria-label="Commands"
      className="app-dialog fixed top-[12vh] mx-auto my-0 w-[min(36rem,calc(100vw-2rem))] max-w-none"
      onClose={onClose}
      onClick={(e) => e.target === dialog.current && onClose()}
    >
      <div className="flex items-center gap-3 border-b border-line px-4">
        <Search aria-hidden size={16} strokeWidth={1.75} className="shrink-0 text-ink-3" />
        <input
          autoFocus
          role="combobox"
          aria-expanded="true"
          aria-controls="command-list"
          aria-activedescendant={found[active] ? `cmd-${found[active]!.id}` : undefined}
          aria-label="Type a command or a reservoir"
          placeholder="Type a command or a reservoir…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') setActive((i) => Math.min(found.length - 1, i + 1));
            else if (e.key === 'ArrowUp') setActive((i) => Math.max(0, i - 1));
            else if (e.key === 'Home') setActive(0);
            else if (e.key === 'End') setActive(found.length - 1);
            else if (e.key === 'Enter') run(found[active]);
            else return;
            e.preventDefault();
          }}
          className="h-14 min-w-0 flex-1 bg-transparent text-body text-ink outline-none placeholder:text-ink-3 focus-visible:outline-none"
        />
        <kbd className="shrink-0 rounded-ui border border-line px-1.5 text-eyebrow text-ink-3">Esc</kbd>
      </div>
      <ul ref={list} id="command-list" role="listbox" aria-label="Commands" className="max-h-[min(24rem,60vh)] overflow-y-auto p-2">
        {found.length === 0 && <li className="px-3 py-6 text-center text-meta text-ink-3">Nothing matches “{query}”.</li>}
        {found.map((c, i) => {
          const header = c.group !== lastGroup;
          lastGroup = c.group;
          return (
            <li key={c.id} role="presentation">
              {header && <p className="px-3 pt-3 pb-1 text-eyebrow font-medium tracking-[0.08em] text-ink-3 uppercase">{c.group}</p>}
              <div
                id={`cmd-${c.id}`}
                role="option"
                aria-selected={i === active}
                data-index={i}
                onMouseMove={() => setActive(i)}
                onClick={() => run(c)}
                className={cx(
                  'flex h-10 cursor-pointer items-center gap-3 rounded-ui px-3 text-meta transition-colors duration-150 ease-signature',
                  i === active ? 'bg-accent-soft text-ink' : 'text-ink-2',
                )}
              >
                <c.icon aria-hidden size={16} strokeWidth={1.75} className={i === active ? 'text-accent' : 'text-ink-3'} />
                <span className="min-w-0 flex-1 truncate">{c.label}</span>
                {c.hint && <span className="shrink-0 text-ink-3">{c.hint}</span>}
                {i === active && <CornerDownLeft aria-hidden size={14} strokeWidth={1.75} className="shrink-0 text-ink-3" />}
              </div>
            </li>
          );
        })}
      </ul>
    </dialog>
  );
}
