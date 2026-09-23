'use client';

/**
 * Drives the real extraction and reports what actually happened.
 *
 * The previous version was theatre: four `setTimeout`s walked through fixed
 * "Connecting to your website / Reading your key pages" steps for ~9s while
 * the work they described had already finished inside the create action. Now
 * the steps track the real call, and a failure is shown with a retry instead
 * of dropping the user into an empty workspace.
 */

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import { useSearchParams } from 'next/navigation';
import { AlertTriangle, RefreshCw } from 'lucide-react';

import { enrichWorkspace, type EnrichmentResult } from '@/app/actions/growth';

/*
  The steps carry message keys, not sentences: a module-level array of English
  strings would be the one part of this screen no translator could reach.
*/
const STEPS = [
  { id: 1, key: 'connect' },
  { id: 2, key: 'read' },
  { id: 3, key: 'understand' },
  { id: 4, key: 'build' },
] as const;

/**
 * The action is one round trip, so the steps cannot be driven by real
 * milestones without streaming. They advance on a timer that *stops* at the
 * last step and only completes when the server answers — so the screen can
 * never claim to be finished before the work is.
 */
const STEP_ADVANCE_MS = 3500;

export function AnalyzingRunner() {
  return (
    <Suspense fallback={<AnalyzingLayout currentStepIndex={0} />}>
      <AnalyzingContent />
    </Suspense>
  );
}

function AnalyzingContent() {
  const t = useTranslations('growth.analyzing');
  const router = useRouter();
  const searchParams = useSearchParams();
  const workspaceId = searchParams.get('id');

  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const startedFor = useRef<string | null>(null);

  const run = useCallback(async () => {
    if (!workspaceId) return;
    setError(null);
    setCurrentStepIndex(0);

    let result: EnrichmentResult;
    try {
      result = await enrichWorkspace(workspaceId);
    } catch (err) {
      console.error('Workspace enrichment threw:', err);
      setError(t('error.threw'));
      return;
    }

    if (!result.ok) {
      setError(result.error ?? t('error.failed'));
      return;
    }

    setCurrentStepIndex(STEPS.length);

    const query = new URLSearchParams({ tab: 'strategy' });
    if (result.warnings.length > 0) query.set('setup', 'partial');
    router.replace(`/growth/${workspaceId}?${query.toString()}` as never);
  }, [router, workspaceId, t]);

  useEffect(() => {
    if (!workspaceId) {
      router.replace('/growth');
      return;
    }
    // React 18 StrictMode mounts effects twice in dev; without this the whole
    // extraction (and its AI spend) would run twice per visit.
    const key = `${workspaceId}:${attempt}`;
    if (startedFor.current === key) return;
    startedFor.current = key;
    void run();
  }, [workspaceId, attempt, router, run]);

  // Advance the visible step while the request is in flight, but never past
  // the final one — completion is owned by the server response.
  useEffect(() => {
    if (error) return;
    const timer = setInterval(() => {
      setCurrentStepIndex((i) => (i < STEPS.length - 1 ? i + 1 : i));
    }, STEP_ADVANCE_MS);
    return () => clearInterval(timer);
  }, [error, attempt]);

  if (error) {
    return <AnalyzingError message={error} onRetry={() => setAttempt((a) => a + 1)} />;
  }

  return <AnalyzingLayout currentStepIndex={currentStepIndex} />;
}

function AnalyzingError({ message, onRetry }: { message: string; onRetry: () => void }) {
  const t = useTranslations('growth.analyzing');
  return (
    <div className="w-full h-full min-h-[80vh] flex items-center justify-center bg-[#FDFCF8] text-[#121212] rounded-[32px] border border-[#121212]/10 p-8">
      <div className="max-w-lg">
        <div className="inline-flex items-center gap-2 text-xs font-bold tracking-widest uppercase text-[#C04C36] mb-8">
          <AlertTriangle className="h-4 w-4" /> {t('error.eyebrow')}
        </div>
        <h1 className="text-4xl md:text-5xl font-medium tracking-tighter leading-[1] mb-6">
          {t('error.titleTop')}
          <br />
          <span className="italic text-[#121212]/50 font-serif font-light">{t('error.titleAccent')}</span>
        </h1>
        <p className="text-lg text-[#121212]/70 leading-relaxed font-medium mb-10">{message}</p>
        <div className="flex flex-wrap gap-3">
          <button
            onClick={onRetry}
            className="group inline-flex items-center gap-3 bg-[#121212] text-[#FDFCF8] py-4 px-6 hover:bg-[#C04C36] transition-colors duration-500"
          >
            <RefreshCw className="w-4 h-4" />
            <span className="text-sm font-bold tracking-widest uppercase">{t('error.retry')}</span>
          </button>
          <Link
            href="/growth"
            className="inline-flex items-center py-4 px-6 border border-[#121212]/20 text-sm font-bold tracking-widest uppercase hover:border-[#121212] transition-colors"
          >
            {t('error.back')}
          </Link>
        </div>
      </div>
    </div>
  );
}

function AnalyzingLayout({ currentStepIndex }: { currentStepIndex: number }) {
  const t = useTranslations('growth.analyzing');
  return (
    <div className="w-full h-full min-h-[80vh] flex flex-col lg:flex-row bg-[#FDFCF8] text-[#121212] overflow-hidden rounded-[32px] border border-[#121212]/10">

      {/* Left Column: Intro */}
      <div className="w-full lg:w-[45%] p-8 lg:p-12 xl:p-16 flex flex-col justify-between border-b lg:border-b-0 lg:border-e border-[#121212]/10 bg-[#EFECE5]">
        <div>
           <div className="inline-flex items-center gap-2 text-xs font-bold tracking-widest uppercase opacity-50 mb-16">
              {t('processing')}
           </div>

           <h1 className="text-5xl md:text-6xl font-medium tracking-tighter leading-[1] text-[#121212] mb-8">
             <div className="animate-in slide-in-from-bottom duration-700 delay-100 fill-mode-both">{t('titleTop')}</div>
             <div className="animate-in slide-in-from-bottom duration-700 delay-200 fill-mode-both">
                 <span className="italic text-[#121212]/50 font-serif font-light">{t('titleAccent')}</span>
             </div>
           </h1>

           <p className="text-lg text-[#121212]/70 leading-relaxed font-medium max-w-sm animate-in fade-in duration-1000 delay-300 fill-mode-both">
             {/* The brand name is a Latin island in Persian prose; without the
                 isolate the punctuation around it jumps sides. */}
             {t.rich('lead', { brand: (chunks) => <bdi>{chunks}</bdi> })}
           </p>
        </div>

        <div className="hidden lg:flex items-center gap-3 mt-12 animate-pulse">
            <div className="w-3 h-3 bg-[#C04C36]" />
            <span className="text-xs font-bold tracking-widest uppercase opacity-40">{t('doNotClose')}</span>
        </div>
      </div>

      {/* Right Column: Steps Progress array */}
      <div className="w-full lg:w-[55%] p-8 lg:p-12 xl:p-24 flex flex-col justify-center bg-[#FDFCF8] animate-in fade-in zoom-in duration-1000 delay-300 fill-mode-both">
         <div className="w-full max-w-md mx-auto relative ps-4">
             {/* Timeline line */}
             <div className="absolute start-0 top-6 bottom-6 w-[2px] bg-[#121212]/10 rounded-full" />

             {STEPS.map((step, index) => {
                const isActive = index === currentStepIndex;
                const isPast = index < currentStepIndex;

                return (
                  <div
                    key={step.id}
                    className={`relative py-6 ps-8 transition-all duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] ${
                      isPast ? 'opacity-40 translate-x-0' : isActive ? 'opacity-100 translate-x-2 rtl:-translate-x-2' : 'opacity-20 translate-x-0'
                    }`}
                  >
                     {/* Timeline Node */}
                     <div className={`absolute start-[-5px] top-[calc(50%-5px)] w-[12px] h-[12px] rounded-sm transition-all duration-700 ${
                         isPast ? 'bg-[#121212]/40' : isActive ? 'bg-[#C04C36]' : 'bg-[#121212]/20'
                     }`}
                     style={{
                         transform: isActive ? 'rotate(45deg) scale(1.2)' : 'rotate(0deg)'
                     }} />

                     <div className="flex flex-col">
                        <span className={`text-[10px] sm:text-xs font-bold tracking-widest uppercase mb-1 transition-colors duration-500 ${
                            isActive ? 'text-[#C04C36]' : 'text-[#121212]/40'
                        }`}>
                           {t('phase', { n: step.id })}
                           {isActive && <span className="ms-2 lowercase italic font-serif font-medium tracking-normal text-[#121212]/60 animate-pulse">{t('running')}</span>}
                           {isPast && <span className="ms-2 lowercase italic font-serif font-medium tracking-normal text-[#121212]/40">{t('complete')}</span>}
                        </span>
                        <span className={`text-xl md:text-2xl font-medium tracking-tighter transition-colors duration-500 ${
                          isPast ? 'text-[#121212] line-through decoration-[#121212]/30' : isActive ? 'text-[#121212]' : 'text-[#121212]/60'
                        }`}>
                          {t(`steps.${step.key}`)}
                        </span>
                     </div>
                  </div>
                );
             })}
         </div>
      </div>
    </div>
  );
}
