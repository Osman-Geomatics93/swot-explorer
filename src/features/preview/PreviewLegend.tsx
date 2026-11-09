import { cx } from '@/components/ui';
import type { MapPreview, PreviewKind } from '@/map/MapView';
import { LEVEL_TOKENS, NO_DATA_TOKEN, QUALITY_CLASSES, fmtLevels, levelStops, qualityOf, type LevelRange } from '@/map/symbology';
import { LAYERS, summarizeLayer, type PreviewLayer } from '@/preview/passPreview';

const NOUN: Record<PreviewKind, [string, string]> = { lakes: ['lake', 'lakes'], reaches: ['reach', 'reaches'], nodes: ['node', 'nodes'] };
const tokenVar = (t: string) => `var(--${t})`;

/** Shape key for a layer: a fill, a cased line or a ringed dot, as drawn on the map. */
function Symbol({ kind, color = 'var(--ink-2)', faint = false }: { kind: PreviewKind; color?: string; faint?: boolean }) {
  const o = faint ? 0.35 : 1;
  return (
    <svg aria-hidden width="28" height="16" viewBox="0 0 28 16" className="shrink-0">
      {kind === 'lakes' && <rect x="2" y="2" width="24" height="12" rx="3" fill={color} fillOpacity={0.55 * o} stroke={color} strokeOpacity={o} strokeWidth="1.5" />}
      {kind === 'reaches' && (
        <>
          <path d="M3 11 C 9 3, 17 13, 25 5" fill="none" stroke="var(--map-label-halo)" strokeOpacity={0.55 * o} strokeWidth="6" strokeLinecap="round" />
          <path d="M3 11 C 9 3, 17 13, 25 5" fill="none" stroke={color} strokeOpacity={o} strokeWidth="3" strokeLinecap="round" />
        </>
      )}
      {kind === 'nodes' && <circle cx="14" cy="8" r="4.5" fill={color} fillOpacity={o} stroke="var(--map-area)" strokeWidth="1.5" />}
    </svg>
  );
}

interface Props {
  layers: PreviewLayer[];
  colorBy: MapPreview['colorBy'];
  onColorBy: (c: MapPreview['colorBy']) => void;
  levels: LevelRange | null;
}

/** Map key for the SWOT preview: what each shape is, what the colours mean, what faint and grey mean. */
export function PreviewLegend({ layers, colorBy, onColorBy, levels }: Props) {
  const features = layers.flatMap((l) => l.features);
  const firstKind = layers[0]?.kind ?? 'lakes';
  const stops = levels ? levelStops(levels.range) : [];
  const flat = levels !== null && levels.range[1] - levels.range[0] < 0.05;
  const clipped = levels !== null && (levels.full[0] < levels.range[0] - 0.05 || levels.full[1] > levels.range[1] + 0.05);
  const qualityCount = (code: number | null) => features.filter((f) => qualityOf(f.properties) === code).length;

  return (
    <div className="space-y-5">
      {/* What is on the map */}
      <ul className="space-y-3">
        {layers.map((l) => {
          const s = summarizeLayer(l);
          const [one, many] = NOUN[l.kind];
          return (
            <li key={l.kind} className="flex items-start gap-3">
              <span className="pt-0.5">
                <Symbol kind={l.kind} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-body text-ink">{LAYERS[l.kind].label}</span>
                  <span className="tabular text-meta text-ink-2">
                    {s.count === 0 ? 'none in your area' : `${s.count.toLocaleString()} ${s.count === 1 ? one : many}`}
                  </span>
                </div>
                {s.count > 0 && (
                  <p className="tabular text-meta text-ink-3">
                    {s.passing === s.count ? (s.count === 1 ? 'passes QC' : 'all pass QC') : `${s.passing} of ${s.count} pass QC`}
                    {s.wseMin !== null && ` · ${fmtLevels(s.wseMin, s.wseMax!)}`}
                    {s.lakeAreaKm2 !== null && s.lakeAreaKm2 > 0 && ` · ≈ ${s.lakeAreaKm2.toFixed(1)} km² of water inside your area`}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {/* What the colours mean */}
      <div className="space-y-3 border-t border-line pt-4">
        <div className="flex items-center justify-between gap-3">
          <span className="text-meta font-medium text-ink-2">Colour by</span>
          <div role="radiogroup" aria-label="Colour by" className="flex gap-1 rounded-ui bg-sunken p-1">
            {(
              [
                ['wse', 'Water level'],
                ['quality', 'Quality flag'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={colorBy === id}
                onClick={() => onColorBy(id)}
                className={cx(
                  'h-7 rounded-ui px-3 text-meta font-medium transition-[background-color,color] duration-200 ease-signature',
                  colorBy === id ? 'bg-surface text-ink shadow-float' : 'text-ink-2 hover:text-ink',
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {colorBy === 'wse' &&
          (!levels ? (
            <p className="text-meta text-ink-3">No water levels in view.</p>
          ) : flat ? (
            <div className="flex items-center gap-3 text-meta text-ink-2">
              <span className="h-3 w-8 rounded-ui" style={{ background: tokenVar(LEVEL_TOKENS[2]) }} aria-hidden />
              <span className="tabular">All at {levels.range[0].toFixed(1)} m</span>
            </div>
          ) : (
            <figure className="space-y-1.5">
              <div
                className="h-3 rounded-ui"
                style={{ background: `linear-gradient(90deg, ${LEVEL_TOKENS.map((t) => tokenVar(t)).join(', ')})` }}
                role="img"
                aria-label={`Water level from ${stops[0]!.toFixed(1)} m (light) to ${stops.at(-1)!.toFixed(1)} m (dark)`}
              />
              <div className="tabular flex justify-between text-eyebrow text-ink-2">
                {stops.map((v, i) => (
                  <span key={i}>{v.toFixed(stops.at(-1)! - stops[0]! < 5 ? 2 : 1)}</span>
                ))}
              </div>
              <figcaption className="text-meta text-ink-3">
                Water surface elevation, m · darker = higher.
                {clipped && ` Colours span the middle 96 % of levels; the full range is ${fmtLevels(levels.full[0], levels.full[1])}.`}
              </figcaption>
            </figure>
          ))}

        {colorBy === 'quality' && (
          <ul className="space-y-1.5">
            {[...QUALITY_CLASSES.map((q) => ({ key: q.code as number | null, label: `${q.code} · ${q.label}`, token: q.token as string })), { key: null, label: 'No flag', token: NO_DATA_TOKEN }].map(
              (q) => (
                <li key={q.label} className="flex items-center gap-3 text-meta">
                  <Symbol kind={firstKind} color={tokenVar(q.token)} />
                  <span className="flex-1 text-ink-2">{q.label}</span>
                  <span className="tabular text-ink-3">{qualityCount(q.key).toLocaleString()}</span>
                </li>
              ),
            )}
          </ul>
        )}
      </div>

      {/* What faint and grey mean */}
      <ul className="flex flex-wrap gap-x-6 gap-y-2 border-t border-line pt-4 text-meta text-ink-3">
        <li className="flex items-center gap-2">
          <Symbol kind={firstKind} color={tokenVar(colorBy === 'wse' ? LEVEL_TOKENS[3] : QUALITY_CLASSES[0].token)} faint />
          Fails your QC rule
        </li>
        {colorBy === 'wse' && (
          <li className="flex items-center gap-2">
            <Symbol kind={firstKind} color={tokenVar(NO_DATA_TOKEN)} />
            No height measured
          </li>
        )}
      </ul>
    </div>
  );
}
