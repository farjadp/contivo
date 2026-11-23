/**
 * content-engine.ts
 *
 * Session-less core of the content workflow: ideation → pipeline item →
 * AI draft → SCHEDULED. Every function takes an explicit `userId` and
 * `workspaceId` so it can be called from a server action (which resolves
 * the session first) *or* from a background runner such as Autopilot that
 * has no session at all.
 *
 * The server actions in `app/actions/workspace.ts` are thin wrappers over
 * these functions and must keep identical return shapes.
 */

import { prisma } from '@/lib/db';
import { matricesGate } from '@/lib/report-readiness';
import { parseLocalDateTimeToUtc } from '@/lib/autopilot/schedule';
import { loadStorylineContext, storylinePromptBlock } from '@/lib/narrative/context';
import {
  generateContentIdeasWithGemini,
  generateContentDraftWithGemini,
  type ContentIdea,
  type IdeationRequestOptions,
} from '@/lib/gemini';
import { writeActivityLog } from '@/lib/activity-log';
import {
  getContentWordCountLimits,
  getDefaultScheduleDelayHours,
  getIdeationMaxContentCount,
} from '@/lib/app-settings';
import {
  clampWordCount,
  midpointWordCount,
  resolveWordCountPlatformKey,
} from '@/lib/content-word-count';
import {
  getLatestFrameworkMetadataForContentItem,
  logFrameworkMetadata,
} from '@/lib/framework-metadata-log';
import { humanizeDraft } from '@/lib/humanize';
import { generateImageOutcome } from '@/lib/content-image';
import { adjustWordCountForLanguage, asContentLanguage } from '@/lib/content-language';
import { POST_BODY_MAX } from '@/lib/content-slug';
import { textForChannel } from '@/lib/social-text';
import { notCheckedVerdict, runManualGate, type StoredVerdict } from '@/lib/quality-verdict';
import { signVerdictToken, verifyVerdictToken } from '@/lib/quality-verdict-token';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ManualSourcePayload = {
  notes?: string | null;
  extractedText?: string | null;
  files?: Array<{ name?: string; type?: string; size?: number }> | null;
  timezone?: string | null;
  targetWordCount?: number | null;
  publishDate?: string | null;
  publishTime?: string | null;
};

type Actor = { userId: string; workspaceId: string };

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

export function buildPipelineDraftContent(idea: any): string {
  const angle = String(idea?.angle || '').trim();
  const pillar = String(idea?.pillar || 'General').trim();
  const parsedTargetWordCount = Number(idea?.target_word_count ?? idea?.targetWordCount ?? 0);
  const targetWordCount =
    Number.isFinite(parsedTargetWordCount) && parsedTargetWordCount > 0
      ? Math.floor(parsedTargetWordCount)
      : null;

  const lines = [`ANGLE/HOOK: ${angle}`, `PILLAR: ${pillar}`];
  if (targetWordCount != null) {
    lines.push(`TARGET_WORD_COUNT: ${targetWordCount}`);
  }
  return lines.join('\n');
}

/**
 * Whole-word format keywords → channel, checked in order. Matching words, not
 * substrings: the old `format.includes('x')` sent "explainer", "text post" and
 * anything else with an x to X. Threads is chosen explicitly, never guessed
 * from a format label. `telegram` is matched only as the whole word: the
 * Autopilot runner forces a slot's channel by passing it as the format.
 */
const FORMAT_CHANNEL_RULES: ReadonlyArray<
  readonly [ReadonlySet<string>, 'twitter' | 'blog' | 'email' | 'instagram' | 'telegram']
> = [
  [new Set(['telegram']), 'telegram'],
  [new Set(['x', 'twitter', 'tweet', 'tweets']), 'twitter'],
  [new Set(['blog', 'article', 'articles']), 'blog'],
  [new Set(['email', 'newsletter']), 'email'],
  [new Set(['instagram', 'insta', 'ig']), 'instagram'],
];

export function resolveChannelFromFormat(
  formatValue: unknown,
): 'linkedin' | 'twitter' | 'blog' | 'email' | 'instagram' | 'telegram' {
  const words = String(formatValue ?? '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  for (const [keywords, channel] of FORMAT_CHANNEL_RULES) {
    if (words.some((word) => keywords.has(word))) return channel;
  }
  return 'linkedin';
}

/**
 * Every stored channel an idea can be saved for. telegram and threads are only
 * ever chosen explicitly (the runner passes them); the format fallback never
 * guesses them.
 */
export type IdeaChannel = ReturnType<typeof resolveChannelFromFormat> | 'telegram' | 'threads';

/**
 * Platform values the user can pick (CONTENT_PLATFORM_OPTIONS) and channel
 * names, mapped to the stored channel. landing_page, ad and strategy_note have
 * no channel of their own and fall through to the format label.
 */
const PLATFORM_TO_CHANNEL: Readonly<Record<string, IdeaChannel>> = {
  linkedin: 'linkedin',
  x: 'twitter',
  twitter: 'twitter',
  blog: 'blog',
  email: 'email',
  instagram: 'instagram',
  telegram: 'telegram',
  threads: 'threads',
};

export function channelForPlatform(value: unknown): IdeaChannel | null {
  const key = String(value ?? '').trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(PLATFORM_TO_CHANNEL, key) ? PLATFORM_TO_CHANNEL[key] : null;
}

/**
 * The channel an idea is saved and drafted for. The platform the user chose
 * wins: ideation stamps it on every idea as `channel`. The model's free-text
 * `format` ("LinkedIn text post with an example…") is only a fallback for ideas
 * that carry no channel, e.g. ones saved before this field existed.
 */
export function resolveIdeaChannel(idea: unknown): IdeaChannel {
  const source = (idea ?? {}) as { channel?: unknown; platform?: unknown; format?: unknown };
  return channelForPlatform(source.channel) ?? channelForPlatform(source.platform) ?? resolveChannelFromFormat(source.format);
}

function extractLegacyFrameworkContext(rawContent: string): {
  frameworkId: string | null;
  frameworkReason: string | null;
  cleanContext: string;
} {
  const lines = String(rawContent || '').split('\n');
  let frameworkId: string | null = null;
  let frameworkReason: string | null = null;
  const cleanLines: string[] = [];

  for (const line of lines) {
    if (/^FRAMEWORK_ID:\s*/i.test(line)) {
      frameworkId = line.replace(/^FRAMEWORK_ID:\s*/i, '').trim() || null;
      continue;
    }
    if (/^FRAMEWORK_REASON:\s*/i.test(line)) {
      frameworkReason = line.replace(/^FRAMEWORK_REASON:\s*/i, '').trim() || null;
      continue;
    }
    if (/^FRAMEWORK_SCORE:\s*/i.test(line)) {
      continue;
    }
    cleanLines.push(line);
  }

  return {
    frameworkId,
    frameworkReason,
    cleanContext: cleanLines.join('\n').trim(),
  };
}

function extractTargetWordCountFromContext(rawContent: string): number | null {
  const match = String(rawContent || '').match(/(?:^|\n)TARGET_WORD_COUNT:\s*(\d+)\s*(?:\n|$)/i);
  if (!match) return null;
  const parsed = Number(match[1]);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.floor(parsed);
}

const AUTO_SCHEDULE_WINDOW_DAYS = 7;

async function computeAutoScheduleUtc(input: {
  workspaceId: string;
  userId: string;
  baseDate: Date;
}): Promise<Date> {
  const scheduledCount = await prisma.contentItem.count({
    where: {
      workspaceId: input.workspaceId,
      userId: input.userId,
      scheduledAtUtc: { not: null },
      status: { in: ['SCHEDULED', 'PUBLISHING', 'PUBLISHED', 'READY', 'GENERATED'] },
    },
  });

  const slotIndex = Math.max(0, scheduledCount);
  const dayOffset = slotIndex % AUTO_SCHEDULE_WINDOW_DAYS;
  const intraDayBatch = Math.floor(slotIndex / AUTO_SCHEDULE_WINDOW_DAYS);

  const scheduledAtUtc = new Date(input.baseDate);
  scheduledAtUtc.setUTCDate(scheduledAtUtc.getUTCDate() + dayOffset);
  scheduledAtUtc.setUTCMinutes(scheduledAtUtc.getUTCMinutes() + intraDayBatch * 60);
  scheduledAtUtc.setUTCSeconds(0, 0);
  return scheduledAtUtc;
}

function normalizeManualSourceContext(payload?: ManualSourcePayload): {
  context: string;
  fileCount: number;
  sourceChars: number;
  fileNames: string[];
} {
  const notes = String(payload?.notes || '').trim().slice(0, 6000);
  const extractedText = String(payload?.extractedText || '').trim().slice(0, 24000);
  const files = Array.isArray(payload?.files) ? payload?.files : [];

  const fileNames = files
    .map((file) => String(file?.name || '').trim())
    .filter(Boolean)
    .slice(0, 8);

  const blocks: string[] = [];
  if (notes) {
    blocks.push(`USER_NOTES:\n${notes}`);
  }
  if (extractedText) {
    blocks.push(`USER_SOURCE_TEXT:\n${extractedText}`);
  }
  if (fileNames.length > 0) {
    blocks.push(`USER_SOURCE_FILES:\n${fileNames.join(', ')}`);
  }

  const context = blocks.join('\n\n').trim();
  return {
    context,
    fileCount: fileNames.length,
    sourceChars: context.length,
    fileNames,
  };
}

function parseManualScheduleUtc(payload?: ManualSourcePayload): Date | null {
  const publishDate = String(payload?.publishDate || '').trim();
  const publishTime = String(payload?.publishTime || '').trim();
  const timezone = String(payload?.timezone || 'America/Toronto').trim();
  if (!publishDate || !publishTime || !timezone) return null;

  return parseLocalDateTimeToUtc(publishDate, publishTime, timezone);
}

// ---------------------------------------------------------------------------
// Ideation
// ---------------------------------------------------------------------------

/**
 * Loads the workspace and checks the ideation prerequisites (brand summary,
 * market matrices, competitor keywords). Returns `{ error }` when anything
 * is missing so callers can surface it, or `{ workspace, ... }` when ready.
 */
export async function loadIdeationContext(actor: Actor) {
  const workspace = await prisma.workspace.findUnique({
    where: { id: actor.workspaceId, userId: actor.userId },
  });

  if (!workspace) return { error: 'Workspace not found' as const };

  const brandSummary = workspace.brandSummary;
  if (!brandSummary) return { error: 'Brand strategy not found for this workspace' as const };

  const audienceInsights =
    workspace.audienceInsights && typeof workspace.audienceInsights === 'object'
      ? (workspace.audienceInsights as Record<string, any>)
      : {};
  const competitiveMatrices = audienceInsights.competitiveMatrices;
  const competitorKeywordsIntel = audienceInsights.competitorKeywordsIntel;

  const gate = matricesGate(competitiveMatrices);
  if (!gate.ok) return { error: gate.reason };
  const competitorBasis = gate.competitorBasis;

  if (
    !Array.isArray(competitorKeywordsIntel?.competitors) ||
    competitorKeywordsIntel.competitors.length === 0
  ) {
    return {
      error:
        'Competitor Keywords data is required for ideation. Please run Competitor Keywords analysis first.' as const,
    };
  }

  return { workspace, brandSummary, competitiveMatrices, competitorBasis, competitorKeywordsIntel };
}

export async function ideateForWorkspace(actor: Actor, options?: IdeationRequestOptions) {
  const ctx = await loadIdeationContext(actor);
  if ('error' in ctx) return { error: ctx.error };

  const { brandSummary, competitiveMatrices, competitorBasis, competitorKeywordsIntel } = ctx;
  const { userId, workspaceId } = actor;

  try {
    const maxIdeaCount = await getIdeationMaxContentCount();
    const requestedIdeaCount = Math.max(
      1,
      Math.min(maxIdeaCount, Number(options?.requestedIdeaCount || 5)),
    );
    const includeImages = Boolean(options?.includeImages);
    const imageCount = Math.max(1, Math.min(3, Number(options?.imageCount || 1)));
    const autoInsertToCalendar = options?.autoInsertToCalendar !== false;

    const ideation = await generateContentIdeasWithGemini(brandSummary, {
      ...options,
      /*
        The workspace decides, not the caller. Autopilot calls this with no
        request context at all, and a caller-supplied language would let a
        Persian workspace quietly produce English ideas the moment someone
        forgot to pass it.
      */
      language: asContentLanguage(ctx.workspace.contentLanguage),
      maxIdeaCount,
      requestedIdeaCount,
      includeImages,
      imageCount,
      autoInsertToCalendar,
      marketMatrices: competitiveMatrices,
      competitorBasis,
      competitorKeywordsIntel,
    }, { userId, workspaceId });
    if (!ideation) {
      return { error: 'Failed to generate ideas.' };
    }

    await writeActivityLog({
      userId,
      workspaceId,
      action: 'IDEATION_GENERATED',
      detail: {
        ideasCount: ideation.ideas.length,
        frameworkId: ideation.framework.framework_id,
        frameworkName: ideation.framework.framework_name,
        selectionMode: ideation.framework.selection_mode,
        qualityScores: ideation.quality_scores,
        fallbackUsed: ideation.fallback_used,
        fallbackFrameworkId: ideation.fallback_framework_id,
        request: {
          goal: options?.goal || null,
          platform: options?.platform || null,
          funnelStage: options?.funnelStage || null,
          selectionMode: options?.selectionMode || 'auto',
          requestedIdeaCount,
          includeImages,
          imageCount: includeImages ? imageCount : 0,
          autoInsertToCalendar,
        },
      },
    });

    await logFrameworkMetadata({
      userId,
      workspaceId,
      eventName: 'IDEATION_GENERATED',
      frameworkId: ideation.framework.framework_id,
      frameworkName: ideation.framework.framework_name,
      frameworkCategory: ideation.framework.framework_category,
      selectionMode: ideation.framework.selection_mode,
      selectionReason: ideation.framework.selection_reason,
      goal: String(options?.goal || ''),
      platform: String(options?.platform || ''),
      funnelStage: String(options?.funnelStage || ''),
      qualityScores: ideation.quality_scores,
      fallbackUsed: ideation.fallback_used,
      fallbackFrameworkId: ideation.fallback_framework_id,
      metadata: {
        ideasCount: ideation.ideas.length,
        requestedIdeaCount,
        includeImages,
        imageCount: includeImages ? imageCount : 0,
        autoInsertToCalendar,
      },
    });

    // Stamp the chosen platform on each idea so preview and save never have to
    // guess the channel back from the model's format text.
    const requestedChannel = channelForPlatform(options?.platform);
    const ideas: Array<ContentIdea & { channel?: IdeaChannel }> = requestedChannel
      ? ideation.ideas.map((idea) => ({ ...idea, channel: requestedChannel }))
      : ideation.ideas;

    return {
      ideas,
      framework: ideation.framework,
      qualityScores: ideation.quality_scores,
      fallbackUsed: ideation.fallback_used,
      fallbackFrameworkId: ideation.fallback_framework_id,
    };
  } catch (error) {
    console.error('Ideation generation failed:', error);
    return { error: 'An unexpected error occurred during ideation.' };
  }
}

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

/**
 * A preview the user generated in Ideation. `verdictToken` is the signed
 * quality verdict the preview action returned for exactly this text (B8).
 */
export type SavedPreview = { body?: unknown; verdictToken?: unknown };

export async function saveIdeaToPipelineCore(actor: Actor, idea: any, preview?: SavedPreview) {
  const { userId, workspaceId } = actor;

  try {
    /*
      workspaceId comes from the client in the server action, and the
      autopilot runner calls this too. Never write a row into a workspace the
      actor does not own: someone else's workspace and a missing one look
      identical.
    */
    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId, userId },
      select: { id: true },
    });
    if (!workspace) return { error: 'Workspace not found' };

    const channel = resolveIdeaChannel(idea);

    /*
      A preview the user already generated is the post: keep it instead of the
      outline, or they wait for and pay for a second, different draft. It is
      AI text nobody has approved yet, so it lands as GENERATED, not READY.
    */
    /*
      The preview's verdict comes back as a signed token (B8): valid only for
      this workspace, channel and exact text, and for 30 minutes. A token that
      verifies means this is the text the server produced and judged, already
      converted for the channel, so it is stored as is. Anything else is
      stored as "not checked" — never re-judged silently, never a pass.
    */
    const rawPreview = typeof preview?.body === 'string' ? preview.body.trim() : '';
    const tokenVerdict = rawPreview
      ? verifyVerdictToken(preview?.verdictToken, { text: rawPreview, workspaceId, channel })
      : null;
    // LinkedIn and X show markdown as typed (B15): store what will be published.
    const previewBody = tokenVerdict
      ? rawPreview
      : rawPreview
        ? textForChannel(channel, rawPreview).trim()
        : '';
    if (previewBody.length > POST_BODY_MAX) return { error: 'Preview is too long to save.' };
    const fromPreview = previewBody.length > 0;
    const qualityVerdict: StoredVerdict | undefined = fromPreview
      ? tokenVerdict ?? notCheckedVerdict('preview')
      : undefined;

    const item = await prisma.contentItem.create({
      data: {
        userId,
        workspaceId,
        type: 'POST', // Default job type
        channel,
        topic: idea.topic || 'Untitled Idea',
        content: fromPreview ? previewBody : buildPipelineDraftContent(idea),
        status: fromPreview ? 'GENERATED' : 'DRAFT',
        // Undefined (column stays null) for an outline: there is no AI text to judge yet.
        ...(qualityVerdict ? { qualityVerdict } : {}),
        // Set when an agent produced this, so each agent keeps its own quota.
        agentId: idea?.agent_id ? String(idea.agent_id) : null,
        // Which argument this advances. Null for content made before the
        // narrative layer, and for hand-written ideas with no storyline chosen.
        storylineId: idea?.storyline_id ? String(idea.storyline_id) : null,
      },
    });

    await writeActivityLog({
      userId,
      workspaceId,
      action: 'CONTENT_PIPELINE_ITEM_SAVED',
      detail: {
        itemId: item.id,
        topic: item.topic,
        channel: item.channel,
        fromPreview,
        qualityVerdict: qualityVerdict
          ? { approved: qualityVerdict.approved, rejectedBy: qualityVerdict.rejectedBy }
          : null,
        frameworkId: idea?.framework_id || null,
        targetWordCount: Number.isFinite(Number(idea?.target_word_count ?? idea?.targetWordCount))
          ? Math.floor(Number(idea?.target_word_count ?? idea?.targetWordCount))
          : null,
      },
    });

    const autoInsertToCalendar = idea?.auto_insert_to_calendar !== false;
    if (autoInsertToCalendar) {
      const scheduledAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
      await writeActivityLog({
        userId,
        workspaceId,
        action: 'CONTENT_CALENDAR_MOCK_INSERTED',
        detail: {
          itemId: item.id,
          topic: item.topic,
          channel: item.channel,
          scheduledAt: scheduledAt.toISOString(),
          publishMode: 'AUTO_MOCK',
          note: 'Calendar integration is mocked until content calendar module is implemented.',
        },
      });
    }

    if (idea?.framework_id && idea?.framework_name) {
      await logFrameworkMetadata({
        userId,
        workspaceId,
        contentItemId: item.id,
        eventName: 'IDEA_SAVED_TO_PIPELINE',
        frameworkId: String(idea.framework_id),
        frameworkName: String(idea.framework_name),
        frameworkCategory: String(idea.framework_category || 'social'),
        selectionMode: String(idea.selection_mode || 'auto'),
        selectionReason: String(idea.selection_reason || ''),
        qualityScores: idea.quality_scores || null,
        fallbackUsed: Boolean(idea.fallback_used),
        fallbackFrameworkId: idea.fallback_framework_id || null,
        metadata: {
          topic: item.topic,
          channel: item.channel,
          pillar: idea?.pillar || null,
          format: idea?.format || null,
          includeImages: Boolean(idea?.include_images),
          imageCount: Number(idea?.image_count || 0),
          imageBriefs: Array.isArray(idea?.image_briefs) ? idea.image_briefs : [],
          autoInsertToCalendar,
          targetWordCount: Number.isFinite(
            Number(idea?.target_word_count ?? idea?.targetWordCount),
          )
            ? Math.floor(Number(idea?.target_word_count ?? idea?.targetWordCount))
            : null,
        },
      });
    }

    return { success: true, id: item.id, channel: item.channel, status: item.status };
  } catch (err) {
    console.error('Failed to save idea to pipeline:', err);
    return { error: 'Failed to save to pipeline.' };
  }
}

// ---------------------------------------------------------------------------
// Drafts
// ---------------------------------------------------------------------------

export async function generateDraftPreviewCore(
  actor: Actor,
  idea: any,
  manualSource?: ManualSourcePayload,
) {
  const { userId, workspaceId } = actor;

  try {
    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId, userId },
    });

    if (!workspace) return { error: 'Workspace not found' };
    if (!workspace.brandSummary) return { error: 'Brand strategy not found for this workspace' };

    const topic = String(idea?.topic || '').trim();
    if (!topic) return { error: 'Idea topic is required for preview generation.' };

    const channel = resolveIdeaChannel(idea);
    const wordCountLimits = await getContentWordCountLimits();
    const wordCountPlatform = resolveWordCountPlatformKey(channel);
    const wordCountRange = wordCountLimits[wordCountPlatform];
    const targetWordCount = clampWordCount(
      manualSource?.targetWordCount ?? idea?.target_word_count ?? idea?.targetWordCount,
      wordCountRange,
      midpointWordCount(wordCountRange),
    );
    const normalizedManualSource = normalizeManualSourceContext(manualSource);
    const generationContext = [buildPipelineDraftContent(idea), normalizedManualSource.context]
      .filter(Boolean)
      .join('\n\n')
      .trim();

    const generatedBody = await generateContentDraftWithGemini(
      workspace.brandSummary,
      topic,
      generationContext,
      channel,
      {
        frameworkId: String(idea?.framework_id || '').trim() || null,
        selectionReason: String(idea?.selection_reason || '').trim() || null,
        wordCount: {
          platform: wordCountPlatform,
          min: wordCountRange.min,
          max: wordCountRange.max,
          target: targetWordCount,
        },
      },
      null,
      asContentLanguage(workspace.contentLanguage),
      { userId, workspaceId },
    );

    // Null = the provider chain failed. Nothing is saved; there is no template draft.
    if (!generatedBody) return { error: 'AI generation failed' };

    // What the user sees is what will be stored and published (B15).
    const previewText = textForChannel(channel, generatedBody);

    // B8: one gate call per generated text. Its verdict travels to Add to
    // Pipeline in a signed token, so saving costs no second call.
    const verdict = await runManualGate({
      actor: { userId, workspaceId },
      workspace,
      content: previewText.trim(),
      topic,
      channel,
      storylineId: idea?.storyline_id ? String(idea.storyline_id) : null,
      source: 'preview',
    });
    const verdictToken = signVerdictToken({ text: previewText, workspaceId, channel, verdict });

    await writeActivityLog({
      userId,
      workspaceId,
      action: 'CONTENT_PREVIEW_GENERATED_FROM_IDEA',
      detail: {
        topic,
        channel,
        frameworkId: idea?.framework_id || null,
        manualSourceUsed: Boolean(normalizedManualSource.context),
        manualSourceFileCount: normalizedManualSource.fileCount,
        manualSourceCharCount: normalizedManualSource.sourceChars,
        manualSourceFiles: normalizedManualSource.fileNames,
        wordCountPlatform,
        wordCountRange,
        targetWordCount,
        qualityVerdict: { approved: verdict.approved, rejectedBy: verdict.rejectedBy },
      },
    });

    return {
      success: true,
      preview: previewText,
      verdict,
      verdictToken,
      channel,
      topic,
      targetWordCount,
      manualSourceUsed: Boolean(normalizedManualSource.context),
    };
  } catch (error) {
    console.error('Preview generation from idea failed:', error);
    return { error: 'Failed to generate preview.' };
  }
}

export type GenerateDraftOptions = {
  manualSource?: ManualSourcePayload;
  /**
   * Explicit publish time. Takes precedence over the manual date/time fields
   * and over the auto-schedule slot. Used by Autopilot, which computes slots
   * inside the policy's publish window itself.
   */
  scheduledAtUtc?: Date | null;
  /** Free-form origin tag written to the activity log (e.g. "autopilot"). */
  source?: string;
  /** Rewrite the draft to strip machine-written tells before saving. */
  humanize?: boolean;
  /** Generate and attach artwork for the post. */
  withImage?: boolean;
};

/**
 * Generates the AI draft for an existing pipeline item and moves it to
 * SCHEDULED with a publish time. From here SocialSchedulerService takes over.
 */
export async function generateDraftForItem(
  actor: Actor,
  itemId: string,
  options: GenerateDraftOptions = {},
) {
  const { userId, workspaceId } = actor;
  const manualSource = options.manualSource;

  try {
    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId, userId },
      include: {
        contentItems: {
          where: { id: itemId },
        },
      },
    });

    if (!workspace || workspace.contentItems.length === 0) {
      return { error: 'Workspace or Content Item not found' };
    }

    const item = workspace.contentItems[0];

    const brandSummary = workspace.brandSummary;
    if (!brandSummary) return { error: 'Brand strategy not found for this workspace' };

    const latestFrameworkMetadata = await getLatestFrameworkMetadataForContentItem(
      userId,
      item.id,
    );
    const legacyFrameworkContext = extractLegacyFrameworkContext(item.content || '');
    const frameworkId =
      latestFrameworkMetadata?.frameworkId || legacyFrameworkContext.frameworkId || null;
    const frameworkReason =
      latestFrameworkMetadata?.selectionReason || legacyFrameworkContext.frameworkReason || null;
    const normalizedManualSource = normalizeManualSourceContext(manualSource);
    const scheduleTimezone = String(
      manualSource?.timezone || item.scheduledTimezone || 'America/Toronto',
    ).trim();
    const requestedScheduleUtc = options.scheduledAtUtc ?? parseManualScheduleUtc(manualSource);
    const wordCountLimits = await getContentWordCountLimits();
    const wordCountPlatform = resolveWordCountPlatformKey(item.channel);
    const wordCountRange = wordCountLimits[wordCountPlatform];
    const persistedTargetWordCount = extractTargetWordCountFromContext(item.content || '');
    const targetWordCount = clampWordCount(
      manualSource?.targetWordCount ?? persistedTargetWordCount,
      wordCountRange,
      midpointWordCount(wordCountRange),
    );
    const generationContext = [legacyFrameworkContext.cleanContext, normalizedManualSource.context]
      .filter(Boolean)
      .join('\n\n')
      .trim();

    // The storyline is loaded here rather than passed in, so a draft regenerated
    // later is held to the same claim the gate will score it against.
    const storyline = await loadStorylineContext(item.storylineId);

    const generatedBody = await generateContentDraftWithGemini(
      brandSummary,
      item.topic,
      generationContext,
      item.channel,
      {
        frameworkId,
        selectionReason: frameworkReason,
        wordCount: {
          platform: wordCountPlatform,
          min: wordCountRange.min,
          max: wordCountRange.max,
          target: targetWordCount,
        },
      },
      storyline ? storylinePromptBlock(storyline) : null,
      asContentLanguage(workspace.contentLanguage),
      { userId, workspaceId },
    );

    // Null = the provider chain failed. The item is left exactly as it was:
    // there is no template draft to save, schedule or publish.
    if (!generatedBody) {
      return { error: 'AI generation failed' };
    }

    // Rewrite before the item is saved, so the humanised text is what gets
    // quality-gated, stored and published — not the raw generation.
    let finalBody = generatedBody;
    let humanizeInfo: Record<string, unknown> | null = null;
    if (options.humanize) {
      const hashtagCount = wordCountPlatform === 'blog' || wordCountPlatform === 'email' ? 0 : 3;
      const countWords = (t: string) => t.split(/\s+/).filter(Boolean).length;
      const language = asContentLanguage(workspace.contentLanguage);
      /*
        The configured floor is an English word count, and the draft was
        generated against a floor already scaled for this language. Comparing
        the rewrite against the unscaled number sends the loop below into two
        extra expansion passes on every Persian post, padding it to hit a
        target that was never meant for Persian — and padding is what the
        quality gate rejects.
      */
      const minWords = adjustWordCountForLanguage(wordCountRange.min, language);

      let humanized = await humanizeDraft({
        text: generatedBody,
        channel: item.channel,
        brandSummary,
        language,
        // Reuse the same target the generator was given, so the rewrite
        // expands a thin draft instead of preserving its thinness.
        targetWords: targetWordCount,
        minWords,
        // Blog posts are rendered as web pages; hashtags only belong on social.
        hashtags: hashtagCount,
        ctx: { userId, workspaceId },
      });
      let passes = 1;

      // Models reliably undershoot a word target by 20-30%. One rewrite is not
      // enough to lift a thin draft to a real one, so keep asking while the
      // result is still under the floor — bounded, and only while it grows.
      while (countWords(humanized.text) < minWords && passes < 3) {
        const before = countWords(humanized.text);
        const next = await humanizeDraft({
          text: humanized.text,
          channel: item.channel,
          brandSummary,
          language,
          targetWords: targetWordCount,
          minWords,
          hashtags: hashtagCount,
          ctx: { userId, workspaceId },
        });
        if (countWords(next.text) <= before) break;
        humanized = next;
        passes += 1;
      }

      finalBody = humanized.text;
      humanizeInfo = {
        changed: humanized.changed,
        source: humanized.source,
        passes,
        words: countWords(humanized.text),
        tellsBefore: humanized.tellsBefore,
        tellsAfter: humanized.tellsAfter,
      };
    }

    // LinkedIn and X render no markdown (B15). Converted here, before the
    // autopilot gate reads it, so the gate judges the text that is published.
    finalBody = textForChannel(item.channel, finalBody);

    const autoScheduleDelayHours = await getDefaultScheduleDelayHours();
    const baseAutoSchedule = new Date(Date.now() + autoScheduleDelayHours * 60 * 60 * 1000);
    const autoScheduledAtUtc = await computeAutoScheduleUtc({
      workspaceId,
      userId,
      baseDate: baseAutoSchedule,
    });
    const finalScheduledAtUtc = requestedScheduleUtc
      ? requestedScheduleUtc
      : item.scheduledAtUtc
        ? new Date(item.scheduledAtUtc)
        : autoScheduledAtUtc;

    /*
      B8: a draft generated by hand is judged before it is scheduled, with the
      same context the autopilot runner gives the gate. Autopilot runs its own
      gate and retry loop after this returns, so it is not judged twice here.
      A failed draft is saved for the user to read but never left SCHEDULED,
      or the cron would publish it.
    */
    const isAutopilot = options.source === 'autopilot';
    const verdict = isAutopilot
      ? null
      : await runManualGate({
          actor: { userId, workspaceId },
          workspace,
          content: finalBody.trim(),
          topic: item.topic,
          channel: item.channel,
          storylineId: item.storylineId,
          excludeItemId: item.id,
          source: 'pipeline',
        });
    const blocked = verdict !== null && !verdict.approved;

    // Update the item
    const updated = await prisma.contentItem.update({
      where: { id: itemId },
      data: {
        content: finalBody,
        status: blocked ? 'GENERATED' : 'SCHEDULED',
        scheduledAtUtc: blocked ? null : finalScheduledAtUtc,
        scheduledTimezone: scheduleTimezone || 'America/Toronto',
        ...(verdict ? { qualityVerdict: verdict } : {}),
      },
    });

    // Artwork is best-effort: a post without an image still publishes, but a
    // missing image carries its cause so callers can say so (B19).
    let imageInfo: Record<string, unknown> | null = null;
    if (options.withImage) {
      const image = await generateImageOutcome({
        contentItemId: updated.id,
        workspaceId,
        userId,
        topic: updated.topic,
        body: finalBody,
        brandSummary,
      });
      imageInfo = image.ok
        ? { imageId: image.image.id, bytes: image.image.bytes, altText: image.image.altText, model: image.model }
        : { imageId: null, failed: true, cause: image.cause, model: image.model, textOnly: true };
    }

    await writeActivityLog({
      userId,
      workspaceId,
      action: 'CONTENT_GENERATED_FROM_PIPELINE',
      detail: {
        itemId: updated.id,
        humanize: humanizeInfo,
        image: imageInfo,
        channel: updated.channel,
        status: updated.status,
        frameworkId,
        source: options.source || 'manual',
        qualityVerdict: verdict ? { approved: verdict.approved, rejectedBy: verdict.rejectedBy } : null,
        manualSourceUsed: Boolean(normalizedManualSource.context),
        manualSourceFileCount: normalizedManualSource.fileCount,
        manualSourceCharCount: normalizedManualSource.sourceChars,
        manualSourceFiles: normalizedManualSource.fileNames,
        wordCountPlatform,
        wordCountRange,
        targetWordCount,
        requestedScheduleUtc: requestedScheduleUtc?.toISOString() || null,
        scheduleTimezone,
        scheduledAtUtc: updated.scheduledAtUtc?.toISOString() || null,
        autoScheduleWindowDays: AUTO_SCHEDULE_WINDOW_DAYS,
        autoScheduleDelayHours,
      },
    });

    if (frameworkId && latestFrameworkMetadata) {
      await logFrameworkMetadata({
        userId,
        workspaceId,
        contentItemId: updated.id,
        eventName: 'CONTENT_DRAFT_GENERATED',
        frameworkId: latestFrameworkMetadata.frameworkId,
        frameworkName: latestFrameworkMetadata.frameworkName,
        frameworkCategory: latestFrameworkMetadata.frameworkCategory,
        selectionMode: latestFrameworkMetadata.selectionMode,
        selectionReason: latestFrameworkMetadata.selectionReason,
        goal: latestFrameworkMetadata.goal,
        platform: latestFrameworkMetadata.platform,
        funnelStage: latestFrameworkMetadata.funnelStage,
        qualityScores: latestFrameworkMetadata.qualityScores,
        fallbackUsed: latestFrameworkMetadata.fallbackUsed,
        fallbackFrameworkId: latestFrameworkMetadata.fallbackFrameworkId,
        metadata: {
          itemStatus: updated.status,
          channel: updated.channel,
          manualSourceUsed: Boolean(normalizedManualSource.context),
          manualSourceFileCount: normalizedManualSource.fileCount,
          manualSourceCharCount: normalizedManualSource.sourceChars,
          manualSourceFiles: normalizedManualSource.fileNames,
          wordCountPlatform,
          wordCountRange,
          targetWordCount,
          requestedScheduleUtc: requestedScheduleUtc?.toISOString() || null,
          scheduleTimezone,
          scheduledAtUtc: updated.scheduledAtUtc?.toISOString() || null,
          autoScheduleWindowDays: AUTO_SCHEDULE_WINDOW_DAYS,
          autoScheduleDelayHours,
        },
      });
    }

    return { success: true, item: updated, humanize: humanizeInfo, image: imageInfo, verdict };
  } catch (err) {
    console.error('Generation action error:', err);
    return { error: 'Failed to generate post.' };
  }
}
