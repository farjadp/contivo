import { Prisma } from '@prisma/client';

import { prisma } from '@/lib/db';
import { writeActivityLog } from '@/lib/activity-log';

import { normalizeCandidateDomain, normalizeEvidenceUrl } from './domains';
import { buildBrandBrief, generateQueries } from './queries';
import { harvestFromSerp, harvestFromWebSearch } from './search';
import { enrichCandidates, judgeCandidates } from './judge';
import { rankAndKeep } from './scoring';
import { sanitizeUpstreamText } from './redact';
import { RUN_ERROR, withRunErrorCode } from './run-errors';
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
// Status-guarded writes
// ---------------------------------------------------------------------------

/**
 * Thrown when a write finds the run no longer RUNNING: the reaper timed it
 * out, or something else already finished it. The pipeline stops on the
 * spot and writes nothing more, so a run the user was told had failed (and
 * was not charged for) can never come back as DONE, save rows, or consume
 * quota — and a second run started after the reap never races this one.
 */
export class RunNoLongerActiveError extends Error {
  constructor(runId: string) {
    super(`Discovery run ${runId} is no longer RUNNING; stopping without further writes`);
    this.name = 'RunNoLongerActiveError';
  }
}

/** Every post-claim write goes through here: it applies only while the run is still RUNNING. */
async function updateWhileRunning(runId: string, data: Prisma.DiscoveryRunUpdateManyMutationInput): Promise<void> {
  const { count } = await prisma.discoveryRun.updateMany({ where: { id: runId, status: 'RUNNING' }, data });
  if (count === 0) throw new RunNoLongerActiveError(runId);
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
        updatedAt: c.updatedAt,
      })),
    });

    const { queries, tokens: queryTokens } = await generateQueries(brief);
    tokens.add(queryTokens);
    sourceStats.queries = { count: queries.length, tokens: queryTokens };

    await updateWhileRunning(runId, { queries });

    // --- SEARCH ---------------------------------------------------------
    await setStage(runId, 'SEARCH');

    // Every domain this workspace already has an opinion on — accepted,
    // pending or REJECTED — is excluded before the search even runs. This
    // is what stops a name the user already rejected from being
    // resurfaced on every future run. `brief.knownDomains` is the same set
    // `buildBrandBrief` collected from every competitor row regardless of
    // decision (see its doc comment), so this is the one place that set is
    // read back out, normalized for comparison against harvested domains.
    const exclude = new Set<string>();
    if (brief.ownDomain) exclude.add(normalizeStoredDomain(brief.ownDomain));
    for (const domain of brief.knownDomains) {
      exclude.add(normalizeStoredDomain(domain));
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

    // I5's mirror: if every web-search query failed (401, 429, a timeout, or
    // the harvest throwing outright — e.g. a missing OPENAI_API_KEY), no
    // candidate ever reaches JUDGE, which then reports 0 batches. Without
    // this check that looks identical to "the market has no competitors"
    // and the run would end EMPTY, sending the user off to change a market
    // that was never the problem. End FAILED (uncharged) instead, with the
    // cause stored, exactly like a judge outage. SERP is not built yet (see
    // `harvestFromSerp`'s doc comment) and never reports an error, so it
    // cannot mask this: only the web-search outcome decides it. A partial
    // failure (some queries failed, others returned results or simply found
    // nothing) is not this case and falls through to EMPTY/DONE as before.
    const webSearchErrorCount = webOutcome.status === 'rejected' ? queries.length : webOutcome.value.errors.length;
    if (queries.length > 0 && mergedCandidates.length === 0 && webSearchErrorCount >= queries.length) {
      const detail =
        webOutcome.status === 'rejected'
          ? webOutcome.reason instanceof Error
            ? webOutcome.reason.message
            : String(webOutcome.reason)
          : webOutcome.value.errors[0];
      throw new Error(withRunErrorCode(RUN_ERROR.SEARCH_UNAVAILABLE, detail));
    }

    // --- ENRICH ---------------------------------------------------------
    await setStage(runId, 'ENRICH');
    const { enriched, skipped: enrichSkipped, budgetExceeded: enrichBudgetExceeded } =
      await enrichCandidates(mergedCandidates);
    sourceStats.enrich = {
      input: mergedCandidates.length,
      enriched: enriched.length,
      ...(enrichBudgetExceeded ? { budgetExceeded: true, skipped: enrichSkipped } : {}),
    };

    // --- JUDGE ------------------------------------------------------------
    await setStage(runId, 'JUDGE');
    const judgeResult = await judgeCandidates(brief, enriched);
    const { judged, tokens: judgeTokens } = judgeResult;
    tokens.add(judgeTokens);
    runErrors.push(...judgeResult.errors);
    const kept: ScoredCandidate[] = rankAndKeep(judged, brief.market);
    sourceStats.judge = {
      input: enriched.length,
      judged: judged.length,
      kept: kept.length,
      tokens: judgeTokens,
      ...(judgeResult.failedBatches > 0
        ? { batches: judgeResult.batches, failedBatches: judgeResult.failedBatches }
        : {}),
    };
    // Every batch failed: nothing was assessed, so "no competitors found"
    // (EMPTY) would be a lie that sends the user off to change their market.
    // End FAILED (uncharged) with the cause stored instead. A partial failure
    // carries on with what was judged; its errors are in sourceStats.
    if (judgeResult.batches > 0 && judgeResult.failedBatches === judgeResult.batches) {
      throw new Error(withRunErrorCode(RUN_ERROR.JUDGE_UNAVAILABLE, judgeResult.errors[0]));
    }

    // --- SAVE ---------------------------------------------------------
    await setStage(runId, 'SAVE');

    const existingByDomain = new Map(
      allCompetitors
        .filter((c) => c.domain)
        .map((c) => [normalizeStoredDomain(c.domain as string), c]),
    );

    // SAVE is one interactive transaction whose FIRST statement is the
    // status-guarded final write (RUNNING -> DONE/EMPTY). If the run is no
    // longer RUNNING — reaped as TIMED_OUT, or failed by anything else —
    // that write matches no row, the transaction throws before a single
    // competitor is written, and nothing is saved or charged. If it is still
    // RUNNING, the row lock that write takes holds off the reaper (whose own
    // write is guarded on PENDING/RUNNING and so finds nothing to do once
    // this commits). All-or-nothing still holds: if competitor write N+1
    // fails, the status change and the first N writes roll back together
    // and the run lands FAILED with savedCount untouched at 0.
    const savedCount = kept.length;
    const finalStatus = savedCount > 0 ? 'DONE' : 'EMPTY';

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

    // `save` goes only into the stats this transaction commits: if it rolls
    // back, the FAILED write in the catch must not claim anything was saved.
    const finalStats: SourceStats = { ...sourceStats, save: { saved: savedCount } };

    await prisma.$transaction(async (tx) => {
      const finished = await tx.discoveryRun.updateMany({
        where: { id: runId, status: 'RUNNING' },
        data: {
          status: finalStatus,
          finishedAt: new Date(),
          savedCount,
          tokensUsed: tokensTotal ?? 0,
          sourceStats: finalStats as Prisma.InputJsonValue,
        },
      });
      if (finished.count === 0) throw new RunNoLongerActiveError(runId);

      for (const candidate of kept) {
        const existing = existingByDomain.get(candidate.domain);
        const existingEvidence = existing ? parseStoredEvidence(existing.evidence) : [];
        const evidence = reconcileEvidence(existingEvidence, candidate.evidence);
        // Round before writing so the database stops holding
        // floating-point noise like 0.9500000000000001 for a number that
        // is shown to a user.
        const confidence = Math.round(candidate.finalConfidence * 1000) / 1000;

        if (existing) {
          await tx.competitor.update({
            where: { id: existing.id },
            data: {
              // `name` and `type` are never rewritten on an existing row:
              // users edit `type`, and the name they already know should
              // not change under them. userDecision is never written here
              // either — a user's decision is sacred.
              domain: candidate.domain,
              description: candidate.description || null,
              confidence,
              labels: candidate.labels,
              sources: candidate.sources,
              evidence,
              positioning: candidate.positioning,
              keyFeatures: candidate.keyFeatures,
              discoveryRunId: runId,
            },
          });
          continue;
        }

        await tx.competitor.create({
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
      }
    });

    await writeActivityLog({
      userId: run.userId,
      workspaceId: workspace.id,
      action: 'COMPETITOR_DISCOVERY_RUN',
      detail: {
        runId,
        status: finalStatus,
        savedCount,
        tokensUsed: tokensTotal,
      },
    });
  } catch (error) {
    if (error instanceof RunNoLongerActiveError) {
      // Something else already finished this run (usually the reaper).
      // Whatever it recorded stands; this call writes nothing more.
      console.warn('runDiscoveryPipeline:', error.message);
      return;
    }

    // Redacted and capped on write, like every other DiscoveryRun.error
    // write site (see redact.ts): the raw message can echo upstream text.
    const message =
      sanitizeUpstreamText(error instanceof Error ? error.message : String(error)) ?? 'Discovery run failed';
    try {
      // Guarded like every other write: a run already finished by
      // something else (reaped, or dispatch-failed) keeps its own record.
      const failed = await prisma.discoveryRun.updateMany({
        where: { id: runId, status: { in: ['PENDING', 'RUNNING'] } },
        data: {
          status: 'FAILED',
          error: message,
          finishedAt: new Date(),
          tokensUsed: tokens.value ?? 0,
          sourceStats: { ...sourceStats, errors: [...runErrors, message] } as Prisma.InputJsonValue,
        },
      });

      if (run && failed.count > 0) {
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
  return updateWhileRunning(runId, { stage });
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

  // Guarded on status as well as id: a run that finished between the read
  // above and this write (its SAVE transaction committed) keeps its result.
  await prisma.discoveryRun.updateMany({
    where: { id: { in: staleIds }, status: { in: ['PENDING', 'RUNNING'] } },
    data: { status: 'FAILED', error: RUN_ERROR.TIMED_OUT, finishedAt: now },
  });
}
