'use server';

// apps/web/src/app/actions/publish-now.ts

import type { ContentItem } from '@prisma/client';

import { getSession } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { writeActivityLog } from '@/lib/activity-log';
import { parseLocalDateTimeToUtc } from '@/lib/autopilot/schedule';
import { FIRST_POST_PUBLISH_REQUESTED } from '@/lib/first-post/types';
import { assertPublishTarget, type PublishTargetPlatform } from '@/lib/publish-readiness';
import { resolvePublishOutcome, type LatestPublishJob, type PublishOutcome } from '@/lib/publish-outcome';
import { enforceQualityGate, QualityGateBlockedError, type StoredVerdict } from '@/lib/quality-verdict';

import type { GateOverride, SchedulePayload } from './calendar';

/**
 * Publish now (spec 2026-11-23-first-post-b-design.md D6) = schedule at now.
 * The API scheduler (every minute) claims SCHEDULED items that are due,
 * resolves the default connection and creates the job, so every post goes
 * through one publish path. The web blog publisher does the same for blog.
 *
 * Every expected refusal is a result, not a throw: Next redacts thrown
 * messages in production, and the caller has to show which refusal it was.
 */
export type PublishResult =
  | { ok: true; item: ContentItem }
  | { ok: false; reason: 'no_connection'; platform: PublishTargetPlatform }
  | { ok: false; reason: 'quality_gate_blocked' | 'not_found' };

/** schedulePublish can also refuse a date and time it cannot read. */
export type SchedulePublishResult = PublishResult | { ok: false; reason: 'invalid_date' };

export type PublishProgress = {
  outcome: PublishOutcome | null;
  /** The item's stored status; null when the item is not the caller's (or gone). */
  status: string | null;
};

/** In flight or done: scheduling again would publish the post twice. */
const NOT_AGAIN = ['PUBLISHING', 'PUBLISHED'] as const;

type ScheduleRequest = {
  userId: string;
  contentId: string;
  scheduledAtUtc: Date;
  timezone: string;
  override?: boolean;
  /** Publish now refuses a published item too; a chosen date only an in-flight one. */
  refuse: readonly string[];
  campaign?: string;
  notes?: string;
  publishNow: boolean;
};

function loadItem(contentId: string, userId: string) {
  return prisma.contentItem.findFirst({ where: { id: contentId, userId } });
}

async function scheduleOwnedItem(req: ScheduleRequest): Promise<PublishResult> {
  if (typeof req.contentId !== 'string' || !req.contentId) return { ok: false, reason: 'not_found' };
  const item = await loadItem(req.contentId, req.userId);
  if (!item) return { ok: false, reason: 'not_found' };
  if (req.refuse.includes(item.status)) return { ok: true, item };

  // Connection first: an override with nothing to publish through must not
  // write a QUALITY_GATE_OVERRIDDEN audit row for a post that never goes out.
  const target = await assertPublishTarget(item.workspaceId, item.channel);
  if (!target.ok) return { ok: false, reason: 'no_connection', platform: target.platform };

  let overridden: StoredVerdict | null;
  try {
    overridden = await enforceQualityGate({ item, userId: req.userId, override: req.override });
  } catch (error) {
    if (error instanceof QualityGateBlockedError) return { ok: false, reason: 'quality_gate_blocked' };
    throw error;
  }

  // Conditional on the status, so an item the scheduler claimed between the
  // read and this write is not put back to SCHEDULED (and published twice).
  const { count } = await prisma.contentItem.updateMany({
    where: { id: item.id, userId: req.userId, status: { notIn: [...NOT_AGAIN] } },
    data: {
      ...(overridden ? { qualityVerdict: overridden as unknown as object } : {}),
      status: 'SCHEDULED',
      scheduledAtUtc: req.scheduledAtUtc,
      scheduledTimezone: req.timezone,
      ...(req.campaign !== undefined ? { campaign: req.campaign } : {}),
      ...(req.notes !== undefined ? { notes: req.notes } : {}),
    },
  });

  const stored = await loadItem(item.id, req.userId);
  if (!stored) return { ok: false, reason: 'not_found' };
  if (count === 0) return { ok: true, item: stored };

  if (item.workspaceId) {
    if (req.publishNow) {
      await writeActivityLog({
        userId: req.userId,
        workspaceId: item.workspaceId,
        action: FIRST_POST_PUBLISH_REQUESTED,
        detail: { contentId: item.id, channel: item.channel, ...(overridden ? { override: true } : {}) },
      });
    }
    await writeActivityLog({
      userId: req.userId,
      workspaceId: item.workspaceId,
      action: 'CONTENT_SCHEDULED',
      detail: {
        contentId: item.id,
        platform: item.channel,
        scheduledAtUtc: req.scheduledAtUtc.toISOString(),
        timezone: req.timezone,
        ...(req.publishNow ? { publishNow: true } : {}),
      },
    });
  }

  return { ok: true, item: stored };
}

export async function publishNow(contentId: string, options: GateOverride = {}): Promise<PublishResult> {
  const session = await getSession();
  // No session looks like someone else's item: nothing to act on.
  if (!session?.userId) return { ok: false, reason: 'not_found' };
  return scheduleOwnedItem({
    userId: session.userId as string,
    contentId,
    scheduledAtUtc: new Date(),
    timezone: 'UTC',
    override: options?.override === true,
    refuse: NOT_AGAIN,
    publishNow: true,
  });
}

/**
 * The result-returning twin of scheduleContentItem (actions/calendar.ts), for
 * the pipeline card. The channel comes from the stored item, never from
 * `payload.platform`, because that is what the publishers read.
 */
export async function schedulePublish(payload: SchedulePayload): Promise<SchedulePublishResult> {
  const session = await getSession();
  if (!session?.userId) return { ok: false, reason: 'not_found' };

  const scheduledAtUtc = parseLocalDateTimeToUtc(payload?.publishDate, payload?.publishTime, payload?.timezone);
  if (!scheduledAtUtc) return { ok: false, reason: 'invalid_date' };

  return scheduleOwnedItem({
    userId: session.userId as string,
    contentId: payload.contentId,
    scheduledAtUtc,
    timezone: payload.timezone,
    override: payload.override === true,
    refuse: ['PUBLISHING'],
    campaign: payload.campaign,
    notes: payload.notes,
    publishNow: false,
  });
}

/** What the publish panel polls: the item's status and, once known, how it went. */
export async function getPublishProgress(contentId: string): Promise<PublishProgress> {
  const session = await getSession();
  if (!session?.userId || typeof contentId !== 'string' || !contentId) return { outcome: null, status: null };

  const item = await prisma.contentItem.findFirst({
    where: { id: contentId, userId: session.userId as string },
    select: { id: true, workspaceId: true, status: true, failedReason: true, publishedAtUtc: true },
  });
  if (!item) return { outcome: null, status: null };

  const row = item.workspaceId
    ? await prisma.socialPublishJob.findFirst({
        where: { contentItemId: item.id, workspaceId: item.workspaceId },
        orderBy: { createdAt: 'desc' },
        select: {
          platform: true,
          status: true,
          externalPostUrl: true,
          lastError: true,
          publishedAtUtc: true,
          connection: { select: { status: true } },
        },
      })
    : null;

  const job: LatestPublishJob | null = row
    ? {
        platform: row.platform,
        status: row.status,
        externalPostUrl: row.externalPostUrl,
        lastError: row.lastError,
        publishedAtUtc: row.publishedAtUtc ? row.publishedAtUtc.toISOString() : null,
        connectionStatus: row.connection?.status ?? null,
      }
    : null;

  return { outcome: resolvePublishOutcome(item, job), status: item.status };
}
