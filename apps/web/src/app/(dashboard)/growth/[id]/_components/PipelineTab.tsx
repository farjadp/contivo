'use client';

import { Workspace, ContentItem } from '@prisma/client';
import { FileText, MoreHorizontal, Calendar, FilePenLine, Loader2, Sparkles, X, Paperclip, Send, Save } from 'lucide-react';
import { updateContentStatus, scheduleContentItem, updateContentAndSchedule } from '@/app/actions/calendar';
import Link from 'next/link';
import { useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { generatePostFromPipeline } from '@/app/actions/workspace';
import { useRouter } from 'next/navigation';
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
const DEFAULT_FIRST_PUBLISH_DELAY_HOURS = 4;

function trimTo(value: string, max: number): string {
  return value.slice(0, max);
}

function cleanText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function toDateInputValue(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function toTimeInputValue(value: Date): string {
  const hours = String(value.getHours()).padStart(2, '0');
  const minutes = String(value.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

function buildDefaultPublishBaseDate(): Date {
  return new Date(Date.now() + DEFAULT_FIRST_PUBLISH_DELAY_HOURS * 60 * 60 * 1000);
}

function parseTargetWordCountFromContent(content: string | null | undefined): number | null {
  const match = String(content || '').match(/(?:^|\n)TARGET_WORD_COUNT:\s*(\d+)\s*(?:\n|$)/i);
  if (!match) return null;
  const parsed = Number(match[1]);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.floor(parsed);
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

  if (isPdf) {
    return extractTextFromPdf(file);
  }

  if (isTextLike) {
    return file.text();
  }

  throw new Error('Unsupported file type. Use PDF/TXT/MD/CSV/JSON.');
}

export function PipelineTab({
  workspace,
  items,
  wordCountLimits,
}: {
  workspace: Workspace;
  items: ContentItem[];
  wordCountLimits: ContentWordCountLimits;
}) {
  if (items.length === 0) {
    return (
      <div className="rounded-2xl border-2 border-dashed border-gray-200 bg-white flex flex-col items-center justify-center p-16 text-center animate-in fade-in slide-in-from-bottom-4 duration-500">
        <div className="w-12 h-12 bg-gray-100 rounded-xl flex items-center justify-center mb-4 text-gray-400">
           <FilePenLine className="w-6 h-6" />
        </div>
        <h2 className="text-lg font-bold text-[#121212] mb-1">Your pipeline is empty</h2>
        <p className="text-sm text-gray-500 max-w-sm mb-6 leading-relaxed">
          You haven't generated any content for this brand yet. Head over to the Ideation Station to get started.
        </p>
        <Link
          href={`/growth/${workspace.id}?tab=ideation`}
          className="inline-flex items-center gap-2 bg-[#121212] text-white px-5 py-2.5 rounded-xl text-sm font-bold shadow-lg hover:bg-black hover:scale-[1.02] transition-all"
        >
          <LightbulbIcon className="w-4 h-4 text-yellow-500" />
          Go to Ideation
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4 animate-in fade-in py-2">
       {/* Future Kanban board could go here, for now using a clean list */}
       <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map(item => (
            <PipelineItemCard
              key={item.id}
              item={item}
              workspace={workspace}
              wordCountLimits={wordCountLimits}
            />
          ))}
       </div>
    </div>
  );
}

function PipelineItemCard({
  item,
  workspace,
  wordCountLimits,
}: {
  item: ContentItem;
  workspace: Workspace;
  wordCountLimits: ContentWordCountLimits;
}) {
  const router = useRouter();
  const [currentItem, setCurrentItem] = useState(item);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [editContentText, setEditContentText] = useState('');
  const [isSavingEdits, setIsSavingEdits] = useState(false);
  const [showManualSource, setShowManualSource] = useState(true);
  const [manualSourceNotes, setManualSourceNotes] = useState('');
  const [manualSourceFiles, setManualSourceFiles] = useState<SourceFileState[]>([]);
  const [isExtractingSourceFiles, setIsExtractingSourceFiles] = useState(false);
  const [manualSourceError, setManualSourceError] = useState<string | null>(null);
  const wordCountPlatform = useMemo(
    () => resolveWordCountPlatformKey(currentItem.channel),
    [currentItem.channel],
  );
  const wordCountRange = wordCountLimits[wordCountPlatform];
  const [targetWordCount, setTargetWordCount] = useState<number>(() =>
    clampWordCount(
      parseTargetWordCountFromContent(item.content),
      wordCountRange,
      midpointWordCount(wordCountRange),
    ),
  );
  const normalizedTargetWordCount = clampWordCount(
    targetWordCount,
    wordCountRange,
    midpointWordCount(wordCountRange),
  );

  useEffect(() => {
    setTargetWordCount((prev) =>
      clampWordCount(
        parseTargetWordCountFromContent(currentItem.content) ?? prev,
        wordCountRange,
        midpointWordCount(wordCountRange),
      ),
    );
  }, [currentItem.content, wordCountRange.min, wordCountRange.max]);

  // Scheduling State
  const [isScheduleModalOpen, setIsScheduleModalOpen] = useState(false);
  const [publishDate, setPublishDate] = useState('');
  const [publishTime, setPublishTime] = useState('');
  const [publishTimezone, setPublishTimezone] = useState(
    Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Toronto'
  );
  const [hasCustomSchedule, setHasCustomSchedule] = useState(false);
  const [isScheduling, setIsScheduling] = useState(false);

  useEffect(() => {
    const base = currentItem.scheduledAtUtc
      ? new Date(currentItem.scheduledAtUtc)
      : buildDefaultPublishBaseDate();
    setPublishDate(toDateInputValue(base));
    setPublishTime(toTimeInputValue(base));
    setHasCustomSchedule(false);
  }, [currentItem.id, currentItem.scheduledAtUtc]);

  const openEditorModal = () => {
    setEditContentText(currentItem.content || '');
    if (currentItem.scheduledAtUtc) {
      const base = new Date(currentItem.scheduledAtUtc);
      setPublishDate(toDateInputValue(base));
      setPublishTime(toTimeInputValue(base));
      setHasCustomSchedule(true);
    } else {
      const base = buildDefaultPublishBaseDate();
      setPublishDate(toDateInputValue(base));
      setPublishTime(toTimeInputValue(base));
      setHasCustomSchedule(false);
    }
    setIsPreviewOpen(true);
  };

  const openScheduleModal = () => {
    const base = currentItem.scheduledAtUtc
      ? new Date(currentItem.scheduledAtUtc)
      : buildDefaultPublishBaseDate();
    setPublishDate(toDateInputValue(base));
    setPublishTime(toTimeInputValue(base));
    setHasCustomSchedule(true);
    setIsScheduleModalOpen(true);
  };

  const handleSaveEdits = async () => {
    setIsSavingEdits(true);
    try {
      const updated = await updateContentAndSchedule({
        contentId: currentItem.id,
        content: editContentText,
        platform: currentItem.channel,
        publishDate,
        publishTime,
        timezone: publishTimezone,
      });
      setCurrentItem(updated);
      setIsPreviewOpen(false);
      if (updated.status === 'SCHEDULED') {
        router.push(`/growth/${workspace.id}/calendar`);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsSavingEdits(false);
    }
  };

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
        } catch (error) {
          setManualSourceError(
            `Failed to read "${file.name}". Use PDF/TXT/MD/CSV/JSON files or paste the text manually.`,
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
    try {
      const res = await generatePostFromPipeline(workspace.id, item.id, {
        notes: manualSourceNotes,
        extractedText: extractedFilesText,
        files: manualSourceFiles.map((file) => ({
          name: file.name,
          type: file.type,
          size: file.size,
        })),
        timezone: publishTimezone,
        targetWordCount: normalizedTargetWordCount,
        publishDate: hasCustomSchedule ? publishDate : undefined,
        publishTime: hasCustomSchedule ? publishTime : undefined,
      });
      if (res?.success) {
        if (res.item) {
          setCurrentItem(res.item);
          setEditContentText(res.item.content || '');
          setIsPreviewOpen(true);
        }
      } else {
        console.error(res?.error);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleApprove = async () => {
    try {
      const updated = await updateContentStatus(currentItem.id, 'READY');
      setCurrentItem(updated);
    } catch (e) {
      console.error(e);
    }
  };

  const handleScheduleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!publishDate || !publishTime) return;
    setIsScheduling(true);
    try {
      const updated = await scheduleContentItem({
        contentId: currentItem.id,
        platform: currentItem.channel,
        publishDate,
        publishTime,
        timezone: publishTimezone,
      });
      setCurrentItem(updated);
      setIsScheduleModalOpen(false);
      router.push(`/growth/${workspace.id}/calendar`);
    } catch (e) {
      console.error('Failed to schedule', e);
    } finally {
      setIsScheduling(false);
    }
  };

  const handleQuickScheduleApply = async () => {
    if (!publishDate || !publishTime) return;
    setIsScheduling(true);
    try {
      const updated = await scheduleContentItem({
        contentId: currentItem.id,
        platform: currentItem.channel,
        publishDate,
        publishTime,
        timezone: publishTimezone,
      });
      setCurrentItem(updated);
      setHasCustomSchedule(false);
      router.push(`/growth/${workspace.id}/calendar`);
    } catch (e) {
      console.error('Failed to apply quick schedule', e);
    } finally {
      setIsScheduling(false);
    }
  };

  return (
    <>
     <div className="group relative flex flex-col rounded-2xl border border-gray-200 bg-white p-5 shadow-sm hover:border-[#121212] transition-colors">
        <div className="flex items-start justify-between mb-3">
          <div className={`inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-bold tracking-widest uppercase
            ${currentItem.status === 'GENERATED' ? 'bg-emerald-50 text-emerald-600' 
            : currentItem.status === 'SCHEDULED' ? 'bg-indigo-50 text-indigo-600'
            : currentItem.status === 'READY' ? 'bg-blue-50 text-blue-600'
            : 'bg-amber-50 text-amber-600'}`}>
            {currentItem.status}
          </div>
         <button className="text-gray-400 hover:text-[#121212] transition-colors">
           <MoreHorizontal className="w-5 h-5" />
         </button>
       </div>
       
       <h3 className="font-bold text-gray-900 leading-snug mb-2 line-clamp-2" title={item.topic}>
          {item.topic}
       </h3>
       
       <div className="flex flex-wrap gap-2 mb-4 mt-auto">
         <span className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-500">
           <FileText className="w-3.5 h-3.5" /> {currentItem.channel.replace(/_/g, ' ')}
         </span>
         <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600">
           {normalizedTargetWordCount} words target
         </span>
       </div>

       {['GENERATED', 'READY', 'SCHEDULED'].includes(currentItem.status) ? (
          <div className="mb-4 rounded-xl border border-emerald-100 bg-emerald-50/70 p-3">
            <p className="text-[11px] font-bold uppercase tracking-widest text-emerald-700 mb-1">Preview</p>
            <p className="text-sm leading-relaxed text-gray-700 line-clamp-4 whitespace-pre-wrap">
              {String(currentItem.content || '').slice(0, 280)}
            </p>
            {currentItem.scheduledAtUtc ? (
              <p className="mt-2 text-[11px] font-semibold text-indigo-700">
                Publish: {new Date(currentItem.scheduledAtUtc).toLocaleDateString()} {' '}
                {new Date(currentItem.scheduledAtUtc).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </p>
            ) : null}
          </div>
        ) : null}

        {['DRAFT', 'GENERATED', 'READY', 'SCHEDULED'].includes(currentItem.status) ? (
          <div className="mb-4 rounded-xl border border-gray-200 bg-gray-50 p-3">
            <p className="text-[11px] font-bold uppercase tracking-widest text-gray-700">
              Quick Publish Schedule
            </p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <label className="space-y-1">
                <span className="block text-[11px] font-semibold text-gray-500">Date</span>
                <input
                  type="date"
                  value={publishDate}
                  onChange={(event) => {
                    setPublishDate(event.target.value);
                    setHasCustomSchedule(true);
                  }}
                  className="w-full rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </label>
              <label className="space-y-1">
                <span className="block text-[11px] font-semibold text-gray-500">Time</span>
                <input
                  type="time"
                  value={publishTime}
                  onChange={(event) => {
                    setPublishTime(event.target.value);
                    setHasCustomSchedule(true);
                  }}
                  className="w-full rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </label>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <select
                value={publishTimezone}
                onChange={(event) => {
                  setPublishTimezone(event.target.value);
                  setHasCustomSchedule(true);
                }}
                className="h-8 flex-1 rounded-lg border border-gray-200 bg-white px-2 text-xs font-semibold text-gray-700 outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="America/Toronto">Eastern Time (ET)</option>
                <option value="America/Los_Angeles">Pacific Time (PT)</option>
                <option value="Europe/London">London (GMT)</option>
              </select>
              {currentItem.status !== 'DRAFT' ? (
                <button
                  type="button"
                  onClick={handleQuickScheduleApply}
                  disabled={isScheduling || !publishDate || !publishTime}
                  className="h-8 shrink-0 rounded-lg bg-indigo-600 px-3 text-xs font-bold text-white transition hover:bg-indigo-700 disabled:opacity-50"
                >
                  {isScheduling ? 'Saving...' : 'Publish'}
                </button>
              ) : null}
            </div>
            <p className="mt-2 text-[11px] text-gray-500">
              Default schedule is {DEFAULT_FIRST_PUBLISH_DELAY_HOURS} hours after generation.
              {currentItem.status === 'DRAFT'
                ? ' Generate now to auto-apply this schedule.'
                : ' You can update it here in one click.'}
            </p>
          </div>
        ) : null}
        
        {currentItem.status === 'DRAFT' || currentItem.status === 'GENERATED' ? (
          <div className="mb-4 rounded-xl border border-indigo-100 bg-indigo-50/40 p-3">
           <button
             type="button"
             onClick={() => setShowManualSource((value) => !value)}
             className="flex w-full items-center justify-between text-left"
           >
             <span className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-indigo-700">
               <Paperclip className="h-3.5 w-3.5" />
               {currentItem.status === 'GENERATED' ? 'Refine With Your Own Source' : 'Use Your Own Source'}
             </span>
             <span className="text-xs font-semibold text-indigo-600">
               {showManualSource ? 'Hide' : 'Add Context'}
             </span>
           </button>

           {showManualSource ? (
             <div className="mt-3 space-y-3">
               <label className="flex items-center justify-between rounded-lg border border-indigo-100 bg-white px-3 py-2 text-xs font-semibold text-indigo-700">
                 <span>
                   Word Count ({WORD_COUNT_PLATFORM_LABELS[wordCountPlatform]} {wordCountRange.min}-{wordCountRange.max})
                 </span>
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
                   className="w-20 rounded-md border border-indigo-200 px-2 py-1 text-right text-xs font-bold text-indigo-700 outline-none"
                 />
               </label>
               <textarea
                 value={manualSourceNotes}
                 onChange={(event) => setManualSourceNotes(event.target.value)}
                 placeholder="Paste your notes, raw ideas, transcript, or key points..."
                 className="h-24 w-full rounded-lg border border-indigo-100 bg-white px-3 py-2 text-sm text-gray-700 outline-none ring-indigo-500 focus:ring-2"
               />
               <label className="flex cursor-pointer items-center justify-between rounded-lg border border-dashed border-indigo-200 bg-white px-3 py-2 text-xs font-semibold text-indigo-700 hover:bg-indigo-50">
                 <span>Attach files (PDF/TXT/MD/CSV/JSON)</span>
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
               {manualSourceError ? (
                 <p className="text-xs font-medium text-red-600">{manualSourceError}</p>
               ) : null}
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
                 Content generation will prioritize your manual notes, attached source text, and target word count.
               </p>
             </div>
            ) : null}
          </div>
        ) : null}

        <div className="pt-4 border-t border-gray-100 flex items-center justify-between text-xs font-medium text-gray-500">
          <span className="flex items-center gap-1.5 object-bottom">
            <Calendar className="w-3.5 h-3.5" />
            {new Date(currentItem.createdAt).toLocaleDateString()}
          </span>

          <div className="flex items-center gap-2">
            {currentItem.status === 'DRAFT' ? (
              <button 
                onClick={handleGenerate}
                disabled={isGenerating || isExtractingSourceFiles}
                className="text-indigo-600 disabled:opacity-50 hover:text-indigo-700 font-bold items-center inline-flex gap-1"
              >
                {isGenerating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                Generate, Schedule & Preview
              </button>
            ) : null}

            {['GENERATED', 'READY', 'SCHEDULED'].includes(currentItem.status) ? (
              <>
                <button
                  type="button"
                  onClick={openEditorModal}
                  className="text-gray-600 hover:text-gray-900 font-bold items-center inline-flex gap-1"
                >
                  Edit
                </button>
                {currentItem.status === 'GENERATED' ? (
                  <button
                    onClick={handleApprove}
                    className="bg-[#121212] flex items-center gap-1.5 text-white px-3 py-1.5 rounded-lg font-bold hover:bg-black transition-colors"
                  >
                    Approve Concept
                  </button>
                ) : null}
              </>
            ) : null}

            {['GENERATED', 'READY', 'SCHEDULED'].includes(currentItem.status) ? (
              <button
                onClick={openScheduleModal}
                className="bg-indigo-600 flex items-center gap-1 text-white px-3 py-1.5 rounded-lg font-bold hover:bg-indigo-700 transition"
              >
                <Send className="w-3.5 h-3.5" /> 
                {currentItem.status === 'SCHEDULED' ? 'Reschedule' : 'Publish'}
              </button>
            ) : null}
          </div>
        </div>
     </div>
    {isPreviewOpen ? (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 animate-in fade-in zoom-in-95 duration-200">
        <div className="flex w-full max-w-4xl flex-col rounded-3xl border border-gray-200 bg-white shadow-2xl overflow-hidden h-[90vh]">
          <div className="flex items-center justify-between border-b border-gray-100 px-6 py-5 bg-gray-50/50">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-widest text-[#121212]">Edit & Schedule Post</p>
              <h4 className="text-lg font-bold text-gray-900 line-clamp-1 mt-0.5">{currentItem.topic}</h4>
            </div>
            <button
              onClick={() => setIsPreviewOpen(false)}
              className="rounded-full shrink-0 p-2 text-gray-400 transition-colors hover:bg-gray-200 hover:text-gray-900"
              aria-label="Close preview"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          
          <div className="flex-1 overflow-y-auto p-6 grid grid-cols-1 lg:grid-cols-3 gap-8">
            <div className="lg:col-span-2 flex flex-col h-full">
              <label className="text-xs font-bold uppercase tracking-wider text-gray-600 mb-2">Content Draft</label>
              <textarea
                value={editContentText}
                onChange={(e) => setEditContentText(e.target.value)}
                className="flex-1 min-h-[400px] w-full resize-none rounded-xl border border-gray-200 bg-white p-4 text-sm leading-relaxed text-gray-800 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all font-sans"
              />
            </div>

            <div className="flex flex-col gap-6">
              <div className="rounded-2xl bg-indigo-50/50 border border-indigo-100 p-5">
                <div className="flex items-center gap-2 mb-4 text-indigo-700">
                  <Calendar className="w-5 h-5" />
                  <h3 className="font-bold">Publishing Schedule</h3>
                </div>
                
                <div className="space-y-4">
                  <div>
                    <label className="block text-[11px] font-bold text-gray-600 uppercase tracking-wider mb-1.5">Date (Optional)</label>
                    <input 
                      type="date" 
                      value={publishDate}
                      onChange={e => setPublishDate(e.target.value)}
                      className="w-full rounded-lg border-gray-200 bg-white focus:ring-2 focus:ring-indigo-500 p-2.5 text-sm outline-none transition"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-gray-600 uppercase tracking-wider mb-1.5">Time (Optional)</label>
                    <input 
                      type="time" 
                      value={publishTime}
                      onChange={e => setPublishTime(e.target.value)}
                      className="w-full rounded-lg border-gray-200 bg-white focus:ring-2 focus:ring-indigo-500 p-2.5 text-sm outline-none transition"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-gray-600 uppercase tracking-wider mb-1.5">Timezone</label>
                    <select 
                      value={publishTimezone} 
                      onChange={e => setPublishTimezone(e.target.value)}
                      className="w-full rounded-lg border-gray-200 bg-white focus:ring-2 focus:ring-indigo-500 p-2.5 text-sm outline-none transition"
                    >
                      <option value="America/Toronto">Eastern Time (ET)</option>
                      <option value="America/Los_Angeles">Pacific Time (PT)</option>
                      <option value="Europe/London">London (GMT)</option>
                    </select>
                  </div>
                  <p className="text-[11px] text-gray-500 leading-tight">
                    Leave date and time blank to save simply as "Ready", or fill them out to automatically mark this post as "Scheduled".
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="border-t border-gray-100 px-6 py-4 flex items-center justify-between bg-gray-50/50">
           <div className="inline-flex items-center rounded-full bg-gray-200/60 px-3 py-1 text-[11px] font-bold uppercase tracking-widest text-[#121212]">
             {currentItem.channel.replace(/_/g, ' ')}
           </div>
           
           <div className="flex gap-2">
             <button
                onClick={() => setIsPreviewOpen(false)}
                className="px-4 py-2 text-sm font-bold text-gray-600 hover:text-gray-900 transition-colors"
                disabled={isSavingEdits}
              >
                Cancel
              </button>
              <button
                onClick={handleSaveEdits}
                disabled={isSavingEdits}
                className="bg-indigo-600 flex items-center gap-1.5 text-white px-5 py-2 rounded-xl text-sm font-bold hover:bg-indigo-700 transition-colors disabled:opacity-60"
              >
                {isSavingEdits ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Save Changes
              </button>
           </div>
          </div>
        </div>
      </div>
    ) : null}

    {isScheduleModalOpen ? (
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 animate-in fade-in zoom-in-95 duration-200">
        <div className="w-full max-w-md rounded-3xl border border-gray-200 bg-white shadow-2xl p-6 relative">
          <button
            onClick={() => setIsScheduleModalOpen(false)}
            className="absolute top-4 right-4 rounded-full p-2 bg-gray-50 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition"
          >
            <X className="h-4 w-4" />
          </button>

          <div className="mb-6">
            <div className="w-12 h-12 bg-indigo-50 rounded-2xl flex items-center justify-center mb-4 text-indigo-600">
              <Calendar className="w-6 h-6" />
            </div>
            <h2 className="text-xl font-bold text-[#121212]">Schedule Content</h2>
            <p className="text-sm text-gray-500 mt-1 line-clamp-1">{currentItem.topic}</p>
          </div>

          <form onSubmit={handleScheduleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-2">Date</label>
                <input 
                  type="date" 
                  autoFocus
                  required
                  value={publishDate}
                  onChange={e => setPublishDate(e.target.value)}
                  className="w-full rounded-xl border-gray-200 bg-gray-50 focus:bg-white focus:ring-2 focus:ring-indigo-500 p-2.5 text-sm outline-none transition"
                />
              </div>
              <div>
                 <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-2">Time</label>
                 <input 
                  type="time" 
                  required
                  value={publishTime}
                  onChange={e => setPublishTime(e.target.value)}
                  className="w-full rounded-xl border-gray-200 bg-gray-50 focus:bg-white focus:ring-2 focus:ring-indigo-500 p-2.5 text-sm outline-none transition"
                />
              </div>
            </div>

            <div>
               <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-2">Timezone</label>
               <select 
                 value={publishTimezone} 
                 onChange={e => setPublishTimezone(e.target.value)}
                 className="w-full rounded-xl border-gray-200 bg-gray-50 focus:bg-white focus:ring-2 focus:ring-indigo-500 p-2.5 text-sm outline-none transition"
               >
                 <option value="America/Toronto">Eastern Time (ET)</option>
                 <option value="America/Los_Angeles">Pacific Time (PT)</option>
                 <option value="Europe/London">London (GMT)</option>
               </select>
            </div>

            <div className="pt-4 border-t border-gray-100 flex items-center justify-end gap-3 mt-6">
               <button 
                 type="button" 
                 onClick={() => setIsScheduleModalOpen(false)}
                 className="px-4 py-2 rounded-xl text-sm font-bold text-gray-600 hover:bg-gray-100 transition"
               >
                 Cancel
               </button>
               <button 
                 type="submit" 
                 disabled={isScheduling}
                 className="bg-indigo-600 hover:bg-indigo-700 text-white flex items-center gap-2 px-6 py-2 rounded-xl text-sm font-bold transition disabled:opacity-50"
               >
                 {isScheduling ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                 Confirm Schedule
               </button>
            </div>
          </form>

        </div>
      </div>
    ) : null}
    </>
  );
}

// Quick icons missing from lucide import
function LightbulbIcon(props: any) {
  return <svg {...props} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.9 1.2 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/></svg>
}
