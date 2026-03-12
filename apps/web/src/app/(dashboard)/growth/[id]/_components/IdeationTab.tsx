'use client';

import { useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { Workspace } from '@prisma/client';
import { Sparkles, Loader2, FileText, CheckCircle2, Paperclip, X } from 'lucide-react';
import { generateIdeas, saveIdeaToPipeline, generateDraftPreviewFromIdea } from '@/app/actions/workspace';
import { useRouter } from 'next/navigation';
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
  workspace: Workspace;
  maxIdeaCount: number;
  maxImageCount: number;
  wordCountLimits: ContentWordCountLimits;
}) {
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
      setManualSourceError(`You can attach up to ${MAX_MANUAL_SOURCE_FILES} files.`);
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
          setManualSourceError(
            `Failed to read "${file.name}". Use PDF/TXT/MD/CSV/JSON files or paste text manually.`,
          );
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
      if (result.error) {
        setError(result.error);
      } else if (result.ideas) {
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
      setError('An unexpected error occurred while brainstorming.');
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in py-2 duration-500">
      <div className="rounded-2xl border border-indigo-100 bg-gradient-to-b from-indigo-50/50 to-white p-8 text-center shadow-sm">
        <div className="mx-auto w-16 h-16 bg-white rounded-2xl shadow-md border border-indigo-100 flex items-center justify-center mb-6">
          <Sparkles className="w-8 h-8 text-indigo-600" />
        </div>
        <h2 className="text-2xl font-bold text-[#121212] mb-3">Ideation Station</h2>
        <p className="text-gray-500 max-w-lg mx-auto mb-8 leading-relaxed">
          Generate high-performing content ideas tailored to your audience and brand pillars. We strictly use Brand Memory, Market Metric, and Competitor Keywords as required context.
        </p>
        <p className="mx-auto mb-4 max-w-3xl rounded-xl border border-indigo-100 bg-indigo-50/70 px-4 py-2 text-xs font-semibold text-indigo-700">
          Required inputs for ideation: Brand Memory + Market Metric + Competitor Keywords.
        </p>
        <p className="mx-auto mb-4 max-w-3xl rounded-xl border border-gray-200 bg-white px-4 py-2 text-xs font-semibold text-gray-700">
          Target words: {normalizedTargetWordCount} ({WORD_COUNT_PLATFORM_LABELS[wordCountPlatform]} range {wordCountRange.min}-{wordCountRange.max})
        </p>
        <div className="mx-auto mb-6 grid max-w-6xl gap-2 rounded-2xl border border-gray-200 bg-white/90 p-3 md:grid-cols-4 lg:grid-cols-8">
          <select
            value={goal}
            onChange={(event) => setGoal(event.target.value)}
            className="h-10 rounded-lg border border-gray-300 bg-white px-2.5 text-xs font-semibold text-gray-700"
          >
            {CONTENT_GOAL_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                Goal: {option.label}
              </option>
            ))}
          </select>
          <select
            value={platform}
            onChange={(event) => setPlatform(event.target.value)}
            className="h-10 rounded-lg border border-gray-300 bg-white px-2.5 text-xs font-semibold text-gray-700"
          >
            {CONTENT_PLATFORM_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                Platform: {option.label}
              </option>
            ))}
          </select>
          <select
            value={funnelStage}
            onChange={(event) => setFunnelStage(event.target.value)}
            className="h-10 rounded-lg border border-gray-300 bg-white px-2.5 text-xs font-semibold text-gray-700"
          >
            {FUNNEL_STAGE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                Funnel: {option.label}
              </option>
            ))}
          </select>
          <select
            value={selectionMode}
            onChange={(event) => setSelectionMode(event.target.value as 'auto' | 'manual')}
            className="h-10 rounded-lg border border-gray-300 bg-white px-2.5 text-xs font-semibold text-gray-700"
          >
            <option value="auto">Framework: Auto</option>
            <option value="manual">Framework: Manual</option>
          </select>
          <select
            value={manualFrameworkId}
            onChange={(event) => setManualFrameworkId(event.target.value as FrameworkId)}
            disabled={selectionMode !== 'manual'}
            className="h-10 rounded-lg border border-gray-300 bg-white px-2.5 text-xs font-semibold text-gray-700 disabled:opacity-50"
          >
            {Object.entries(FRAMEWORK_LABELS).map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
          <label className="flex h-10 items-center gap-2 rounded-lg border border-gray-300 bg-white px-2.5 text-xs font-semibold text-gray-700">
            <span className="whitespace-nowrap">Ideas</span>
            <input
              type="number"
              min={1}
              max={maxIdeaCount}
              value={requestedCount}
              onChange={(event) => {
                const next = Number(event.target.value);
                setRequestedCount(Math.max(1, Math.min(maxIdeaCount, Number.isFinite(next) ? next : 1)));
              }}
              className="w-full min-w-0 bg-transparent text-right outline-none"
            />
          </label>
          <label className="flex h-10 items-center gap-2 rounded-lg border border-gray-300 bg-white px-2.5 text-xs font-semibold text-gray-700">
            <span className="whitespace-nowrap">Words</span>
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
              className="w-full min-w-0 bg-transparent text-right outline-none"
            />
          </label>
          <label className="flex h-10 items-center justify-between rounded-lg border border-gray-300 bg-white px-2.5 text-xs font-semibold text-gray-700">
            <span className="whitespace-nowrap">Need Images</span>
            <input
              type="checkbox"
              checked={includeImages}
              onChange={(event) => setIncludeImages(event.target.checked)}
              className="h-4 w-4"
            />
          </label>
          <label className="flex h-10 items-center gap-2 rounded-lg border border-gray-300 bg-white px-2.5 text-xs font-semibold text-gray-700">
            <span className="whitespace-nowrap">Images</span>
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
              className="w-full min-w-0 bg-transparent text-right outline-none disabled:opacity-50"
            />
          </label>
          <label className="flex h-10 items-center justify-between rounded-lg border border-gray-300 bg-white px-2.5 text-xs font-semibold text-gray-700">
            <span className="whitespace-nowrap">Auto Calendar</span>
            <input
              type="checkbox"
              checked={autoInsertToCalendar}
              onChange={(event) => setAutoInsertToCalendar(event.target.checked)}
              className="h-4 w-4"
            />
          </label>
        </div>
        <div className="mx-auto mb-6 w-full max-w-6xl rounded-2xl border border-indigo-100 bg-indigo-50/40 p-4 text-left">
          <p className="text-xs font-bold uppercase tracking-widest text-indigo-700">Generation Path</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => setGenerationPath('direct')}
              className={`rounded-xl border px-3 py-2 text-sm font-bold transition ${
                generationPath === 'direct'
                  ? 'border-[#121212] bg-[#121212] text-white'
                  : 'border-indigo-100 bg-white text-indigo-700 hover:bg-indigo-50'
              }`}
            >
              Direct Generate
            </button>
            <button
              type="button"
              onClick={() => setGenerationPath('source_form')}
              className={`rounded-xl border px-3 py-2 text-sm font-bold transition ${
                generationPath === 'source_form'
                  ? 'border-[#121212] bg-[#121212] text-white'
                  : 'border-indigo-100 bg-white text-indigo-700 hover:bg-indigo-50'
              }`}
            >
              Generate With Source Form
            </button>
          </div>

          {generationPath === 'source_form' ? (
            <div className="mt-3 space-y-3">
              <textarea
                value={manualSourceNotes}
                onChange={(event) => setManualSourceNotes(event.target.value)}
                placeholder="Paste your notes, document summary, script, or key ideas..."
                className="h-24 w-full rounded-lg border border-indigo-100 bg-white px-3 py-2 text-sm text-gray-700 outline-none ring-indigo-500 focus:ring-2"
              />
              <label className="flex cursor-pointer items-center justify-between rounded-lg border border-dashed border-indigo-200 bg-white px-3 py-2 text-xs font-semibold text-indigo-700 hover:bg-indigo-50">
                <span className="inline-flex items-center gap-2">
                  <Paperclip className="h-3.5 w-3.5" />
                  Attach files (PDF/TXT/MD/CSV/JSON)
                </span>
                <span>Max {MAX_MANUAL_SOURCE_FILES}</span>
                <input
                  type="file"
                  accept=".pdf,.txt,.md,.csv,.json,text/plain,application/pdf"
                  multiple
                  onChange={handleSourceFilesSelected}
                  className="hidden"
                />
              </label>
              {isExtractingSourceFiles ? (
                <p className="text-xs font-medium text-indigo-600">Extracting text from attached files...</p>
              ) : null}
              {manualSourceError ? <p className="text-xs font-medium text-red-600">{manualSourceError}</p> : null}
              {manualSourceFiles.length > 0 ? (
                <div className="space-y-2">
                  {manualSourceFiles.map((file) => (
                    <div
                      key={`${file.name}-${file.size}`}
                      className="flex items-center justify-between rounded-lg border border-indigo-100 bg-white px-3 py-2"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-xs font-semibold text-gray-700">{file.name}</p>
                        <p className="text-[11px] text-gray-500">
                          {Math.max(1, Math.round(file.extractedText.length / 4))} tokens approx extracted
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
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}
              <p className="text-[11px] text-gray-500">
                This source form is global and will be used for all generated previews in this ideation run.
              </p>
            </div>
          ) : (
            <p className="mt-3 text-xs text-gray-600">
              Direct mode: generate content ideas without manual source context.
            </p>
          )}
        </div>
        <button
          onClick={handleGenerate}
          disabled={isGenerating}
          className="inline-flex items-center gap-2 bg-[#121212] text-white px-8 py-3.5 rounded-xl font-bold shadow-lg hover:bg-black hover:scale-[1.02] transition-all disabled:opacity-50 disabled:pointer-events-none"
        >
          {isGenerating ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin" />
              Brainstorming with AI...
            </>
          ) : (
            <>
              <Sparkles className="w-5 h-5" />
              Generate {requestedCount} Content Idea{requestedCount > 1 ? 's' : ''}
            </>
          )}
        </button>
        {error && <p className="mt-4 text-sm text-red-600 font-medium">{error}</p>}
      </div>

      {frameworkMeta && qualityScores ? (
        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-gray-500">Selected Framework</p>
              <p className="mt-1 text-base font-bold text-[#121212]">{frameworkMeta.framework_name}</p>
              <p className="mt-1 text-sm text-gray-600">{frameworkMeta.selection_reason}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <span className="inline-flex items-center rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">
                Overall Score: {Number(qualityScores.overall_score || 0).toFixed(2)}/10
              </span>
              {fallbackUsed ? (
                <span className="inline-flex items-center rounded-full bg-amber-50 px-3 py-1 text-xs font-bold text-amber-700">
                  Fallback applied
                </span>
              ) : null}
              <span className="inline-flex items-center rounded-full bg-indigo-50 px-3 py-1 text-xs font-bold text-indigo-700">
                Images: {includeImages ? `${imageCount} (1st = cover)` : 'No'}
              </span>
              <span className="inline-flex items-center rounded-full bg-gray-100 px-3 py-1 text-xs font-bold text-gray-700">
                Calendar: {autoInsertToCalendar ? 'Auto insert (mock)' : 'Manual'}
              </span>
              <span className="inline-flex items-center rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-700">
                Words: {normalizedTargetWordCount}
              </span>
            </div>
          </div>
        </div>
      ) : null}

      {ideas.length > 0 && (
        <div className="space-y-4">
          <h3 className="text-lg font-bold text-[#121212] px-1">Fresh Ideas Generated <span className="text-sm text-gray-400 font-normal ml-2">({ideas.length})</span></h3>
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

      if (result?.error) {
        setPreviewError(result.error);
        return;
      }

      if (result?.success) {
        setPreviewText(String(result.preview || ''));
        setPreviewChannel(String(result.channel || idea?.format || ''));
        setIsPreviewOpen(true);
      }
    } catch {
      setPreviewError('Failed to generate preview.');
    } finally {
      setIsPreviewing(false);
    }
  };

  const handleSaveToPipeline = async () => {
    setIsSaving(true);
    try {
      const res = await saveIdeaToPipeline(workspaceId, idea);
      if (res?.success) {
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
    <div className="group relative flex flex-col rounded-2xl border border-gray-200 bg-white p-5 shadow-sm hover:border-indigo-300 hover:shadow-md transition-all">
      <div className="flex items-center gap-2 mb-3">
        <span className="inline-flex items-center rounded-full bg-indigo-50 px-2.5 py-1 text-[10px] font-bold tracking-widest text-indigo-700 uppercase">
          {idea.format || 'Article'}
        </span>
        <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-1 text-[10px] font-bold tracking-widest text-gray-600 uppercase">
          {idea.pillar || 'General'}
        </span>
        {idea.framework_name ? (
          <span className="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-bold tracking-widest text-emerald-700 uppercase">
            {idea.framework_name}
          </span>
        ) : null}
        {idea.include_images ? (
          <span className="inline-flex items-center rounded-full bg-indigo-50 px-2.5 py-1 text-[10px] font-bold tracking-widest text-indigo-700 uppercase">
            {idea.image_count || 1} images
          </span>
        ) : null}
        {Number(idea?.target_word_count) > 0 ? (
          <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-bold tracking-widest text-slate-700 uppercase">
            {Math.floor(Number(idea.target_word_count))} words
          </span>
        ) : null}
      </div>
      
      <h3 className="font-bold text-[#121212] leading-snug mb-2">
        {idea.topic}
      </h3>
      <p className="text-sm text-gray-500 mb-6 flex-1 line-clamp-3">
        {idea.angle}
      </p>

      {previewError ? <p className="mb-3 text-xs font-medium text-red-600">{previewError}</p> : null}

      <div className="pt-4 border-t border-gray-100 mt-auto space-y-2">
        <button
          onClick={handleGeneratePreview}
          disabled={isPreviewing}
          className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 py-2.5 text-xs font-bold text-white transition-all hover:bg-indigo-700 disabled:opacity-50"
        >
          {isPreviewing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
          {isPreviewing ? 'Generating Preview...' : 'Generate Preview'}
        </button>
        <button
          onClick={handleSaveToPipeline}
          disabled={isSaving || saved}
          className={`w-full inline-flex items-center justify-center gap-2 rounded-xl py-2.5 text-xs font-bold transition-all
            ${saved ? 'bg-emerald-50 text-emerald-700' : 'bg-[#121212] text-white hover:bg-black'}`}
        >
          {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : 
           saved ? <><CheckCircle2 className="w-4 h-4" /> Added to Pipeline</> : 
           <><FileText className="w-4 h-4" /> Add to Pipeline</>}
        </button>
      </div>

      {isPreviewOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-2xl rounded-2xl border border-gray-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-widest text-gray-500">Content Preview</p>
                <h4 className="text-base font-bold text-[#121212]">{idea.topic}</h4>
              </div>
              <button
                onClick={() => setIsPreviewOpen(false)}
                className="rounded-lg p-2 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900"
                aria-label="Close preview"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="max-h-[65vh] overflow-y-auto px-5 py-4">
              <div className="mb-3 inline-flex items-center rounded-full bg-gray-100 px-3 py-1 text-[11px] font-bold uppercase tracking-widest text-gray-600">
                {String(previewChannel || idea.format || 'Content')}
              </div>
              <p className="whitespace-pre-wrap text-sm leading-7 text-gray-800">
                {previewText || 'No preview content available yet.'}
              </p>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
