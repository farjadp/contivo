import { describe, expect, it } from 'vitest';
import {
  REQUIRED_MATRIX_CHARTS,
  matricesGate,
  missingReportRequirements,
} from './report-readiness';

const charts = (n: number) => Array.from({ length: n }, () => ({}));
const full = (n: number) => ({
  competitiveMatrices: { charts: charts(n) },
  competitorKeywordsIntel: { competitors: [{}] },
  productsServicesIntel: { client_offerings: { offerings: [{}] } },
});

describe('report readiness threshold', () => {
  it('requires three charts', () => {
    expect(REQUIRED_MATRIX_CHARTS).toBe(3);
  });
  it('treats 3 charts as ready and 2 as not', () => {
    expect(missingReportRequirements({ a: 1 }, full(3))).toEqual([]);
    expect(missingReportRequirements({ a: 1 }, full(2))).toEqual(['marketMatrices']);
  });
});

describe('matricesGate', () => {
  it('passes a new blob with enough charts and an accepted basis', () => {
    expect(matricesGate({ run_id: 'r', charts: charts(3), competitor_basis: 'ACCEPTED' })).toEqual({
      ok: true,
      competitorBasis: 'ACCEPTED',
    });
    expect(
      matricesGate({ run_id: 'r', charts: charts(3), competitor_basis: 'UNCONFIRMED_HIGH' }),
    ).toEqual({ ok: true, competitorBasis: 'UNCONFIRMED_HIGH' });
  });
  it('fails a new blob with a missing or NONE basis', () => {
    expect(matricesGate({ run_id: 'r', charts: charts(3) }).ok).toBe(false);
    expect(matricesGate({ run_id: 'r', charts: charts(3), competitor_basis: 'NONE' }).ok).toBe(false);
  });
  it('fails a new blob with too few charts', () => {
    expect(matricesGate({ run_id: 'r', charts: charts(2), competitor_basis: 'ACCEPTED' }).ok).toBe(false);
  });
  it('passes a legacy blob with enough charts as UNKNOWN, ignoring any basis', () => {
    expect(matricesGate({ charts: charts(3) })).toEqual({ ok: true, competitorBasis: 'UNKNOWN' });
    expect(matricesGate({ charts: charts(5), competitor_basis: 'NONE' })).toEqual({
      ok: true,
      competitorBasis: 'UNKNOWN',
    });
  });
  it('fails a legacy blob with too few charts and never names five', () => {
    const r = matricesGate({ charts: charts(2) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).not.toMatch(/\b5\b/);
  });
  it('fails on missing, non-object, or chartless input', () => {
    for (const v of [undefined, null, 'x', {}, { charts: 'no' }]) {
      expect(matricesGate(v).ok).toBe(false);
    }
  });
});
