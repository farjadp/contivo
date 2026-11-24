/**
 * first-post/load.ts
 *
 * Reads everything the first-post view and the bar need for one workspace:
 * the run rows, the facts deriveFirstPostState takes, the current draft, the
 * "Why this post" facts and the other-angle count. Server-only.
 *
 * The caller has checked that `userId` owns `workspaceId`; every query is
 * still scoped to both where the row carries them. A database error is
 * thrown, never read as an empty state.
 */
import { COUNTED_COMPETITOR_WHERE } from '@/lib/competitor-counts';
import { prisma } from '@/lib/db';
import { isBlockedVerdict } from '@/lib/quality-verdict-shared';
import { matricesGate } from '@/lib/report-readiness';

import { countOtherAngles, readRunRows } from './run-log';
import { deriveFirstPostState } from './state';
import { matchTopicGap } from './topic-gap';
import {
  FIRST_POST_RUN_FINISHED,
  type FirstPostDraft,
  type FirstPostFacts,
  type FirstPostItemFact,
  type FirstPostJobFact,
  type FirstPostState,
  type FirstPostWhyFacts,
  type LinkedInState,
} from './types';

export type FirstPostLoad = {
  state: FirstPostState;
  facts: FirstPostFacts;
  draft: FirstPostDraft | null;
  why: FirstPostWhyFacts;
  otherAnglesUsed: number;
};

const asRecord = (value: unknown): Record<string, any> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, any>) : null;

/**
 * Stored facts only: a missing value is 0 or null, never a guess. With a
 * draft topic, `topGap` is the stored gap that draft is about (or null), so
 * "Try another angle" never keeps a gap the new post is not about.
 */
export function whyFactsFrom(audienceInsights: unknown, draftTopic?: string | null): FirstPostWhyFacts {
  const insights = asRecord(audienceInsights) ?? {};
  const matrices = insights.competitiveMatrices;
  const keywords = asRecord(insights.competitorKeywordsIntel);
  const charts = asRecord(matrices)?.charts;
  const gaps = Array.isArray(keywords?.content_gaps) ? keywords.content_gaps : [];
  const gapTopics: string[] = gaps
    .map((g: unknown) => asRecord(g)?.topic)
    .filter((t: unknown): t is string => typeof t === 'string' && t.trim().length > 0);
  const topGap = draftTopic === undefined ? (gapTopics[0]?.trim() ?? null) : matchTopicGap(gapTopics, draftTopic);
  return {
    matrixCharts: Array.isArray(charts) ? charts.length : 0,
    matricesReady: matricesGate(matrices).ok,
    keywordCompetitors: Array.isArray(keywords?.competitors) ? keywords.competitors.length : 0,
    gaps: gaps.length,
    topGap,
  };
}

function finishedItemIds(rows: Array<{ action: string; detail: unknown }>): string[] {
  const ids = new Set<string>();
  for (const row of rows) {
    if (row.action !== FIRST_POST_RUN_FINISHED) continue;
    const id = asRecord(row.detail)?.contentItemId;
    if (typeof id === 'string' && id) ids.add(id);
  }
  return [...ids];
}

export async function loadFirstPostState(userId: string, workspaceId: string): Promise<FirstPostLoad> {
  const [rows, otherAnglesUsed, accepted, suggestions, connection, workspace] = await Promise.all([
    readRunRows(workspaceId),
    countOtherAngles(workspaceId),
    prisma.competitor.count({ where: { workspaceId, userDecision: 'ACCEPTED' } }),
    prisma.competitor.count({ where: { workspaceId, ...COUNTED_COMPETITOR_WHERE } }),
    prisma.socialConnection.findFirst({
      where: { workspaceId, platform: 'LINKEDIN', status: 'CONNECTED', isDefault: true },
      select: { accountName: true },
    }),
    prisma.workspace.findFirst({ where: { id: workspaceId, userId }, select: { audienceInsights: true } }),
  ]);

  const ids = finishedItemIds(rows);
  const [items, jobs] =
    ids.length === 0
      ? [[], []]
      : await Promise.all([
          prisma.contentItem.findMany({
            where: { id: { in: ids }, workspaceId, userId },
            select: { id: true, status: true, publishedAtUtc: true, content: true, topic: true, qualityVerdict: true },
          }),
          prisma.socialPublishJob.findMany({
            where: { contentItemId: { in: ids }, workspaceId },
            orderBy: { createdAt: 'desc' },
            select: { contentItemId: true, status: true, externalPostUrl: true, publishedAtUtc: true },
          }),
        ]);

  const itemFacts: Record<string, FirstPostItemFact> = {};
  for (const item of items) itemFacts[item.id] = { status: item.status, publishedAtUtc: item.publishedAtUtc };

  // Newest first, so the first job seen per item is its latest.
  const latestJobByItem: Record<string, FirstPostJobFact> = {};
  for (const job of jobs) {
    if (!job.contentItemId || latestJobByItem[job.contentItemId]) continue;
    latestJobByItem[job.contentItemId] = {
      status: job.status,
      externalPostUrl: job.externalPostUrl,
      publishedAtUtc: job.publishedAtUtc,
    };
  }

  const linkedIn: LinkedInState = connection
    ? { connected: true, accountName: connection.accountName }
    : { connected: false };

  const facts: FirstPostFacts = { accepted, suggestions, items: itemFacts, latestJobByItem, linkedIn };
  const derived = deriveFirstPostState(rows, facts, new Date());

  const draftId = 'contentItemId' in derived ? derived.contentItemId : null;
  const item = draftId ? items.find((i) => i.id === draftId) : undefined;
  // The run row holds the gate's first answer; Check again, an edit or
  // "Publish anyway" changed the stored verdict since. The bar reads this.
  const state: FirstPostState =
    derived.phase === 'draft' && item ? { ...derived, approved: !isBlockedVerdict(item.qualityVerdict) } : derived;
  const draft: FirstPostDraft | null = item
    ? { id: item.id, content: item.content, topic: item.topic, qualityVerdict: item.qualityVerdict }
    : null;

  return { state, facts, draft, why: whyFactsFrom(workspace?.audienceInsights, draft ? draft.topic : undefined), otherAnglesUsed };
}
