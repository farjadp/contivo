'use server';

import { prisma } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { scrapeUrl, analyzeWebsiteWithGemini, discoverCompetitorsWithGemini } from '@/lib/gemini';
import { writeActivityLog } from '@/lib/activity-log';
import { createWorkspaceProgressBaseline } from '@/lib/workspace-progress';

/**
 * Step 1 of workspace creation: record the workspace and get out of the way.
 *
 * This used to scrape the site and make two Gemini calls inline, which took
 * ~13s with the submit button frozen on "Initializing…" and no feedback, and
 * blew past the serverless function limit on Vercel. The slow work now runs
 * from the analysing screen (see `enrichWorkspace`), so this action stays
 * well under a second and the user sees real progress.
 */
export async function createNewWorkspace(_prevState: any, formData: FormData) {
  const session = await getSession();
  if (!session) return { error: 'Not authenticated' };

  const name = String(formData.get('name') ?? '').trim();
  const url = String(formData.get('url') ?? '').trim();

  if (!name || !url) {
    return { error: 'Please provide both Company Name and Website URL.' };
  }

  let normalizedUrl: string;
  try {
    const parsed = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`);
    if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname.includes('.')) {
      throw new Error('bad host');
    }
    normalizedUrl = parsed.toString();
  } catch {
    return { error: 'That does not look like a valid website address.' };
  }

  const progressBaseline = createWorkspaceProgressBaseline({ brandSummary: {} });

  const workspace = await prisma.workspace.create({
    data: {
      userId: session.userId as string,
      name,
      websiteUrl: normalizedUrl,
      status: 'PENDING',
      brandSummary: {},
      audienceInsights: {
        progressReport: { baseline: progressBaseline },
        extraction: { state: 'PENDING' },
      },
    },
  });

  await writeActivityLog({
    userId: session.userId as string,
    workspaceId: workspace.id,
    action: 'WORKSPACE_CREATED',
    detail: { name, websiteUrl: normalizedUrl },
  });

  redirect(`/growth/analyzing?id=${workspace.id}`);
}

/** What `enrichWorkspace` reports back to the analysing screen. */
export type EnrichmentResult = {
  ok: boolean;
  /** Set when nothing could be extracted at all — the screen offers a retry. */
  error?: string;
  /** Partial failures the user should know about, e.g. no competitors found. */
  warnings: string[];
  competitorsFound: number;
};

/**
 * Step 2: scrape the site, build brand memory, discover competitors.
 *
 * Every failure here used to be swallowed by one catch block, so a Gemini 503
 * produced a workspace with zero competitors and a UI that said "No
 * competitors discovered yet" — indistinguishable from a site that genuinely
 * has none. Failures are now returned to the caller and recorded on the
 * workspace so the reason survives a page reload.
 */
export async function enrichWorkspace(workspaceId: string): Promise<EnrichmentResult> {
  const session = await getSession();
  if (!session) return { ok: false, error: 'Not authenticated', warnings: [], competitorsFound: 0 };

  const workspace = await prisma.workspace.findFirst({
    where: { id: workspaceId, userId: session.userId as string },
    select: { id: true, name: true, websiteUrl: true, audienceInsights: true },
  });
  if (!workspace) {
    return { ok: false, error: 'Workspace not found.', warnings: [], competitorsFound: 0 };
  }

  const url = workspace.websiteUrl ?? '';
  const warnings: string[] = [];
  let brandSummary: any = null;
  let competitorsData: any[] = [];

  // ── Scrape ────────────────────────────────────────────────────────────────
  let scrapedText: string | null = null;
  try {
    scrapedText = await scrapeUrl(url);
  } catch (err) {
    console.error('enrichWorkspace: scrape failed:', err);
  }

  if (!scrapedText) {
    await recordExtractionState(workspace, 'FAILED', ['Could not read the website.']);
    return {
      ok: false,
      error: `We could not read ${url}. Check the address is public and reachable, then try again.`,
      warnings: [],
      competitorsFound: 0,
    };
  }

  // ── Brand memory ──────────────────────────────────────────────────────────
  try {
    const aiResult = await analyzeWebsiteWithGemini(url, scrapedText);
    if (aiResult) {
      brandSummary = {
        heroMessage: aiResult.heroMessage,
        extractedCta: aiResult.extractedCta,
        industry: aiResult.industry,
        businessSummary: aiResult.businessSummary,
        audience: aiResult.audience,
        tone: aiResult.tone,
        valueProposition: aiResult.valueProposition,
        pillars: aiResult.pillars || [],
        persona: aiResult.persona || { title: '', description: '' },
      };
    }
  } catch (err) {
    console.error('enrichWorkspace: brand extraction failed:', err);
  }

  if (!brandSummary) {
    await recordExtractionState(workspace, 'FAILED', ['Brand extraction returned nothing.']);
    return {
      ok: false,
      error:
        'The AI provider did not respond while reading your site. Nothing was saved from this attempt — try again in a moment.',
      warnings: [],
      competitorsFound: 0,
    };
  }

  // ── Competitors (best effort — a failure must not lose the brand memory) ──
  try {
    const comps = await discoverCompetitorsWithGemini(brandSummary);
    if (comps && comps.length > 0) {
      competitorsData = comps;
    } else {
      warnings.push(
        'Competitor discovery came back empty — the AI provider was unavailable. You can retry it from Market Matrices.',
      );
    }
  } catch (err) {
    console.error('enrichWorkspace: competitor discovery failed:', err);
    warnings.push(
      'Competitor discovery failed — the AI provider was unavailable. You can retry it from Market Matrices.',
    );
  }

  const progressBaseline = createWorkspaceProgressBaseline({ brandSummary });
  const existingInsights =
    workspace.audienceInsights && typeof workspace.audienceInsights === 'object'
      ? (workspace.audienceInsights as Record<string, unknown>)
      : {};

  await prisma.workspace.update({
    where: { id: workspace.id },
    data: {
      brandSummary,
      // Workspaces used to stay PENDING forever, so the workspace list's
      // `status === 'READY'` check never matched.
      status: 'READY',
      audienceInsights: {
        ...existingInsights,
        progressReport: { baseline: progressBaseline },
        extraction: {
          state: warnings.length > 0 ? 'PARTIAL' : 'OK',
          warnings,
          at: new Date().toISOString(),
        },
      },
    },
  });

  if (competitorsData.length > 0) {
    await prisma.competitor.createMany({
      data: competitorsData.map((c: any) => ({
        workspaceId: workspace.id,
        name: c.name,
        domain: c.domain,
        description: c.description,
        category: c.category,
        audienceGuess: c.audienceGuess,
        source: 'AI',
      })),
    });
  }

  await writeActivityLog({
    userId: session.userId as string,
    workspaceId: workspace.id,
    action: 'WORKSPACE_BASELINE_SNAPSHOT_CREATED',
    detail: {
      baselineCreatedAt: progressBaseline.created_at,
      baselineScores: progressBaseline.scores,
      baselineMaturityStage: progressBaseline.maturity_stage,
      competitorsSeeded: competitorsData.length,
      warnings,
    },
  });

  return { ok: true, warnings, competitorsFound: competitorsData.length };
}

async function recordExtractionState(
  workspace: { id: string; audienceInsights: unknown },
  state: 'FAILED' | 'PARTIAL' | 'OK',
  warnings: string[],
) {
  const existing =
    workspace.audienceInsights && typeof workspace.audienceInsights === 'object'
      ? (workspace.audienceInsights as Record<string, unknown>)
      : {};
  await prisma.workspace.update({
    where: { id: workspace.id },
    data: {
      status: state === 'FAILED' ? 'ERROR' : 'READY',
      audienceInsights: {
        ...existing,
        extraction: { state, warnings, at: new Date().toISOString() },
      },
    },
  });
}
