'use server';

/**
 * Narrative — the layer that gives a workspace a position.
 *
 * Reuses `loadIdeationContext` as the source of intelligence, so the narrative
 * is built from exactly the data ideation already refuses to run without.
 */

import { revalidatePath } from 'next/cache';
import type { EvidenceKind } from '@prisma/client';

import { getSession } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { writeActivityLog } from '@/lib/activity-log';
import {
  draftStorylines,
  proposeChanges,
  type ChangeHypothesis,
  type NarrativeContext,
} from '@/lib/narrative/engine';

type Ok<T> = { ok: true } & T;
type Fail = { ok: false; error: string };
type Result<T = unknown> = Ok<T> | Fail;

/** Discriminated so `'error' in actor` narrows to the failure branch. */
type Actor = { ok: true; userId: string; workspaceId: string } | { ok: false; error: string };

const EVIDENCE_KINDS: EvidenceKind[] = [
  'CUSTOMER_COUNT',
  'PUBLIC_NUMBER',
  'NAMED_CUSTOMER',
  'FIRSTHAND_EXPERIENCE',
  'FORBIDDEN_CLAIM',
];

async function authorise(workspaceId: string): Promise<Actor> {
  const session = await getSession();
  if (!session) return { ok: false, error: 'Not authenticated' };
  const workspace = await prisma.workspace.findFirst({
    where: { id: workspaceId, userId: session.userId as string },
    select: { id: true },
  });
  if (!workspace) return { ok: false, error: 'Workspace not found.' };
  return { ok: true, userId: session.userId as string, workspaceId };
}

/**
 * Loads the intelligence a narrative is built from.
 *
 * Deliberately a stricter-than-nothing but looser-than-ideation gate. Dunford's
 * positioning inputs are the competitive alternatives and a market frame that
 * puts your strengths at the centre — here, the accepted competitors and the
 * matrices. Keyword gaps sharpen the change hypothesis but are not load-bearing,
 * so they are passed through when present and never required. Requiring them
 * would gate the narrative harder than the frameworks justify.
 */
async function loadContext(
  actor: { userId: string; workspaceId: string },
): Promise<NarrativeContext | { error: string }> {
  const workspace = await prisma.workspace.findUnique({
    where: { id: actor.workspaceId },
    select: { brandSummary: true, audienceInsights: true },
  });
  if (!workspace?.brandSummary) {
    return { error: 'Build Brand Memory first — the narrative is written from it.' };
  }

  const insights =
    workspace.audienceInsights && typeof workspace.audienceInsights === 'object'
      ? (workspace.audienceInsights as Record<string, any>)
      : {};
  const competitiveMatrices = insights.competitiveMatrices;

  if (!Array.isArray(competitiveMatrices?.charts) || competitiveMatrices.charts.length === 0) {
    return { error: 'Generate the positioning charts first — they are the market frame.' };
  }

  const competitors = await prisma.competitor.findMany({
    where: { workspaceId: actor.workspaceId, userDecision: 'ACCEPTED' },
    select: { name: true, domain: true, description: true },
    take: 12,
  });

  if (competitors.length < 2) {
    return { error: 'Accept at least two competitors — a position needs something to be against.' };
  }

  return {
    brandSummary: workspace.brandSummary,
    competitiveMatrices,
    competitorKeywordsIntel: insights.competitorKeywordsIntel ?? null,
    competitors,
  };
}

// ─── Read ─────────────────────────────────────────────────────────────────────

export async function getNarrative(workspaceId: string) {
  const actor = await authorise(workspaceId);
  if (!actor.ok) return { ok: false as const, error: actor.error };

  const [narrative, evidence] = await Promise.all([
    prisma.narrative.findUnique({
      where: { workspaceId },
      include: { storylines: { orderBy: { position: 'asc' } } },
    }),
    prisma.evidence.findMany({ where: { workspaceId }, orderBy: { createdAt: 'asc' } }),
  ]);

  return { ok: true as const, narrative, evidence };
}

// ─── Evidence ─────────────────────────────────────────────────────────────────

export async function addEvidence(
  workspaceId: string,
  input: { kind: string; value: string; detail?: string },
): Promise<Result<{ id: string }>> {
  const actor = await authorise(workspaceId);
  if (!actor.ok) return { ok: false, error: actor.error };

  const kind = input.kind as EvidenceKind;
  if (!EVIDENCE_KINDS.includes(kind)) return { ok: false, error: 'Unknown evidence type.' };
  const value = String(input.value ?? '').trim();
  if (value.length < 2) return { ok: false, error: 'Say a little more than that.' };
  if (value.length > 600) return { ok: false, error: 'Keep it under 600 characters.' };

  const row = await prisma.evidence.create({
    data: { workspaceId, kind, value, detail: input.detail?.trim() || null },
  });
  revalidatePath(`/growth/${workspaceId}`);
  return { ok: true, id: row.id };
}

export async function deleteEvidence(
  workspaceId: string,
  evidenceId: string,
): Promise<Result> {
  const actor = await authorise(workspaceId);
  if (!actor.ok) return { ok: false, error: actor.error };

  await prisma.evidence.deleteMany({ where: { id: evidenceId, workspaceId } });
  revalidatePath(`/growth/${workspaceId}`);
  return { ok: true };
}

// ─── The change ───────────────────────────────────────────────────────────────

/**
 * Proposes candidate changes. Nothing is committed — the caller picks one,
 * edits it, or writes their own.
 */
export async function proposeChange(
  workspaceId: string,
): Promise<Result<{ options: ChangeHypothesis[] }>> {
  const actor = await authorise(workspaceId);
  if (!actor.ok) return { ok: false, error: actor.error };

  const ctx = await loadContext(actor);
  if ('error' in ctx) return { ok: false, error: ctx.error };

  const proposed = await proposeChanges(ctx);
  if (!proposed) {
    return {
      ok: false,
      error: 'Both AI providers are unavailable right now. Nothing was saved — try again shortly.',
    };
  }

  await prisma.narrative.upsert({
    where: { workspaceId },
    create: { workspaceId, changeOptions: proposed.options as any, generatedBy: proposed.provider },
    update: { changeOptions: proposed.options as any, generatedBy: proposed.provider },
  });

  revalidatePath(`/growth/${workspaceId}`);
  return { ok: true, options: proposed.options };
}

/** Commits the change. `source` records whether a human wrote it or accepted ours. */
export async function setChange(
  workspaceId: string,
  change: string,
  source: 'PROPOSED' | 'EDITED' | 'HUMAN',
): Promise<Result> {
  const actor = await authorise(workspaceId);
  if (!actor.ok) return { ok: false, error: actor.error };

  const value = change.trim();
  if (value.length < 10) return { ok: false, error: 'The change needs to be a full sentence.' };

  await prisma.narrative.upsert({
    where: { workspaceId },
    create: { workspaceId, change: value, changeSource: source },
    update: { change: value, changeSource: source },
  });
  revalidatePath(`/growth/${workspaceId}`);
  return { ok: true };
}

// ─── Storylines ───────────────────────────────────────────────────────────────

/** Drafts the storylines from the agreed change. Replaces any previous draft. */
export async function generateStorylines(
  workspaceId: string,
): Promise<Result<{ count: number }>> {
  const actor = await authorise(workspaceId);
  if (!actor.ok) return { ok: false, error: actor.error };

  const narrative = await prisma.narrative.findUnique({ where: { workspaceId } });
  if (!narrative?.change) {
    return { ok: false, error: 'Agree on the change first — every storyline hangs off it.' };
  }

  const ctx = await loadContext(actor);
  if ('error' in ctx) return { ok: false, error: ctx.error };

  const evidence = await prisma.evidence.findMany({ where: { workspaceId } });

  const drafted = await draftStorylines(
    ctx,
    narrative.change,
    evidence.map((e) => ({ kind: e.kind, value: e.value, detail: e.detail })),
  );
  if (!drafted) {
    return {
      ok: false,
      error: 'Both AI providers are unavailable right now. Nothing was saved — try again shortly.',
    };
  }

  const allowedEvidenceIds = evidence.filter((e) => e.kind !== 'FORBIDDEN_CLAIM').map((e) => e.id);

  await prisma.$transaction([
    prisma.storyline.deleteMany({ where: { narrativeId: narrative.id } }),
    prisma.storyline.createMany({
      data: drafted.storylines.map((s, i) => ({
        narrativeId: narrative.id,
        claim: s.claim,
        audience: s.audience || null,
        winners: s.winners || null,
        losers: s.losers || null,
        promisedLand: s.promisedLand,
        gifts: s.gifts as any,
        sourceRefs: s.sourceRefs as any,
        evidenceIds: allowedEvidenceIds,
        neverClaim: [],
        position: i,
      })),
    }),
    prisma.narrative.update({
      where: { id: narrative.id },
      data: {
        status: 'ACTIVE',
        generatedBy: drafted.provider,
        generatedAt: new Date(),
        sourceSnapshot: {
          competitors: ctx.competitors.map((c) => c.name),
          chartCount: Array.isArray(ctx.competitiveMatrices?.charts)
            ? ctx.competitiveMatrices.charts.length
            : 0,
          evidenceCount: evidence.length,
          at: new Date().toISOString(),
        } as any,
      },
    }),
  ]);

  await writeActivityLog({
    userId: actor.userId,
    workspaceId,
    action: 'NARRATIVE_GENERATED',
    detail: {
      storylines: drafted.storylines.length,
      provider: drafted.provider,
      changeSource: narrative.changeSource,
    },
  });

  revalidatePath(`/growth/${workspaceId}`);
  return { ok: true, count: drafted.storylines.length };
}

/** Founder corrections. The draft is a starting point, not the answer. */
export async function updateStoryline(
  workspaceId: string,
  storylineId: string,
  patch: { claim?: string; promisedLand?: string; audience?: string; enabled?: boolean },
): Promise<Result> {
  const actor = await authorise(workspaceId);
  if (!actor.ok) return { ok: false, error: actor.error };

  const storyline = await prisma.storyline.findFirst({
    where: { id: storylineId, narrative: { workspaceId } },
    select: { id: true },
  });
  if (!storyline) return { ok: false, error: 'Storyline not found.' };

  await prisma.storyline.update({
    where: { id: storylineId },
    data: {
      ...(patch.claim !== undefined ? { claim: patch.claim.trim() } : {}),
      ...(patch.promisedLand !== undefined ? { promisedLand: patch.promisedLand.trim() } : {}),
      ...(patch.audience !== undefined ? { audience: patch.audience.trim() || null } : {}),
      ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
    },
  });
  revalidatePath(`/growth/${workspaceId}`);
  return { ok: true };
}
