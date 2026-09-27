import { describe, expect, it } from 'vitest';
import { selectCompetitors } from './selection';

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
