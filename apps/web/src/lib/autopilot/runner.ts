/**
 * autopilot/runner.ts
 *
 * Executes Autopilot policies. One run = for one workspace:
 *   1. check the policy is enabled and due
 *   2. work out how many posts are still needed for the coming week
 *   3. keep only channels that can actually publish (connected default account)
 *   4. ideate (with steering), dedupe against recent topics and the avoid list
 *   5. save ideas to the pipeline and generate drafts, each with a publish
 *      slot inside the policy window → item becomes SCHEDULED
 *   6. record an AutopilotRun with a step-by-step log
 *
 * Publishing itself is done by SocialSchedulerService when the slot arrives.
 * No session — this is meant to be called from a cron-triggered route.
 */

import type { ContentChannel, Prisma } from '@prisma/client';

import { prisma } from '@/lib/db';
import { writeActivityLog } from '@/lib/activity-log';
import {
  generateDraftForItem,
  ideateForWorkspace,
  loadIdeationContext,
  saveIdeaToPipelineCore,
} from '@/lib/content-engine';

import { CHANNEL_TO_PLATFORM } from './channels';
import { pickPublishSlots } from './schedule';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** How far ahead the runner keeps the queue filled. */
const PLANNING_HORIZON_DAYS = 7;
/** Re-run cadence when a run completes (or has nothing to do). */
const DEFAULT_RERUN_HOURS = 24;
/** Re-run sooner after a failure so a transient AI outage doesn't cost a day. */
const FAILURE_RERUN_HOURS = 3;
/** How many recent topics to consider when deduping. */
const RECENT_TOPIC_LOOKBACK = 40;
/** Statuses that count as "already occupying a slot". */
const OCCUPYING_STATUSES = ['SCHEDULED', 'PUBLISHING', 'PUBLISHED'] as const;

/** ContentChannel → ideation `platform` hint. */
const CHANNEL_TO_IDEATION_PLATFORM: Record<string, string> = {
  linkedin: 'linkedin',
  twitter: 'x',
  instagram: 'linkedin', // no dedicated IG framework yet; short-form social is closest
  blog: 'blog',
  email: 'email',
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RunTrigger = 'cron' | 'manual';

type LogEntry = { at: string; step: string; [key: string]: unknown };

export type RunResult = {
  runId: string | null;
  policyId: string;
  workspaceId: string;
  status: 'SUCCEEDED' | 'PARTIAL' | 'FAILED' | 'SKIPPED';
  ideasGenerated: number;
  itemsScheduled: number;
  itemsSkipped: number;
  reason?: string;
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Runs every enabled policy whose `nextRunAt` is null or in the past.
 * Processes at most `limit` policies per call so a serverless invocation
 * stays inside its time budget; call again to drain.
 */
export async function runDuePolicies(options: {
  now?: Date;
  limit?: number;
  trigger?: RunTrigger;
} = {}): Promise<RunResult[]> {
  const now = options.now ?? new Date();
  const limit = Math.max(1, Math.min(20, options.limit ?? 3));

  const due = await prisma.autopilotPolicy.findMany({
    where: {
      enabled: true,
      OR: [{ nextRunAt: null }, { nextRunAt: { lte: now } }],
    },
    orderBy: [{ nextRunAt: 'asc' }, { updatedAt: 'asc' }],
    take: limit,
    select: { id: true },
  });

  const results: RunResult[] = [];
  for (const { id } of due) {
    results.push(await runPolicy(id, { now, trigger: options.trigger ?? 'cron' }));
  }
  return results;
}

/** Runs a single policy regardless of `nextRunAt` (used by "Run now"). */
export async function runPolicy(
  policyId: string,
  options: { now?: Date; trigger?: RunTrigger } = {},
): Promise<RunResult> {
  const now = options.now ?? new Date();
  const trigger = options.trigger ?? 'manual';
  const log: LogEntry[] = [];
  const note = (step: string, extra: Record<string, unknown> = {}) =>
    log.push({ at: new Date().toISOString(), step, ...extra });

  const policy = await prisma.autopilotPolicy.findUnique({ where: { id: policyId } });
  if (!policy) {
    return skipped(policyId, '', 'policy not found');
  }
  const base = { policyId: policy.id, workspaceId: policy.workspaceId };
  const actor = { userId: policy.userId, workspaceId: policy.workspaceId };

  if (!policy.enabled) {
    return skipped(policy.id, policy.workspaceId, 'policy disabled');
  }

  // Claim the run: bump nextRunAt immediately so a concurrent tick doesn't
  // double-run this policy while we're inside the AI calls.
  await prisma.autopilotPolicy.update({
    where: { id: policy.id },
    data: { lastRunAt: now, nextRunAt: addHours(now, FAILURE_RERUN_HOURS) },
  });

  const run = await prisma.autopilotRun.create({
    data: { ...base, trigger, status: 'RUNNING' },
  });

  const finish = async (
    status: RunResult['status'],
    counts: { ideasGenerated: number; itemsScheduled: number; itemsSkipped: number },
    opts: { error?: string; rerunHours?: number } = {},
  ): Promise<RunResult> => {
    await prisma.autopilotRun.update({
      where: { id: run.id },
      data: {
        status,
        ...counts,
        log: log as unknown as Prisma.InputJsonValue,
        error: opts.error ?? null,
        finishedAt: new Date(),
      },
    });
    await prisma.autopilotPolicy.update({
      where: { id: policy.id },
      data: { nextRunAt: addHours(new Date(), opts.rerunHours ?? DEFAULT_RERUN_HOURS) },
    });
    await writeActivityLog({
      userId: policy.userId,
      workspaceId: policy.workspaceId,
      action: 'AUTOPILOT_RUN',
      detail: { runId: run.id, status, trigger, ...counts, error: opts.error ?? null },
    });
    return { runId: run.id, ...base, status, ...counts, reason: opts.error };
  };

  const zero = { ideasGenerated: 0, itemsScheduled: 0, itemsSkipped: 0 };

  try {
    // 1. Prerequisites (brand memory, matrices, keywords)
    const ctx = await loadIdeationContext(actor);
    if ('error' in ctx) {
      note('prerequisites_missing', { error: ctx.error });
      return finish('SKIPPED', zero, { error: ctx.error });
    }
    note('prerequisites_ok');

    // 2. Publishable channels
    const channels = await resolvePublishableChannels(policy.workspaceId, policy.channels, note);
    if (channels.length === 0) {
      note('no_publishable_channels');
      return finish('SKIPPED', zero, {
        error: 'No channel has a connected default social account.',
      });
    }

    // 3. How many posts are still needed for the horizon
    const horizonEnd = addDays(now, PLANNING_HORIZON_DAYS);
    const upcoming = await prisma.contentItem.findMany({
      where: {
        workspaceId: policy.workspaceId,
        status: { in: [...OCCUPYING_STATUSES] },
        scheduledAtUtc: { gte: now, lte: horizonEnd },
      },
      select: { scheduledAtUtc: true },
    });
    const needed = Math.max(0, policy.postsPerWeek - upcoming.length);
    note('capacity', { postsPerWeek: policy.postsPerWeek, upcoming: upcoming.length, needed });
    if (needed === 0) {
      return finish('SKIPPED', zero, { error: 'Queue already full for the coming week.' });
    }

    // 4. Slots
    const taken = upcoming.map((i) => i.scheduledAtUtc).filter((d): d is Date => Boolean(d));
    const slots = pickPublishSlots({
      now,
      count: needed,
      window: {
        timezone: policy.timezone,
        windowStartHour: policy.windowStartHour,
        windowEndHour: policy.windowEndHour,
        publishDays: policy.publishDays,
      },
      taken,
    });
    note('slots', { slots: slots.map((s) => s.toISOString()) });
    if (slots.length === 0) {
      return finish('SKIPPED', zero, { error: 'No open publish slot inside the window.' });
    }

    // 5. Ideate — ask for extra so dedupe has room, round-robin channels
    const recentTopics = await loadRecentTopics(policy.workspaceId);
    const steeringNotes = buildSteeringNotes(policy, recentTopics);
    const plan: Array<{ channel: ContentChannel; slot: Date }> = slots.map((slot, i) => ({
      channel: channels[i % channels.length],
      slot,
    }));

    let ideasGenerated = 0;
    let itemsScheduled = 0;
    let itemsSkipped = 0;
    const usedTopics = [...recentTopics];

    // Group by channel so each ideation call is platform-specific.
    const byChannel = new Map<ContentChannel, Date[]>();
    for (const p of plan) byChannel.set(p.channel, [...(byChannel.get(p.channel) ?? []), p.slot]);

    for (const [channel, channelSlots] of byChannel) {
      const want = channelSlots.length;
      const ideation = await ideateForWorkspace(actor, {
        goal: policy.goal || undefined,
        platform: CHANNEL_TO_IDEATION_PLATFORM[channel] ?? 'linkedin',
        selectionMode: 'auto',
        requestedIdeaCount: Math.min(want * 2 + 1, 10),
        includeImages: false,
        autoInsertToCalendar: false,
        steeringNotes,
      });
      if ('error' in ideation && ideation.error) {
        note('ideation_failed', { channel, error: ideation.error });
        itemsSkipped += want;
        continue;
      }
      const ideas: any[] = 'ideas' in ideation && Array.isArray(ideation.ideas) ? ideation.ideas : [];
      ideasGenerated += ideas.length;

      const fresh = ideas.filter((idea: any) => {
        const topic = String(idea?.topic || '').trim();
        if (!topic) return false;
        if (matchesAvoidList(topic, policy.avoidTopics)) return false;
        if (usedTopics.some((t) => topicsOverlap(t, topic))) return false;
        return true;
      });
      note('ideas', { channel, generated: ideas.length, fresh: fresh.length, want });

      for (let i = 0; i < want; i++) {
        const idea = fresh[i];
        const slot = channelSlots[i];
        if (!idea) {
          itemsSkipped += 1;
          note('slot_unfilled', { channel, slot: slot.toISOString(), reason: 'no fresh idea' });
          continue;
        }
        // Force the channel: idea.format drives channel resolution in the engine.
        const saved = await saveIdeaToPipelineCore(actor, {
          ...idea,
          format: channel,
          auto_insert_to_calendar: false,
          framework_id: idea.framework_id ?? ('framework' in ideation ? ideation.framework?.framework_id : undefined),
          framework_name: idea.framework_name ?? ('framework' in ideation ? ideation.framework?.framework_name : undefined),
        });
        if ('error' in saved && saved.error) {
          itemsSkipped += 1;
          note('save_failed', { channel, topic: idea.topic, error: saved.error });
          continue;
        }
        const itemId = 'id' in saved ? saved.id : null;
        if (!itemId) {
          itemsSkipped += 1;
          continue;
        }
        const drafted = await generateDraftForItem(actor, itemId, {
          scheduledAtUtc: slot,
          source: 'autopilot',
          manualSource: { timezone: policy.timezone },
        });
        if ('error' in drafted && drafted.error) {
          itemsSkipped += 1;
          note('draft_failed', { channel, itemId, topic: idea.topic, error: drafted.error });
          continue;
        }
        usedTopics.push(String(idea.topic));
        itemsScheduled += 1;
        note('scheduled', { channel, itemId, topic: idea.topic, slot: slot.toISOString() });
      }
    }

    const counts = { ideasGenerated, itemsScheduled, itemsSkipped };
    if (itemsScheduled === 0) {
      return finish('FAILED', counts, {
        error: 'Nothing could be scheduled this run.',
        rerunHours: FAILURE_RERUN_HOURS,
      });
    }
    return finish(itemsSkipped > 0 ? 'PARTIAL' : 'SUCCEEDED', counts);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    note('exception', { message });
    console.error('[autopilot] run failed', policy.id, err);
    return finish('FAILED', zero, { error: message, rerunHours: FAILURE_RERUN_HOURS });
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function resolvePublishableChannels(
  workspaceId: string,
  requested: ContentChannel[],
  note: (step: string, extra?: Record<string, unknown>) => void,
): Promise<ContentChannel[]> {
  const wanted = requested.length > 0 ? requested : (['linkedin'] as ContentChannel[]);
  const connections = await prisma.socialConnection.findMany({
    where: { workspaceId, status: 'CONNECTED', isDefault: true },
    select: { platform: true },
  });
  const connected = new Set(connections.map((c) => String(c.platform)));

  const ok: ContentChannel[] = [];
  for (const channel of wanted) {
    const platform = CHANNEL_TO_PLATFORM[channel];
    if (!platform) {
      note('channel_skipped', { channel, reason: 'no publisher for this channel yet' });
      continue;
    }
    if (!connected.has(platform)) {
      note('channel_skipped', { channel, reason: `no connected default ${platform} account` });
      continue;
    }
    ok.push(channel);
  }
  return ok;
}

async function loadRecentTopics(workspaceId: string): Promise<string[]> {
  const items = await prisma.contentItem.findMany({
    where: { workspaceId, status: { not: 'ARCHIVED' } },
    orderBy: { createdAt: 'desc' },
    take: RECENT_TOPIC_LOOKBACK,
    select: { topic: true },
  });
  return items.map((i) => String(i.topic || '').trim()).filter(Boolean);
}

function buildSteeringNotes(
  policy: { goal: string | null; topicHints: string[]; avoidTopics: string[] },
  recentTopics: string[],
): string {
  const lines: string[] = [];
  if (policy.goal) lines.push(`- Primary goal: ${policy.goal}`);
  if (policy.topicHints.length) lines.push(`- Lean into these themes: ${policy.topicHints.join('; ')}`);
  if (policy.avoidTopics.length) lines.push(`- Never write about: ${policy.avoidTopics.join('; ')}`);
  if (recentTopics.length) {
    lines.push(
      `- Do NOT repeat or closely paraphrase these recent topics: ${recentTopics
        .slice(0, 15)
        .map((t) => `"${t}"`)
        .join(', ')}`,
    );
  }
  lines.push('- These posts will be published automatically with no human review: be accurate, specific, and safe.');
  return lines.join('\n');
}

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'for', 'on', 'with', 'how', 'why', 'what',
  'your', 'you', 'is', 'are', 'vs', 'from', 'that', 'this', 'it', 'at', 'by', 'as', 'be',
]);

function tokens(text: string): Set<string> {
  return new Set(
    String(text)
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOPWORDS.has(w)),
  );
}

/** Jaccard overlap on content words; > 0.6 counts as the same topic. */
function topicsOverlap(a: string, b: string): boolean {
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.size === 0 || tb.size === 0) return false;
  let inter = 0;
  for (const w of ta) if (tb.has(w)) inter++;
  const union = ta.size + tb.size - inter;
  return inter / union > 0.6;
}

function matchesAvoidList(topic: string, avoid: string[]): boolean {
  const t = topic.toLowerCase();
  return avoid.some((phrase) => {
    const p = phrase.trim().toLowerCase();
    return p.length > 0 && t.includes(p);
  });
}

function addHours(date: Date, hours: number): Date {
  return new Date(date.getTime() + hours * 60 * 60 * 1000);
}
function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

function skipped(policyId: string, workspaceId: string, reason: string): RunResult {
  return {
    runId: null,
    policyId,
    workspaceId,
    status: 'SKIPPED',
    ideasGenerated: 0,
    itemsScheduled: 0,
    itemsSkipped: 0,
    reason,
  };
}
