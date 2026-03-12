'use server';

// apps/web/src/app/actions/calendar.ts

import { getSession } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { writeActivityLog } from '@/lib/activity-log';
import { ContentStatus } from '@prisma/client';

export interface SchedulePayload {
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

  // Parse local date + time -> UTC Date
  const localDateTimeString = `${payload.publishDate}T${payload.publishTime}:00`;
  const scheduledAtUtc = new Date(
    new Date(localDateTimeString).toLocaleString('en-US', { timeZone: payload.timezone })
  );

  const updatedContent = await prisma.contentItem.update({
    where: {
      id: payload.contentId,
      userId: session.userId,
    },
    data: {
      status: ContentStatus.SCHEDULED,
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
    const localDateTimeString = `${payload.publishDate}T${payload.publishTime}:00`;
    scheduledAtUtc = new Date(
      new Date(localDateTimeString).toLocaleString('en-US', { timeZone: payload.timezone })
    );
  }

  const updatedContent = await prisma.contentItem.update({
    where: {
      id: payload.contentId,
      userId: session.userId,
    },
    data: {
      content: payload.content,
      status: scheduledAtUtc ? ContentStatus.SCHEDULED : ContentStatus.READY,
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

export async function updateContentStatus(contentId: string, status: ContentStatus) {
  const session = await getSession();
  if (!session?.userId) throw new Error('Unauthorized');

  const updated = await prisma.contentItem.update({
    where: { id: contentId, userId: session.userId },
    data: { status },
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
          ContentStatus.READY,
          ContentStatus.SCHEDULED,
          ContentStatus.PUBLISHING,
          ContentStatus.PUBLISHED,
          ContentStatus.FAILED,
        ]
      }
    },
    orderBy: {
      scheduledAtUtc: 'asc',
    },
  });
}
