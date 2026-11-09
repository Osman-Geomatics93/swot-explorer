/** Read a design token (CSS custom property) for canvas/WebGL code that can't use CSS. */
export function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim();
}

export const FONT_BODY = "'Geist Variable', ui-sans-serif, sans-serif";
