import { describe, expect, it } from 'vitest';

import { plainReasons, type StoredVerdict } from './quality-verdict-shared';

const base: StoredVerdict = {
  approved: false,
  rejectedBy: 'low_score',
  reasons: [],
  scores: { brandFit: 8, factualSafety: 3, clarity: 5, storylineFit: null, evidenceDiscipline: null },
  below: ['factualSafety', 'clarity'],
  judge: 'openai',
  judgeModel: 'm',
  checkedAt: '2026-11-22T10:00:00.000Z',
  source: 'pipeline',
};

describe('plainReasons', () => {
  it('names each failed score with its value', () => {
    expect(plainReasons(base)).toEqual([
      { key: 'factualSafety', score: 3 },
      { key: 'clarity', score: 5 },
    ]);
  });
  it('maps both unavailable codes to one plain reason', () => {
    expect(plainReasons({ ...base, rejectedBy: 'judge_unavailable' })).toEqual([{ key: 'unavailable' }]);
    expect(plainReasons({ ...base, rejectedBy: 'gate_unavailable' })).toEqual([{ key: 'unavailable' }]);
  });
  it('falls back for unknown codes and says nothing for a pass', () => {
    expect(plainReasons({ ...base, rejectedBy: 'new_check' })).toEqual([{ key: 'other' }]);
    expect(plainReasons({ ...base, approved: true })).toEqual([]);
    expect(plainReasons(null)).toEqual([]);
  });
});
