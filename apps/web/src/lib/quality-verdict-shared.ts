/**
 * quality-verdict-shared.ts
 *
 * The pure half of quality-verdict.ts: the stored shape, the blocked rule and
 * the plain-language reasons. No prisma, no AI client, so the Pipeline card
 * and the Ideation preview can import it in the browser.
 */

import type { GateScores } from '@/lib/autopilot/quality-gate';

export type VerdictSource = 'preview' | 'pipeline' | 'autopilot' | 'recheck';

export type StoredVerdict = {
  approved: boolean;
  rejectedBy: string | null;
  reasons: string[];
  scores: GateScores | null;
  /** Score names under their threshold, computed on the server when stored. */
  below?: Array<keyof GateScores>;
  judge: string;
  judgeModel: string | null;
  checkedAt: string;
  source: VerdictSource;
  override?: { userId: string; at: string };
};

/** Reads the column defensively: it is JSON, so anything can be in it. */
export function readStoredVerdict(value: unknown): StoredVerdict | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Partial<StoredVerdict>;
  if (typeof v.approved !== 'boolean') return null;
  return v as StoredVerdict;
}

/**
 * Blocked = gated by this system, not approved, and not overridden. A null
 * column is never blocked. A malformed non-null value is blocked: fail closed.
 * An override lasts until the text changes (editing resets it to not_checked),
 * so rescheduling an overridden post does not ask again.
 */
export function isBlockedVerdict(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  const v = readStoredVerdict(value);
  if (!v) return true;
  return v.approved !== true && !v.override;
}

/** Message keys under `tabsA.quality.reasons`, one per rejection code. */
export type ReasonKey =
  | 'empty'
  | 'platform_char_limit'
  | 'word_count'
  | 'leakage'
  | 'avoid_list'
  | 'duplicate'
  | 'unavailable'
  | 'judge_veto'
  | 'not_checked'
  | 'brandFit'
  | 'factualSafety'
  | 'clarity'
  | 'storylineFit'
  | 'evidenceDiscipline'
  | 'low_score'
  | 'other';

export type PlainReason = { key: ReasonKey; score?: number };

const DIRECT: Record<string, ReasonKey> = {
  empty: 'empty',
  platform_char_limit: 'platform_char_limit',
  word_count: 'word_count',
  leakage: 'leakage',
  avoid_list: 'avoid_list',
  duplicate: 'duplicate',
  judge_unavailable: 'unavailable',
  gate_unavailable: 'unavailable',
  judge_veto: 'judge_veto',
  not_checked: 'not_checked',
};

/**
 * What the user reads in the badge and the "Publish anyway" dialog: the
 * gate's rejection as plain-language message keys, one per failed score for
 * low_score. The gate's own English reason strings stay in the record for
 * the audit log; they are not shown as the explanation.
 */
export function plainReasons(verdict: StoredVerdict | null): PlainReason[] {
  if (!verdict || verdict.approved) return [];
  const code = verdict.rejectedBy ?? '';
  if (DIRECT[code]) return [{ key: DIRECT[code] }];
  if (code === 'low_score') {
    const below = (verdict.below ?? []).filter((k) => verdict.scores && verdict.scores[k] !== null);
    if (below.length === 0) return [{ key: 'low_score' }];
    return below.map((k) => ({ key: k, score: Number(verdict.scores?.[k] ?? 0) }));
  }
  return [{ key: 'other' }];
}
