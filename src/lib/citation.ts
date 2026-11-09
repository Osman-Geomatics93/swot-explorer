/**
 * Data citations for exports, built from each collection's own CMR metadata
 * (UMM-C DOI + CollectionCitations), cached in chrome.storage.local since DOIs don't change.
 */
import { z } from 'zod';

const CMR = 'https://cmr.earthdata.nasa.gov/search/collections.umm_json';
const CACHE_KEY = 'citations';

const Umm = z.object({
  DOI: z.object({ DOI: z.string().optional() }).partial().optional(),
  CollectionCitations: z
    .array(z.object({ Creator: z.string(), Title: z.string(), Publisher: z.string(), ReleaseDate: z.string(), Version: z.string() }).partial())
    .optional(),
  EntryTitle: z.string().optional(),
});

export interface Citation {
  shortName: string;
  doi: string | null;
  text: string;
}

/** DAHITI's reference publication, as requested by the DAHITI team for any use of its data. */
export const DAHITI_CITATION =
  'Schwatke, C., Dettmering, D., Bosch, W., Seitz, F. (2015). DAHITI - an innovative approach for estimating water level time series over inland waters using multi-mission satellite altimetry. Hydrology and Earth System Sciences, 19, 4345-4364. https://doi.org/10.5194/hess-19-4345-2015';

export function formatCitation(shortName: string, umm: z.infer<typeof Umm>, accessed = new Date()): Citation {
  const c = umm.CollectionCitations?.[0] ?? {};
  const doi = umm.DOI?.DOI ?? null;
  const year = c.ReleaseDate?.slice(0, 4) ?? 'n.d.';
  const title = c.Title ?? umm.EntryTitle ?? shortName;
  const parts = [
    `${c.Creator ?? 'SWOT'}. (${year}). ${title}${c.Version ? ` (Version ${c.Version})` : ''} [Data set].`,
    `${c.Publisher ?? 'NASA Physical Oceanography DAAC'}.`,
    doi ? `https://doi.org/${doi}.` : `CMR short name ${shortName}.`,
    `Accessed ${accessed.toISOString().slice(0, 10)}.`,
  ];
  return { shortName, doi, text: parts.join(' ') };
}

export async function citationFor(shortName: string): Promise<Citation> {
  const cached = ((await browser.storage.local.get(CACHE_KEY))[CACHE_KEY] ?? {}) as Record<string, z.infer<typeof Umm>>;
  let umm = cached[shortName];
  if (!umm) {
    try {
      const resp = await fetch(`${CMR}?${new URLSearchParams({ short_name: shortName, provider: 'POCLOUD' })}`, { headers: { 'Client-Id': 'swot-explorer-ext' } });
      const item = resp.ok ? ((await resp.json()) as { items?: { umm: unknown }[] }).items?.[0] : undefined;
      umm = Umm.parse(item?.umm ?? {});
      // Cache real metadata only, so a failed lookup is retried next time; re-read to keep concurrent entries.
      if (item) {
        const latest = ((await browser.storage.local.get(CACHE_KEY))[CACHE_KEY] ?? {}) as Record<string, z.infer<typeof Umm>>;
        await browser.storage.local.set({ [CACHE_KEY]: { ...latest, [shortName]: umm } });
      }
    } catch {
      umm = {};
    }
  }
  return formatCitation(shortName, umm);
}

/** README fields: one citation per dataset used. */
export async function citationMeta(shortNames: string[], extra: string[] = []): Promise<Record<string, string>> {
  const cites = await Promise.all([...new Set(shortNames)].map(citationFor));
  const lines = [...cites.map((c) => c.text), ...extra];
  return Object.fromEntries(lines.map((text, i) => [lines.length === 1 ? 'cite_as' : `cite_as_${i + 1}`, text]));
}
