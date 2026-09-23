'use server';

import { getTranslations } from 'next-intl/server';

import { getSession } from '@/lib/auth';
import {
  asContentLanguage,
  languageInstructions,
} from '@/lib/content-language';
import { prisma } from '@/lib/db';
import { requestJsonFromAi } from '@/lib/gemini';
import { buildJourney, type WorkspaceFacts } from '@/lib/workspace-journey';
import { actionError } from '@/lib/action-errors';

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
  if (!session) return { error: await actionError('notAuthenticated') };
  const userId = session.userId as string;

  /*
    `buildJourney` names its sentences rather than writing them, because it
    runs without a request context. This action has one, so it is the place
    they become words — both for what the user reads and for the prompt, which
    would otherwise describe the step to the model in a language the model has
    just been told not to answer in.
  */
  const tj = await getTranslations('journey');
  const tg = await getTranslations('journeyGuide');

  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId, userId },
    include: {
      competitors: { select: { userDecision: true } },
      _count: { select: { contentItems: true } },
    },
  });
  if (!workspace) return { error: await actionError('workspaceNotFound') };

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
      headline: tg('doneHeadline'),
      body: facts.autopilotEnabled
        ? tg('doneRunning', {
            scheduled: facts.scheduledCount,
            published: facts.publishedCount,
          })
        : tg('doneIdle'),
      action: null,
      href: null,
      source: 'fallback',
    };
  }

  const stepTitle = tj(step.title.key, step.title.values);
  const stepWhy = tj(step.why.key, step.why.values);
  const stepDetail = tj(step.detail.key, step.detail.values);
  const stepAction = tj(step.action.key, step.action.values);

  const fallback: GuideAnswer = {
    stepTitle,
    /*
      Built from whole translated sentences rather than by lower-casing the
      title and splicing it into a frame. Persian has no letter case, so
      `toLowerCase()` was a no-op there, and an English sentence frame around a
      Persian clause reads as broken in a way the English side never shows.
    */
    headline: tg('nextHeadline', { step: stepTitle }),
    body: tg('nextBody', { why: stepWhy, detail: stepDetail }),
    action: stepAction,
    href: step.href,
    source: 'fallback',
  };

  const brand = workspace.brandSummary as any;
  if (!brand) return fallback;

  const prompt = `You are a calm, concrete product guide inside a marketing tool. The user has one job right now. Explain it in their brand's terms.

${languageInstructions(asContentLanguage(workspace.contentLanguage))}
The two JSON keys stay in English; only their values are written in that language.

Brand: ${JSON.stringify(
    {
      industry: brand?.industry,
      audience: brand?.audience,
      valueProposition: brand?.valueProposition,
    },
    null,
    2,
  ).slice(0, 900)}

The step they must do: ${stepTitle}
Why the product requires it: ${stepWhy}
Their current state: ${stepDetail}
The button they will click: ${stepAction}

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

  return { stepTitle, headline, body, action: stepAction, href: step.href, source: 'ai' };
}
