/**
 * Light / dark / auto theme. Kept in localStorage (shared by every extension page, read
 * synchronously) so the page never flashes the wrong theme before the store loads.
 */
import { useEffect, useState } from 'react';
import { create } from 'zustand';

export type ThemeMode = 'auto' | 'light' | 'dark';
export const THEME_LABEL: Record<ThemeMode, string> = { auto: 'Auto (system)', light: 'Light', dark: 'Dark' };
const KEY = 'swot-theme';

function readMode(): ThemeMode {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'auto';
  } catch {
    return 'auto';
  }
}

function apply(mode: ThemeMode) {
  if (mode === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.dataset.theme = mode;
}

export const useTheme = create<{ mode: ThemeMode; setMode: (m: ThemeMode) => void }>((set) => ({
  mode: readMode(),
  setMode: (mode) => {
    try {
      localStorage.setItem(KEY, mode);
    } catch {
      // Private window: the choice lasts for this page only.
    }
    apply(mode);
    set({ mode });
  },
}));

/** Apply the saved theme before the first render, and follow changes made in other extension pages. */
export function initTheme() {
  apply(useTheme.getState().mode);
  window.addEventListener('storage', (e) => {
    if (e.key !== KEY) return;
    const mode = readMode();
    apply(mode);
    useTheme.setState({ mode });
  });
}

/** The next mode when cycling with one button. */
export const nextTheme = (m: ThemeMode): ThemeMode => (m === 'auto' ? 'light' : m === 'light' ? 'dark' : 'auto');

/**
 * Changes whenever the colours on screen change (chosen theme or, in auto, the system's).
 * Charts read colour tokens when they build their options, so they list this as a dependency.
 */
export function useThemeKey(): string {
  const mode = useTheme((s) => s.mode);
  const [systemDark, setSystemDark] = useState(() => matchMedia('(prefers-color-scheme: dark)').matches);
  useEffect(() => {
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const on = () => setSystemDark(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return mode === 'auto' ? `auto-${systemDark ? 'dark' : 'light'}` : mode;
}
