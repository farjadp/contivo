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
import { CheckCircle, FileText, Loader2 } from 'lucide-react';

// One step in the progress pipeline shown to the user
interface Stage {
  label: string;       // Short label shown in the step list
  detail: string;      // Longer description shown below the progress bar
  targetPct: number;   // Progress bar target when this stage is "current"
  // How long (ms) to spend linearly advancing from previous target to this one
  durationMs: number;
}

const STAGES: Stage[] = [
  {
    label: 'Preparing data',
    detail: 'Loading workspace intelligence, competitors, and brand data…',
    targetPct: 8,
    durationMs: 2_000,
  },
  {
    label: 'AI designing report',
    detail: 'Gemini is analysing your data and building a professional layout…',
    targetPct: 60,
    durationMs: 28_000,
  },
  {
    label: 'Rendering PDF',
    detail: 'Puppeteer is converting the HTML to a print-ready PDF…',
    targetPct: 88,
    durationMs: 16_000,
  },
  {
    label: 'Saving report',
    detail: 'Storing the report and updating your history…',
    targetPct: 96,
    durationMs: 2_500,
  },
];

interface ReportGeneratingModalProps {
  /** Set to true to show the modal; false hides it */
  isOpen: boolean;
  /** Set to true once the server action has resolved successfully */
  isDone: boolean;
  /** Set to a non-empty string if the server action threw */
  error: string;
}

export function ReportGeneratingModal({ isOpen, isDone, error }: ReportGeneratingModalProps) {
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md mx-4 bg-white rounded-2xl shadow-2xl overflow-hidden">

        {/* ── Header ── */}
        <div className="bg-gradient-to-r from-[#1e3a8a] to-[#1e40af] px-8 py-6 text-white">
          <div className="flex items-center gap-3 mb-1">
            <FileText className="w-6 h-6 opacity-80" />
            <span className="text-sm font-semibold uppercase tracking-widest opacity-80">
              Generating Report
            </span>
          </div>
          <p className="text-2xl font-bold">Strategic Intelligence</p>
          <p className="text-sm opacity-70 mt-1">This takes 30–60 seconds — please don't close the tab</p>
        </div>

        {/* ── Body ── */}
        <div className="px-8 py-6 space-y-6">

          {/* Progress bar */}
          <div>
            <div className="flex justify-between text-sm font-semibold mb-2">
              <span className="text-slate-700">{isDone ? 'Complete!' : currentStage.label}</span>
              <span className="text-[#1e3a8a]">{progress}%</span>
            </div>
            <div className="w-full h-3 bg-slate-100 rounded-full overflow-hidden">
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
              <p className="text-xs text-slate-500 mt-2">{currentStage.detail}</p>
            )}
          </div>

          {/* Stage checklist */}
          <ul className="space-y-3">
            {STAGES.map((stage, i) => {
              const done = isDone || i < stageIndex || (i === stageIndex && progress >= stage.targetPct);
              const active = !isDone && i === stageIndex;

              return (
                <li key={stage.label} className="flex items-center gap-3">
                  {done ? (
                    <CheckCircle className="w-5 h-5 text-emerald-500 shrink-0" />
                  ) : active ? (
                    <Loader2 className="w-5 h-5 text-[#1e3a8a] animate-spin shrink-0" />
                  ) : (
                    // Upcoming step — faint circle placeholder
                    <span className="w-5 h-5 rounded-full border-2 border-slate-200 shrink-0" />
                  )}
                  <span
                    className={`text-sm ${
                      done
                        ? 'text-emerald-700 font-medium'
                        : active
                          ? 'text-[#1e3a8a] font-semibold'
                          : 'text-slate-400'
                    }`}
                  >
                    {stage.label}
                  </span>
                </li>
              );
            })}
          </ul>

          {/* Error state */}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
              <strong>Generation failed:</strong> {error}
            </div>
          )}

          {/* Done state */}
          {isDone && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-3 text-sm text-emerald-800 font-medium text-center">
              ✅ Report ready — your download will open automatically
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
