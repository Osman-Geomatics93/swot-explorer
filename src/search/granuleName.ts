/**
 * SWOT granule names, as seen in CMR (Version D):
 *   SWOT_L2_HR_RiverSP_Reach_039_290_AF_20251001T101231_20251001T102351_PID0_01_swot
 *   SWOT_L2_HR_RiverAvg_039_AF_11_20250921T020646_20251011T225152_PID0_01
 *   SWOT_L2_HR_PIXC_039_318_135R_20251002T101752_20251002T101803_PID0_01
 *   SWOT_L2_HR_Raster_100m_UTM36P_N_x_x_x_039_318_068F_20251002T101752_20251002T101810_PID0_01_swot
 *   SWOT_L2_LR_SSH_Expert_039_318_20251002T095530_20251002T104658_PID0_01_swot
 */

export interface GranuleName {
  cycle: string | null;
  pass: string | null;
  /** Continent code (AF, EU, ...) for continental products. */
  continent: string | null;
  /** PIXC tile (e.g. 135R) or raster scene (e.g. 068F). */
  tile: string | null;
  start: string | null;
  /** Name without the CRID/counter suffix: identical for reprocessed versions of one granule. */
  baseName: string;
  /** CRID + counter, e.g. PID0_01; sorts so the newest reprocessing is last. */
  version: string;
}

const STAMP = /\d{8}T\d{6}/;

export function parseGranuleName(name: string): GranuleName {
  const clean = name.replace(/_swot$/, '');
  const tokens = clean.split('_');
  const version = tokens.slice(-2).join('_');
  const baseName = tokens.slice(0, -2).join('_');
  const stampIdx = tokens.findIndex((t) => STAMP.test(t));
  const head = stampIdx > 0 ? tokens.slice(0, stampIdx) : tokens;
  const nums = head.map((t, i) => [t, i] as const).filter(([t]) => /^\d{3}$/.test(t));

  const cycle = nums[0]?.[0] ?? null;
  const pass = nums[1]?.[0] ?? null;
  const afterPass = nums[1] ? head[nums[1][1] + 1] : nums[0] ? head[nums[0][1] + 1] : undefined;

  let continent: string | null = null;
  let tile: string | null = null;
  if (afterPass && /^[A-Z]{2}$/.test(afterPass)) continent = afterPass;
  else if (afterPass && /^\d{3}[A-Z]$/.test(afterPass)) tile = afterPass;

  const stamp = stampIdx >= 0 ? tokens[stampIdx]! : null;
  const start = stamp
    ? `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}T${stamp.slice(9, 11)}:${stamp.slice(11, 13)}:${stamp.slice(13, 15)}Z`
    : null;

  return { cycle, pass, continent, tile, start, baseName, version };
}

/** Keep only the newest reprocessed version of each granule. */
export function latestVersions<T extends { name: string }>(items: T[]): { items: T[]; removed: number } {
  const best = new Map<string, T>();
  for (const item of items) {
    const { baseName, version } = parseGranuleName(item.name);
    const cur = best.get(baseName);
    if (!cur || version > parseGranuleName(cur.name).version) best.set(baseName, item);
  }
  return { items: [...best.values()], removed: items.length - best.size };
}
