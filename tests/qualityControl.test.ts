import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyQc, describeRule, evaluateQc, SWOT_FILL } from '@/qc/qualityControl';

/** Hydrocron with `Accept: text/csv` returns the CSV as a JSON-encoded string. */
function loadFixture(name: string): Record<string, string>[] {
  const csv = JSON.parse(readFileSync(`tests/fixtures/hydrocron_${name}.csv`, 'utf8')) as string;
  const [header, ...lines] = csv.trim().split('\n');
  const cols = header!.split(',');
  return lines.map((line) => Object.fromEntries(line.split(',').map((v, i) => [cols[i], v])));
}

describe('evaluateQc (lake)', () => {
  const ok = { wse: '600.1', wse_u: '0.05', quality_f: '1' };

  it('keeps flag 0/1 with wse_u <= 0.10 m', () => {
    expect(evaluateQc(ok, 'lake').pass).toBe(true);
    expect(evaluateQc({ ...ok, quality_f: '0', wse_u: '0.1' }, 'lake').pass).toBe(true);
  });

  it('rejects flags 2 and 3', () => {
    expect(evaluateQc({ ...ok, quality_f: '2' }, 'lake')).toEqual({ pass: false, reason: 'bad_flag' });
    expect(evaluateQc({ ...ok, quality_f: '3' }, 'lake')).toEqual({ pass: false, reason: 'bad_flag' });
  });

  it('rejects wse_u above the limit', () => {
    expect(evaluateQc({ ...ok, wse_u: '0.1001' }, 'lake')).toEqual({ pass: false, reason: 'wse_u_too_high' });
  });

  it('rejects fill values even though they are <= 0.10', () => {
    expect(evaluateQc({ ...ok, wse_u: String(SWOT_FILL) }, 'lake')).toEqual({ pass: false, reason: 'missing_wse_u' });
    expect(evaluateQc({ ...ok, wse: String(SWOT_FILL) }, 'lake')).toEqual({ pass: false, reason: 'not_observed' });
    expect(evaluateQc({ ...ok, quality_f: 'no_data' }, 'lake')).toEqual({ pass: false, reason: 'missing_flag' });
  });

  it('uses reach_q for river reaches', () => {
    expect(evaluateQc({ wse: '480', wse_u: '0.05', reach_q: '1' }, 'reach').pass).toBe(true);
    expect(evaluateQc({ wse: '480', wse_u: '0.05', reach_q: '2' }, 'reach').pass).toBe(false);
  });

  it('removes only unobserved rows when QC is off', () => {
    const rule = { enabled: false, allowedFlags: [0, 1], maxWseU: 0.1 };
    expect(evaluateQc({ ...ok, quality_f: '3' }, 'lake', rule).pass).toBe(true);
    expect(evaluateQc({ ...ok, wse: String(SWOT_FILL) }, 'lake', rule).pass).toBe(false);
  });
});

describe('applyQc on real Hydrocron data', () => {
  it.each(['gerd', 'roseires', 'tekeze'])('%s: every kept row satisfies the rule', (name) => {
    const rows = loadFixture(name);
    const { rows: kept, summary } = applyQc(rows, 'lake');

    expect(summary.total).toBe(rows.length);
    expect(summary.kept).toBe(kept.length);
    expect(summary.kept + Object.values(summary.rejected).reduce((a, b) => a + b, 0)).toBe(rows.length);
    for (const r of kept) {
      expect(['0', '1']).toContain(r.quality_f);
      expect(Number(r.wse_u)).toBeGreaterThanOrEqual(0);
      expect(Number(r.wse_u)).toBeLessThanOrEqual(0.1);
      expect(Number(r.wse)).toBeGreaterThan(0);
    }
  });

  it('flagged mode keeps every row and tags it', () => {
    const rows = loadFixture('tekeze');
    const { rows: out, summary } = applyQc(rows, 'lake', undefined, true);
    expect(out).toHaveLength(rows.length);
    expect(out.filter((r) => r.qc_pass)).toHaveLength(summary.kept);
    expect(summary.rejected.not_observed).toBeGreaterThan(0);
  });
});

it('describes the rule for export headers', () => {
  expect(describeRule('lake')).toBe('QC: quality_f in {0,1} and wse_u <= 0.1 m; fill values removed');
});
