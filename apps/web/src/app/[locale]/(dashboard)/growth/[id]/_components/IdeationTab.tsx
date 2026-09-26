'use client';

import { useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { useFormatter, useTranslations } from 'next-intl';

import { Sparkles, Loader2, FileText, CheckCircle2, Paperclip, X } from 'lucide-react';
import { generateIdeas, saveIdeaToPipeline, generateDraftPreviewFromIdea } from '@/app/actions/workspace';
import { useRouter } from '@/i18n/navigation';
import {
  CONTENT_GOAL_OPTIONS,
  CONTENT_PLATFORM_OPTIONS,
  FRAMEWORK_LABELS,
  FUNNEL_STAGE_OPTIONS,
  type FrameworkId,
} from '@/lib/framework-engine';
import {
  clampWordCount,
  midpointWordCount,
  resolveWordCountPlatformKey,
  WORD_COUNT_PLATFORM_LABELS,
  type ContentWordCountLimits,
} from '@/lib/content-word-count';

type SourceFileState = {
  name: string;
  type: string;
  size: number;
  extractedText: string;
};

/**
 * The option lists in `framework-engine` are data with an English label baked
 * in. Where `tabsA` has a translation for the id we use it; anything the map
 * does not know about falls back to the shipped label rather than a key.
 */
function optionLabel(
  t: ReturnType<typeof useTranslations>,
  group: string,
  id: string,
  fallback: string,
) {
  return t.has(`${group}.${id}`) ? t(`${group}.${id}`) : fallback;
}

function wordCountPlatformLabel(t: ReturnType<typeof useTranslations>, platform: string) {
  return t.has(`wordCountPlatforms.${platform}`)
    ? t(`wordCountPlatforms.${platform}`)
    : (WORD_COUNT_PLATFORM_LABELS[platform as keyof typeof WORD_COUNT_PLATFORM_LABELS] ?? platform);
}

const MAX_MANUAL_SOURCE_FILES = 3;
const MAX_MANUAL_SOURCE_TEXT_CHARS = 24000;

function trimTo(value: string, max: number): string {
  return value.slice(0, max);
}

function cleanText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

async function extractTextFromPdf(file: File): Promise<string> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const loadingTask = (pdfjs as any).getDocument({
    data: await file.arrayBuffer(),
    disableWorker: true,
  });
  const document = await loadingTask.promise;
  const pages: string[] = [];
  const maxPages = Math.min(document.numPages, 30);

  for (let index = 1; index <= maxPages; index += 1) {
    const page = await document.getPage(index);
    const content = await page.getTextContent();
    const pageText = Array.isArray(content.items)
      ? content.items
          .map((item: any) => String(item?.str || '').trim())
          .filter(Boolean)
          .join(' ')
      : '';
    if (pageText) pages.push(pageText);
  }

  return pages.join('\n');
}

async function extractTextFromFile(file: File): Promise<string> {
  const mime = (file.type || '').toLowerCase();
  const filename = file.name.toLowerCase();
  const isPdf = mime === 'application/pdf' || filename.endsWith('.pdf');
  const isTextLike =
    mime.startsWith('text/') ||
    filename.endsWith('.txt') ||
    filename.endsWith('.md') ||
    filename.endsWith('.csv') ||
    filename.endsWith('.json');

  if (isPdf) return extractTextFromPdf(file);
  if (isTextLike) return file.text();

  throw new Error('Unsupported file type. Use PDF/TXT/MD/CSV/JSON.');
}

export function IdeationTab({
  workspace,
  maxIdeaCount,
  maxImageCount,
  wordCountLimits,
}: {
  workspace: any;
  maxIdeaCount: number;
  maxImageCount: number;
  wordCountLimits: ContentWordCountLimits;
}) {
  const t = useTranslations('tabsA');
  const format = useFormatter();
  const [isGenerating, setIsGenerating] = useState(false);
  const [ideas, setIdeas] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [frameworkMeta, setFrameworkMeta] = useState<any | null>(null);
  const [qualityScores, setQualityScores] = useState<any | null>(null);
  const [fallbackUsed, setFallbackUsed] = useState(false);
  const [goal, setGoal] = useState<string>('authority');
  const [platform, setPlatform] = useState<string>('linkedin');
  const [funnelStage, setFunnelStage] = useState<string>('AUTO');
  const [selectionMode, setSelectionMode] = useState<'auto' | 'manual'>('auto');
  const [manualFrameworkId, setManualFrameworkId] = useState<FrameworkId>('insight_implication_action');
  const [requestedCount, setRequestedCount] = useState<number>(Math.min(5, Math.max(1, maxIdeaCount)));
  const [targetWordCount, setTargetWordCount] = useState<number>(
    midpointWordCount(wordCountLimits.linkedin),
  );
  const [includeImages, setIncludeImages] = useState<boolean>(false);
  const [imageCount, setImageCount] = useState<number>(1);
  const [autoInsertToCalendar, setAutoInsertToCalendar] = useState<boolean>(true);
  const [generationPath, setGenerationPath] = useState<'direct' | 'source_form'>('direct');
  const [manualSourceNotes, setManualSourceNotes] = useState('');
  const [manualSourceFiles, setManualSourceFiles] = useState<SourceFileState[]>([]);
  const [manualSourceError, setManualSourceError] = useState<string | null>(null);
  const [isExtractingSourceFiles, setIsExtractingSourceFiles] = useState(false);
  const wordCountPlatform = useMemo(() => resolveWordCountPlatformKey(platform), [platform]);
  const wordCountRange = wordCountLimits[wordCountPlatform];
  const normalizedTargetWordCount = clampWordCount(
    targetWordCount,
    wordCountRange,
    midpointWordCount(wordCountRange),
  );

  useEffect(() => {
    setTargetWordCount((prev) =>
      clampWordCount(prev, wordCountRange, midpointWordCount(wordCountRange)),
    );
  }, [wordCountRange.min, wordCountRange.max]);

  const extractedFilesText = trimTo(
    manualSourceFiles
      .map((file) => `FILE: ${file.name}\n${file.extractedText}`)
      .join('\n\n')
      .trim(),
    MAX_MANUAL_SOURCE_TEXT_CHARS,
  );

  const handleSourceFilesSelected = async (event: ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(event.target.files || []);
    event.target.value = '';
    setManualSourceError(null);
    if (!selected.length) return;

    const remaining = Math.max(0, MAX_MANUAL_SOURCE_FILES - manualSourceFiles.length);
    if (remaining === 0) {
      setManualSourceError(t('ideation.errors.maxFiles', { count: MAX_MANUAL_SOURCE_FILES }));
      return;
    }

    setIsExtractingSourceFiles(true);
    try {
      const nextFiles: SourceFileState[] = [];
      for (const file of selected.slice(0, remaining)) {
        try {
          const raw = await extractTextFromFile(file);
          const text = cleanText(raw);
          if (!text) continue;
          nextFiles.push({
            name: file.name,
            type: file.type || 'unknown',
            size: file.size,
            extractedText: trimTo(text, 9000),
          });
        } catch {
          setManualSourceError(t('ideation.errors.readFailed', { name: file.name }));
        }
      }

      if (nextFiles.length > 0) {
        setManualSourceFiles((prev) => [...prev, ...nextFiles].slice(0, MAX_MANUAL_SOURCE_FILES));
      }
    } finally {
      setIsExtractingSourceFiles(false);
    }
  };

  const handleGenerate = async () => {
    setIsGenerating(true);
    setError(null);
    try {
      const result = await generateIdeas(workspace.id, {
        goal,
        platform,
        funnelStage,
        selectionMode,
        manualFrameworkId: selectionMode === 'manual' ? manualFrameworkId : null,
        requestedIdeaCount: requestedCount,
        includeImages,
        imageCount: includeImages ? imageCount : 0,
        autoInsertToCalendar,
      });
      // The action returns a union; `in` narrows it to the success member.
      if ('error' in result && result.error) {
        setError(result.error);
      } else if ('ideas' in result && result.ideas) {
        setIdeas(
          result.ideas.map((idea) => ({
            ...idea,
            target_word_count: normalizedTargetWordCount,
          })),
        );
        setFrameworkMeta(result.framework || null);
        setQualityScores(result.qualityScores || null);
        setFallbackUsed(Boolean(result.fallbackUsed));
      }
    } catch (err) {
      setError(t('ideation.errors.unexpected'));
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in py-2 duration-500">
      <div className="rounded-2xl border border-rule bg-gradient-to-b from-chalk-sunk/50 to-chalk-raised p-8 text-center shadow-sm">
        <div className="mx-auto w-16 h-16 bg-chalk-raised rounded-2xl shadow-md border border-rule flex items-center justify-center mb-6">
          <Sparkles className="w-8 h-8 text-moss-700" />
        </div>
        <h2 className="text-2xl font-bold text-moss mb-3">{t('ideation.title')}</h2>
        <p className="text-moss-muted max-w-lg mx-auto mb-8 leading-relaxed">{t('ideation.lede')}</p>
        <p className="mx-auto mb-4 max-w-3xl rounded-xl border border-rule bg-chalk-sunk/70 px-4 py-2 text-xs font-semibold text-moss">
          {t('ideation.requiredInputs')}
        </p>
        <p className="mx-auto mb-4 max-w-3xl rounded-xl border border-rule bg-chalk-raised px-4 py-2 text-xs font-semibold text-moss">
          {t('ideation.targetWords', {
            count: normalizedTargetWordCount,
            platform: wordCountPlatformLabel(t, wordCountPlatform),
            min: wordCountRange.min,
            max: wordCountRange.max,
          })}
        </p>
        <div className="mx-auto mb-6 grid max-w-6xl gap-2 rounded-2xl border border-rule bg-chalk-raised/90 p-3 md:grid-cols-4 lg:grid-cols-8">
          <select
            value={goal}
            onChange={(event) => setGoal(event.target.value)}
            className="h-10 rounded-lg border border-rule-strong bg-chalk-raised px-2.5 text-xs font-semibold text-moss"
          >
            {CONTENT_GOAL_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {t('ideation.goalOption', { label: optionLabel(t, 'goals', option.value, option.label) })}
              </option>
            ))}
          </select>
          <select
            value={platform}
            onChange={(event) => setPlatform(event.target.value)}
            className="h-10 rounded-lg border border-rule-strong bg-chalk-raised px-2.5 text-xs font-semibold text-moss"
          >
            {CONTENT_PLATFORM_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {t('ideation.platformOption', { label: optionLabel(t, 'platforms', option.value, option.label) })}
              </option>
            ))}
          </select>
          <select
            value={funnelStage}
            onChange={(event) => setFunnelStage(event.target.value)}
            className="h-10 rounded-lg border border-rule-strong bg-chalk-raised px-2.5 text-xs font-semibold text-moss"
          >
            {FUNNEL_STAGE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {t('ideation.funnelOption', { label: optionLabel(t, 'funnel', option.value, option.label) })}
              </option>
            ))}
          </select>
          <select
            value={selectionMode}
            onChange={(event) => setSelectionMode(event.target.value as 'auto' | 'manual')}
            className="h-10 rounded-lg border border-rule-strong bg-chalk-raised px-2.5 text-xs font-semibold text-moss"
          >
            <option value="auto">{t('ideation.frameworkAuto')}</option>
            <option value="manual">{t('ideation.frameworkManual')}</option>
          </select>
          <select
            value={manualFrameworkId}
            onChange={(event) => setManualFrameworkId(event.target.value as FrameworkId)}
            disabled={selectionMode !== 'manual'}
            className="h-10 rounded-lg border border-rule-strong bg-chalk-raised px-2.5 text-xs font-semibold text-moss disabled:opacity-50"
          >
            {Object.entries(FRAMEWORK_LABELS).map(([id, label]) => (
              <option key={id} value={id}>
                {optionLabel(t, 'frameworks', id, label)}
              </option>
            ))}
          </select>
          <label className="flex h-10 items-center gap-2 rounded-lg border border-rule-strong bg-chalk-raised px-2.5 text-xs font-semibold text-moss">
            <span className="whitespace-nowrap">{t('ideation.ideasLabel')}</span>
            <input
              type="number"
              min={1}
              max={maxIdeaCount}
              value={requestedCount}
              onChange={(event) => {
                const next = Number(event.target.value);
                setRequestedCount(Math.max(1, Math.min(maxIdeaCount, Number.isFinite(next) ? next : 1)));
              }}
              className="w-full min-w-0 bg-transparent text-end outline-none"
            />
          </label>
          <label className="flex h-10 items-center gap-2 rounded-lg border border-rule-strong bg-chalk-raised px-2.5 text-xs font-semibold text-moss">
            <span className="whitespace-nowrap">{t('ideation.wordsLabel')}</span>
            <input
              type="number"
              min={wordCountRange.min}
              max={wordCountRange.max}
              value={targetWordCount}
              onChange={(event) => {
                const next = Number(event.target.value);
                setTargetWordCount(
                  clampWordCount(
                    next,
                    wordCountRange,
                    midpointWordCount(wordCountRange),
                  ),
                );
              }}
              className="w-full min-w-0 bg-transparent text-end outline-none"
            />
          </label>
          <label className="flex h-10 items-center justify-between rounded-lg border border-rule-strong bg-chalk-raised px-2.5 text-xs font-semibold text-moss">
            <span className="whitespace-nowrap">{t('ideation.needImagesLabel')}</span>
            <input
              type="checkbox"
              checked={includeImages}
              onChange={(event) => setIncludeImages(event.target.checked)}
              className="h-4 w-4"
            />
          </label>
          <label className="flex h-10 items-center gap-2 rounded-lg border border-rule-strong bg-chalk-raised px-2.5 text-xs font-semibold text-moss">
            <span className="whitespace-nowrap">{t('ideation.imagesLabel')}</span>
            <input
              type="number"
              min={1}
              max={maxImageCount}
              value={imageCount}
              disabled={!includeImages}
              onChange={(event) => {
                const next = Number(event.target.value);
                setImageCount(Math.max(1, Math.min(maxImageCount, Number.isFinite(next) ? next : 1)));
              }}
              className="w-full min-w-0 bg-transparent text-end outline-none disabled:opacity-50"
            />
          </label>
          <label className="flex h-10 items-center justify-between rounded-lg border border-rule-strong bg-chalk-raised px-2.5 text-xs font-semibold text-moss">
            <span className="whitespace-nowrap">{t('ideation.autoCalendarLabel')}</span>
            <input
              type="checkbox"
              checked={autoInsertToCalendar}
              onChange={(event) => setAutoInsertToCalendar(event.target.checked)}
              className="h-4 w-4"
            />
          </label>
        </div>
        <div className="mx-auto mb-6 w-full max-w-6xl rounded-2xl border border-rule bg-chalk-sunk/40 p-4 text-start">
          <p className="text-xs font-bold uppercase tracking-widest text-moss">{t('ideation.generationPath')}</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => setGenerationPath('direct')}
              className={`rounded-xl border px-3 py-2 text-sm font-bold transition ${
                generationPath === 'direct'
                  ? 'border-moss bg-moss text-chalk'
                  : 'border-rule bg-chalk-raised text-moss hover:bg-chalk-sunk'
              }`}
            >
              {t('ideation.directGenerate')}
            </button>
            <button
              type="button"
              onClick={() => setGenerationPath('source_form')}
              className={`rounded-xl border px-3 py-2 text-sm font-bold transition ${
                generationPath === 'source_form'
                  ? 'border-moss bg-moss text-chalk'
                  : 'border-rule bg-chalk-raised text-moss hover:bg-chalk-sunk'
              }`}
            >
              {t('ideation.sourceFormGenerate')}
            </button>
          </div>

          {generationPath === 'source_form' ? (
            <div className="mt-3 space-y-3">
              <textarea
                value={manualSourceNotes}
                onChange={(event) => setManualSourceNotes(event.target.value)}
                placeholder={t('ideation.sourcePlaceholder')}
                className="h-24 w-full rounded-lg border border-rule bg-chalk-raised px-3 py-2 text-sm text-moss outline-none ring-saffron focus:ring-2"
              />
              <label className="flex cursor-pointer items-center justify-between rounded-lg border border-dashed border-rule-strong bg-chalk-raised px-3 py-2 text-xs font-semibold text-moss hover:bg-chalk-sunk">
                <span className="inline-flex items-center gap-2">
                  <Paperclip className="h-3.5 w-3.5" />
                  {t('common.attachFiles')}
                </span>
                <span>{t('common.maxFiles', { count: MAX_MANUAL_SOURCE_FILES })}</span>
                <input
                  type="file"
                  accept=".pdf,.txt,.md,.csv,.json,text/plain,application/pdf"
                  multiple
                  onChange={handleSourceFilesSelected}
                  className="hidden"
                />
              </label>
              {isExtractingSourceFiles ? (
                <p className="text-xs font-medium text-moss-700">{t('common.extracting')}</p>
              ) : null}
              {manualSourceError ? <p className="text-xs font-medium text-red-600">{manualSourceError}</p> : null}
              {manualSourceFiles.length > 0 ? (
                <div className="space-y-2">
                  {manualSourceFiles.map((file) => (
                    <div
                      key={`${file.name}-${file.size}`}
                      className="flex items-center justify-between rounded-lg border border-rule bg-chalk-raised px-3 py-2"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-xs font-semibold text-moss">{file.name}</p>
                        <p className="text-[11px] text-moss-muted">
                          {t('common.tokensApprox', {
                            count: Math.max(1, Math.round(file.extractedText.length / 4)),
                          })}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          setManualSourceFiles((prev) =>
                            prev.filter((entry) => !(entry.name === file.name && entry.size === file.size)),
                          )
                        }
                        className="rounded-md px-2 py-1 text-[11px] font-bold text-red-600 hover:bg-red-50"
                      >
                        {t('common.remove')}
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}
              <p className="text-[11px] text-moss-muted">{t('ideation.sourceNote')}</p>
            </div>
          ) : (
            <p className="mt-3 text-xs text-moss-muted">{t('ideation.directNote')}</p>
          )}
        </div>
        <button
          onClick={handleGenerate}
          disabled={isGenerating}
          className="inline-flex items-center gap-2 bg-moss text-chalk px-8 py-3.5 rounded-xl font-bold shadow-lg hover:bg-moss hover:scale-[1.02] transition-all disabled:opacity-50 disabled:pointer-events-none"
        >
          {isGenerating ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin" />
              {t('ideation.brainstorming')}
            </>
          ) : (
            <>
              <Sparkles className="w-5 h-5" />
              {t('ideation.generateCta', { count: requestedCount })}
            </>
          )}
        </button>
        {error && <p className="mt-4 text-sm text-red-600 font-medium">{error}</p>}
      </div>

      {frameworkMeta && qualityScores ? (
        <div className="rounded-2xl border border-rule bg-chalk-raised p-4 shadow-sm">
          <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-moss-muted">{t('ideation.selectedFramework')}</p>
              <p className="mt-1 text-base font-bold text-moss">{frameworkMeta.framework_name}</p>
              <p className="mt-1 text-sm text-moss-muted">{frameworkMeta.selection_reason}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <span className="inline-flex items-center rounded-full bg-chalk-sunk px-3 py-1 text-xs font-bold text-moss-700">
                {t('ideation.overallScore', {
                  score: format.number(Number(qualityScores.overall_score || 0), {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  }),
                })}
              </span>
              {fallbackUsed ? (
                <span className="inline-flex items-center rounded-full bg-amber-50 px-3 py-1 text-xs font-bold text-amber-700">
                  {t('ideation.fallbackApplied')}
                </span>
              ) : null}
              <span className="inline-flex items-center rounded-full bg-chalk-sunk px-3 py-1 text-xs font-bold text-moss">
                {includeImages
                  ? t('ideation.imagesBadge', { count: imageCount })
                  : t('ideation.imagesBadgeNone')}
              </span>
              <span className="inline-flex items-center rounded-full bg-chalk-sunk px-3 py-1 text-xs font-bold text-moss">
                {autoInsertToCalendar ? t('ideation.calendarAuto') : t('ideation.calendarManual')}
              </span>
              <span className="inline-flex items-center rounded-full bg-chalk-sunk px-3 py-1 text-xs font-bold text-moss">
                {t('ideation.wordsBadge', { count: normalizedTargetWordCount })}
              </span>
            </div>
          </div>
        </div>
      ) : null}

      {ideas.length > 0 && (
        <div className="space-y-4">
          <h3 className="text-lg font-bold text-moss px-1">
            {t('ideation.freshIdeas')}{' '}
            <span className="text-sm text-moss-muted font-normal ms-2">
              {t('ideation.freshIdeasCount', { count: ideas.length })}
            </span>
          </h3>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {ideas.map((idea, idx) => (
              <IdeaCard
                key={idx}
                idea={idea}
                workspaceId={workspace.id}
                sourceMode={generationPath}
                manualSourcePayload={
                  generationPath === 'source_form'
                    ? {
                        notes: manualSourceNotes,
                        extractedText: extractedFilesText,
                        files: manualSourceFiles.map((file) => ({
                          name: file.name,
                          type: file.type,
                          size: file.size,
                        })),
                        targetWordCount: normalizedTargetWordCount,
                      }
                    : null
                }
                targetWordCount={normalizedTargetWordCount}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function IdeaCard({
  idea,
  workspaceId,
  sourceMode,
  manualSourcePayload,
  targetWordCount,
}: {
  idea: any;
  workspaceId: string;
  sourceMode: 'direct' | 'source_form';
  manualSourcePayload: {
    notes: string;
    extractedText: string;
    files: Array<{ name: string; type: string; size: number }>;
    targetWordCount: number;
  } | null;
  targetWordCount: number;
}) {
  const t = useTranslations('tabsA');
  const router = useRouter();
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewText, setPreviewText] = useState<string>('');
  const [previewChannel, setPreviewChannel] = useState<string>('');
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);

  const handleGeneratePreview = async () => {
    setPreviewError(null);
    setIsPreviewing(true);
    try {
      const result = await generateDraftPreviewFromIdea(
        workspaceId,
        idea,
        sourceMode === 'source_form' && manualSourcePayload
          ? manualSourcePayload
          : { targetWordCount },
      );

      if (result && 'error' in result && result.error) {
        setPreviewError(result.error);
        return;
      }

      if (result && 'success' in result && result.success) {
        setPreviewText(String(result.preview || ''));
        setPreviewChannel(String(result.channel || idea?.format || ''));
        setIsPreviewOpen(true);
      }
    } catch {
      setPreviewError(t('ideation.errors.previewFailed'));
    } finally {
      setIsPreviewing(false);
    }
  };

  const handleSaveToPipeline = async () => {
    setIsSaving(true);
    try {
      const res = await saveIdeaToPipeline(workspaceId, idea);
      if (res && 'success' in res && res.success) {
        setSaved(true);
        router.refresh();
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="group relative flex flex-col rounded-2xl border border-rule bg-chalk-raised p-5 shadow-sm hover:border-rule-strong hover:shadow-md transition-all">
      <div className="flex items-center gap-2 mb-3">
        <span className="inline-flex items-center rounded-full bg-chalk-sunk px-2.5 py-1 text-[10px] font-bold tracking-widest text-moss uppercase">
          {idea.format || t('ideation.formatFallback')}
        </span>
        <span className="inline-flex items-center rounded-full bg-chalk-sunk px-2.5 py-1 text-[10px] font-bold tracking-widest text-moss-muted uppercase">
          {idea.pillar || t('ideation.pillarFallback')}
        </span>
        {idea.framework_name ? (
          <span className="inline-flex items-center rounded-full bg-chalk-sunk px-2.5 py-1 text-[10px] font-bold tracking-widest text-moss-700 uppercase">
            {idea.framework_name}
          </span>
        ) : null}
        {idea.include_images ? (
          <span className="inline-flex items-center rounded-full bg-chalk-sunk px-2.5 py-1 text-[10px] font-bold tracking-widest text-moss uppercase">
            {t('ideation.imagesCount', { count: idea.image_count || 1 })}
          </span>
        ) : null}
        {Number(idea?.target_word_count) > 0 ? (
          <span className="inline-flex items-center rounded-full bg-chalk-sunk px-2.5 py-1 text-[10px] font-bold tracking-widest text-moss uppercase">
            {t('ideation.wordsCount', { count: Math.floor(Number(idea.target_word_count)) })}
          </span>
        ) : null}
      </div>
      
      <h3 className="font-bold text-moss leading-snug mb-2">
        {idea.topic}
      </h3>
      <p className="text-sm text-moss-muted mb-6 flex-1 line-clamp-3">
        {idea.angle}
      </p>

      {previewError ? <p className="mb-3 text-xs font-medium text-red-600">{previewError}</p> : null}

      <div className="pt-4 border-t border-rule mt-auto space-y-2">
        <button
          onClick={handleGeneratePreview}
          disabled={isPreviewing}
          className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-moss py-2.5 text-xs font-bold text-chalk transition-all hover:bg-moss-700 disabled:opacity-50"
        >
          {isPreviewing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
          {isPreviewing ? t('ideation.generatingPreview') : t('ideation.generatePreview')}
        </button>
        <button
          onClick={handleSaveToPipeline}
          disabled={isSaving || saved}
          className={`w-full inline-flex items-center justify-center gap-2 rounded-xl py-2.5 text-xs font-bold transition-all
            ${saved ? 'bg-chalk-sunk text-moss-700' : 'bg-moss text-chalk hover:bg-moss'}`}
        >
          {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : 
           saved ? <><CheckCircle2 className="w-4 h-4" /> {t('ideation.addedToPipeline')}</> : 
           <><FileText className="w-4 h-4" /> {t('ideation.addToPipeline')}</>}
        </button>
      </div>

      {isPreviewOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-moss/50 p-4">
          <div className="w-full max-w-2xl rounded-2xl border border-rule bg-chalk-raised shadow-2xl">
            <div className="flex items-center justify-between border-b border-rule px-5 py-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-widest text-moss-muted">{t('ideation.contentPreview')}</p>
                <h4 className="text-base font-bold text-moss">{idea.topic}</h4>
              </div>
              <button
                onClick={() => setIsPreviewOpen(false)}
                className="rounded-lg p-2 text-moss-muted transition-colors hover:bg-chalk-sunk hover:text-moss"
                aria-label={t('ideation.closePreview')}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="max-h-[65vh] overflow-y-auto px-5 py-4">
              <div className="mb-3 inline-flex items-center rounded-full bg-chalk-sunk px-3 py-1 text-[11px] font-bold uppercase tracking-widest text-moss-muted">
                {String(previewChannel || idea.format || t('ideation.channelFallback'))}
              </div>
              <p className="whitespace-pre-wrap text-sm leading-7 text-moss">
                {previewText || t('ideation.noPreview')}
              </p>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
