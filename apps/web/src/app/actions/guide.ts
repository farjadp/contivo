'use server';

import { getSession } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { requestJsonFromAi } from '@/lib/gemini';
import { buildJourney, type WorkspaceFacts } from '@/lib/workspace-journey';

/**
 * The guide's advice is deterministic — it comes from the journey model, not
 * from a model's imagination. The AI only writes the *explanation*: why this
 * step matters for this particular brand. If the AI is unavailable the guide
 * still works, it is just less personal. Advice must never depend on a
 * provider being up.
 */

export type GuideAnswer = {
  stepTitle: string | null;
  headline: string;
  body: string;
  action: string | null;
  href: string | null;
  source: 'ai' | 'fallback';
};

export async function explainNextStep(workspaceId: string): Promise<GuideAnswer | { error: string }> {
  const session = await getSession();
  if (!session) return { error: 'Not authenticated' };
  const userId = session.userId as string;

  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId, userId },
    include: {
      competitors: { select: { userDecision: true } },
      _count: { select: { contentItems: true } },
    },
  });
  if (!workspace) return { error: 'Workspace not found' };

  const [policy, connections, sites, published, scheduled, storylines] = await Promise.all([
    prisma.autopilotPolicy.findFirst({ where: { workspaceId, enabled: true } }),
    prisma.socialConnection.findMany({
      where: { workspaceId, status: 'CONNECTED' },
      select: { platform: true },
    }),
    prisma.siteConnection.count({ where: { workspaceId, status: 'ACTIVE' } }),
    prisma.contentItem.count({ where: { workspaceId, status: 'PUBLISHED' } }),
    prisma.contentItem.count({ where: { workspaceId, status: 'SCHEDULED' } }),
    prisma.storyline.count({ where: { narrative: { workspaceId }, enabled: true } }),
  ]);

  const insights = (workspace.audienceInsights as any) || {};
  const facts: WorkspaceFacts = {
    workspaceId,
    hasBrandSummary: Boolean(workspace.brandSummary),
    acceptedCompetitors: workspace.competitors.filter((c) => c.userDecision === 'ACCEPTED').length,
    totalCompetitors: workspace.competitors.length,
    matrixCharts: Array.isArray(insights?.competitiveMatrices?.charts)
      ? insights.competitiveMatrices.charts.length
      : 0,
    keywordCompetitors: Array.isArray(insights?.competitorKeywordsIntel?.competitors)
      ? insights.competitorKeywordsIntel.competitors.length
      : 0,
    storylines,
    hasChannel: connections.length > 0 || sites > 0,
    channelLabel:
      connections.length > 0
        ? connections.map((c) => String(c.platform)).join(', ')
        : sites > 0
          ? 'Website'
          : null,
    autopilotEnabled: Boolean(policy?.enabled),
    publishedCount: published,
    scheduledCount: scheduled,
  };

  const journey = buildJourney(facts);
  const step = journey.next;

  // Setup finished — the guide switches from "do this" to "here's what's running".
  if (!step) {
    return {
      stepTitle: null,
      headline: 'Setup is complete.',
      body: facts.autopilotEnabled
        ? `Autopilot is on. ${facts.scheduledCount} post${facts.scheduledCount === 1 ? '' : 's'} queued, ${facts.publishedCount} published so far. Nothing needs you right now — check the Autopilot run history if you want to see what it decided.`
        : 'Everything is connected and analysed. Ideate by hand, or turn on Autopilot to let it run without you.',
      action: null,
      href: null,
      source: 'fallback',
    };
  }

  const fallback: GuideAnswer = {
    stepTitle: step.title,
    headline: `Next: ${step.title.toLowerCase()}`,
    body: `${step.why} Right now: ${step.detail.toLowerCase()}.`,
    action: step.action,
    href: step.href,
    source: 'fallback',
  };

  const brand = workspace.brandSummary as any;
  if (!brand) return fallback;

  const prompt = `You are a calm, concrete product guide inside a marketing tool. The user has one job right now. Explain it in their brand's terms.

Brand: ${JSON.stringify(
    {
      industry: brand?.industry,
      audience: brand?.audience,
      valueProposition: brand?.valueProposition,
    },
    null,
    2,
  ).slice(0, 900)}

The step they must do: ${step.title}
Why the product requires it: ${step.why}
Their current state: ${step.detail}
The button they will click: ${step.action}

Write JSON only:
{"headline": "max 8 words, imperative, no fluff", "body": "2-3 sentences, max 55 words. Say what this step will do FOR THIS BRAND specifically, and what it unlocks next. No greetings, no marketing language, no exclamation marks."}`;

  const ai = await requestJsonFromAi<{ headline?: unknown; body?: unknown }>(
    prompt,
    'You write short, factual in-product guidance. Return only valid JSON.',
  );
  if (!ai) return fallback;

  const headline = String(ai.data.headline || '').trim();
  const body = String(ai.data.body || '').trim();
  if (!headline || !body || body.length > 420) return fallback;

  return { stepTitle: step.title, headline, body, action: step.action, href: step.href, source: 'ai' };
}
