'use server';

// apps/web/src/app/actions/calendar.ts

import { getSession } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { parseLocalDateTimeToUtc } from '@/lib/autopilot/schedule';
import { writeActivityLog } from '@/lib/activity-log';
import { enforceQualityGate, isBlockedVerdict, notCheckedVerdict, type StoredVerdict } from '@/lib/quality-verdict';
import { assertPublishTarget, PublishTargetMissingError } from '@/lib/publish-readiness';

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
    select: { id: true, workspaceId: true, status: true, channel: true, content: true, qualityVerdict: true },
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

  /*
    W2: nothing is scheduled that nothing can publish. Still a throw here, for
    the existing callers; the message is the code because Next redacts thrown
    messages in production. New callers use schedulePublish (actions/publish-now.ts),
    which returns the refusal instead. Checked before the gate, like publishNow,
    so a "Publish anyway" that cannot publish stamps and audits nothing.
  */
  const target = await assertPublishTarget(item.workspaceId, item.channel);
  if (!target.ok) throw new PublishTargetMissingError(target.platform);

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

  /*
    Saving the editor never schedules by itself (QA, 22 Nov): a customer who
    fixes a typo and presses Save must not publish a post. A schedule is set
    only when the request carries a date AND a time — the UI sends them only
    from "Save & schedule". Without them the item keeps its status and any
    time it already had.
  */
  const wantsSchedule = Boolean(payload.publishDate && payload.publishTime);
  let scheduledAtUtc: Date | null = null;
  if (wantsSchedule) {
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
    checked": the edit is saved, but held unscheduled until the user runs
    "Check again" or chooses "Publish anyway". Nothing typed is lost.
  */
  const bodyChanged = String(item.content ?? '').trim() !== String(payload.content ?? '').trim();
  const gated = item.qualityVerdict !== null && item.qualityVerdict !== undefined;
  let nextVerdict: StoredVerdict | null = null;
  let hold = false;
  let heldReason: 'no_connection' | undefined;
  if (gated && bodyChanged) {
    const reset = notCheckedVerdict('pipeline');
    nextVerdict =
      payload.override === true
        ? await enforceQualityGate({ item: { ...item, qualityVerdict: reset }, userId: session.userId, override: true })
        : reset;
    hold = !nextVerdict?.override;
  } else if (wantsSchedule) {
    if (isBlockedVerdict(item.qualityVerdict) && payload.override !== true) {
      // The editor saves; it never publishes a blocked draft. Held, not
      // refused, so the user's edits are kept.
      hold = true;
    } else {
      nextVerdict = await enforceQualityGate({ item, userId: session.userId, override: payload.override });
    }
  }

  /*
    W2: a schedule the gate allows still needs something that can publish
    it. Held exactly like the gate hold (text saved, schedule cleared), and
    the reason is returned, because the editor must say why it did not
    schedule.
  */
  if (wantsSchedule && !hold) {
    const target = await assertPublishTarget(item.workspaceId, item.channel);
    if (!target.ok) {
      hold = true;
      heldReason = 'no_connection';
    }
  }

  const scheduled = wantsSchedule && !hold;
  // A held item that was on its way out (READY/SCHEDULED) goes back to GENERATED.
  const wasForward = item.status === 'READY' || item.status === 'SCHEDULED';
  const statusData = hold
    ? { ...(wasForward ? { status: 'GENERATED' as const } : {}), scheduledAtUtc: null, scheduledTimezone: null }
    : scheduled
      ? { status: 'SCHEDULED' as const, scheduledAtUtc, scheduledTimezone: payload.timezone }
      : {};

  const updatedContent = await prisma.contentItem.update({
    where: {
      id: payload.contentId,
      userId: session.userId,
    },
    data: {
      ...verdictData(nextVerdict),
      ...statusData,
      content: payload.content,
      campaign: payload.campaign,
      notes: payload.notes,
    },
  });

  if (updatedContent.workspaceId) {
    await writeActivityLog({
      userId: session.userId,
      workspaceId: updatedContent.workspaceId,
      // Named for what happened, not for the form it came from.
      action: scheduled ? 'CONTENT_EDITED_AND_SCHEDULED' : 'CONTENT_EDITED',
      detail: {
        contentId: updatedContent.id,
        platform: payload.platform,
        scheduledAtUtc: scheduled ? scheduledAtUtc?.toISOString() : undefined,
        timezone: scheduled ? payload.timezone : undefined,
        held: hold || undefined,
        heldReason,
      },
    });
  }

  const result: typeof updatedContent & { held?: 'no_connection' } = heldReason
    ? { ...updatedContent, held: heldReason }
    : updatedContent;
  return result;
}

const GATED_STATUSES = new Set(['READY', 'SCHEDULED', 'PUBLISHING', 'PUBLISHED']);

export async function updateContentStatus(contentId: string, status: string, options: GateOverride = {}) {
  const session = await getSession();
  if (!session?.userId) throw new Error('Unauthorized');

  // Moving back to draft or archiving is always allowed; moving forward is gated.
  let overridden: StoredVerdict | null = null;
  if (GATED_STATUSES.has(status)) {
    const item = await loadOwnedItem(contentId, session.userId);
    // W2: SCHEDULED is a promise to publish; refuse it when nothing can (connection first, as above).
    if (status === 'SCHEDULED') {
      const target = await assertPublishTarget(item.workspaceId, item.channel);
      if (!target.ok) throw new PublishTargetMissingError(target.platform);
    }
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
