'use server';

// apps/web/src/app/actions/calendar.ts

import { getSession } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { parseLocalDateTimeToUtc } from '@/lib/autopilot/schedule';
import { writeActivityLog } from '@/lib/activity-log';
import { enforceQualityGate, isBlockedVerdict, notCheckedVerdict, type StoredVerdict } from '@/lib/quality-verdict';

/**
 * B8: every action that moves an item to READY or SCHEDULED checks the
 * quality verdict here, on the server. A blocked AI draft is refused with
 * `quality_gate_blocked` unless the request says `override: true` — the
 * "Publish anyway" button — which is stamped on the verdict and audited as
 * QUALITY_GATE_OVERRIDDEN. Items with no verdict (legacy rows, the
 * customer's own "Write a post" text) are not gated.
 */
export type GateOverride = { override?: boolean };

async function loadOwnedItem(contentId: string, userId: string) {
  const item = await prisma.contentItem.findFirst({
    where: { id: contentId, userId },
    select: { id: true, workspaceId: true, content: true, qualityVerdict: true },
  });
  if (!item) throw new Error('Content item not found');
  return item;
}

/** Prisma `data` fragment for a verdict that changed, or nothing. */
function verdictData(verdict: StoredVerdict | null) {
  return verdict ? { qualityVerdict: verdict as unknown as object } : {};
}


export interface SchedulePayload extends GateOverride {
  contentId: string;
  platform: string;
  publishDate: string;
  publishTime: string;
  timezone: string;
  campaign?: string;
  notes?: string;
}

export interface UpdateContentAndSchedulePayload extends SchedulePayload {
  content: string;
}

export async function scheduleContentItem(payload: SchedulePayload) {
  const session = await getSession();
  if (!session?.userId) throw new Error('Unauthorized');

  // The customer's wall-clock time in their own zone, as a UTC instant.
  const scheduledAtUtc = parseLocalDateTimeToUtc(
    payload.publishDate,
    payload.publishTime,
    payload.timezone,
  );
  if (!scheduledAtUtc) throw new Error('Could not read that publish date and time.');

  const item = await loadOwnedItem(payload.contentId, session.userId);
  const overridden = await enforceQualityGate({ item, userId: session.userId, override: payload.override });

  const updatedContent = await prisma.contentItem.update({
    where: {
      id: payload.contentId,
      userId: session.userId,
    },
    data: {
      ...verdictData(overridden),
      status: 'SCHEDULED',
      scheduledAtUtc,
      scheduledTimezone: payload.timezone,
      campaign: payload.campaign,
      notes: payload.notes,
    },
  });

  if (updatedContent.workspaceId) {
    await writeActivityLog({
      userId: session.userId,
      workspaceId: updatedContent.workspaceId,
      action: 'CONTENT_SCHEDULED',
      detail: {
        contentId: updatedContent.id,
        platform: payload.platform,
        scheduledAtUtc: scheduledAtUtc.toISOString(),
        timezone: payload.timezone,
      },
    });
  }

  return updatedContent;
}

export async function updateContentAndSchedule(payload: UpdateContentAndSchedulePayload) {
  const session = await getSession();
  if (!session?.userId) throw new Error('Unauthorized');

  let scheduledAtUtc: Date | null = null;
  if (payload.publishDate && payload.publishTime) {
    // The customer's wall-clock time in their own zone, as a UTC instant —
    // same conversion as scheduleContentItem, independent of the server zone.
    scheduledAtUtc = parseLocalDateTimeToUtc(
      payload.publishDate,
      payload.publishTime,
      payload.timezone,
    );
    if (!scheduledAtUtc) throw new Error('Could not read that publish date and time.');
  }

  const item = await loadOwnedItem(payload.contentId, session.userId);
  /*
    A verdict judged the old text. Editing a gated body resets it to "not
    checked": the edit is saved, but held unscheduled (GENERATED) until the
    user runs "Check again" or chooses "Publish anyway". Nothing typed is lost.
  */
  const bodyChanged = String(item.content ?? '').trim() !== String(payload.content ?? '').trim();
  const gated = item.qualityVerdict !== null && item.qualityVerdict !== undefined;
  let nextVerdict: StoredVerdict | null = null;
  let hold = false;
  if (gated && bodyChanged) {
    const reset = notCheckedVerdict('pipeline');
    nextVerdict =
      payload.override === true
        ? await enforceQualityGate({ item: { ...item, qualityVerdict: reset }, userId: session.userId, override: true })
        : reset;
    hold = !nextVerdict?.override;
  } else if (isBlockedVerdict(item.qualityVerdict) && payload.override !== true) {
    // The editor saves; it never publishes a blocked draft. Held, not refused,
    // so the user's edits are kept.
    hold = true;
  } else {
    nextVerdict = await enforceQualityGate({ item, userId: session.userId, override: payload.override });
  }
  if (hold) scheduledAtUtc = null;

  const updatedContent = await prisma.contentItem.update({
    where: {
      id: payload.contentId,
      userId: session.userId,
    },
    data: {
      ...verdictData(nextVerdict),
      content: payload.content,
      status: hold ? 'GENERATED' : scheduledAtUtc ? 'SCHEDULED' : 'READY',
      scheduledAtUtc,
      scheduledTimezone: scheduledAtUtc ? payload.timezone : null,
      campaign: payload.campaign,
      notes: payload.notes,
    },
  });

  if (updatedContent.workspaceId) {
    await writeActivityLog({
      userId: session.userId,
      workspaceId: updatedContent.workspaceId,
      action: 'CONTENT_EDITED_AND_SCHEDULED',
      detail: {
        contentId: updatedContent.id,
        platform: payload.platform,
        scheduledAtUtc: scheduledAtUtc?.toISOString(),
        timezone: payload.timezone,
      },
    });
  }

  return updatedContent;
}

const GATED_STATUSES = new Set(['READY', 'SCHEDULED', 'PUBLISHING', 'PUBLISHED']);

export async function updateContentStatus(contentId: string, status: string, options: GateOverride = {}) {
  const session = await getSession();
  if (!session?.userId) throw new Error('Unauthorized');

  // Moving back to draft or archiving is always allowed; moving forward is gated.
  let overridden: StoredVerdict | null = null;
  if (GATED_STATUSES.has(status)) {
    const item = await loadOwnedItem(contentId, session.userId);
    overridden = await enforceQualityGate({ item, userId: session.userId, override: options.override });
  }

  const updated = await prisma.contentItem.update({
    where: { id: contentId, userId: session.userId },
    data: { ...verdictData(overridden), status: status as any },
  });

  if (updated.workspaceId) {
    await writeActivityLog({
      userId: session.userId,
      workspaceId: updated.workspaceId,
      action: `CONTENT_STATUS_CHANGED_${status}`,
      detail: { contentId, newStatus: status },
    });
  }

  return updated;
}

export async function getCalendarItems(workspaceId: string) {
  const session = await getSession();
  if (!session?.userId) throw new Error('Unauthorized');

  return prisma.contentItem.findMany({
    where: {
      workspaceId,
      userId: session.userId,
      status: {
        in: [
          'READY',
          'SCHEDULED',
          'PUBLISHING',
          'PUBLISHED',
          'FAILED',
        ]
      }
    },
    orderBy: {
      scheduledAtUtc: 'asc',
    },
  });
}
