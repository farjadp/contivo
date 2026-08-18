'use server';

import type { ContentChannel } from '@prisma/client';
import { revalidatePath } from 'next/cache';

import { getSession } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { writeActivityLog } from '@/lib/activity-log';
import { PUBLISHABLE_CHANNELS } from '@/lib/autopilot/channels';
import { getRecipe } from '@/lib/autopilot/recipes';
import { runPolicy } from '@/lib/autopilot/runner';

export type AutopilotPolicyInput = {
  name?: string;
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

type UserAuth = { ok: true; userId: string } | { ok: false; error: string };

async function requireUser(): Promise<UserAuth> {
  const session = await getSession();
  if (!session) return { ok: false, error: 'Not authenticated' };
  return { ok: true, userId: session.userId as string };
}

async function requireWorkspace(workspaceId: string, userId: string) {
  return prisma.workspace.findUnique({
    where: { id: workspaceId, userId },
    select: { id: true },
  });
}

/** Loads every agent in the workspace plus the shared publishing context. */
export async function getAutopilotState(workspaceId: string) {
  const auth = await requireUser();
  if (!auth.ok) return { error: auth.error };

  const [agents, runs, connections, siteCount] = await Promise.all([
    prisma.autopilotPolicy.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'asc' },
    }),
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
    agents: agents.map(serializePolicy),
    // Kept for callers that only care whether anything is running.
    policy: agents.find((a) => a.enabled) ? serializePolicy(agents.find((a) => a.enabled)!) : null,
    runs: runs.map(serializeRun),
    connectedPlatforms: connections.map((c) => ({
      platform: String(c.platform),
      accountName: c.accountName,
    })),
    hasSiteConnection: siteCount > 0,
  };
}

/** Creates an agent from a recipe preset. */
export async function createAgent(workspaceId: string, recipeKey: string) {
  const auth = await requireUser();
  if (!auth.ok) return { error: auth.error };
  if (!(await requireWorkspace(workspaceId, auth.userId))) return { error: 'Workspace not found.' };

  const recipe = getRecipe(recipeKey);
  if (!recipe) return { error: `Unknown agent type: ${recipeKey}` };

  const existing = await prisma.autopilotPolicy.count({ where: { workspaceId } });
  if (existing >= 8) return { error: 'A workspace can run at most 8 agents.' };

  const agent = await prisma.autopilotPolicy.create({
    data: {
      workspaceId,
      userId: auth.userId,
      name: recipe.name,
      recipeKey: recipe.key,
      // Created switched off: the user reviews the settings, then enables.
      enabled: false,
      postsPerWeek: recipe.defaults.postsPerWeek,
      channels: recipe.defaults.channels,
      windowStartHour: recipe.defaults.windowStartHour,
      windowEndHour: recipe.defaults.windowEndHour,
      publishDays: recipe.defaults.publishDays,
      goal: recipe.defaults.goal,
      topicHints: recipe.defaults.topicHints,
      avoidTopics: recipe.defaults.avoidTopics,
    },
  });

  await writeActivityLog({
    userId: auth.userId,
    workspaceId,
    action: 'AUTOPILOT_AGENT_CREATED',
    detail: { agentId: agent.id, recipeKey: recipe.key, name: agent.name },
  });

  revalidatePath(`/growth/${workspaceId}`);
  return { success: true, agent: serializePolicy(agent) };
}

export async function saveAutopilotPolicy(
  workspaceId: string,
  input: AutopilotPolicyInput & { agentId?: string },
) {
  const auth = await requireUser();
  if (!auth.ok) return { error: auth.error };
  if (!(await requireWorkspace(workspaceId, auth.userId))) return { error: 'Workspace not found.' };

  const clean = normalizeInput(input);
  if ('error' in clean) return { error: clean.error };

  // Target an explicit agent when given; otherwise the workspace's first one,
  // creating it if this workspace has never had an agent.
  const target = input.agentId
    ? await prisma.autopilotPolicy.findFirst({ where: { id: input.agentId, workspaceId } })
    : await prisma.autopilotPolicy.findFirst({ where: { workspaceId }, orderBy: { createdAt: 'asc' } });

  const agent = target
    ? await prisma.autopilotPolicy.update({ where: { id: target.id }, data: clean.data })
    : await prisma.autopilotPolicy.create({
        data: { workspaceId, userId: auth.userId, name: 'Autopilot', ...clean.data },
      });

  await writeActivityLog({
    userId: auth.userId,
    workspaceId,
    action: 'AUTOPILOT_POLICY_SAVED',
    detail: { agentId: agent.id, enabled: agent.enabled, postsPerWeek: agent.postsPerWeek, channels: agent.channels },
  });

  revalidatePath(`/growth/${workspaceId}`);
  return { success: true, policy: serializePolicy(agent), agent: serializePolicy(agent) };
}

export async function deleteAgent(workspaceId: string, agentId: string) {
  const auth = await requireUser();
  if (!auth.ok) return { error: auth.error };
  if (!(await requireWorkspace(workspaceId, auth.userId))) return { error: 'Workspace not found.' };

  const agent = await prisma.autopilotPolicy.findFirst({ where: { id: agentId, workspaceId } });
  if (!agent) return { error: 'Agent not found.' };

  // Content it already produced survives; only the agent link is cleared.
  await prisma.autopilotPolicy.delete({ where: { id: agent.id } });
  await writeActivityLog({
    userId: auth.userId,
    workspaceId,
    action: 'AUTOPILOT_AGENT_DELETED',
    detail: { agentId, name: agent.name },
  });

  revalidatePath(`/growth/${workspaceId}`);
  return { success: true };
}

export async function runAutopilotNow(workspaceId: string, agentId?: string) {
  const auth = await requireUser();
  if (!auth.ok) return { error: auth.error };
  if (!(await requireWorkspace(workspaceId, auth.userId))) return { error: 'Workspace not found.' };

  const agent = agentId
    ? await prisma.autopilotPolicy.findFirst({ where: { id: agentId, workspaceId } })
    : await prisma.autopilotPolicy.findFirst({ where: { workspaceId, enabled: true } });

  if (!agent) return { error: 'Create an agent first.' };
  if (!agent.enabled) return { error: 'Enable this agent before running it.' };

  const result = await runPolicy(agent.id, { trigger: 'manual' });
  revalidatePath(`/growth/${workspaceId}`);
  return { success: true, result };
}

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
      ...(input.name ? { name: String(input.name).trim().slice(0, 60) } : {}),
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
      // Re-arm so a newly enabled agent runs on the next tick.
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
  name: string;
  recipeKey: string | null;
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
    name: p.name,
    recipeKey: p.recipeKey,
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
  policyId: string;
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
    policyId: r.policyId,
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
