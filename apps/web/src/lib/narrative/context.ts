/**
 * narrative/context.ts — the storyline as it reaches the rest of the pipeline.
 *
 * Ideation, drafting and the quality gate all need the same view of a
 * storyline, and they must agree: if the gate enforces a boundary the draft
 * prompt never saw, every draft fails and the queue stalls. One loader, one
 * prompt block, used by all three.
 */

import { prisma } from '@/lib/db';

export type StorylineContext = {
  id: string;
  claim: string;
  audience: string | null;
  promisedLand: string;
  winners: string | null;
  losers: string | null;
  gifts: string[];
  /** What this storyline may point at as proof. Empty means: argue, don't cite. */
  allowedEvidence: string[];
  /** Workspace-wide prohibitions plus this storyline's own. */
  neverClaim: string[];
};

function asArray(v: unknown): string[] {
  return Array.isArray(v) ? v.map(String).filter(Boolean) : [];
}

/** Loads one storyline with its evidence resolved. Null when it is gone or disabled. */
export async function loadStorylineContext(
  storylineId: string | null | undefined,
): Promise<StorylineContext | null> {
  if (!storylineId) return null;

  const storyline = await prisma.storyline.findUnique({
    where: { id: storylineId },
    include: { narrative: { select: { workspaceId: true } } },
  });
  if (!storyline || !storyline.enabled) return null;

  const evidence = await prisma.evidence.findMany({
    where: { workspaceId: storyline.narrative.workspaceId },
  });

  const allowed = evidence
    .filter((e) => e.kind !== 'FORBIDDEN_CLAIM' && storyline.evidenceIds.includes(e.id))
    .map((e) => `${e.value}${e.detail ? ` (${e.detail})` : ''}`);

  // Workspace prohibitions always apply, on top of the storyline's own.
  const forbidden = evidence.filter((e) => e.kind === 'FORBIDDEN_CLAIM').map((e) => e.value);

  return {
    id: storyline.id,
    claim: storyline.claim,
    audience: storyline.audience,
    promisedLand: storyline.promisedLand,
    winners: storyline.winners,
    losers: storyline.losers,
    gifts: asArray(storyline.gifts),
    allowedEvidence: allowed,
    neverClaim: [...storyline.neverClaim, ...forbidden],
  };
}

/**
 * Picks the storyline an autopilot run should advance next.
 *
 * `allowedIds` is the agent's own binding. Empty means the whole workspace, so
 * an agent created before the narrative layer keeps working and gains a
 * position for free rather than going quiet.
 */
export async function pickStorylineForWorkspace(
  workspaceId: string,
  /** Storylines used by the most recent items, so the runner does not hammer one claim. */
  recentlyUsedIds: string[] = [],
  allowedIds: string[] = [],
): Promise<StorylineContext | null> {
  const narrative = await prisma.narrative.findUnique({
    where: { workspaceId },
    include: { storylines: { where: { enabled: true }, orderBy: { position: 'asc' } } },
  });
  if (!narrative?.storylines.length) return null;

  const pool = allowedIds.length
    ? narrative.storylines.filter((s) => allowedIds.includes(s.id))
    : narrative.storylines;
  // The agent's bound storylines may all have been deleted or disabled since.
  // Falling back to the workspace beats going silent for reasons nobody can see.
  const candidates = pool.length ? pool : narrative.storylines;

  const leastRecent = candidates.find((s) => !recentlyUsedIds.includes(s.id)) ?? candidates[0];
  return loadStorylineContext(leastRecent.id);
}

/**
 * The prompt block. Shared verbatim by the draft generator and the judge so
 * the writer is told exactly what the reviewer will hold it to.
 */
export function storylinePromptBlock(s: StorylineContext): string {
  return `
STORYLINE this piece must advance
  Claim: ${s.claim}
  Audience: ${s.audience || 'as per the brand profile'}
  Where it leads: ${s.promisedLand}
${s.winners ? `  Who this rewards: ${s.winners}\n` : ''}${s.losers ? `  Who it leaves behind: ${s.losers}\n` : ''}${
    s.gifts.length ? `  How: ${s.gifts.join(' · ')}\n` : ''
  }
EVIDENCE this piece may point to as proof
${s.allowedEvidence.length ? s.allowedEvidence.map((e) => `  - ${e}`).join('\n') : '  - NONE. Argue from reasoning and observation. Do not imply customers, results or case studies.'}

NEVER CLAIM
${s.neverClaim.length ? s.neverClaim.map((c) => `  - ${c}`).join('\n') : '  - nothing specified'}
`.trim();
}
