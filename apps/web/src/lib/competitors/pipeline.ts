import { Prisma } from '@prisma/client';

import { prisma } from '@/lib/db';
import { writeActivityLog } from '@/lib/activity-log';

import { normalizeCandidateDomain, normalizeEvidenceUrl } from './domains';
import { buildBrandBrief, generateQueries } from './queries';
import { harvestFromSerp, harvestFromWebSearch } from './search';
import { enrichCandidates, judgeCandidates } from './judge';
import { rankAndKeep } from './scoring';
import type { Candidate, EvidenceItem, ScoredCandidate, SourceHarvestStats, SourceStats } from './types';

/**
 * A run older than this and still `PENDING`/`RUNNING` is presumed dead (the
 * process that owned it crashed, was redeployed, or the request that kicked
 * it off never got a response). `reapStaleRuns` marks it `FAILED` instead of
 * leaving it to spin the UI's poller forever.
 */
export const STALE_RUN_MINUTES = 10;

const STAGES = ['QUERIES', 'SEARCH', 'ENRICH', 'JUDGE', 'SAVE'] as const;
type Stage = (typeof STAGES)[number];

// ---------------------------------------------------------------------------
// Pure helpers — TDD'd in pipeline.test.ts without any network or DB access.
// ---------------------------------------------------------------------------

/**
 * Merge candidate lists from independent sources (web search, SERP) into one
 * list keyed by domain: sources are unioned, frequency is summed, and
 * evidence is concatenated. Order of the input lists does not matter.
 */
export function mergeCandidateLists(lists: Candidate[][]): Candidate[] {
  const byDomain = new Map<string, Candidate>();

  for (const list of lists) {
    for (const candidate of list) {
      const existing = byDomain.get(candidate.domain);
      if (!existing) {
        byDomain.set(candidate.domain, {
          domain: candidate.domain,
          frequency: candidate.frequency,
          sources: [...new Set(candidate.sources)],
          evidence: [...candidate.evidence],
        });
        continue;
      }

      existing.frequency += candidate.frequency;
      existing.sources = [...new Set([...existing.sources, ...candidate.sources])];
      existing.evidence = [...existing.evidence, ...candidate.evidence];
    }
  }

  return [...byDomain.values()];
}

/** Read whatever was stored in `Competitor.evidence` (a Json? column) back into `EvidenceItem[]`, tolerating anything malformed as empty. */
export function parseStoredEvidence(value: unknown): EvidenceItem[] {
  if (!Array.isArray(value)) return [];
  const items: EvidenceItem[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue;
    const record = raw as Record<string, unknown>;
    if (typeof record.id !== 'string' || typeof record.url !== 'string') continue;
    items.push({
      id: record.id,
      kind: record.kind === 'serp' || record.kind === 'site' ? record.kind : 'citation',
      url: record.url,
      title: typeof record.title === 'string' ? record.title : undefined,
      snippet: typeof record.snippet === 'string' ? record.snippet : undefined,
      query: typeof record.query === 'string' ? record.query : undefined,
    });
  }
  return items;
}

/** `normalizeEvidenceUrl(url) -> id` for every stored evidence item. */
export function buildEvidenceIdMap(existingEvidence: EvidenceItem[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const item of existingEvidence) {
    if (!item?.url) continue;
    map.set(normalizeEvidenceUrl(item.url), item.id);
  }
  return map;
}

/**
 * Before an existing competitor's evidence is overwritten by this run's
 * fresh evidence, re-point every item whose normalised URL already existed
 * to its previous id. A sibling feature (positioning matrices) cites
 * evidence by id, so a rerun must never silently re-point an existing
 * citation — only a genuinely new URL keeps the id it was minted with.
 */
export function reconcileEvidence(existingEvidence: EvidenceItem[], newEvidence: EvidenceItem[]): EvidenceItem[] {
  const idByUrl = buildEvidenceIdMap(existingEvidence);
  return newEvidence.map((item) => {
    const preservedId = idByUrl.get(normalizeEvidenceUrl(item.url));
    return preservedId ? { ...item, id: preservedId } : item;
  });
}

/** Whether `run` should be reaped: still in-flight and older than `staleMinutes`. */
export function isStaleRun(
  run: { status: string; startedAt: Date },
  now: Date,
  staleMinutes: number,
): boolean {
  if (run.status !== 'PENDING' && run.status !== 'RUNNING') return false;
  return now.getTime() - run.startedAt.getTime() > staleMinutes * 60 * 1000;
}

/**
 * Accumulates `number | null` token readings from every stage into a single
 * `number | null` total, per the project convention: `null` means "could
 * not be read", not zero, and must never be silently treated as zero when
 * summing. The total is `null` only when *no* stage returned a readable
 * figure; otherwise it is the sum of whatever could be read.
 */
class TokenAccumulator {
  private total: number | null = null;
  private sawReadable = false;
  private sawUnreadable = false;

  add(value: number | null): void {
    if (value == null) {
      this.sawUnreadable = true;
      return;
    }
    this.sawReadable = true;
    this.total = (this.total ?? 0) + value;
  }

  /** The summed total, or `null` if nothing was ever readable. */
  get value(): number | null {
    return this.sawReadable ? this.total : null;
  }

  /** True once any single `add()` call got a null — the total (even if non-null) is a floor, not the true figure. */
  get incomplete(): boolean {
    return this.sawUnreadable;
  }
}

function normalizeStoredDomain(domain: string): string {
  return normalizeCandidateDomain(domain) ?? domain.trim().toLowerCase();
}

// ---------------------------------------------------------------------------
// runDiscoveryPipeline
// ---------------------------------------------------------------------------

export async function runDiscoveryPipeline(runId: string): Promise<void> {
  const tokens = new TokenAccumulator();
  const sourceStats: SourceStats = {};
  const runErrors: string[] = [];

  let run: Awaited<ReturnType<typeof loadRun>> | null = null;

  try {
    run = await loadRun(runId);
    if (!run) return; // no such run — nothing this call can do or report

    // Scoped to `status: 'PENDING'` rather than a bare `where: { id }`:
    // `startCompetitorDiscovery` can mark this same row FAILED (e.g. when
    // the trigger that led to this call couldn't be dispatched at all — a
    // race is possible between that write and this one reaching the
    // route). A `count` of 0 means the row is no longer PENDING for some
    // reason — already FAILED, already reaped as stale, or (in principle)
    // already RUNNING from a second dispatch — and this call must not run
    // the pipeline over it: doing so would let a run the action already
    // recorded as failed flip back to RUNNING and finish DONE, consuming
    // quota for a run the user was already told did not start.
    const claimed = await prisma.discoveryRun.updateMany({
      where: { id: runId, status: 'PENDING' },
      data: { status: 'RUNNING' },
    });
    if (claimed.count === 0) return;

    const workspace = run.workspace;
    const allCompetitors = workspace.competitors;

    // --- QUERIES ------------------------------------------------------
    await setStage(runId, 'QUERIES');

    const brief = buildBrandBrief({
      workspace: {
        name: workspace.name,
        websiteUrl: workspace.websiteUrl,
        brandSummary: workspace.brandSummary,
        targetCountry: workspace.targetCountry,
        targetLanguage: workspace.targetLanguage,
      },
      competitors: allCompetitors.map((c) => ({
        name: c.name,
        domain: c.domain,
        userDecision: c.userDecision,
        rejectionReason: c.rejectionReason,
      })),
    });

    const { queries, tokens: queryTokens } = await generateQueries(brief);
    tokens.add(queryTokens);
    sourceStats.queries = { count: queries.length, tokens: queryTokens };

    await prisma.discoveryRun.update({ where: { id: runId }, data: { queries } });

    // --- SEARCH ---------------------------------------------------------
    await setStage(runId, 'SEARCH');

    // Every domain this workspace already has an opinion on — accepted,
    // pending or REJECTED — is excluded before the search even runs. This
    // is what stops a name the user already rejected from being
    // resurfaced on every future run.
    const exclude = new Set<string>();
    if (brief.ownDomain) exclude.add(normalizeStoredDomain(brief.ownDomain));
    for (const competitor of allCompetitors) {
      if (competitor.domain) exclude.add(normalizeStoredDomain(competitor.domain));
    }

    const [webOutcome, serpOutcome] = await Promise.allSettled([
      harvestFromWebSearch(queries, brief.market, exclude),
      harvestFromSerp(queries, brief.market, exclude),
    ]);

    const searchLists: Candidate[][] = [];
    const searchCounts: { webSearch?: SourceHarvestStats; serp?: SourceHarvestStats } = {};

    for (const [label, outcome] of [
      ['webSearch', webOutcome],
      ['serp', serpOutcome],
    ] as const) {
      if (outcome.status === 'fulfilled') {
        searchLists.push(outcome.value.candidates);
        tokens.add(outcome.value.tokens);
        runErrors.push(...outcome.value.errors);
        searchCounts[label] = {
          harvested: outcome.value.candidates.length,
          tokens: outcome.value.tokens,
          errors: outcome.value.errors.length,
        };
      } else {
        const message = outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason);
        runErrors.push(`${label} harvest threw: ${message}`);
        searchCounts[label] = { harvested: 0, tokens: null, errors: 1 };
        // A rejected promise never reported a token figure at all — this
        // must count as an unreadable stage the same as a resolved
        // `{ tokens: null }` would, or the run-level `tokensIncomplete`
        // flag would silently stay false while this stage's own stat
        // already says "unknown".
        tokens.add(null);
      }
    }

    const mergedCandidates = mergeCandidateLists(searchLists);
    sourceStats.search = { ...searchCounts, merged: mergedCandidates.length };

    // --- ENRICH ---------------------------------------------------------
    await setStage(runId, 'ENRICH');
    const enriched = await enrichCandidates(mergedCandidates);
    sourceStats.enrich = { input: mergedCandidates.length, enriched: enriched.length };

    // --- JUDGE ------------------------------------------------------------
    await setStage(runId, 'JUDGE');
    const { judged, tokens: judgeTokens } = await judgeCandidates(brief, enriched);
    tokens.add(judgeTokens);
    const kept: ScoredCandidate[] = rankAndKeep(judged, brief.market);
    sourceStats.judge = { input: enriched.length, judged: judged.length, kept: kept.length, tokens: judgeTokens };

    // --- SAVE ---------------------------------------------------------
    await setStage(runId, 'SAVE');

    const existingByDomain = new Map(
      allCompetitors
        .filter((c) => c.domain)
        .map((c) => [normalizeStoredDomain(c.domain as string), c]),
    );

    // Every write is prepared first (no `await` yet — these are pending
    // Prisma operations, not yet sent) and only then run together inside
    // `$transaction`. Ten rows is small and short-lived, and all-or-nothing
    // is the only honest semantic here: if write N+1 of a plain sequential
    // loop threw, the outer catch would record `FAILED` with `savedCount`
    // defaulting to 0 while up to N real rows had already been persisted —
    // the run row would lie about what happened. With a transaction, either
    // every kept candidate lands and `savedCount` is set to match, or none
    // of them do and `savedCount` is never touched (staying at its true
    // value of 0, since nothing was actually written).
    const operations = kept.map((candidate) => {
      const existing = existingByDomain.get(candidate.domain);
      const existingEvidence = existing ? parseStoredEvidence(existing.evidence) : [];
      const evidence = reconcileEvidence(existingEvidence, candidate.evidence);
      // Round before writing so the database stops holding
      // floating-point noise like 0.9500000000000001 for a number that
      // is shown to a user.
      const confidence = Math.round(candidate.finalConfidence * 1000) / 1000;

      if (existing) {
        return prisma.competitor.update({
          where: { id: existing.id },
          data: {
            name: candidate.name,
            domain: candidate.domain,
            description: candidate.description || null,
            type: candidate.type,
            confidence,
            labels: candidate.labels,
            sources: candidate.sources,
            evidence,
            positioning: candidate.positioning,
            keyFeatures: candidate.keyFeatures,
            discoveryRunId: runId,
            // userDecision is never written here — a user's decision is sacred.
          },
        });
      }

      return prisma.competitor.create({
        data: {
          workspaceId: workspace.id,
          name: candidate.name,
          domain: candidate.domain,
          description: candidate.description || null,
          type: candidate.type,
          confidence,
          labels: candidate.labels,
          sources: candidate.sources,
          evidence,
          positioning: candidate.positioning,
          keyFeatures: candidate.keyFeatures,
          source: 'AI',
          userDecision: 'PENDING',
          discoveryRunId: runId,
        },
      });
    });

    if (operations.length > 0) {
      await prisma.$transaction(operations);
    }
    const savedCount = operations.length;

    sourceStats.save = { saved: savedCount };
    if (runErrors.length > 0) sourceStats.errors = runErrors;

    const tokensTotal = tokens.value;
    // `tokensUsed` is a NOT NULL Int column: it cannot literally store
    // "unknown". A partial sum (some stages readable, some not) is real
    // information and gets written as-is; `tokensIncomplete` says it is a
    // floor, not the true total. Only in the (rare) case where *no* stage
    // ever returned a readable figure is the 0 we're forced to write here a
    // placeholder rather than a fact — `tokensUnknown` flags that
    // explicitly so nothing downstream mistakes it for "this run cost
    // nothing".
    if (tokens.incomplete) sourceStats.tokensIncomplete = true;
    if (tokensTotal === null) sourceStats.tokensUnknown = true;

    await prisma.discoveryRun.update({
      where: { id: runId },
      data: {
        status: savedCount > 0 ? 'DONE' : 'EMPTY',
        finishedAt: new Date(),
        savedCount,
        tokensUsed: tokensTotal ?? 0,
        sourceStats: sourceStats as Prisma.InputJsonValue,
      },
    });

    await writeActivityLog({
      userId: run.userId,
      workspaceId: workspace.id,
      action: 'COMPETITOR_DISCOVERY_RUN',
      detail: {
        runId,
        status: savedCount > 0 ? 'DONE' : 'EMPTY',
        savedCount,
        tokensUsed: tokensTotal,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    try {
      await prisma.discoveryRun.update({
        where: { id: runId },
        data: {
          status: 'FAILED',
          error: message,
          finishedAt: new Date(),
          tokensUsed: tokens.value ?? 0,
          sourceStats: { ...sourceStats, errors: [...runErrors, message] } as Prisma.InputJsonValue,
        },
      });

      if (run) {
        await writeActivityLog({
          userId: run.userId,
          workspaceId: run.workspace.id,
          action: 'COMPETITOR_DISCOVERY_RUN',
          detail: { runId, status: 'FAILED', error: message },
        });
      }
    } catch (writeError) {
      // The one thing this function must never do is throw — even the
      // fallback write failed, so all that's left is to log it. The run
      // stays stuck in RUNNING; `reapStaleRuns` will eventually catch it.
      console.error('runDiscoveryPipeline: failed to record failure for run', runId, writeError);
    }
    // Deliberately not re-thrown — see module doc comment.
  }
}

function loadRun(runId: string) {
  return prisma.discoveryRun.findUnique({
    where: { id: runId },
    include: { workspace: { include: { competitors: true } } },
  });
}

function setStage(runId: string, stage: Stage) {
  return prisma.discoveryRun.update({ where: { id: runId }, data: { stage } });
}

// ---------------------------------------------------------------------------
// reapStaleRuns
// ---------------------------------------------------------------------------

/**
 * Marks any `PENDING`/`RUNNING` run of this workspace older than
 * `STALE_RUN_MINUTES` as `FAILED` with `error: 'TIMED_OUT'`. Meant to be
 * called on every status read (cheap: at most a handful of in-flight rows
 * per workspace). Since quota counts only `DONE` runs, a timed-out run
 * costs the user nothing.
 */
export async function reapStaleRuns(workspaceId: string): Promise<void> {
  const inFlight = await prisma.discoveryRun.findMany({
    where: { workspaceId, status: { in: ['PENDING', 'RUNNING'] } },
    select: { id: true, status: true, startedAt: true },
  });

  const now = new Date();
  const staleIds = inFlight.filter((run) => isStaleRun(run, now, STALE_RUN_MINUTES)).map((run) => run.id);
  if (staleIds.length === 0) return;

  await prisma.discoveryRun.updateMany({
    where: { id: { in: staleIds } },
    data: { status: 'FAILED', error: 'TIMED_OUT', finishedAt: now },
  });
}
