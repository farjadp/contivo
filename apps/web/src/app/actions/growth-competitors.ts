'use server';

import { promises as dns } from 'node:dns';

import { prisma } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { generatePositioningInsights } from '@/lib/gemini';
import { discoverCompetitorsWithGemini } from '@/lib/gemini';
import {
  createDiscoveryArchive,
  getMaxDiscoveryRuns,
  getWorkspaceDiscoveryStats,
  listWorkspaceDiscoveryArchive,
  writeActivityLog,
} from '@/lib/activity-log';

type EditableCompetitor = {
  id?: string;
  name?: string;
  domain?: string | null;
  description?: string | null;
  category?: string | null;
  audienceGuess?: string | null;
  type?: string | null;
  userDecision?: string | null;
  confidence?: number | null;
  reason?: string | null;
  positioning?: string | null;
  keyFeatures?: string[] | null;
};

type OpenAiDiscoveredCompetitor = EditableCompetitor & {
  confidence?: number | null;
  reason?: string | null;
  positioning?: string | null;
  keyFeatures?: string[] | null;
};

function normalizeDomain(value: string | null | undefined): string | null {
  const raw = String(value || '').trim();
  if (!raw) return null;

  const withoutProtocol = raw.replace(/^https?:\/\//i, '').replace(/^www\./i, '');
  const domain = withoutProtocol.split('/')[0]?.toLowerCase().trim();
  return domain || null;
}

function normalizeCompetitorType(type: string | null | undefined): 'DIRECT' | 'INDIRECT' | 'ASPIRATIONAL' {
  if (type === 'INDIRECT') return 'INDIRECT';
  if (type === 'ASPIRATIONAL') return 'ASPIRATIONAL';
  return 'DIRECT';
}

function normalizeDecision(decision: string | null | undefined): 'ACCEPTED' | 'REJECTED' | 'PENDING' {
  if (decision === 'REJECTED') return 'REJECTED';
  if (decision === 'PENDING') return 'PENDING';
  return 'ACCEPTED';
}

function normalizeTypeFromDiscovery(type: string | null | undefined): 'DIRECT' | 'INDIRECT' | 'ASPIRATIONAL' {
  const value = String(type || '').trim().toLowerCase();
  if (value === 'indirect') return 'INDIRECT';
  if (value === 'adjacent') return 'ASPIRATIONAL';
  if (value === 'aspirational') return 'ASPIRATIONAL';
  return 'DIRECT';
}

function normalizeConfidence(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.min(1, parsed));
}

function trimTo(value: string | null | undefined, max = 255): string {
  return String(value || '').trim().slice(0, max);
}

function serializeCompetitorsForClient(items: any[]) {
  return items.map((item) => ({
    id: item.id,
    name: item.name,
    domain: item.domain,
    description: item.description,
    category: item.category,
    audienceGuess: item.audienceGuess,
    type: item.type,
    userDecision: item.userDecision,
    source: item.source,
    confidence: null,
    reason: null,
    positioning: null,
    keyFeatures: null,
  }));
}

function stripCodeFences(value: string): string {
  return value
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/i, '')
    .trim();
}

function isLikelySyntheticCompetitor(item: { name?: string | null; domain?: string | null }): boolean {
  const name = String(item.name || '').toLowerCase().trim();
  const domain = String(item.domain || '').toLowerCase().trim();

  if (!name && !domain) return true;

  const syntheticNames = ['nova labs', 'pulse works', 'axis growth', 'summit metrics', 'clarity forge'];
  if (syntheticNames.includes(name)) return true;

  if (/^market\d+\.com$/.test(domain)) return true;
  if (!domain.includes('.') && !name) return true;

  return false;
}

async function domainHasDns(domain: string): Promise<boolean> {
  const normalized = normalizeDomain(domain);
  if (!normalized) return false;

  try {
    const records = await dns.resolve(normalized);
    return records.length > 0;
  } catch {
    return false;
  }
}

async function domainResponds(domain: string): Promise<boolean> {
  const normalized = normalizeDomain(domain);
  if (!normalized) return false;

  const urls = [`https://${normalized}`, `http://${normalized}`];
  for (const target of urls) {
    try {
      const res = await fetch(target, {
        method: 'GET',
        redirect: 'follow',
        signal: AbortSignal.timeout(4000),
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        },
      });
      if (res.ok || res.status === 401 || res.status === 403) {
        return true;
      }
    } catch {
      continue;
    }
  }

  return false;
}

function buildCompetitorDiscoveryPrompt(input: {
  companyName: string;
  websiteUrl?: string | null;
  summary: string;
  productDescription: string;
  industry: string;
  audience: string;
  keywords: string[];
  limit: number;
}): string {
  return `
You are a market intelligence analyst.
Your job is to identify real competitors for a company using website-based signals.

Prioritize:
- accuracy
- relevance
- real companies
- verifiable domains

Never invent companies. If uncertain, lower confidence.

INPUT
Company Name: ${input.companyName}
Website URL: ${input.websiteUrl || 'unknown'}
Website Summary: ${input.summary}
Product / Service Description: ${input.productDescription}
Detected Industry: ${input.industry}
Detected Audience: ${input.audience}
Key Keywords: ${input.keywords.join(', ')}

TASK
Identify competitors for this product. Focus on direct, indirect, and adjacent tools.
Return 6 to ${input.limit} competitors maximum. Quality > quantity.

PROCESS (you must follow):
1) Infer product category, core problem, primary audience.
2) Generate discovery search query ideas (category, alternatives, audience query types).
3) Identify candidate competitors.
4) Validate each candidate is real, has a real site, and overlaps product/audience.
5) Classify each as direct / indirect / adjacent.
6) Extract signals for each.
7) Assign confidence score between 0 and 1.
8) Explain reason for inclusion.

STRICT RULES:
- No more than ${input.limit}
- Unique domains only
- Exclude the original company itself
- Avoid agencies, blogs, consultants, marketplaces, unrelated services
- Prefer well-known or verifiable companies
- If uncertain, lower confidence

Return JSON only using this schema:
{
  "product_category": "string",
  "core_problem": "string",
  "primary_audience": "string",
  "search_queries": ["string"],
  "competitors": [
    {
      "name": "string",
      "website": "https://example.com",
      "type": "direct|indirect|adjacent",
      "description": "string",
      "product_category": "string",
      "target_audience": "string",
      "key_features": ["string"],
      "positioning": "string",
      "confidence": 0.0,
      "reason": "string"
    }
  ]
}
`;
}

async function discoverCompetitorsWithOpenAI(
  brandSummary: any,
  workspaceName?: string,
  websiteUrl?: string | null,
  limit = 10,
): Promise<{
  candidates: OpenAiDiscoveredCompetitor[];
  context: {
    productCategory: string;
    coreProblem: string;
    primaryAudience: string;
    searchQueries: string[];
  };
}> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return {
      candidates: [],
      context: {
        productCategory: '',
        coreProblem: '',
        primaryAudience: '',
        searchQueries: [],
      },
    };
  }

  const model = process.env.OPENAI_DEFAULT_MODEL || 'gpt-4.1';
  const ownDomain = normalizeDomain(websiteUrl || '');
  const summary = trimTo(brandSummary?.businessSummary || brandSummary?.heroMessage || '', 500);
  const productDescription = trimTo(brandSummary?.valueProposition || summary, 500);
  const industry = trimTo(brandSummary?.industry || 'Unknown', 120);
  const audience = trimTo(brandSummary?.audience || brandSummary?.persona?.title || 'Unknown', 160);
  const keywords = [
    industry,
    audience,
    trimTo(brandSummary?.heroMessage, 120),
    trimTo(brandSummary?.valueProposition, 120),
    ...(Array.isArray(brandSummary?.pillars) ? brandSummary.pillars : []),
  ]
    .map((item) => trimTo(item, 80))
    .filter(Boolean)
    .slice(0, 10);

  const prompt = buildCompetitorDiscoveryPrompt({
    companyName: trimTo(workspaceName || ownDomain || 'Unknown Company', 120),
    websiteUrl,
    summary,
    productDescription,
    industry,
    audience,
    keywords,
    limit,
  });

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content:
              'You are precise and factual. Return only valid JSON. Do not include fake or uncertain companies.',
          },
          { role: 'user', content: prompt },
        ],
        temperature: 0.2,
      }),
    });

    if (!res.ok) {
      console.error('OpenAI competitor discovery error:', await res.text());
      return {
        candidates: [],
        context: {
          productCategory: '',
          coreProblem: '',
          primaryAudience: '',
          searchQueries: [],
        },
      };
    }

    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content || typeof content !== 'string') {
      return {
        candidates: [],
        context: {
          productCategory: '',
          coreProblem: '',
          primaryAudience: '',
          searchQueries: [],
        },
      };
    }

    const parsed = JSON.parse(stripCodeFences(content));
    const competitors = Array.isArray(parsed?.competitors) ? parsed.competitors : [];
    const candidates = competitors
      .map((item: any) => ({
        name: trimTo(item?.name, 120),
        domain: normalizeDomain(item?.website || item?.domain),
        description: trimTo(item?.description, 500) || null,
        category: trimTo(item?.product_category || item?.category, 120) || null,
        audienceGuess: trimTo(item?.target_audience || item?.audienceGuess, 200) || null,
        type: normalizeTypeFromDiscovery(item?.type),
        confidence: normalizeConfidence(item?.confidence),
        reason: trimTo(item?.reason, 280) || null,
        positioning: trimTo(item?.positioning, 280) || null,
        keyFeatures: Array.isArray(item?.key_features)
          ? item.key_features.map((feature: unknown) => trimTo(String(feature), 80)).filter(Boolean).slice(0, 6)
          : null,
      }))
      .filter((item: EditableCompetitor) => {
        const domain = normalizeDomain(item.domain);
        if (!item.name || !domain) return false;
        if (ownDomain && domain === ownDomain) return false;
        return !isLikelySyntheticCompetitor(item);
      })
      .slice(0, limit);

    return {
      candidates,
      context: {
        productCategory: trimTo(parsed?.product_category, 160),
        coreProblem: trimTo(parsed?.core_problem, 220),
        primaryAudience: trimTo(parsed?.primary_audience, 180),
        searchQueries: Array.isArray(parsed?.search_queries)
          ? parsed.search_queries.map((query: unknown) => trimTo(String(query), 100)).filter(Boolean).slice(0, 12)
          : [],
      },
    };
  } catch (error) {
    console.error('Failed to parse OpenAI competitor discovery:', error);
    return {
      candidates: [],
      context: {
        productCategory: '',
        coreProblem: '',
        primaryAudience: '',
        searchQueries: [],
      },
    };
  }
}

export async function saveCompetitors(_prevState: any, formData: FormData) {
  const session = await getSession();
  if (!session) return { error: 'Not authenticated' };

  const id = formData.get('id') as string;
  const competitorsJson = formData.get('competitorsData') as string;

  if (!id || !competitorsJson) return { error: 'Missing data' };

  try {
    const competitors = JSON.parse(competitorsJson);

    // Filter out exactly which competitors the user interacted with, or we just save the current client state array.
    for (const comp of competitors) {
      if (comp.id.startsWith('temp-')) {
        // Manually added by user
        await prisma.competitor.create({
           data: {
             workspaceId: id,
             name: comp.name,
             domain: comp.domain,
             description: comp.description || '',
             source: 'MANUAL',
             userDecision: comp.userDecision || 'ACCEPTED',
             type: comp.type || 'DIRECT'
           }
        });
      } else {
        // Existing AI generated competitor
        await prisma.competitor.update({
          where: { id: comp.id },
          data: {
            userDecision: comp.userDecision,
            type: comp.type,
            name: comp.name,
            domain: comp.domain
          }
        });
      }
    }

    // Now generate the strategic positioning insights based on exactly what the user validated
    const activeCompetitors = competitors.filter((c: any) => c.userDecision === 'ACCEPTED');
    const workspace = await prisma.workspace.findUnique({
      where: { id }
    });

    if (workspace && activeCompetitors.length > 0) {
       const brandSummary = workspace.brandSummary as any || {};
       const insights = await generatePositioningInsights(brandSummary, activeCompetitors);
       
       if (insights) {
          await prisma.workspace.update({
             where: { id },
             data: {
               brandSummary: {
                 ...brandSummary,
                 positioningOpportunity: insights.positioningOpportunity,
                 messagingDifferentiation: insights.messagingDifferentiation
               }
             }
          });
       }
    }

    await writeActivityLog({
      userId: session.userId as string,
      workspaceId: id,
      action: 'COMPETITOR_REVIEW_SAVED',
      detail: {
        acceptedCount: activeCompetitors.length,
        totalCount: competitors.length,
      },
    });

  } catch (err) {
    console.error('Failed to save competitors:', err);
    return { error: 'Failed to save competitors' };
  }

  // Advance to the Strategy Review
  redirect(`/growth/review?id=${id}`);
}

export async function discoverWorkspaceCompetitors(workspaceId: string) {
  const session = await getSession();
  if (!session) return { error: 'Not authenticated' };

  if (!workspaceId) return { error: 'Workspace ID is required' };

  try {
    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId, userId: session.userId as string },
      include: { competitors: true },
    });

    if (!workspace) return { error: 'Workspace not found' };

    const brandSummary = (workspace.brandSummary as any) || {};
    const discoveryStats = await getWorkspaceDiscoveryStats(session.userId as string, workspace.id);
    const maxRuns = await getMaxDiscoveryRuns();

    if (discoveryStats.remainingRuns <= 0) {
      await writeActivityLog({
        userId: session.userId as string,
        workspaceId: workspace.id,
        action: 'COMPETITOR_DISCOVERY_BLOCKED',
        detail: {
          reason: 'LIMIT_REACHED',
          usedRuns: discoveryStats.usedRuns,
          maxRuns,
        },
      });
      const archive = await listWorkspaceDiscoveryArchive(session.userId as string, workspace.id, 10);
      return {
        error: `Discovery limit reached (${maxRuns}/${maxRuns}).`,
        meta: {
          usedRuns: discoveryStats.usedRuns,
          remainingRuns: discoveryStats.remainingRuns,
          maxRuns,
        },
        archive,
      };
    }

    const ownDomain = normalizeDomain(workspace.websiteUrl || '');
    const existing = [...workspace.competitors];

    const syntheticIds = existing
      .filter((item) => isLikelySyntheticCompetitor({ name: item.name, domain: item.domain }))
      .map((item) => item.id);

    if (syntheticIds.length > 0) {
      await prisma.competitor.deleteMany({
        where: { workspaceId: workspace.id, id: { in: syntheticIds } },
      });
    }

    const openAiDiscovery = await discoverCompetitorsWithOpenAI(
      brandSummary,
      workspace.name,
      workspace.websiteUrl,
      12,
    );

    const geminiFallbackCandidates = openAiDiscovery.candidates.length >= 6
      ? []
      : ((await discoverCompetitorsWithGemini(brandSummary)) || [])
          .map((item: any) => ({
            name: trimTo(item?.name || item?.domain || 'Unknown Competitor', 120),
            domain: normalizeDomain(item?.domain),
            description: trimTo(item?.description, 500) || null,
            category: trimTo(item?.category, 120) || null,
            audienceGuess: trimTo(item?.audienceGuess, 200) || null,
            type: normalizeTypeFromDiscovery(item?.type),
            confidence: null,
            reason: null,
            positioning: null,
            keyFeatures: null,
          }))
          .filter((item: EditableCompetitor) => {
            const domain = normalizeDomain(item.domain);
            if (!item.name || !domain) return false;
            if (ownDomain && domain === ownDomain) return false;
            return !isLikelySyntheticCompetitor(item);
          });

    const mergedCandidates = [...openAiDiscovery.candidates, ...geminiFallbackCandidates];

    const uniqueCandidates: OpenAiDiscoveredCompetitor[] = [];
    const seen = new Set<string>();

    for (const candidate of mergedCandidates) {
      const domain = normalizeDomain(candidate.domain);
      const key = domain || candidate.name?.toLowerCase().trim();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      uniqueCandidates.push(candidate);
    }

    const validatedCandidates: OpenAiDiscoveredCompetitor[] = [];
    for (const candidate of uniqueCandidates) {
      const domain = normalizeDomain(candidate.domain);
      if (!domain) continue;
      const dnsValid = await domainHasDns(domain);
      if (!dnsValid) continue;

      const reachable = await domainResponds(domain);
      const confidence = candidate.confidence ?? 0.55;
      const validationBoost = reachable ? 0.2 : -0.05;
      const finalConfidence = Math.max(0.3, Math.min(0.99, confidence + validationBoost));

      if (!reachable && finalConfidence < 0.72) {
        continue;
      }

      validatedCandidates.push({
        ...candidate,
        confidence: finalConfidence,
        reason: trimTo(
          `${candidate.reason || 'Product and audience overlap detected.'}${reachable ? ' Verified reachable website.' : ' Domain DNS verified.'}`,
          320,
        ),
      });
      if (validatedCandidates.length >= 10) break;
    }

    if (validatedCandidates.length === 0) {
      await writeActivityLog({
        userId: session.userId as string,
        workspaceId: workspace.id,
        action: 'COMPETITOR_DISCOVERY_FAILED',
        detail: {
          reason: 'NO_REAL_COMPETITORS_FOUND',
        },
      });
      return {
        error: 'No high-confidence competitors found. Try refining your positioning and try again.',
        meta: {
          usedRuns: discoveryStats.usedRuns,
          remainingRuns: discoveryStats.remainingRuns,
          maxRuns,
        },
      };
    }

    for (const item of validatedCandidates) {
      const name = trimTo(item.name || item.domain || 'Unknown Competitor', 120);
      const domain = normalizeDomain(item.domain);
      if (!name || !domain) continue;

      const description = trimTo(item.description, 500);
      const category = trimTo(item.category, 120);
      const audienceGuess = trimTo(item.audienceGuess, 200);
      const type = normalizeTypeFromDiscovery(item.type);
      const confidenceLabel = item.confidence != null ? `Confidence ${(item.confidence * 100).toFixed(0)}%` : '';
      const reasoning = trimTo(item.reason, 220);
      const positioning = trimTo(item.positioning, 120);
      const keyFeatures = Array.isArray(item.keyFeatures) ? item.keyFeatures.join(', ') : '';
      const enrichedDescription = trimTo(
        [description, positioning ? `Positioning: ${positioning}` : '', reasoning ? `Reason: ${reasoning}` : '', confidenceLabel, keyFeatures ? `Signals: ${keyFeatures}` : '']
          .filter(Boolean)
          .join(' | '),
        500,
      );

      const duplicate = existing.find((entry) => {
        const entryDomain = normalizeDomain(entry.domain);
        if (entryDomain && domain && entryDomain === domain) return true;
        return entry.name.trim().toLowerCase() === name.trim().toLowerCase();
      });

      if (duplicate) {
        await prisma.competitor.update({
          where: { id: duplicate.id },
          data: {
            name,
            domain,
            description: enrichedDescription || duplicate.description,
            category: category || duplicate.category,
            audienceGuess: audienceGuess || duplicate.audienceGuess,
            source: 'AI',
            type,
            userDecision: duplicate.userDecision || 'PENDING',
          },
        });
        continue;
      }

      await prisma.competitor.create({
        data: {
          workspaceId: workspace.id,
          name,
          domain,
          description: enrichedDescription || 'AI-discovered potential competitor',
          category: category || 'Unknown',
          audienceGuess: audienceGuess || 'Unknown',
          source: 'AI',
          type,
          userDecision: 'PENDING',
        },
      });
    }

    const latest = await prisma.competitor.findMany({
      where: { workspaceId: workspace.id },
      orderBy: { createdAt: 'asc' },
    });

    const archiveMeta = await createDiscoveryArchive({
      userId: session.userId as string,
      workspaceId: workspace.id,
      source: 'AI_DISCOVERY',
      competitors: validatedCandidates,
    });

    await writeActivityLog({
      userId: session.userId as string,
      workspaceId: workspace.id,
      action: 'COMPETITOR_DISCOVERY_RUN',
      detail: {
        runNumber: archiveMeta.runNumber,
        discoveredCount: validatedCandidates.length,
        remainingRuns: archiveMeta.remainingRuns,
        productCategory: openAiDiscovery.context.productCategory || null,
        coreProblem: openAiDiscovery.context.coreProblem || null,
        primaryAudience: openAiDiscovery.context.primaryAudience || null,
        searchQueries: openAiDiscovery.context.searchQueries || [],
      },
    });

    const archive = await listWorkspaceDiscoveryArchive(session.userId as string, workspace.id, 10);

    return {
      success: true,
      competitors: serializeCompetitorsForClient(latest),
      message: 'We found potential competitors for your business. Please review and confirm them.',
      meta: {
        usedRuns: archiveMeta.runNumber,
        remainingRuns: archiveMeta.remainingRuns,
        maxRuns,
      },
      archive,
    };
  } catch (error) {
    console.error('discoverWorkspaceCompetitors failed:', error);
    return { error: 'Could not discover competitors right now.' };
  }
}

export async function saveWorkspaceCompetitorEdits(workspaceId: string, competitors: EditableCompetitor[]) {
  const session = await getSession();
  if (!session) return { error: 'Not authenticated' };
  if (!workspaceId) return { error: 'Workspace ID is required' };
  if (!Array.isArray(competitors)) return { error: 'Invalid competitor payload' };

  try {
    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId, userId: session.userId as string },
      include: { competitors: true },
    });

    if (!workspace) return { error: 'Workspace not found' };

    const existingById = new Map(workspace.competitors.map((item) => [item.id, item]));

    for (const raw of competitors.slice(0, 50)) {
      const id = String(raw.id || '');
      const name = trimTo(raw.name, 120);
      if (!name) continue;

      const domain = normalizeDomain(raw.domain);
      const description = trimTo(raw.description, 500);
      const category = trimTo(raw.category, 120);
      const audienceGuess = trimTo(raw.audienceGuess, 200);
      const type = normalizeCompetitorType(raw.type);
      const userDecision = normalizeDecision(raw.userDecision);

      const data = {
        name,
        domain,
        description: description || null,
        category: category || null,
        audienceGuess: audienceGuess || null,
        type,
        userDecision,
      };

      if (!id || id.startsWith('temp-') || !existingById.has(id)) {
        await prisma.competitor.create({
          data: {
            workspaceId: workspace.id,
            ...data,
            source: 'MANUAL',
          },
        });
        continue;
      }

      await prisma.competitor.update({
        where: { id },
        data,
      });
    }

    const latest = await prisma.competitor.findMany({
      where: { workspaceId: workspace.id },
      orderBy: { createdAt: 'asc' },
    });

    await writeActivityLog({
      userId: session.userId as string,
      workspaceId: workspace.id,
      action: 'COMPETITOR_MANUAL_EDIT_SAVED',
      detail: {
        editedCount: competitors.length,
      },
    });

    const stats = await getWorkspaceDiscoveryStats(session.userId as string, workspace.id);

    return {
      success: true,
      competitors: serializeCompetitorsForClient(latest),
      meta: {
        usedRuns: stats.usedRuns,
        remainingRuns: stats.remainingRuns,
        maxRuns: await getMaxDiscoveryRuns(),
      },
      archive: await listWorkspaceDiscoveryArchive(session.userId as string, workspace.id, 10),
    };
  } catch (error) {
    console.error('saveWorkspaceCompetitorEdits failed:', error);
    return { error: 'Could not save competitor edits.' };
  }
}
