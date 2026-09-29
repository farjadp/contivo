import { describe, expect, it } from 'vitest';
import {
  REQUIRED_MATRIX_CHARTS,
  isFabricatedLegacyMatrices,
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

const FALLBACK_REASON = 'Score estimated from limited evidence and public positioning signals.';
const FALLBACK_PATTERN = 'Estimated pattern from limited public signals.';
const genuineChart = () => ({
  summary: { market_pattern: 'Everyone sells the suite.' },
  companies: [{ x_reason: 'Sells one product.', confidence_score: 0.42 }],
});

describe('isFabricatedLegacyMatrices', () => {
  it('flags a legacy blob carrying the old fallback reason and confidence', () => {
    const blob = {
      charts: [genuineChart(), { ...genuineChart(), companies: [{ x_reason: FALLBACK_REASON, confidence_score: 0.42 }] }, genuineChart()],
    };
    expect(isFabricatedLegacyMatrices(blob)).toBe(true);
  });
  it('flags a legacy blob carrying the old fallback market pattern', () => {
    const blob = { charts: [genuineChart(), { ...genuineChart(), summary: { market_pattern: FALLBACK_PATTERN } }, genuineChart()] };
    expect(isFabricatedLegacyMatrices(blob)).toBe(true);
  });
  it('needs both halves of the company signature', () => {
    const blob = { charts: [{ ...genuineChart(), companies: [{ x_reason: FALLBACK_REASON, confidence_score: 0.9 }] }] };
    expect(isFabricatedLegacyMatrices(blob)).toBe(false);
  });
  it('passes a genuine legacy blob and never flags a current-pipeline blob', () => {
    expect(isFabricatedLegacyMatrices({ charts: [genuineChart(), genuineChart(), genuineChart()] })).toBe(false);
    expect(
      isFabricatedLegacyMatrices({ run_id: 'r', charts: [{ summary: { market_pattern: FALLBACK_PATTERN } }] }),
    ).toBe(false);
  });
  it('is false for malformed input', () => {
    for (const v of [undefined, null, 'x', {}, { charts: 'no' }, { charts: [null, 3] }]) {
      expect(isFabricatedLegacyMatrices(v)).toBe(false);
    }
  });
});

describe('fabricated legacy blobs close the gates', () => {
  const fabricated = {
    charts: [genuineChart(), genuineChart(), { summary: { market_pattern: FALLBACK_PATTERN }, companies: [] }],
  };
  it('matricesGate refuses one', () => {
    expect(matricesGate(fabricated).ok).toBe(false);
    expect(matricesGate({ charts: [genuineChart(), genuineChart(), genuineChart()] })).toEqual({
      ok: true,
      competitorBasis: 'UNKNOWN',
    });
  });
  it('missingReportRequirements lists market matrices for one', () => {
    expect(missingReportRequirements({ a: 1 }, { ...full(3), competitiveMatrices: fabricated })).toEqual(['marketMatrices']);
  });
});
