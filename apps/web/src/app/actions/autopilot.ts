'use server';

import type { ContentChannel } from '@prisma/client';
import { revalidatePath } from 'next/cache';

import { getSession } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { writeActivityLog } from '@/lib/activity-log';
import { PUBLISHABLE_CHANNELS } from '@/lib/autopilot/channels';
import { runPolicy } from '@/lib/autopilot/runner';

export type AutopilotPolicyInput = {
  enabled: boolean;
  postsPerWeek: number;
  channels: ContentChannel[];
  timezone: string;
  windowStartHour: number;
  windowEndHour: number;
  publishDays: number[];
  goal?: string | null;
  topicHints?: string[];
  avoidTopics?: string[];
};

async function requireOwnedWorkspace(workspaceId: string) {
  const session = await getSession();
  if (!session) return { error: 'Not authenticated' as const };
  const userId = session.userId as string;
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId, userId },
    select: { id: true },
  });
  if (!workspace) return { error: 'Workspace not found' as const };
  return { userId };
}

export async function getAutopilotState(workspaceId: string) {
  const auth = await requireOwnedWorkspace(workspaceId);
  if ('error' in auth) return { error: auth.error };

  const [policy, runs, connections, siteCount] = await Promise.all([
    prisma.autopilotPolicy.findUnique({ where: { workspaceId } }),
    prisma.autopilotRun.findMany({
      where: { workspaceId },
      orderBy: { startedAt: 'desc' },
      take: 20,
    }),
    prisma.socialConnection.findMany({
      where: { workspaceId, status: 'CONNECTED', isDefault: true },
      select: { platform: true, accountName: true },
    }),
    prisma.siteConnection.count({ where: { workspaceId, status: 'ACTIVE' } }),
  ]);

  return {
    policy: policy ? serializePolicy(policy) : null,
    runs: runs.map(serializeRun),
    connectedPlatforms: connections.map((c) => ({
      platform: String(c.platform),
      accountName: c.accountName,
    })),
    hasSiteConnection: siteCount > 0,
  };
}

export async function saveAutopilotPolicy(workspaceId: string, input: AutopilotPolicyInput) {
  const auth = await requireOwnedWorkspace(workspaceId);
  if ('error' in auth) return { error: auth.error };

  const clean = normalizeInput(input);
  if ('error' in clean) return { error: clean.error };

  const policy = await prisma.autopilotPolicy.upsert({
    where: { workspaceId },
    create: { workspaceId, userId: auth.userId, ...clean.data },
    update: clean.data,
  });

  await writeActivityLog({
    userId: auth.userId,
    workspaceId,
    action: 'AUTOPILOT_POLICY_SAVED',
    detail: { enabled: policy.enabled, postsPerWeek: policy.postsPerWeek, channels: policy.channels },
  });

  revalidatePath(`/growth/${workspaceId}`);
  return { success: true, policy: serializePolicy(policy) };
}

export async function runAutopilotNow(workspaceId: string) {
  const auth = await requireOwnedWorkspace(workspaceId);
  if ('error' in auth) return { error: auth.error };

  const policy = await prisma.autopilotPolicy.findUnique({ where: { workspaceId } });
  if (!policy) return { error: 'Save an Autopilot policy first.' };
  if (!policy.enabled) return { error: 'Enable Autopilot before running it.' };

  const result = await runPolicy(policy.id, { trigger: 'manual' });
  revalidatePath(`/growth/${workspaceId}`);
  return { success: true, result };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeInput(input: AutopilotPolicyInput) {
  const postsPerWeek = Math.floor(Number(input.postsPerWeek));
  if (!Number.isFinite(postsPerWeek) || postsPerWeek < 1 || postsPerWeek > 14) {
    return { error: 'Posts per week must be between 1 and 14.' };
  }
  const channels = (Array.isArray(input.channels) ? input.channels : []).filter((c) =>
    PUBLISHABLE_CHANNELS.includes(c),
  );
  if (input.enabled && channels.length === 0) {
    return { error: 'Pick at least one channel.' };
  }
  const windowStartHour = clampInt(input.windowStartHour, 0, 23, 9);
  const windowEndHour = clampInt(input.windowEndHour, 1, 24, 18);
  if (windowEndHour <= windowStartHour) {
    return { error: 'Publish window must end after it starts.' };
  }
  const publishDays = Array.from(
    new Set((Array.isArray(input.publishDays) ? input.publishDays : []).map((d) => clampInt(d, 0, 6, 1))),
  ).sort();
  if (input.enabled && publishDays.length === 0) {
    return { error: 'Pick at least one publish day.' };
  }
  const timezone = String(input.timezone || 'America/Toronto').trim();
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
  } catch {
    return { error: `Unknown timezone: ${timezone}` };
  }

  return {
    data: {
      enabled: Boolean(input.enabled),
      postsPerWeek,
      channels,
      timezone,
      windowStartHour,
      windowEndHour,
      publishDays,
      goal: String(input.goal || '').trim().slice(0, 200) || null,
      topicHints: cleanList(input.topicHints),
      avoidTopics: cleanList(input.avoidTopics),
      // Re-arm so a newly enabled policy runs on the next tick.
      nextRunAt: input.enabled ? null : undefined,
    },
  };
}

function cleanList(list?: string[]) {
  return Array.from(
    new Set((Array.isArray(list) ? list : []).map((s) => String(s).trim()).filter(Boolean)),
  ).slice(0, 20);
}

function clampInt(value: unknown, min: number, max: number, fallback: number) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function serializePolicy(p: {
  id: string;
  enabled: boolean;
  postsPerWeek: number;
  channels: ContentChannel[];
  timezone: string;
  windowStartHour: number;
  windowEndHour: number;
  publishDays: number[];
  goal: string | null;
  topicHints: string[];
  avoidTopics: string[];
  lastRunAt: Date | null;
  nextRunAt: Date | null;
}) {
  return {
    id: p.id,
    enabled: p.enabled,
    postsPerWeek: p.postsPerWeek,
    channels: p.channels,
    timezone: p.timezone,
    windowStartHour: p.windowStartHour,
    windowEndHour: p.windowEndHour,
    publishDays: p.publishDays,
    goal: p.goal,
    topicHints: p.topicHints,
    avoidTopics: p.avoidTopics,
    lastRunAt: p.lastRunAt?.toISOString() ?? null,
    nextRunAt: p.nextRunAt?.toISOString() ?? null,
  };
}

function serializeRun(r: {
  id: string;
  status: string;
  trigger: string;
  ideasGenerated: number;
  itemsScheduled: number;
  itemsSkipped: number;
  log: unknown;
  error: string | null;
  startedAt: Date;
  finishedAt: Date | null;
}) {
  return {
    id: r.id,
    status: r.status,
    trigger: r.trigger,
    ideasGenerated: r.ideasGenerated,
    itemsScheduled: r.itemsScheduled,
    itemsSkipped: r.itemsSkipped,
    log: Array.isArray(r.log) ? (r.log as Array<Record<string, unknown>>) : [],
    error: r.error,
    startedAt: r.startedAt.toISOString(),
    finishedAt: r.finishedAt?.toISOString() ?? null,
  };
}

export type AutopilotState = Awaited<ReturnType<typeof getAutopilotState>>;
export type SerializedPolicy = ReturnType<typeof serializePolicy>;
export type SerializedRun = ReturnType<typeof serializeRun>;
