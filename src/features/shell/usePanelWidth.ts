import { useCallback, useState, type KeyboardEvent, type PointerEvent } from 'react';

const KEY = 'panelWidth';
export const PANEL_MIN = 340;
export const PANEL_MAX = 760;
export const PANEL_DEFAULT = 520;

const clamp = (w: number) => Math.round(Math.min(PANEL_MAX, Math.max(PANEL_MIN, w)));

function read(): number {
  try {
    const w = Number(localStorage.getItem(KEY));
    return w ? clamp(w) : PANEL_DEFAULT;
  } catch {
    return PANEL_DEFAULT;
  }
}

function write(w: number) {
  try {
    localStorage.setItem(KEY, String(w));
  } catch {
    // Storage blocked: the width just isn't remembered.
  }
}

/**
 * Width of the full-page side panel, dragged by a separator on its edge and remembered per browser.
 * `origin` is the panel's left edge in client pixels, so the width follows the pointer directly.
 */
export function usePanelWidth() {
  const [width, setWidth] = useState(read);

  const set = useCallback((w: number) => {
    const next = clamp(w);
    setWidth(next);
    write(next);
  }, []);

  const onPointerDown = useCallback(
    (e: PointerEvent<HTMLElement>) => {
      const handle = e.currentTarget;
      const origin = handle.parentElement!.getBoundingClientRect().left;
      handle.setPointerCapture(e.pointerId);
      document.body.style.cursor = 'col-resize';
      const move = (ev: globalThis.PointerEvent) => set(ev.clientX - origin);
      const up = () => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
        handle.removeEventListener('pointercancel', up);
        document.body.style.cursor = '';
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
      handle.addEventListener('pointercancel', up);
    },
    [set],
  );

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLElement>) => {
      const step = e.shiftKey ? 80 : 20;
      if (e.key === 'ArrowLeft') set(width - step);
      else if (e.key === 'ArrowRight') set(width + step);
      else if (e.key === 'Home') set(PANEL_MIN);
      else if (e.key === 'End') set(PANEL_MAX);
      else return;
      e.preventDefault();
    },
    [set, width],
  );

  return { width, reset: () => set(PANEL_DEFAULT), onPointerDown, onKeyDown };
}
