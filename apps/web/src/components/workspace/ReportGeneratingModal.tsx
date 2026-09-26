'use client';

/**
 * ReportGeneratingModal
 *
 * A full-screen overlay shown while generateStrategicReport() is running.
 * Since server actions can't stream real progress, we simulate it by
 * advancing through known pipeline stages with realistic timing.
 *
 * Pipeline stages and their approximate real durations:
 *   1. Preparing workspace data   ~2 s
 *   2. AI designing report        ~25 s  (Gemini call — the slow part)
 *   3. Rendering to PDF           ~15 s  (Puppeteer headless Chrome)
 *   4. Saving report              ~2 s
 *   5. Done                       instant
 *
 * We advance the bar at a rate that fills ~90% by the time the action
 * usually completes, then jump to 100% when the action resolves.
 */

import { useEffect, useRef, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { CheckCircle, FileText, Loader2 } from 'lucide-react';

/*
  One step in the progress pipeline shown to the user. The label and the
  detail line are user-facing, so they live in the catalogue and only their
  keys are pinned here; the timings are not translatable.
*/
interface Stage {
  /** Catalogue key for the short label shown in the step list. */
  labelKey: string;
  /** Catalogue key for the longer line shown below the progress bar. */
  detailKey: string;
  targetPct: number;   // Progress bar target when this stage is "current"
  // How long (ms) to spend linearly advancing from previous target to this one
  durationMs: number;
}

const STAGES: Stage[] = [
  { labelKey: 'prepareLabel', detailKey: 'prepareDetail', targetPct: 8, durationMs: 2_000 },
  { labelKey: 'designLabel', detailKey: 'designDetail', targetPct: 60, durationMs: 28_000 },
  { labelKey: 'renderLabel', detailKey: 'renderDetail', targetPct: 88, durationMs: 16_000 },
  { labelKey: 'saveLabel', detailKey: 'saveDetail', targetPct: 96, durationMs: 2_500 },
];

/** Brand names stay Latin; isolating them keeps Persian punctuation in place. */
const bdi = (chunks: React.ReactNode) => <bdi>{chunks}</bdi>;

interface ReportGeneratingModalProps {
  /** Set to true to show the modal; false hides it */
  isOpen: boolean;
  /** Set to true once the server action has resolved successfully */
  isDone: boolean;
  /** Set to a non-empty string if the server action threw */
  error: string;
}

export function ReportGeneratingModal({ isOpen, isDone, error }: ReportGeneratingModalProps) {
  const t = useTranslations('tabsB.reportModal');
  const format = useFormatter();
  const [progress, setProgress] = useState(0);
  const [stageIndex, setStageIndex] = useState(0);
  const rafRef = useRef<number | null>(null);
  const startTimeRef = useRef<number>(0);
  const stageStartPctRef = useRef<number>(0);

  // Reset animation state every time the modal opens
  useEffect(() => {
    if (!isOpen) {
      setProgress(0);
      setStageIndex(0);
      return;
    }

    startTimeRef.current = performance.now();
    stageStartPctRef.current = 0;

    let currentStage = 0;
    let stageStart = performance.now();

    function tick(now: number) {
      if (currentStage >= STAGES.length) return;

      const stage = STAGES[currentStage];
      const elapsed = now - stageStart;
      const fraction = Math.min(elapsed / stage.durationMs, 1);

      // Ease-out cubic so the bar feels natural (fast start, slows near target)
      const eased = 1 - Math.pow(1 - fraction, 3);
      const pct = stageStartPctRef.current + eased * (stage.targetPct - stageStartPctRef.current);

      setProgress(Math.round(pct));
      setStageIndex(currentStage);

      if (fraction >= 1) {
        // Advance to next stage
        stageStartPctRef.current = stage.targetPct;
        currentStage += 1;
        stageStart = now;
      }

      if (currentStage < STAGES.length) {
        rafRef.current = requestAnimationFrame(tick);
      }
    }

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [isOpen]);

  // When server action resolves, snap bar to 100%
  useEffect(() => {
    if (isDone) {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      setProgress(100);
      setStageIndex(STAGES.length - 1);
    }
  }, [isDone]);

  if (!isOpen) return null;

  const currentStage = STAGES[Math.min(stageIndex, STAGES.length - 1)];

  return (
    // Full-screen backdrop — pointer-events-none on the backdrop so accidental
    // clicks outside don't close it (user must wait for the action to finish)
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-moss/60 backdrop-blur-sm">
      <div className="w-full max-w-md mx-4 bg-chalk-raised rounded-2xl shadow-2xl overflow-hidden">

        {/* ── Header ── */}
        <div className="bg-gradient-to-r from-rival to-rival px-8 py-6 text-chalk">
          <div className="flex items-center gap-3 mb-1">
            <FileText className="w-6 h-6 opacity-80" />
            <span className="text-sm font-semibold uppercase tracking-widest opacity-80">
              {t('eyebrow')}
            </span>
          </div>
          <p className="text-2xl font-bold">{t('title')}</p>
          <p className="text-sm opacity-70 mt-1">{t('warning')}</p>
        </div>

        {/* ── Body ── */}
        <div className="px-8 py-6 space-y-6">

          {/* Progress bar */}
          <div>
            <div className="flex justify-between text-sm font-semibold mb-2">
              <span className="text-moss">
                {isDone ? t('complete') : t(`stages.${currentStage.labelKey}`)}
              </span>
              <span className="text-rival">
                {t('percent', { value: format.number(progress) })}
              </span>
            </div>
            <div className="w-full h-3 bg-chalk-sunk rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-300 ease-out"
                style={{
                  width: `${progress}%`,
                  // Gradient shifts from blue → emerald as it completes
                  background: isDone
                    ? '#059669'
                    : `linear-gradient(90deg, #1e3a8a ${100 - progress}%, #2563eb)`,
                }}
              />
            </div>
            {/* Detail label under the bar */}
            {!isDone && !error && (
              <p className="text-xs text-moss-muted mt-2">
                {t.rich(`stages.${currentStage.detailKey}`, { bdi })}
              </p>
            )}
          </div>

          {/* Stage checklist */}
          <ul className="space-y-3">
            {STAGES.map((stage, i) => {
              const done = isDone || i < stageIndex || (i === stageIndex && progress >= stage.targetPct);
              const active = !isDone && i === stageIndex;

              return (
                <li key={stage.labelKey} className="flex items-center gap-3">
                  {done ? (
                    <CheckCircle className="w-5 h-5 text-moss-700 shrink-0" />
                  ) : active ? (
                    <Loader2 className="w-5 h-5 text-rival animate-spin shrink-0" />
                  ) : (
                    // Upcoming step — faint circle placeholder
                    <span className="w-5 h-5 rounded-full border-2 border-rule shrink-0" />
                  )}
                  <span
                    className={`text-sm ${
                      done
                        ? 'text-moss-700 font-medium'
                        : active
                          ? 'text-rival font-semibold'
                          : 'text-moss-muted'
                    }`}
                  >
                    {t(`stages.${stage.labelKey}`)}
                  </span>
                </li>
              );
            })}
          </ul>

          {/* Error state */}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
              <strong>{t('errorPrefix')}</strong> {error}
            </div>
          )}

          {/* Done state */}
          {isDone && (
            <div className="bg-chalk-sunk border border-rule rounded-lg px-4 py-3 text-sm text-moss font-medium text-center">
              ✅ {t('done')}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
