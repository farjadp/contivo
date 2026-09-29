'use server';

/**
 * SEO Intelligence Server Actions
 *
 * Three core actions powered by DataForSEO API:
 *   1. scanCompetitorKeywords   — Pulls real keyword data for a competitor domain
 *   2. computeKeywordOpportunities — Calculates gap keywords the client can target
 *   3. analyzeSerpForKeyword    — Runs a SERP query and generates a Gemini AI insight report
 *
 * Rate limits (enforced via DB timestamp, no Redis required):
 *   - Competitor scan: max 1 per domain per 7 days
 *   - SERP analysis:   max 1 per keyword per 24 hours
 *
 * Provenance rule: generated sample data (DATAFORSEO_MOCK=1) is returned to the
 * caller labelled 'MOCK' and is never written to the database. Anything stored
 * in competitor_keywords or serp_analyses is therefore live by construction,
 * which is what lets matrices and ideation trust it.
 */

import { getSession } from '@/lib/auth';
import { prisma } from '@/lib/db';
import {
  DataForSEOError,
  fetchDomainKeywords,
  fetchSerpResults,
  hasDataForSeoCredentials,
  type DataForSEODataSource,
} from '@/lib/dataforseo';
import { asContentLanguage } from '@/lib/content-language';
import { actionError } from '@/lib/action-errors';

// ─── Constants ────────────────────────────────────────────────────────────────

const COMPETITOR_SCAN_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;   // 7 days
const SERP_ANALYSIS_COOLDOWN_MS   = 24 * 60 * 60 * 1000;         // 24 hours
const MAX_KEYWORDS_PER_COMPETITOR  = 200;
const MAX_KEYWORD_OPPORTUNITIES    = 50;

// ─── Helper: Auth + Workspace guard ──────────────────────────────────────────

async function resolveWorkspace(workspaceId: string) {
  const session = await getSession();
  if (!session?.userId) throw new Error('Unauthorized');

  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId, userId: session.userId },
  });
  if (!workspace) throw new Error('Workspace not found');

  return { session, workspace };
}

/** Turn a client failure into something the user can act on, never into data. */
function describeDataForSeoFailure(err: unknown): string {
  if (err instanceof DataForSEOError && err.reason === 'MISSING_CREDENTIALS') {
    return 'DataForSEO is not configured. Set DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD, then try again.';
  }
  if (err instanceof DataForSEOError) {
    return `The DataForSEO request failed: ${err.message.slice(0, 200)}`;
  }
  throw err;
}

// ─── Module 1: Competitor Keyword Scan ────────────────────────────────────────

/**
 * Scan real keyword data from DataForSEO for a competitor domain.
 * Respects a 7-day cooldown per domain to avoid excess API costs.
 *
 * @param workspaceId  The workspace this scan belongs to
 * @param domain       The competitor's domain, e.g. "hubspot.com"
 */
export async function scanCompetitorKeywords(
  workspaceId: string,
  domain: string,
) {
  await resolveWorkspace(workspaceId);

  const cleanDomain = domain.replace(/^https?:\/\//, '').replace(/\/.*$/, '').toLowerCase();

  // ── Rate limit check ──────────────────────────────────────────────────────
  const latest = await prisma.competitorKeyword.findFirst({
    where: { workspaceId, competitorDomain: cleanDomain },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  });

  if (latest) {
    const ageMs = Date.now() - latest.createdAt.getTime();
    if (ageMs < COMPETITOR_SCAN_COOLDOWN_MS) {
      const nextScanMs = COMPETITOR_SCAN_COOLDOWN_MS - ageMs;
      const nextScanDays = Math.ceil(nextScanMs / (24 * 60 * 60 * 1000));
      return {
        skipped: true,
        reason: `Domain "${cleanDomain}" was scanned recently. Next scan available in ${nextScanDays} day(s).`,
        nextScanAvailableAt: new Date(latest.createdAt.getTime() + COMPETITOR_SCAN_COOLDOWN_MS),
      };
    }
  }

  // ── Fetch from DataForSEO ─────────────────────────────────────────────────
  let keywords: Awaited<ReturnType<typeof fetchDomainKeywords>>;
  try {
    keywords = await fetchDomainKeywords(cleanDomain, MAX_KEYWORDS_PER_COMPETITOR);
  } catch (err) {
    // A failed lookup is reported as a failure. It used to become mock rows.
    return { success: false, error: describeDataForSeoFailure(err), count: 0 };
  }

  if (keywords.items.length === 0) {
    return {
      success: false,
      error: `No keyword data found for domain "${cleanDomain}". It may not be indexed by DataForSEO yet.`,
      count: 0,
    };
  }

  if (keywords.dataSource === 'MOCK') {
    // Shown for UI work, never stored: stored keyword data is what matrices and
    // ideation treat as evidence, and sample numbers would poison both.
    return {
      success: true,
      stored: false,
      dataSource: 'MOCK' as DataForSEODataSource,
      domain: cleanDomain,
      count: keywords.items.length,
      keywords: keywords.items,
    };
  }

  // ── Delete old records for this domain and re-insert fresh ones ───────────
  await prisma.competitorKeyword.deleteMany({
    where: { workspaceId, competitorDomain: cleanDomain },
  });

  await prisma.competitorKeyword.createMany({
    data: keywords.items.map((kw) => ({
      workspaceId,
      competitorDomain: cleanDomain,
      keyword: kw.keyword,
      searchVolume: Math.max(0, Math.round(kw.search_volume)),
      difficulty: Math.max(0, Math.min(100, Math.round(kw.keyword_difficulty))),
      competition: Math.max(0, Math.min(1, kw.competition)),
      rankingPosition: kw.ranking_position,
      rankingUrl: kw.ranking_url,
    })),
  });

  return {
    success: true,
    stored: true,
    dataSource: 'LIVE' as DataForSEODataSource,
    domain: cleanDomain,
    count: keywords.items.length,
  };
}

// ─── Module 2: Keyword Opportunity Computation ────────────────────────────────

/**
 * Compute keyword opportunities for the workspace.
 * Formula: opportunityScore = (searchVolume × 0.6) + ((1 - competition) × 0.4)
 * Top 50 are stored, replacing previous results.
 *
 * @param workspaceId  The workspace to compute opportunities for
 */
export async function computeKeywordOpportunities(workspaceId: string) {
  const { } = await resolveWorkspace(workspaceId);

  // Fetch all competitor keywords for this workspace
  const allCompetitorKeywords = await prisma.competitorKeyword.findMany({
    where: { workspaceId },
    orderBy: { searchVolume: 'desc' },
  });

  if (allCompetitorKeywords.length === 0) {
    return {
      success: false,
      error: await actionError('noKeywordData'),
    };
  }

  // Optionally: fetch client's own keywords to subtract (gap analysis)
  // For now we use all competitor keywords as the opportunity pool
  // and de-duplicate by keyword string across competitors
  const keywordMap = new Map<string, {
    searchVolume: number;
    competition: number;
    sourceCompetitor: string;
  }>();

  for (const kw of allCompetitorKeywords) {
    const existing = keywordMap.get(kw.keyword.toLowerCase());
    // Keep the entry with highest search volume (most valuable opportunity)
    if (!existing || kw.searchVolume > existing.searchVolume) {
      keywordMap.set(kw.keyword.toLowerCase(), {
        searchVolume: kw.searchVolume,
        competition: kw.competition,
        sourceCompetitor: kw.competitorDomain,
      });
    }
  }

  // Score and sort
  const scored = Array.from(keywordMap.entries())
    .map(([keyword, data]) => ({
      keyword,
      searchVolume: data.searchVolume,
      competition: data.competition,
      opportunityScore:
        data.searchVolume * 0.6 + (1 - data.competition) * 0.4,
      sourceCompetitor: data.sourceCompetitor,
    }))
    .sort((a, b) => b.opportunityScore - a.opportunityScore)
    .slice(0, MAX_KEYWORD_OPPORTUNITIES);

  // Replace old opportunities
  await prisma.keywordOpportunity.deleteMany({ where: { workspaceId } });
  await prisma.keywordOpportunity.createMany({
    data: scored.map((item) => ({
      workspaceId,
      keyword: item.keyword,
      searchVolume: Math.round(item.searchVolume),
      competition: item.competition,
      opportunityScore: Math.round(item.opportunityScore * 100) / 100,
      sourceCompetitor: item.sourceCompetitor,
    })),
  });

  return {
    success: true,
    count: scored.length,
    topOpportunities: scored.slice(0, 10),
  };
}

// ─── Module 3: SERP Analysis ─────────────────────────────────────────────────

/**
 * Fetch SERP results for a keyword, analyze them with Gemini AI,
 * and store the insight report. Respects a 24-hour cooldown per keyword.
 *
 * @param workspaceId  The workspace context
 * @param keyword      The keyword to analyze, e.g. "content marketing tools"
 */
export async function analyzeSerpForKeyword(
  workspaceId: string,
  keyword: string,
) {
  const { workspace } = await resolveWorkspace(workspaceId);

  const normalizedKeyword = keyword.toLowerCase().trim();

  // ── Rate limit check ──────────────────────────────────────────────────────
  const latest = await prisma.serpAnalysis.findFirst({
    where: { workspaceId, keyword: normalizedKeyword },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true, analysis: true, rawResults: true },
  });

  if (latest) {
    const ageMs = Date.now() - latest.createdAt.getTime();
    if (ageMs < SERP_ANALYSIS_COOLDOWN_MS) {
      const nextHours = Math.ceil((SERP_ANALYSIS_COOLDOWN_MS - ageMs) / (60 * 60 * 1000));
      return {
        skipped: true,
        reason: `SERP analysis for "${keyword}" was run recently. Next available in ${nextHours}h.`,
        analysis: latest.analysis,
        rawResults: latest.rawResults,
      };
    }
  }

  // ── Fetch SERP results from DataForSEO ────────────────────────────────────
  let serp: Awaited<ReturnType<typeof fetchSerpResults>>;
  try {
    serp = await fetchSerpResults(normalizedKeyword);
  } catch (err) {
    return { success: false, error: describeDataForSeoFailure(err) };
  }

  const serpItems = serp.items;

  if (serpItems.length === 0) {
    return {
      success: false,
      error: `No SERP results found for "${keyword}". The keyword may be too niche or unavailable.`,
    };
  }

  // ── Analyze with Gemini ───────────────────────────────────────────────────
  const { analyzeSerpResultsWithGemini } = await import('@/lib/gemini');
  const analysis = await analyzeSerpResultsWithGemini(
    normalizedKeyword,
    serpItems,
    asContentLanguage(workspace.contentLanguage),
  );

  if (!analysis) {
    return {
      success: false,
      error: await actionError('aiAnalysisFailed'),
    };
  }

  // ── Persist results ───────────────────────────────────────────────────────
  // Sample SERPs are never stored, so a saved analysis always rests on a real
  // search. The cooldown is not consumed either, since nothing was recorded.
  if (serp.dataSource === 'LIVE') {
    await prisma.serpAnalysis.create({
      data: {
        workspaceId,
        keyword: normalizedKeyword,
        rawResults: serpItems as any,
        analysis,
      },
    });
  }

  return {
    success: true,
    stored: serp.dataSource === 'LIVE',
    dataSource: serp.dataSource,
    keyword: normalizedKeyword,
    serpCount: serpItems.length,
    analysis,
    rawResults: serpItems,
  };
}

// ─── Queries ─────────────────────────────────────────────────────────────────

/**
 * Whether live SEO lookups are possible at all, so the UI can say "not
 * configured" instead of letting the user spend a click on a guaranteed error.
 */
export async function getSeoDataSourceStatus() {
  await getSession();
  return {
    configured: hasDataForSeoCredentials(),
    mockMode: process.env.DATAFORSEO_MOCK === '1',
  };
}

/** Load all SEO intelligence data for the workspace dashboard. */
export async function loadSeoIntelligence(workspaceId: string) {
  await resolveWorkspace(workspaceId);

  const [competitorKeywords, keywordOpportunities, serpAnalyses] = await Promise.all([
    prisma.competitorKeyword.findMany({
      where: { workspaceId },
      orderBy: [{ competitorDomain: 'asc' }, { searchVolume: 'desc' }],
    }),
    prisma.keywordOpportunity.findMany({
      where: { workspaceId },
      orderBy: { opportunityScore: 'desc' },
    }),
    prisma.serpAnalysis.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        keyword: true,
        analysis: true,
        createdAt: true,
        // rawResults omitted from list to keep payload small
      },
    }),
  ]);

  // Group competitor keywords by domain
  const byDomain = new Map<string, typeof competitorKeywords>();
  for (const kw of competitorKeywords) {
    if (!byDomain.has(kw.competitorDomain)) {
      byDomain.set(kw.competitorDomain, []);
    }
    byDomain.get(kw.competitorDomain)!.push(kw);
  }

  // Compute last scan time per domain
  const domainScans: Record<string, Date> = {};
  for (const kw of competitorKeywords) {
    const existing = domainScans[kw.competitorDomain];
    if (!existing || kw.createdAt > existing) {
      domainScans[kw.competitorDomain] = kw.createdAt;
    }
  }

  return {
    domainGroups: Object.fromEntries(byDomain),
    domainScans,
    keywordOpportunities,
    serpAnalyses,
  };
}
