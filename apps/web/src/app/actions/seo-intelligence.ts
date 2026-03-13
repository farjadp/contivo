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
 */

import { getSession } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { fetchDomainKeywords, fetchSerpResults } from '@/lib/dataforseo';

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
  const keywords = await fetchDomainKeywords(cleanDomain, MAX_KEYWORDS_PER_COMPETITOR);

  if (keywords.length === 0) {
    return {
      success: false,
      error: `No keyword data found for domain "${cleanDomain}". It may not be indexed by DataForSEO yet.`,
      count: 0,
    };
  }

  // ── Delete old records for this domain and re-insert fresh ones ───────────
  await prisma.competitorKeyword.deleteMany({
    where: { workspaceId, competitorDomain: cleanDomain },
  });

  await prisma.competitorKeyword.createMany({
    data: keywords.map((kw) => ({
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
    domain: cleanDomain,
    count: keywords.length,
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
      error: 'No competitor keyword data found. Run "Scan Competitor Keywords" first.',
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
  await resolveWorkspace(workspaceId);

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
  const serpItems = await fetchSerpResults(normalizedKeyword);

  if (serpItems.length === 0) {
    return {
      success: false,
      error: `No SERP results found for "${keyword}". The keyword may be too niche or unavailable.`,
    };
  }

  // ── Analyze with Gemini ───────────────────────────────────────────────────
  const { analyzeSerpResultsWithGemini } = await import('@/lib/gemini');
  const analysis = await analyzeSerpResultsWithGemini(normalizedKeyword, serpItems);

  if (!analysis) {
    return {
      success: false,
      error: 'AI analysis failed. Try again in a moment.',
    };
  }

  // ── Persist results ───────────────────────────────────────────────────────
  await prisma.serpAnalysis.create({
    data: {
      workspaceId,
      keyword: normalizedKeyword,
      rawResults: serpItems as any,
      analysis,
    },
  });

  return {
    success: true,
    keyword: normalizedKeyword,
    serpCount: serpItems.length,
    analysis,
    rawResults: serpItems,
  };
}

// ─── Queries ─────────────────────────────────────────────────────────────────

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
