export const fmtSize = (bytes: number) =>
  bytes >= 1e9
    ? `${(bytes / 1e9).toFixed(2)} GB`
    : bytes >= 1e6
      ? `${(bytes / 1e6).toFixed(1)} MB`
      : `${Math.max(1, Math.round(bytes / 1e3))} kB`;

export const isoDate = (d: Date) => d.toISOString().slice(0, 10);

export const slug = (s: string) => s.replace(/[^\w-]+/g, '_').replace(/^_|_$/g, '').slice(0, 40) || 'area';

export const fmtWhen = (ms: number) =>
  new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
