/**
 * quality-verdict.ts
 *
 * The quality gate on AI drafts made by hand (defect B8, e2e handover
 * 2026-11-22). Until this, only the autopilot runner called `evaluateDraft`:
 * a draft generated from Ideation or the Pipeline went to SCHEDULED unjudged,
 * while the product says a draft "doesn't publish until it clears".
 *
 * The verdict lives in `content_items.qualityVerdict`:
 *   - null      → never gated by this system: legacy rows and the customer's
 *                 own "Write a post" text. They behave exactly as before.
 *   - approved  → cleared the gate.
 *   - otherwise → blocked. Approve / schedule / publish refuse it unless the
 *                 user explicitly overrides ("Publish anyway"), which is
 *                 recorded on the verdict and in activity_logs.
 *
 * An AI path never leaves it null. When it cannot judge, it stores a fail —
 * `not_checked` (the text changed since it was judged) or `gate_unavailable`
 * / `judge_unavailable` (no judge could run). Never a silent pass.
 */

import { prisma } from '@/lib/db';
import { writeActivityLog } from '@/lib/activity-log';
import { evaluateDraft, THRESHOLDS, type GateScores, type GateVerdict } from '@/lib/autopilot/quality-gate';
import {
  isBlockedVerdict,
  readStoredVerdict,
  type StoredVerdict,
  type VerdictSource,
} from '@/lib/quality-verdict-shared';
import { asContentLanguage } from '@/lib/content-language';
import { loadStorylineContext } from '@/lib/narrative/context';

export type { StoredVerdict, VerdictSource } from '@/lib/quality-verdict-shared';
export { isBlockedVerdict, readStoredVerdict } from '@/lib/quality-verdict-shared';

/** Error code returned/thrown when a blocked item is moved towards publishing. */
export const QUALITY_GATE_BLOCKED = 'quality_gate_blocked';

export class QualityGateBlockedError extends Error {
  constructor() {
    super(QUALITY_GATE_BLOCKED);
    this.name = 'QualityGateBlockedError';
  }
}

/** Same lookback and statuses the autopilot runner uses for its duplicate check. */
const RECENT_BODY_LOOKBACK = 10;
const RECENT_BODY_STATUSES = ['SCHEDULED', 'PUBLISHING', 'PUBLISHED'] as const;

export function toStoredVerdict(verdict: GateVerdict, source: VerdictSource, now = new Date()): StoredVerdict {
  return {
    approved: verdict.approved === true,
    rejectedBy: verdict.approved ? null : verdict.rejectedBy ?? 'unknown',
    reasons: (verdict.reasons ?? []).map((r) => String(r).slice(0, 300)).slice(0, 8),
    scores: verdict.scores ?? null,
    below: belowThreshold(verdict.scores ?? null),
    judge: String(verdict.judge),
    judgeModel: verdict.judgeModel ?? null,
    checkedAt: now.toISOString(),
    source,
  };
}

/** Which scores failed, so the UI can say so in the reader's language. */
function belowThreshold(scores: GateScores | null): Array<keyof GateScores> {
  if (!scores) return [];
  return (Object.keys(THRESHOLDS) as Array<keyof typeof THRESHOLDS>).filter((k) => {
    const v = scores[k];
    return typeof v === 'number' && v < THRESHOLDS[k];
  });
}

/** Stored when a gated text was changed after it was judged, or its token did not verify. */
export function notCheckedVerdict(source: VerdictSource, now = new Date()): StoredVerdict {
  return {
    approved: false,
    rejectedBy: 'not_checked',
    reasons: ['The quality check has not reviewed this text.'],
    scores: null,
    judge: 'skipped',
    judgeModel: null,
    checkedAt: now.toISOString(),
    source,
  };
}

export function gateUnavailableVerdict(source: VerdictSource, now = new Date()): StoredVerdict {
  return {
    approved: false,
    rejectedBy: 'gate_unavailable',
    reasons: ['The quality check could not run.'],
    scores: null,
    judge: 'unavailable',
    judgeModel: null,
    checkedAt: now.toISOString(),
    source,
  };
}

export type ManualGateInput = {
  actor: { userId: string; workspaceId: string };
  workspace: { brandSummary: unknown; contentLanguage?: string | null };
  content: string;
  topic: string;
  channel: string;
  storylineId?: string | null;
  /** The item being judged, left out of its own duplicate check. */
  excludeItemId?: string;
  source: VerdictSource;
};

/**
 * One gate call with the same context the autopilot runner gives it.
 * `avoidTopics` is an autopilot policy field, so the manual path has none.
 * Any failure to run is stored as a fail, never a pass.
 */
export async function runManualGate(input: ManualGateInput): Promise<StoredVerdict> {
  try {
    const [recent, storyline] = await Promise.all([
      prisma.contentItem.findMany({
        where: {
          workspaceId: input.actor.workspaceId,
          status: { in: [...RECENT_BODY_STATUSES] },
          ...(input.excludeItemId ? { id: { not: input.excludeItemId } } : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: RECENT_BODY_LOOKBACK,
        select: { content: true },
      }),
      loadStorylineContext(input.storylineId ?? null),
    ]);
    const verdict = await evaluateDraft({
      content: input.content,
      topic: input.topic,
      channel: input.channel,
      brandSummary: input.workspace.brandSummary,
      recentContents: recent.map((r) => String(r.content || '')).filter(Boolean),
      storyline,
      language: asContentLanguage(input.workspace.contentLanguage),
      aiContext: input.actor,
    });
    return toStoredVerdict(verdict, input.source);
  } catch (err) {
    console.error('[quality-gate] manual gate failed', err);
    return gateUnavailableVerdict(input.source);
  }
}

/**
 * Guard for every action that moves an item to READY or SCHEDULED.
 *
 * Returns the verdict to write back (with the override stamped on) when the
 * item is blocked and the user overrode it; null when nothing needs writing.
 * Throws QualityGateBlockedError when the item is blocked and there is no
 * override. Writes the QUALITY_GATE_OVERRIDDEN audit row.
 */
export async function enforceQualityGate(input: {
  item: { id: string; workspaceId: string | null; qualityVerdict: unknown };
  userId: string;
  override?: boolean;
}): Promise<StoredVerdict | null> {
  if (!isBlockedVerdict(input.item.qualityVerdict)) return null;
  if (input.override !== true) throw new QualityGateBlockedError();

  const current = readStoredVerdict(input.item.qualityVerdict);
  const at = new Date().toISOString();
  const next: StoredVerdict = {
    ...(current ?? notCheckedVerdict('pipeline')),
    override: { userId: input.userId, at },
  };
  if (input.item.workspaceId) {
    await writeActivityLog({
      userId: input.userId,
      workspaceId: input.item.workspaceId,
      action: 'QUALITY_GATE_OVERRIDDEN',
      detail: {
        itemId: input.item.id,
        rejectedBy: next.rejectedBy,
        reasons: next.reasons,
        judgeModel: next.judgeModel,
        at,
      },
    });
  }
  return next;
}
