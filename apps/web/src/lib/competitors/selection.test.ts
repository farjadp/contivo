import { describe, expect, it } from 'vitest';
import { competitorOrigin, ONBOARDING_GUESS_SOURCE, parseStoredBasis, selectCompetitors } from './selection';

const c = (userDecision: string | null, confidence: number | null, id = '') => ({ userDecision, confidence, id });

describe('selectCompetitors', () => {
  it('prefers accepted competitors and ignores confidence', () => {
    const { competitors, basis } = selectCompetitors([c('ACCEPTED', null, 'a'), c('PENDING', 0.95, 'b')]);
    expect(basis).toBe('ACCEPTED');
    expect(competitors.map((x) => x.id)).toEqual(['a']);
  });

  it('falls back only to pending competitors that are high-confidence AND corroborated', () => {
    const corroborated = { ...c('PENDING', 0.95, 'a'), evidence: [{ query: 'q1' }, { query: 'q2' }] };
    const highButAlone = { ...c('PENDING', 0.95, 'b'), evidence: [{ query: 'q1' }, { query: 'q1' }] };
    const corroboratedButLow = { ...c('PENDING', 0.7, 'c'), evidence: [{ query: 'q1' }, { query: 'q2' }] };
    const { competitors, basis } = selectCompetitors([corroborated, highButAlone, corroboratedButLow]);
    expect(basis).toBe('UNCONFIRMED_HIGH');
    expect(competitors.map((x) => x.id)).toEqual(['a']);
  });

  it('treats more than one source as corroboration too', () => {
    const twoSources = { ...c('PENDING', 0.95, 'a'), sources: ['WEB_SEARCH', 'SERP'], evidence: [{ query: 'q1' }] };
    expect(selectCompetitors([twoSources]).competitors.map((x) => x.id)).toEqual(['a']);
  });

  it('never corroborates from malformed evidence', () => {
    const junk = { ...c('PENDING', 0.99, 'a'), evidence: 'not an array' };
    expect(selectCompetitors([junk])).toEqual({ competitors: [], basis: 'NONE' });
  });

  it('never returns rejected competitors', () => {
    expect(selectCompetitors([c('REJECTED', 0.99, 'a')])).toEqual({ competitors: [], basis: 'NONE' });
  });

  it('never returns legacy pending rows with no confidence', () => {
    expect(selectCompetitors([c('PENDING', null, 'a')])).toEqual({ competitors: [], basis: 'NONE' });
  });
});

describe('onboarding-seeded competitors (I4): an initial guess can never feed analysis', () => {
  // Exactly the shape growth.ts's onboarding writes: a model-named row with
  // no decision, no confidence, no evidence, no sources, no discovery run.
  const guess = (id: string) => ({
    id,
    source: ONBOARDING_GUESS_SOURCE,
    userDecision: null,
    confidence: null,
    sources: [] as string[],
    evidence: null,
    discoveryRunId: null,
  });

  it('is excluded when it is the only kind of competitor: basis NONE, nothing selected', () => {
    const { competitors, basis } = selectCompetitors([guess('g1'), guess('g2'), guess('g3')]);
    expect(basis).toBe('NONE');
    expect(competitors).toEqual([]);
  });

  it('is excluded alongside high-confidence corroborated candidates, which are selected on their own', () => {
    const candidate = {
      id: 'real',
      source: 'AI',
      userDecision: 'PENDING',
      confidence: 0.95,
      sources: ['WEB_SEARCH'],
      evidence: [{ query: 'q1' }, { query: 'q2' }],
      discoveryRunId: 'run-1',
    };
    const { competitors, basis } = selectCompetitors([guess('g1'), candidate]);
    expect(basis).toBe('UNCONFIRMED_HIGH');
    expect(competitors.map((x) => x.id)).toEqual(['real']);
  });

  it('feeds analysis only once the user accepts it, like any competitor they confirm', () => {
    const { competitors, basis } = selectCompetitors([{ ...guess('g1'), userDecision: 'ACCEPTED' }]);
    expect(basis).toBe('ACCEPTED');
    expect(competitors.map((x) => x.id)).toEqual(['g1']);
  });
});

describe('competitorOrigin', () => {
  it('marks onboarding-seeded rows as an initial guess', () => {
    expect(competitorOrigin({ source: ONBOARDING_GUESS_SOURCE, discoveryRunId: null })).toBe('initialGuess');
  });

  it('marks pre-marker AI rows that never went through a discovery run as an initial guess', () => {
    expect(competitorOrigin({ source: 'AI', discoveryRunId: null })).toBe('initialGuess');
  });

  it('marks rows a discovery run saved as evidence-backed, and manual rows as manual', () => {
    expect(competitorOrigin({ source: 'AI', discoveryRunId: 'run-1' })).toBe('evidence');
    expect(competitorOrigin({ source: ONBOARDING_GUESS_SOURCE, discoveryRunId: 'run-1' })).toBe('evidence');
    expect(competitorOrigin({ source: 'MANUAL', discoveryRunId: null })).toBe('manual');
  });
});

describe('parseStoredBasis', () => {
  it('reads the three known values and nothing else', () => {
    expect(parseStoredBasis('ACCEPTED')).toBe('ACCEPTED');
    expect(parseStoredBasis('UNCONFIRMED_HIGH')).toBe('UNCONFIRMED_HIGH');
    expect(parseStoredBasis('NONE')).toBe('NONE');
    expect(parseStoredBasis(undefined)).toBeUndefined();
    expect(parseStoredBasis('accepted')).toBeUndefined();
    expect(parseStoredBasis(1)).toBeUndefined();
  });
});
