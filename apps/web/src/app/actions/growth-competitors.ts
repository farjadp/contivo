'use server';

/**
 * Server-action boundary for competitor discovery. Everything the library
 * code under `@/lib/competitors/*` does — normalising domains, generating
 * queries, harvesting search results, enriching and judging candidates,
 * running the whole pipeline for one `DiscoveryRun` — is pure library code
 * that trusts its caller completely. This file is what stands between that
 * library and the browser, and it is the only thing that can.
 *
 * SECURITY: read this before adding or changing an action here.
 *
 * This file used to trust a client-supplied `workspaceId` outright. Any
 * signed-in user could pass any workspace's id and this file would write
 * competitors into it — and because ideation reads competitors, that was
 * content injection into another user's account, not just bad data. The
 * per-row competitor ids were trusted the same way, so a caller could
 * rename or re-classify any competitor row in the database by guessing (or
 * simply reusing, from their own devtools) an id that belonged to someone
 * else's workspace.
 *
 * Every action below therefore, in this order:
 *   1. Loads the workspace with `findFirst({ where: { id, userId } })`
 *      *before* doing anything else, and returns the exact same error for
 *      "not yours" as for "does not exist" — so this cannot be used to
 *      probe which workspace ids exist.
 *   2. Verifies every competitor id the client sends belongs to that same
 *      workspace before touching that row (via a `where: { id, workspaceId
 *      }` update/delete and checking the affected count, never a bare
 *      `where: { id }`).
 *   3. Validates every enum-ish input (`decision`, `type`,
 *      `rejectionReason`, `country`, `language`) against a fixed allowlist
 *      before it reaches Prisma — a TypeScript parameter type is a
 *      compile-time hint for callers written in this codebase, not a
 *      runtime guarantee, since a server action is a public RPC endpoint
 *      any authenticated browser session can call with an arbitrary
 *      payload.
 *
 * The browser never calls the Nest API directly from here either — these
 * actions talk to Prisma and to the pure pipeline library only.
 */

import { Prisma } from '@prisma/client';

import { prisma } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { actionError } from '@/lib/action-errors';
import { triggerBackgroundRun } from '@/lib/background-run';
import {
  getMaxDiscoveryRuns,
  getWorkspaceDiscoveryStats as getLegacyDiscoveryStats,
  writeActivityLog,
} from '@/lib/activity-log';
import { normalizeCandidateDomain } from '@/lib/competitors/domains';
import { buildBrandBrief } from '@/lib/competitors/queries';
import { enrichCandidates, judgeCandidates } from '@/lib/competitors/judge';
import { confidenceBand } from '@/lib/competitors/scoring';
import { sanitizeUpstreamText } from '@/lib/competitors/redact';
import { parseStoredEvidence, reapStaleRuns } from '@/lib/competitors/pipeline';
import type {
  Candidate,
  CompetitorLabel,
  CompetitorType,
  EvidenceItem,
  JudgedCandidate,
  SourceStats,
  TargetMarket,
} from '@/lib/competitors/types';

// ---------------------------------------------------------------------------
// Allowlists — every enum-ish value a caller can send is checked against
// exactly one of these before it reaches Prisma.
// ---------------------------------------------------------------------------

const DECISIONS = ['ACCEPTED', 'REJECTED', 'PENDING'] as const;
type Decision = (typeof DECISIONS)[number];
function isDecision(value: unknown): value is Decision {
  return typeof value === 'string' && (DECISIONS as readonly string[]).includes(value);
}

const COMPETITOR_TYPES = ['DIRECT', 'INDIRECT', 'ASPIRATIONAL'] as const;
function isCompetitorType(value: unknown): value is CompetitorType {
  return typeof value === 'string' && (COMPETITOR_TYPES as readonly string[]).includes(value);
}

/**
 * `rejectionReason` feeds `buildBrandBrief`, which puts it in front of a
 * model on the next run (`queries.ts`'s "rejected competitors" section). A
 * free-text reason here would be a prompt-injection channel from the
 * browser straight into that prompt, so it is a closed set like every other
 * enum-ish field, not a caption the user can type.
 */
const REJECTION_REASONS = ['NOT_A_COMPETITOR', 'WRONG_SCALE', 'DUPLICATE', 'ALREADY_KNOWN', 'OTHER'] as const;
type RejectionReason = (typeof REJECTION_REASONS)[number];
function isRejectionReason(value: unknown): value is RejectionReason {
  return typeof value === 'string' && (REJECTION_REASONS as readonly string[]).includes(value);
}

function isLanguage(value: unknown): value is 'fa' | 'en' {
  return value === 'fa' || value === 'en';
}

/**
 * No canonical list of supported countries exists anywhere in this repo —
 * `targetCountry` is a hint passed straight through to OpenAI's web-search
 * tool as `user_location.country` (`search.ts`), which itself expects an
 * ISO-3166-1 alpha-2 code. Validating the *shape* of that code is the real
 * allowlist here: it is exactly as restrictive as the one canonical list
 * would be, without maintaining a ~250-entry table this codebase has never
 * needed before, and it closes the same door — no free text reaches Prisma
 * or a prompt through this field.
 */
const COUNTRY_CODE_RE = /^[A-Z]{2}$/;
function isValidCountry(value: string | null): boolean {
  return value === null || COUNTRY_CODE_RE.test(value);
}

// ---------------------------------------------------------------------------
// Error-text hygiene — DiscoveryRun.error and .sourceStats are shown in the
// UI through this module's serializers. `sanitizeUpstreamText` (shared with
// the write sites in judge.ts, search.ts and queries.ts — see that module's
// doc comment) is applied again here as defence in depth: a write site
// added later that forgets to redact should not be the only thing standing
// between a leaked value and the browser.
// ---------------------------------------------------------------------------

function sanitizeSourceStats(value: unknown): SourceStats | null {
  if (!value || typeof value !== 'object') return null;
  const stats = value as SourceStats;
  if (!Array.isArray(stats.errors)) return stats;
  return { ...stats, errors: stats.errors.map((e) => sanitizeUpstreamText(e) ?? '') };
}

// ---------------------------------------------------------------------------
// View types returned to the client
// ---------------------------------------------------------------------------

export type DiscoveryMeta = { usedRuns: number; remainingRuns: number; maxRuns: number };

export type CompetitorView = {
  id: string;
  name: string;
  domain: string | null;
  description: string | null;
  type: CompetitorType;
  userDecision: Decision;
  rejectionReason: string | null;
  source: string;
  sources: string[];
  labels: CompetitorLabel[];
  confidence: number | null;
  confidenceBand: 'high' | 'medium' | 'low' | 'unknown';
  positioning: string | null;
  keyFeatures: string[];
  evidence: EvidenceItem[];
  createdAt: string;
};

export type RunView = {
  id: string;
  status: string;
  stage: string | null;
  savedCount: number;
  tokensUsed: number;
  error: string | null;
  sourceStats: SourceStats | null;
  startedAt: string;
  finishedAt: string | null;
};

export type RunHistoryItem = {
  id: string;
  status: string;
  stage: string | null;
  savedCount: number;
  tokensUsed: number;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
};

type CompetitorRow = {
  id: string;
  name: string;
  domain: string | null;
  description: string | null;
  type: string | null;
  userDecision: string | null;
  rejectionReason: string | null;
  source: string;
  sources: string[];
  labels: string[];
  confidence: number | null;
  positioning: string | null;
  keyFeatures: string[];
  evidence: unknown;
  createdAt: Date;
};

function normalizeStoredType(value: string | null): CompetitorType {
  return value === 'INDIRECT' || value === 'ASPIRATIONAL' ? value : 'DIRECT';
}

function normalizeStoredDecision(value: string | null): Decision {
  return value === 'ACCEPTED' || value === 'REJECTED' ? value : 'PENDING';
}

function normalizeStoredLabels(value: string[]): CompetitorLabel[] {
  return value.filter((label): label is CompetitorLabel => label === 'SEO' || label === 'BUSINESS');
}

function toCompetitorView(row: CompetitorRow): CompetitorView {
  return {
    id: row.id,
    name: row.name,
    domain: row.domain,
    description: row.description,
    type: normalizeStoredType(row.type),
    userDecision: normalizeStoredDecision(row.userDecision),
    rejectionReason: row.rejectionReason,
    source: row.source,
    sources: row.sources,
    labels: normalizeStoredLabels(row.labels),
    confidence: row.confidence,
    confidenceBand: confidenceBand(row.confidence),
    positioning: row.positioning,
    keyFeatures: row.keyFeatures,
    evidence: parseStoredEvidence(row.evidence),
    createdAt: row.createdAt.toISOString(),
  };
}

function toRunView(run: {
  id: string;
  status: string;
  stage: string | null;
  savedCount: number;
  tokensUsed: number;
  error: string | null;
  sourceStats: unknown;
  startedAt: Date;
  finishedAt: Date | null;
}): RunView {
  return {
    id: run.id,
    status: run.status,
    stage: run.stage,
    savedCount: run.savedCount,
    tokensUsed: run.tokensUsed,
    error: sanitizeUpstreamText(run.error),
    sourceStats: sanitizeSourceStats(run.sourceStats),
    startedAt: run.startedAt.toISOString(),
    finishedAt: run.finishedAt ? run.finishedAt.toISOString() : null,
  };
}

// ---------------------------------------------------------------------------
// Quota — Ruling A: the legacy archive table (`competitor_discovery_runs`,
// read through `getWorkspaceDiscoveryStats` in `activity-log.ts`) still
// holds every run made before this rebuild. A used-runs count that ignored
// it would hand every existing user a free quota reset the day this ships.
// So "used" is legacy rows *plus* `DiscoveryRun` rows that actually reached
// `DONE` — never PENDING, RUNNING, EMPTY or FAILED, so a run that failed, or
// one still in flight, costs the workspace nothing.
// ---------------------------------------------------------------------------

async function computeDiscoveryMeta(userId: string, workspaceId: string): Promise<DiscoveryMeta> {
  const [maxRuns, doneRuns, legacyStats] = await Promise.all([
    getMaxDiscoveryRuns(),
    prisma.discoveryRun.count({ where: { workspaceId, status: 'DONE' } }),
    getLegacyDiscoveryStats(userId, workspaceId),
  ]);

  const usedRuns = doneRuns + legacyStats.usedRuns;
  return { usedRuns, remainingRuns: Math.max(0, maxRuns - usedRuns), maxRuns };
}

// ---------------------------------------------------------------------------
// startCompetitorDiscovery
// ---------------------------------------------------------------------------

export async function startCompetitorDiscovery(
  workspaceId: string,
): Promise<{ runId: string } | { error: string; meta?: DiscoveryMeta }> {
  const session = await getSession();
  if (!session) return { error: await actionError('notAuthenticated') };
  if (!workspaceId) return { error: await actionError('workspaceIdRequired') };

  // Ownership first — nothing below runs unless this workspace is the
  // caller's, and a workspace that does not exist looks identical to one
  // that exists but belongs to someone else.
  const workspace = await prisma.workspace.findFirst({
    where: { id: workspaceId, userId: session.userId },
  });
  if (!workspace) return { error: await actionError('workspaceNotFound') };

  // A run stuck in PENDING/RUNNING past STALE_RUN_MINUTES is presumed dead
  // (crashed process, redeploy, a request that never got a response) and is
  // marked FAILED here before the "already running" check below, so a truly
  // dead run never permanently blocks new discovery for this workspace.
  await reapStaleRuns(workspaceId);

  const active = await prisma.discoveryRun.findFirst({
    where: { workspaceId, status: { in: ['PENDING', 'RUNNING'] } },
    select: { id: true },
  });
  if (active) return { error: await actionError('discoveryAlreadyRunning') };

  const meta = await computeDiscoveryMeta(session.userId, workspaceId);
  if (meta.remainingRuns <= 0) {
    return { error: await actionError('discoveryLimitReached'), meta };
  }

  const market: TargetMarket = {
    country: workspace.targetCountry,
    language: workspace.targetLanguage === 'fa' ? 'fa' : 'en',
  };

  let run: { id: string };
  try {
    run = await prisma.discoveryRun.create({
      data: {
        workspaceId,
        userId: session.userId,
        status: 'PENDING',
        market: market as unknown as Prisma.InputJsonValue,
      },
      select: { id: true },
    });
  } catch (error) {
    // `discovery_runs_one_active_per_workspace` (a partial unique index —
    // see prisma/add-discovery-run-active-constraint.ts and its migration,
    // since Prisma's schema language cannot express "unique where status
    // IN (...)") enforces at the database level what the `active` check
    // above only checks-then-acts on. Two concurrent calls can both pass
    // that check before either has created its row; the constraint is what
    // actually stops a second PENDING/RUNNING row from ever being written,
    // and this catch is what makes the two agree on the error the caller
    // sees.
    //
    // Narrowed to this specific constraint via `error.meta.target` (Prisma
    // reports the column list a P2002 came from — `["workspaceId"]` for
    // this one, verified directly against the local database) rather than
    // catching every P2002 on this model: DiscoveryRun has no other unique
    // constraint, so this is airtight today, but a bare `code === 'P2002'`
    // would silently start reporting "already running" for an unrelated
    // future unique violation on this table too.
    const isActiveRunConflict =
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002' &&
      Array.isArray(error.meta?.target) &&
      (error.meta.target as unknown[]).includes('workspaceId');
    if (isActiveRunConflict) {
      return { error: await actionError('discoveryAlreadyRunning') };
    }
    throw error;
  }

  await writeActivityLog({
    userId: session.userId,
    workspaceId,
    action: 'COMPETITOR_DISCOVERY_STARTED',
    detail: { runId: run.id },
  });

  const dispatch = await triggerBackgroundRun('/api/growth/discovery/run', { runId: run.id });
  if (!dispatch.ok) {
    // The row already exists in PENDING, but the thing that was supposed
    // to move it forward never even reached the route — left alone, this
    // row would sit in PENDING (refusing every retry with
    // discoveryAlreadyRunning) until reapStaleRuns caught it up to
    // STALE_RUN_MINUTES later. Mark it FAILED now, so the caller learns
    // this immediately instead of ten minutes from now.
    await prisma.discoveryRun.update({
      where: { id: run.id },
      data: {
        status: 'FAILED',
        error: sanitizeUpstreamText(dispatch.error),
        finishedAt: new Date(),
      },
    });
    await writeActivityLog({
      userId: session.userId,
      workspaceId,
      action: 'COMPETITOR_DISCOVERY_DISPATCH_FAILED',
      detail: { runId: run.id, error: dispatch.error },
    });
    return { error: await actionError('discoveryDispatchFailed') };
  }

  return { runId: run.id };
}

// ---------------------------------------------------------------------------
// getDiscoveryStatus
// ---------------------------------------------------------------------------

export async function getDiscoveryStatus(
  workspaceId: string,
): Promise<{ run: RunView | null; meta: DiscoveryMeta; competitors: CompetitorView[] }> {
  const empty = async (): Promise<{ run: RunView | null; meta: DiscoveryMeta; competitors: CompetitorView[] }> => ({
    run: null,
    meta: { usedRuns: 0, remainingRuns: 0, maxRuns: await getMaxDiscoveryRuns() },
    competitors: [],
  });

  const session = await getSession();
  if (!session || !workspaceId) return empty();

  const workspace = await prisma.workspace.findFirst({
    where: { id: workspaceId, userId: session.userId },
    select: { id: true },
  });
  // Same empty shape whether the workspace does not exist or is not the
  // caller's — this action never returns a bare error string, so an empty
  // result is the only signal available, and it must not vary by cause.
  if (!workspace) return empty();

  await reapStaleRuns(workspaceId);

  const [latestRun, competitorRows, meta] = await Promise.all([
    prisma.discoveryRun.findFirst({ where: { workspaceId }, orderBy: { startedAt: 'desc' } }),
    prisma.competitor.findMany({ where: { workspaceId }, orderBy: { createdAt: 'asc' } }),
    computeDiscoveryMeta(session.userId, workspaceId),
  ]);

  return {
    run: latestRun ? toRunView(latestRun) : null,
    meta,
    competitors: competitorRows.map(toCompetitorView),
  };
}

// ---------------------------------------------------------------------------
// setCompetitorDecision
// ---------------------------------------------------------------------------

export async function setCompetitorDecision(
  workspaceId: string,
  competitorId: string,
  decision: 'ACCEPTED' | 'REJECTED' | 'PENDING',
  rejectionReason?: string,
): Promise<{ success: true } | { error: string }> {
  const session = await getSession();
  if (!session) return { error: await actionError('notAuthenticated') };
  if (!workspaceId || !competitorId) return { error: await actionError('missingIdentifiers') };
  if (!isDecision(decision)) return { error: await actionError('competitorPayloadInvalid') };
  if (rejectionReason !== undefined && !isRejectionReason(rejectionReason)) {
    return { error: await actionError('competitorPayloadInvalid') };
  }

  const workspace = await prisma.workspace.findFirst({
    where: { id: workspaceId, userId: session.userId },
    select: { id: true },
  });
  if (!workspace) return { error: await actionError('workspaceNotFound') };

  // Scoped through workspaceId in the same query, not a bare `where: { id
  // }` — a competitor id from another workspace matches zero rows here
  // rather than this workspace's row by coincidence.
  const { count } = await prisma.competitor.updateMany({
    where: { id: competitorId, workspaceId },
    data: {
      userDecision: decision,
      rejectionReason: decision === 'REJECTED' ? rejectionReason ?? null : null,
    },
  });
  if (count === 0) return { error: await actionError('competitorNotFound') };

  await writeActivityLog({
    userId: session.userId,
    workspaceId,
    action: 'COMPETITOR_DECISION_SET',
    detail: { competitorId, decision },
  });

  return { success: true };
}

// ---------------------------------------------------------------------------
// updateCompetitorType
// ---------------------------------------------------------------------------

export async function updateCompetitorType(
  workspaceId: string,
  competitorId: string,
  type: CompetitorType,
): Promise<{ success: true } | { error: string }> {
  const session = await getSession();
  if (!session) return { error: await actionError('notAuthenticated') };
  if (!workspaceId || !competitorId) return { error: await actionError('missingIdentifiers') };
  if (!isCompetitorType(type)) return { error: await actionError('competitorPayloadInvalid') };

  const workspace = await prisma.workspace.findFirst({
    where: { id: workspaceId, userId: session.userId },
    select: { id: true },
  });
  if (!workspace) return { error: await actionError('workspaceNotFound') };

  const { count } = await prisma.competitor.updateMany({
    where: { id: competitorId, workspaceId },
    data: { type },
  });
  if (count === 0) return { error: await actionError('competitorNotFound') };

  await writeActivityLog({
    userId: session.userId,
    workspaceId,
    action: 'COMPETITOR_TYPE_SET',
    detail: { competitorId, type },
  });

  return { success: true };
}

// ---------------------------------------------------------------------------
// removeCompetitor
// ---------------------------------------------------------------------------

export async function removeCompetitor(
  workspaceId: string,
  competitorId: string,
): Promise<{ success: true } | { error: string }> {
  const session = await getSession();
  if (!session) return { error: await actionError('notAuthenticated') };
  if (!workspaceId || !competitorId) return { error: await actionError('missingIdentifiers') };

  const workspace = await prisma.workspace.findFirst({
    where: { id: workspaceId, userId: session.userId },
    select: { id: true },
  });
  if (!workspace) return { error: await actionError('workspaceNotFound') };

  const { count } = await prisma.competitor.deleteMany({ where: { id: competitorId, workspaceId } });
  if (count === 0) return { error: await actionError('competitorNotFound') };

  await writeActivityLog({
    userId: session.userId,
    workspaceId,
    action: 'COMPETITOR_REMOVED',
    detail: { competitorId },
  });

  return { success: true };
}

// ---------------------------------------------------------------------------
// updateTargetMarket
// ---------------------------------------------------------------------------

export async function updateTargetMarket(
  workspaceId: string,
  country: string | null,
  language: 'fa' | 'en',
): Promise<{ success: true } | { error: string }> {
  const session = await getSession();
  if (!session) return { error: await actionError('notAuthenticated') };
  if (!workspaceId) return { error: await actionError('workspaceIdRequired') };
  if (!isLanguage(language)) return { error: await actionError('competitorPayloadInvalid') };
  if (!isValidCountry(country)) return { error: await actionError('competitorPayloadInvalid') };

  const workspace = await prisma.workspace.findFirst({
    where: { id: workspaceId, userId: session.userId },
    select: { id: true },
  });
  if (!workspace) return { error: await actionError('workspaceNotFound') };

  await prisma.workspace.update({
    where: { id: workspaceId },
    data: { targetCountry: country, targetLanguage: language },
  });

  await writeActivityLog({
    userId: session.userId,
    workspaceId,
    action: 'TARGET_MARKET_UPDATED',
    detail: { country, language },
  });

  return { success: true };
}

// ---------------------------------------------------------------------------
// listDiscoveryRuns
// ---------------------------------------------------------------------------

export async function listDiscoveryRuns(workspaceId: string): Promise<RunHistoryItem[]> {
  const session = await getSession();
  if (!session || !workspaceId) return [];

  const workspace = await prisma.workspace.findFirst({
    where: { id: workspaceId, userId: session.userId },
    select: { id: true },
  });
  if (!workspace) return [];

  const runs = await prisma.discoveryRun.findMany({
    where: { workspaceId },
    orderBy: { startedAt: 'desc' },
    take: 20,
  });

  return runs.map((run) => ({
    id: run.id,
    status: run.status,
    stage: run.stage,
    savedCount: run.savedCount,
    tokensUsed: run.tokensUsed,
    error: sanitizeUpstreamText(run.error),
    startedAt: run.startedAt.toISOString(),
    finishedAt: run.finishedAt ? run.finishedAt.toISOString() : null,
  }));
}

// ---------------------------------------------------------------------------
// addManualCompetitor
// ---------------------------------------------------------------------------

export async function addManualCompetitor(
  workspaceId: string,
  domainInput: string,
): Promise<{ competitor: CompetitorView; judgeWarning: string | null } | { error: string }> {
  const session = await getSession();
  if (!session) return { error: await actionError('notAuthenticated') };
  if (!workspaceId) return { error: await actionError('workspaceIdRequired') };

  const workspace = await prisma.workspace.findFirst({
    where: { id: workspaceId, userId: session.userId },
    include: { competitors: true },
  });
  if (!workspace) return { error: await actionError('workspaceNotFound') };

  const domain = normalizeCandidateDomain(domainInput);
  if (!domain) return { error: await actionError('invalidUrl') };

  // The deleted `discoverCompetitorsWithOpenAI`/manual-edit flow this
  // action replaces always excluded the workspace's own domain from its
  // results; restore the same guard here so "add a competitor" cannot be
  // used to add the workspace to its own competitor list.
  const ownDomain = normalizeCandidateDomain(workspace.websiteUrl || '');
  if (ownDomain && domain === ownDomain) {
    return { error: await actionError('competitorIsOwnDomain') };
  }

  const duplicate = workspace.competitors.some(
    (c) => c.domain && normalizeCandidateDomain(c.domain) === domain,
  );
  if (duplicate) return { error: await actionError('competitorAlreadyExists') };

  const brief = buildBrandBrief({
    workspace: {
      name: workspace.name,
      websiteUrl: workspace.websiteUrl,
      brandSummary: workspace.brandSummary,
      targetCountry: workspace.targetCountry,
      targetLanguage: workspace.targetLanguage,
    },
    competitors: workspace.competitors.map((c) => ({
      name: c.name,
      domain: c.domain,
      userDecision: c.userDecision,
      rejectionReason: c.rejectionReason,
    })),
  });

  const candidate: Candidate = { domain, frequency: 1, sources: ['MANUAL'], evidence: [] };
  const { enriched } = await enrichCandidates([candidate]);

  // No site could be scanned at all — there is nothing for the judge to
  // read, so it never runs. The competitor is still saved (the brief is
  // explicit: ACCEPTED whatever the judge says), just with no judged
  // fields to invent.
  let judged: JudgedCandidate | undefined;
  if (enriched.length > 0) {
    const result = await judgeCandidates(brief, enriched);
    judged = result.judged[0];
  }

  const created = await prisma.competitor.create({
    data: {
      workspaceId,
      name: judged?.name || domain,
      domain,
      description: judged?.description || null,
      type: judged?.type || 'DIRECT',
      confidence: judged ? Math.round(judged.judgeConfidence * 1000) / 1000 : null,
      labels: judged?.labels || [],
      sources: ['MANUAL'],
      evidence: (judged?.evidence || []) as unknown as Prisma.InputJsonValue,
      positioning: judged?.positioning || null,
      keyFeatures: judged?.keyFeatures || [],
      source: 'MANUAL',
      userDecision: 'ACCEPTED',
    },
  });

  const judgeWarning = judged
    ? judged.isCompetitor
      ? null
      : judged.reason || (await actionError('manualCompetitorNotAMatch'))
    : await actionError('manualCompetitorUnverified');

  await writeActivityLog({
    userId: session.userId,
    workspaceId,
    action: 'COMPETITOR_MANUAL_ADD',
    detail: { competitorId: created.id, domain },
  });

  return { competitor: toCompetitorView(created), judgeWarning };
}
