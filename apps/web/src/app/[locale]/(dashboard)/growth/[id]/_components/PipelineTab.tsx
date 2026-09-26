'use client';


import { FileText, MoreHorizontal, Calendar, FilePenLine, Loader2, Sparkles, X, Paperclip, Send, Save } from 'lucide-react';
import { updateContentStatus, scheduleContentItem, updateContentAndSchedule } from '@/app/actions/calendar';
import { Link, useRouter } from '@/i18n/navigation';
import { useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { generatePostFromPipeline } from '@/app/actions/workspace';
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

/** Falls back to the shipped English label for a platform the map has not got. */
function wordCountPlatformLabel(t: ReturnType<typeof useTranslations>, platform: string) {
  return t.has(`wordCountPlatforms.${platform}`)
    ? t(`wordCountPlatforms.${platform}`)
    : (WORD_COUNT_PLATFORM_LABELS[platform as keyof typeof WORD_COUNT_PLATFORM_LABELS] ?? platform);
}

/** Channel ids are Latin data; the human half of the label is copy. */
function channelLabel(t: ReturnType<typeof useTranslations>, channel: string) {
  return t.has(`channels.${channel}`) ? t(`channels.${channel}`) : channel.replace(/_/g, ' ');
}

/** Content statuses arrive as raw enum values; unknown ones show the enum. */
function statusLabel(t: ReturnType<typeof useTranslations>, status: string) {
  return t.has(`contentStatus.${status}`) ? t(`contentStatus.${status}`) : status;
}

const MAX_MANUAL_SOURCE_FILES = 3;
const MAX_MANUAL_SOURCE_TEXT_CHARS = 24000;

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

function buildDefaultPublishBaseDate(defaultScheduleDelayHours: number): Date {
  return new Date(Date.now() + defaultScheduleDelayHours * 60 * 60 * 1000);
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
  defaultScheduleDelayHours,
}: {
  workspace: any;
  items: any[];
  wordCountLimits: ContentWordCountLimits;
  defaultScheduleDelayHours: number;
}) {
  const t = useTranslations('tabsA.pipeline');

  if (items.length === 0) {
    return (
      <div className="rounded-2xl border-2 border-dashed border-rule bg-chalk-raised flex flex-col items-center justify-center p-16 text-center animate-in fade-in slide-in-from-bottom-4 duration-500">
        <div className="w-12 h-12 bg-chalk-sunk rounded-xl flex items-center justify-center mb-4 text-moss-muted">
           <FilePenLine className="w-6 h-6" />
        </div>
        <h2 className="text-lg font-bold text-moss mb-1">{t('empty.title')}</h2>
        <p className="text-sm text-moss-muted max-w-sm mb-6 leading-relaxed">{t('empty.body')}</p>
        <Link
          href={{ pathname: '/growth/[id]', params: { id: workspace.id }, query: { tab: 'ideation' } }}
          className="inline-flex items-center gap-2 bg-moss text-chalk px-5 py-2.5 rounded-xl text-sm font-bold shadow-lg hover:bg-moss hover:scale-[1.02] transition-all"
        >
          <LightbulbIcon className="w-4 h-4 text-saffron-ink" />
          {t('empty.cta')}
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4 animate-in fade-in py-2">
       {/* Future Kanban board could go here, for now using a clean list */}
       <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item: any) => (
            <PipelineItemCard
              key={item.id}
              item={item}
              workspace={workspace}
              wordCountLimits={wordCountLimits}
              defaultScheduleDelayHours={defaultScheduleDelayHours}
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
  defaultScheduleDelayHours,
}: {
  item: any;
  workspace: any;
  wordCountLimits: ContentWordCountLimits;
  defaultScheduleDelayHours: number;
}) {
  const t = useTranslations('tabsA');
  const format = useFormatter();
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
      : buildDefaultPublishBaseDate(defaultScheduleDelayHours);
    setPublishDate(toDateInputValue(base));
    setPublishTime(toTimeInputValue(base));
    setHasCustomSchedule(false);
  }, [currentItem.id, currentItem.scheduledAtUtc, defaultScheduleDelayHours]);

  const openEditorModal = () => {
    setEditContentText(currentItem.content || '');
    if (currentItem.scheduledAtUtc) {
      const base = new Date(currentItem.scheduledAtUtc);
      setPublishDate(toDateInputValue(base));
      setPublishTime(toTimeInputValue(base));
      setHasCustomSchedule(true);
    } else {
      const base = buildDefaultPublishBaseDate(defaultScheduleDelayHours);
      setPublishDate(toDateInputValue(base));
      setPublishTime(toTimeInputValue(base));
      setHasCustomSchedule(false);
    }
    setIsPreviewOpen(true);
  };

  const openScheduleModal = () => {
    const base = currentItem.scheduledAtUtc
      ? new Date(currentItem.scheduledAtUtc)
      : buildDefaultPublishBaseDate(defaultScheduleDelayHours);
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
        router.push({ pathname: '/growth/[id]', params: { id: workspace.id }, query: { tab: 'calendar' } });
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
      setManualSourceError(t('pipeline.errors.maxFiles', { count: MAX_MANUAL_SOURCE_FILES }));
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
          setManualSourceError(t('pipeline.errors.readFailed', { name: file.name }));
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
      // The action returns a union; `in` narrows it to the success member.
      if (res && 'success' in res && res.success) {
        if (res.item) {
          setCurrentItem(res.item);
          setEditContentText(res.item.content || '');
          setIsPreviewOpen(true);
        }
      } else {
        console.error(res && 'error' in res ? res.error : null);
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
      // toast.success('Content generated and scheduled'); // This line was not in the original code, adding it as per instruction
      setIsScheduleModalOpen(false);
      router.push({ pathname: '/growth/[id]', params: { id: workspace.id }, query: { tab: 'calendar' } });
    } catch (e: any) { // Changed 'e' to 'err: any' as per instruction
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
      // toast.success('Generated and scheduled successfully'); // This line was not in the original code, adding it as per instruction
      setHasCustomSchedule(false);
      router.push({ pathname: '/growth/[id]', params: { id: workspace.id }, query: { tab: 'calendar' } });
    } catch (e) { // The instruction had a syntax error here: `} else {catch (e) {` which I'm correcting to `} catch (e) {`
      console.error('Failed to apply quick schedule', e);
    } finally {
      setIsScheduling(false);
    }
  };

  return (
    <>
     <div className="group relative flex flex-col rounded-2xl border border-rule bg-chalk-raised p-5 shadow-sm hover:border-moss transition-colors">
        <div className="flex items-start justify-between mb-3">
          <div className={`inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-bold tracking-widest uppercase
            ${currentItem.status === 'GENERATED' ? 'bg-chalk-sunk text-moss-700' 
            : currentItem.status === 'SCHEDULED' ? 'bg-chalk-sunk text-moss-700'
            : currentItem.status === 'READY' ? 'bg-chalk-sunk text-rival'
            : 'bg-amber-50 text-amber-600'}`}>
            {statusLabel(t, currentItem.status)}
          </div>
         <button className="text-moss-muted hover:text-moss transition-colors">
           <MoreHorizontal className="w-5 h-5" />
         </button>
       </div>
       
       <h3 className="font-bold text-moss leading-snug mb-2 line-clamp-2" title={item.topic}>
          {item.topic}
       </h3>
       
       <div className="flex flex-wrap gap-2 mb-4 mt-auto">
         <span className="inline-flex items-center gap-1.5 text-xs font-medium text-moss-muted">
           <FileText className="w-3.5 h-3.5" /> <bdi>{channelLabel(t, currentItem.channel)}</bdi>
         </span>
         <span className="inline-flex items-center gap-1.5 text-xs font-medium text-moss-muted">
           {t('pipeline.wordsTarget', { count: normalizedTargetWordCount })}
         </span>
       </div>

       {['GENERATED', 'READY', 'SCHEDULED'].includes(currentItem.status) ? (
          <div className="mb-4 rounded-xl border border-rule bg-chalk-sunk/70 p-3">
            <p className="text-[11px] font-bold uppercase tracking-widest text-moss-700 mb-1">{t('pipeline.previewLabel')}</p>
            <p className="text-sm leading-relaxed text-moss line-clamp-4 whitespace-pre-wrap">
              {String(currentItem.content || '').slice(0, 280)}
            </p>
            {currentItem.scheduledAtUtc ? (
              <p className="mt-2 text-[11px] font-semibold text-moss">
                {t('pipeline.publishAt', {
                  date: format.dateTime(new Date(currentItem.scheduledAtUtc), { dateStyle: 'medium' }),
                  time: format.dateTime(new Date(currentItem.scheduledAtUtc), {
                    hour: '2-digit',
                    minute: '2-digit',
                  }),
                })}
              </p>
            ) : null}
          </div>
        ) : null}

        {['DRAFT', 'GENERATED', 'READY', 'SCHEDULED'].includes(currentItem.status) ? (
          <div className="mb-4 rounded-xl border border-rule bg-chalk p-3">
            <p className="text-[11px] font-bold uppercase tracking-widest text-moss">
              {t('pipeline.quickSchedule.title')}
            </p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <label className="space-y-1">
                <span className="block text-[11px] font-semibold text-moss-muted">{t('common.date')}</span>
                <input
                  type="date"
                  value={publishDate}
                  onChange={(event) => {
                    setPublishDate(event.target.value);
                    setHasCustomSchedule(true);
                  }}
                  className="w-full rounded-lg border border-rule bg-chalk-raised px-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-saffron"
                />
              </label>
              <label className="space-y-1">
                <span className="block text-[11px] font-semibold text-moss-muted">{t('common.time')}</span>
                <input
                  type="time"
                  value={publishTime}
                  onChange={(event) => {
                    setPublishTime(event.target.value);
                    setHasCustomSchedule(true);
                  }}
                  className="w-full rounded-lg border border-rule bg-chalk-raised px-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-saffron"
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
                className="h-8 flex-1 rounded-lg border border-rule bg-chalk-raised px-2 text-xs font-semibold text-moss outline-none focus:ring-2 focus:ring-saffron"
              >
                <option value="America/Toronto">{t('timezones.America/Toronto')}</option>
                <option value="America/Los_Angeles">{t('timezones.America/Los_Angeles')}</option>
                <option value="Europe/London">{t('timezones.Europe/London')}</option>
              </select>
              {currentItem.status !== 'DRAFT' ? (
                <button
                  type="button"
                  onClick={handleQuickScheduleApply}
                  disabled={isScheduling || !publishDate || !publishTime}
                  className="h-8 shrink-0 rounded-lg bg-moss px-3 text-xs font-bold text-chalk transition hover:bg-moss-700 disabled:opacity-50"
                >
                  {isScheduling ? t('pipeline.quickSchedule.saving') : t('pipeline.quickSchedule.publish')}
                </button>
              ) : null}
            </div>
            <p className="mt-2 text-[11px] text-moss-muted">
              {t('pipeline.quickSchedule.note', { hours: defaultScheduleDelayHours })}{' '}
              {currentItem.status === 'DRAFT'
                ? t('pipeline.quickSchedule.noteDraft')
                : t('pipeline.quickSchedule.noteReady')}
            </p>
          </div>
        ) : null}
        
        {currentItem.status === 'DRAFT' || currentItem.status === 'GENERATED' ? (
          <div className="mb-4 rounded-xl border border-rule bg-chalk-sunk/40 p-3">
           <button
             type="button"
             onClick={() => setShowManualSource((value) => !value)}
             className="flex w-full items-center justify-between text-start"
           >
             <span className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-moss">
               <Paperclip className="h-3.5 w-3.5" />
               {currentItem.status === 'GENERATED'
                 ? t('pipeline.source.refineTitle')
                 : t('pipeline.source.useTitle')}
             </span>
             <span className="text-xs font-semibold text-moss-700">
               {showManualSource ? t('pipeline.source.hide') : t('pipeline.source.addContext')}
             </span>
           </button>

           {showManualSource ? (
             <div className="mt-3 space-y-3">
               <label className="flex items-center justify-between rounded-lg border border-rule bg-chalk-raised px-3 py-2 text-xs font-semibold text-moss">
                 <span>
                   {t('pipeline.source.wordCount', {
                     platform: wordCountPlatformLabel(t, wordCountPlatform),
                     min: wordCountRange.min,
                     max: wordCountRange.max,
                   })}
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
                   className="w-20 rounded-md border border-rule-strong px-2 py-1 text-end text-xs font-bold text-moss outline-none"
                 />
               </label>
               <textarea
                 value={manualSourceNotes}
                 onChange={(event) => setManualSourceNotes(event.target.value)}
                 placeholder={t('pipeline.source.placeholder')}
                 className="h-24 w-full rounded-lg border border-rule bg-chalk-raised px-3 py-2 text-sm text-moss outline-none ring-saffron focus:ring-2"
               />
               <label className="flex cursor-pointer items-center justify-between rounded-lg border border-dashed border-rule-strong bg-chalk-raised px-3 py-2 text-xs font-semibold text-moss hover:bg-chalk-sunk">
                 <span>{t('common.attachFiles')}</span>
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
               {manualSourceError ? (
                 <p className="text-xs font-medium text-red-600">{manualSourceError}</p>
               ) : null}
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
               <p className="text-[11px] text-moss-muted">{t('pipeline.source.note')}</p>
             </div>
            ) : null}
          </div>
        ) : null}

        <div className="pt-4 border-t border-rule flex items-center justify-between text-xs font-medium text-moss-muted">
          <span className="flex items-center gap-1.5 object-bottom">
            <Calendar className="w-3.5 h-3.5" />
            {format.dateTime(new Date(currentItem.createdAt), { dateStyle: 'medium' })}
          </span>

          <div className="flex items-center gap-2">
            {currentItem.status === 'DRAFT' ? (
              <button 
                onClick={handleGenerate}
                disabled={isGenerating || isExtractingSourceFiles}
                className="text-moss-700 disabled:opacity-50 hover:text-moss font-bold items-center inline-flex gap-1"
              >
                {isGenerating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                {t('pipeline.actions.generate')}
              </button>
            ) : null}

            {['GENERATED', 'READY', 'SCHEDULED'].includes(currentItem.status) ? (
              <>
                <button
                  type="button"
                  onClick={openEditorModal}
                  className="text-moss-muted hover:text-moss font-bold items-center inline-flex gap-1"
                >
                  {t('pipeline.actions.edit')}
                </button>
                {currentItem.status === 'GENERATED' ? (
                  <button
                    onClick={handleApprove}
                    className="bg-moss flex items-center gap-1.5 text-chalk px-3 py-1.5 rounded-lg font-bold hover:bg-moss transition-colors"
                  >
                    {t('pipeline.actions.approve')}
                  </button>
                ) : null}
              </>
            ) : null}

            {['GENERATED', 'READY', 'SCHEDULED'].includes(currentItem.status) ? (
              <button
                onClick={openScheduleModal}
                className="bg-moss flex items-center gap-1 text-chalk px-3 py-1.5 rounded-lg font-bold hover:bg-moss-700 transition"
              >
                <Send className="w-3.5 h-3.5 rtl:-scale-x-100" /> 
                {currentItem.status === 'SCHEDULED'
                  ? t('pipeline.actions.reschedule')
                  : t('pipeline.actions.publish')}
              </button>
            ) : null}
          </div>
        </div>
     </div>
    {isPreviewOpen ? (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-moss/60 p-4 animate-in fade-in zoom-in-95 duration-200">
        <div className="flex w-full max-w-4xl flex-col rounded-3xl border border-rule bg-chalk-raised shadow-2xl overflow-hidden h-[90vh]">
          <div className="flex items-center justify-between border-b border-rule px-6 py-5 bg-chalk/50">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-widest text-moss">{t('pipeline.editor.eyebrow')}</p>
              <h4 className="text-lg font-bold text-moss line-clamp-1 mt-0.5">{currentItem.topic}</h4>
            </div>
            <button
              onClick={() => setIsPreviewOpen(false)}
              className="rounded-full shrink-0 p-2 text-moss-muted transition-colors hover:bg-chalk-sunk hover:text-moss"
              aria-label={t('pipeline.editor.close')}
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          
          <div className="flex-1 overflow-y-auto p-6 grid grid-cols-1 lg:grid-cols-3 gap-8">
            <div className="lg:col-span-2 flex flex-col h-full">
              <label className="text-xs font-bold uppercase tracking-wider text-moss-muted mb-2">{t('pipeline.editor.draftLabel')}</label>
              <textarea
                value={editContentText}
                onChange={(e) => setEditContentText(e.target.value)}
                className="flex-1 min-h-[400px] w-full resize-none rounded-xl border border-rule bg-chalk-raised p-4 text-sm leading-relaxed text-moss outline-none focus:border-moss focus:ring-1 focus:ring-saffron transition-all font-sans"
              />
            </div>

            <div className="flex flex-col gap-6">
              <div className="rounded-2xl bg-chalk-sunk/50 border border-rule p-5">
                <div className="flex items-center gap-2 mb-4 text-moss">
                  <Calendar className="w-5 h-5" />
                  <h3 className="font-bold">{t('pipeline.editor.scheduleTitle')}</h3>
                </div>
                
                <div className="space-y-4">
                  <div>
                    <label className="block text-[11px] font-bold text-moss-muted uppercase tracking-wider mb-1.5">{t('pipeline.editor.dateOptional')}</label>
                    <input 
                      type="date" 
                      value={publishDate}
                      onChange={e => setPublishDate(e.target.value)}
                      className="w-full rounded-lg border-rule bg-chalk-raised focus:ring-2 focus:ring-saffron p-2.5 text-sm outline-none transition"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-moss-muted uppercase tracking-wider mb-1.5">{t('pipeline.editor.timeOptional')}</label>
                    <input 
                      type="time" 
                      value={publishTime}
                      onChange={e => setPublishTime(e.target.value)}
                      className="w-full rounded-lg border-rule bg-chalk-raised focus:ring-2 focus:ring-saffron p-2.5 text-sm outline-none transition"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-moss-muted uppercase tracking-wider mb-1.5">{t('common.timezone')}</label>
                    <select 
                      value={publishTimezone} 
                      onChange={e => setPublishTimezone(e.target.value)}
                      className="w-full rounded-lg border-rule bg-chalk-raised focus:ring-2 focus:ring-saffron p-2.5 text-sm outline-none transition"
                    >
                      <option value="America/Toronto">{t('timezones.America/Toronto')}</option>
                      <option value="America/Los_Angeles">{t('timezones.America/Los_Angeles')}</option>
                      <option value="Europe/London">{t('timezones.Europe/London')}</option>
                    </select>
                  </div>
                  <p className="text-[11px] text-moss-muted leading-tight">{t('pipeline.editor.blankNote')}</p>
                </div>
              </div>
            </div>
          </div>

          <div className="border-t border-rule px-6 py-4 flex items-center justify-between bg-chalk/50">
           <div className="inline-flex items-center rounded-full bg-chalk-sunk/60 px-3 py-1 text-[11px] font-bold uppercase tracking-widest text-moss">
             <bdi>{channelLabel(t, currentItem.channel)}</bdi>
           </div>
           
           <div className="flex gap-2">
             <button
                onClick={() => setIsPreviewOpen(false)}
                className="px-4 py-2 text-sm font-bold text-moss-muted hover:text-moss transition-colors"
                disabled={isSavingEdits}
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={handleSaveEdits}
                disabled={isSavingEdits}
                className="bg-moss flex items-center gap-1.5 text-chalk px-5 py-2 rounded-xl text-sm font-bold hover:bg-moss-700 transition-colors disabled:opacity-60"
              >
                {isSavingEdits ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                {t('pipeline.editor.save')}
              </button>
           </div>
          </div>
        </div>
      </div>
    ) : null}

    {isScheduleModalOpen ? (
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-moss/60 p-4 animate-in fade-in zoom-in-95 duration-200">
        <div className="w-full max-w-md rounded-3xl border border-rule bg-chalk-raised shadow-2xl p-6 relative">
          <button
            onClick={() => setIsScheduleModalOpen(false)}
            className="absolute top-4 end-4 rounded-full p-2 bg-chalk text-moss-muted hover:bg-chalk-sunk hover:text-moss-muted transition"
          >
            <X className="h-4 w-4" />
          </button>

          <div className="mb-6">
            <div className="w-12 h-12 bg-chalk-sunk rounded-2xl flex items-center justify-center mb-4 text-moss-700">
              <Calendar className="w-6 h-6" />
            </div>
            <h2 className="text-xl font-bold text-moss">{t('pipeline.scheduleModal.title')}</h2>
            <p className="text-sm text-moss-muted mt-1 line-clamp-1">{currentItem.topic}</p>
          </div>

          <form onSubmit={handleScheduleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-moss uppercase tracking-wider mb-2">{t('common.date')}</label>
                <input 
                  type="date" 
                  autoFocus
                  required
                  value={publishDate}
                  onChange={e => setPublishDate(e.target.value)}
                  className="w-full rounded-xl border-rule bg-chalk focus:bg-chalk-raised focus:ring-2 focus:ring-saffron p-2.5 text-sm outline-none transition"
                />
              </div>
              <div>
                 <label className="block text-xs font-bold text-moss uppercase tracking-wider mb-2">{t('common.time')}</label>
                 <input 
                  type="time" 
                  required
                  value={publishTime}
                  onChange={e => setPublishTime(e.target.value)}
                  className="w-full rounded-xl border-rule bg-chalk focus:bg-chalk-raised focus:ring-2 focus:ring-saffron p-2.5 text-sm outline-none transition"
                />
              </div>
            </div>

            <div>
               <label className="block text-xs font-bold text-moss uppercase tracking-wider mb-2">{t('common.timezone')}</label>
               <select 
                 value={publishTimezone} 
                 onChange={e => setPublishTimezone(e.target.value)}
                 className="w-full rounded-xl border-rule bg-chalk focus:bg-chalk-raised focus:ring-2 focus:ring-saffron p-2.5 text-sm outline-none transition"
               >
                 <option value="America/Toronto">{t('timezones.America/Toronto')}</option>
                 <option value="America/Los_Angeles">{t('timezones.America/Los_Angeles')}</option>
                 <option value="Europe/London">{t('timezones.Europe/London')}</option>
               </select>
            </div>

            <div className="pt-4 border-t border-rule flex items-center justify-end gap-3 mt-6">
               <button 
                 type="button" 
                 onClick={() => setIsScheduleModalOpen(false)}
                 className="px-4 py-2 rounded-xl text-sm font-bold text-moss-muted hover:bg-chalk-sunk transition"
               >
                 {t('common.cancel')}
               </button>
               <button 
                 type="submit" 
                 disabled={isScheduling}
                 className="bg-moss hover:bg-moss-700 text-chalk flex items-center gap-2 px-6 py-2 rounded-xl text-sm font-bold transition disabled:opacity-50"
               >
                 {isScheduling ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4 rtl:-scale-x-100" />}
                 {t('pipeline.scheduleModal.confirm')}
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
