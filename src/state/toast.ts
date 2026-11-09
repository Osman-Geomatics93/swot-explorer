/** Short confirmations at the bottom of the page ("Saved 51 passes"), optionally with an action such as Undo. */
import { create } from 'zustand';

export type ToastTone = 'success' | 'info' | 'error';

export interface Toast {
  id: number;
  message: string;
  tone: ToastTone;
  action?: { label: string; run: () => unknown };
}

let nextId = 1;

export const useToasts = create<{ toasts: Toast[]; dismiss: (id: number) => void }>((set) => ({
  toasts: [],
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

/** Show a toast; it closes by itself (later when it offers an action). Returns its id. */
export function toast(message: string, opts: { tone?: ToastTone; action?: Toast['action'] } = {}): number {
  const id = nextId++;
  // At most three at once: the oldest goes first.
  useToasts.setState((s) => ({ toasts: [...s.toasts.slice(-2), { id, message, tone: opts.tone ?? 'success', action: opts.action }] }));
  setTimeout(() => useToasts.getState().dismiss(id), opts.action ? 9000 : opts.tone === 'error' ? 8000 : 4500);
  return id;
}
