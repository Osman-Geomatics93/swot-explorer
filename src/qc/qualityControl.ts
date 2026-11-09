/**
 * SWOT quality control applied to every time-series export and every clipped
 * vector download (LakeSP / RiverSP features).
 *
 * Default keep rule: quality flag ∈ {0, 1} and wse_u ≤ 0.10 m.
 *   - Lakes use `quality_f`; river reaches use `reach_q`, nodes use `node_q`
 *     (same 0 good / 1 suspect / 2 degraded / 3 bad scale).
 *   - SWOT fill values (-999999999999) mean "not observed" and are always
 *     rejected. Without this check a fill wse_u (a large negative number)
 *     would pass `wse_u ≤ 0.10`.
 */

export const SWOT_FILL = -999999999999;

export type FeatureKind = 'lake' | 'reach' | 'node';

export interface QcRule {
  enabled: boolean;
  allowedFlags: number[];
  maxWseU: number; // metres
}

export const DEFAULT_QC_RULE: QcRule = {
  enabled: true,
  allowedFlags: [0, 1],
  maxWseU: 0.1,
};

export const QUALITY_FIELD: Record<FeatureKind, string> = {
  lake: 'quality_f',
  reach: 'reach_q',
  node: 'node_q',
};

/** Fields Hydrocron must return for the rule to be evaluated. */
export function qcFields(kind: FeatureKind): string[] {
  return [QUALITY_FIELD[kind], 'wse', 'wse_u'];
}

export type QcReason = 'not_observed' | 'missing_flag' | 'bad_flag' | 'missing_wse_u' | 'wse_u_too_high';

export interface QcResult {
  pass: boolean;
  reason?: QcReason;
}

type Row = Record<string, unknown>;

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '' || value === 'no_data') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

const isFill = (n: number | null) => n === null || n <= SWOT_FILL;

export function evaluateQc(record: object, kind: FeatureKind, rule: QcRule = DEFAULT_QC_RULE): QcResult {
  const row = record as Row;
  const wse = toNumber(row.wse);
  if (isFill(wse)) return { pass: false, reason: 'not_observed' };
  if (!rule.enabled) return { pass: true };

  const flag = toNumber(row[QUALITY_FIELD[kind]]);
  if (isFill(flag)) return { pass: false, reason: 'missing_flag' };
  if (!rule.allowedFlags.includes(flag as number)) return { pass: false, reason: 'bad_flag' };

  const wseU = toNumber(row.wse_u);
  if (isFill(wseU) || (wseU as number) < 0) return { pass: false, reason: 'missing_wse_u' };
  if ((wseU as number) > rule.maxWseU) return { pass: false, reason: 'wse_u_too_high' };

  return { pass: true };
}

export interface QcSummary {
  total: number;
  kept: number;
  rejected: Record<QcReason, number>;
}

/**
 * Filter rows. With `keepRejected` the rows are kept and tagged with
 * `qc_pass` / `qc_reason` columns instead of being dropped.
 */
export function applyQc<T extends Row>(
  rows: T[],
  kind: FeatureKind,
  rule: QcRule = DEFAULT_QC_RULE,
  keepRejected = false,
): { rows: (T & { qc_pass?: boolean; qc_reason?: QcReason | '' })[]; summary: QcSummary } {
  const summary: QcSummary = {
    total: rows.length,
    kept: 0,
    rejected: { not_observed: 0, missing_flag: 0, bad_flag: 0, missing_wse_u: 0, wse_u_too_high: 0 },
  };
  const out: (T & { qc_pass?: boolean; qc_reason?: QcReason | '' })[] = [];

  for (const row of rows) {
    const result = evaluateQc(row, kind, rule);
    if (result.pass) summary.kept++;
    else summary.rejected[result.reason as QcReason]++;

    if (keepRejected) out.push({ ...row, qc_pass: result.pass, qc_reason: result.reason ?? '' });
    else if (result.pass) out.push(row);
  }
  return { rows: out, summary };
}

/** One-line description written into export headers and file metadata. */
export function describeRule(kind: FeatureKind, rule: QcRule = DEFAULT_QC_RULE): string {
  if (!rule.enabled) return 'QC: off (only unobserved/fill rows removed)';
  return `QC: ${QUALITY_FIELD[kind]} in {${rule.allowedFlags.join(',')}} and wse_u <= ${rule.maxWseU} m; fill values removed`;
}
