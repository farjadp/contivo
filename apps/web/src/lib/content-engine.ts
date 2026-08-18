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
import {
  generateContentIdeasWithGemini,
  generateContentDraftWithGemini,
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
import { generateImageForContentItem } from '@/lib/content-image';

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

export function resolveChannelFromFormat(formatValue: unknown): any {
  const format = String(formatValue || '').toLowerCase();
  if (format.includes('twitter') || format.includes('x')) return 'twitter';
  if (format.includes('blog') || format.includes('article')) return 'blog';
  if (format.includes('email') || format.includes('newsletter')) return 'email';
  if (format.includes('instagram') || format.includes('insta')) return 'instagram';
  return 'linkedin';
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

  const localDateTimeString = `${publishDate}T${publishTime}:00`;
  const localDate = new Date(localDateTimeString);
  if (Number.isNaN(localDate.getTime())) return null;

  const scheduledAtUtc = new Date(localDate.toLocaleString('en-US', { timeZone: timezone }));
  if (Number.isNaN(scheduledAtUtc.getTime())) return null;
  return scheduledAtUtc;
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

  if (!Array.isArray(competitiveMatrices?.charts) || competitiveMatrices.charts.length === 0) {
    return {
      error:
        'Market Metric data is required for ideation. Please run Competitive Landscape charts first.' as const,
    };
  }

  if (
    !Array.isArray(competitorKeywordsIntel?.competitors) ||
    competitorKeywordsIntel.competitors.length === 0
  ) {
    return {
      error:
        'Competitor Keywords data is required for ideation. Please run Competitor Keywords analysis first.' as const,
    };
  }

  return { workspace, brandSummary, competitiveMatrices, competitorKeywordsIntel };
}

export async function ideateForWorkspace(actor: Actor, options?: IdeationRequestOptions) {
  const ctx = await loadIdeationContext(actor);
  if ('error' in ctx) return { error: ctx.error };

  const { brandSummary, competitiveMatrices, competitorKeywordsIntel } = ctx;
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
      maxIdeaCount,
      requestedIdeaCount,
      includeImages,
      imageCount,
      autoInsertToCalendar,
      marketMatrices: competitiveMatrices,
      competitorKeywordsIntel,
    });
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

    return {
      ideas: ideation.ideas,
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

export async function saveIdeaToPipelineCore(actor: Actor, idea: any) {
  const { userId, workspaceId } = actor;

  try {
    const channel = resolveChannelFromFormat(idea?.format);

    const item = await prisma.contentItem.create({
      data: {
        userId,
        workspaceId,
        type: 'POST', // Default job type
        channel,
        topic: idea.topic || 'Untitled Idea',
        content: buildPipelineDraftContent(idea),
        status: 'DRAFT',
        // Set when an agent produced this, so each agent keeps its own quota.
        agentId: idea?.agent_id ? String(idea.agent_id) : null,
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

    return { success: true, id: item.id };
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

    const channel = resolveChannelFromFormat(idea?.format);
    const wordCountLimits = await getContentWordCountLimits();
    const wordCountPlatform = resolveWordCountPlatformKey(idea?.format || channel);
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
    );

    if (!generatedBody) return { error: 'AI generation failed' };

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
      },
    });

    return {
      success: true,
      preview: generatedBody,
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
    );

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

      let humanized = await humanizeDraft({
        text: generatedBody,
        channel: item.channel,
        brandSummary,
        // Reuse the same target the generator was given, so the rewrite
        // expands a thin draft instead of preserving its thinness.
        targetWords: targetWordCount,
        minWords: wordCountRange.min,
        // Blog posts are rendered as web pages; hashtags only belong on social.
        hashtags: hashtagCount,
      });
      let passes = 1;

      // Models reliably undershoot a word target by 20-30%. One rewrite is not
      // enough to lift a thin draft to a real one, so keep asking while the
      // result is still under the floor — bounded, and only while it grows.
      while (countWords(humanized.text) < wordCountRange.min && passes < 3) {
        const before = countWords(humanized.text);
        const next = await humanizeDraft({
          text: humanized.text,
          channel: item.channel,
          brandSummary,
          targetWords: targetWordCount,
          minWords: wordCountRange.min,
          hashtags: hashtagCount,
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

    // Update the item
    const updated = await prisma.contentItem.update({
      where: { id: itemId },
      data: {
        content: finalBody,
        status: 'SCHEDULED',
        scheduledAtUtc: finalScheduledAtUtc,
        scheduledTimezone: scheduleTimezone || 'America/Toronto',
      },
    });

    // Artwork is best-effort: a post without an image still publishes.
    let imageInfo: Record<string, unknown> | null = null;
    if (options.withImage) {
      const image = await generateImageForContentItem({
        contentItemId: updated.id,
        workspaceId,
        topic: updated.topic,
        body: finalBody,
        brandSummary,
      });
      imageInfo = image
        ? { imageId: image.id, bytes: image.bytes, altText: image.altText }
        : { imageId: null, failed: true };
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

    return { success: true, item: updated, humanize: humanizeInfo, image: imageInfo };
  } catch (err) {
    console.error('Generation action error:', err);
    return { error: 'Failed to generate post.' };
  }
}
