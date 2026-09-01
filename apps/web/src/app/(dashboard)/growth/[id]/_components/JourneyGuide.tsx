'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { ArrowRight, Check, Lock, Sparkles, X } from 'lucide-react';

import { explainNextStep, type GuideAnswer } from '@/app/actions/guide';
import type { Journey } from '@/lib/workspace-journey';

/**
 * The setup rail: shows the dependency chain as a chain, marks where the user
 * is, and offers an AI explanation of the current step in their brand's terms.
 * Collapses to a thin bar once setup is complete so it stops taking space.
 */
export function JourneyGuide({ workspaceId, journey }: { workspaceId: string; journey: Journey }) {
  const [answer, setAnswer] = useState<GuideAnswer | null>(null);
  const [error, setError] = useState('');
  const [isAsking, ask] = useTransition();

  const handleAsk = () => {
    setError('');
    ask(async () => {
      const result = await explainNextStep(workspaceId);
      if ('error' in result) {
        setError(result.error);
        return;
      }
      setAnswer(result);
    });
  };

  if (journey.isComplete) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 border border-ink-200 bg-white px-5 py-3">
        <p className="flex items-center gap-2 text-[13px] text-ink-700">
          <Check className="h-4 w-4 text-signal-dim" />
          Setup complete — brand, market, keywords, channel and Autopilot are all in place.
        </p>
        <GuideButton onClick={handleAsk} pending={isAsking} label="What now?" />
        {answer && <GuideBubble answer={answer} onClose={() => setAnswer(null)} />}
      </div>
    );
  }

  const next = journey.next;

  return (
    <div className="border border-ink-200 bg-white">
      {/* Progress header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-100 px-5 py-3">
        <div className="flex items-center gap-3">
          <span className="font-mono text-[11px] uppercase tracking-widest text-ink-400">Setup</span>
          <span className="font-mono text-[12px] text-ink-900">
            {journey.completed} / {journey.total}
          </span>
          <span className="h-1 w-28 bg-ink-100">
            <span className="block h-1 bg-ink-900" style={{ width: `${journey.percent}%` }} />
          </span>
        </div>
        <GuideButton onClick={handleAsk} pending={isAsking} label="Explain this step" />
      </div>

      {/* The chain */}
      {/* Column count follows the chain length; hardcoding 5 left an empty
          cell the moment Narrative made it six. */}
      <ol className="grid gap-px bg-ink-100 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-6">
        {journey.steps.map((s) => {
          const isCurrent = s.state === 'current';
          const isDone = s.state === 'done';
          const isLocked = s.state === 'locked';
          const content = (
            <>
              <div className="flex items-center gap-2">
                <span
                  className={`flex h-5 w-5 shrink-0 items-center justify-center font-mono text-[11px] ${
                    isDone
                      ? 'bg-signal text-signal-ink'
                      : isCurrent
                        ? 'bg-ink-900 text-white'
                        : 'bg-ink-100 text-ink-400'
                  }`}
                >
                  {isDone ? <Check className="h-3 w-3" /> : isLocked ? <Lock className="h-3 w-3" /> : s.order}
                </span>
                <span
                  className={`text-[13px] ${isCurrent ? 'font-semibold text-ink-900' : isDone ? 'text-ink-700' : 'text-ink-400'}`}
                >
                  {s.title}
                </span>
              </div>
              <p className={`mt-1.5 pl-7 text-[12px] ${isLocked ? 'text-ink-400' : 'text-ink-600'}`}>
                {isLocked ? `Needs ${s.blockedBy}` : s.detail}
              </p>
              {isCurrent && (
                <p className="mt-2 inline-flex items-center gap-1.5 pl-7 text-[12px] font-medium text-ink-900">
                  {s.action} <ArrowRight className="h-3 w-3" />
                </p>
              )}
            </>
          );

          return (
            <li key={s.id} className={`bg-white p-4 ${isCurrent ? 'ring-1 ring-inset ring-ink-900' : ''}`}>
              {isLocked ? (
                <div className="cursor-not-allowed opacity-70" title={`Needs ${s.blockedBy}`}>
                  {content}
                </div>
              ) : (
                <Link href={s.href as never} className="block hover:opacity-80">
                  {content}
                </Link>
              )}
            </li>
          );
        })}
      </ol>

      {/* Current step call-out */}
      {next && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-ink-100 bg-paper px-5 py-3">
          <p className="text-[13px] text-ink-700">
            <span className="font-semibold text-ink-900">You are here:</span> {next.why}
          </p>
          <Link
            href={next.href as never}
            className="inline-flex shrink-0 items-center gap-2 bg-ink-900 px-4 py-2 text-[13px] font-medium text-white hover:bg-ink-800"
          >
            {next.action} <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      )}

      {error && <p className="border-t border-ink-100 px-5 py-2 text-[12px] text-red-600">{error}</p>}
      {answer && (
        <div className="border-t border-ink-100 px-5 py-4">
          <GuideBubble answer={answer} onClose={() => setAnswer(null)} inline />
        </div>
      )}
    </div>
  );
}

function GuideButton({ onClick, pending, label }: { onClick: () => void; pending: boolean; label: string }) {
  return (
    <button
      onClick={onClick}
      disabled={pending}
      className="inline-flex items-center gap-1.5 border border-ink-200 px-3 py-1.5 text-[12.5px] font-medium text-ink-900 transition-colors hover:border-ink-400 disabled:opacity-60"
    >
      <Sparkles className="h-3.5 w-3.5 text-signal-dim" />
      {pending ? 'Thinking…' : label}
    </button>
  );
}

function GuideBubble({
  answer,
  onClose,
  inline,
}: {
  answer: GuideAnswer;
  onClose: () => void;
  inline?: boolean;
}) {
  return (
    <div className={inline ? '' : 'w-full'}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-display text-[15px] font-semibold text-ink-900">{answer.headline}</p>
          <p className="mt-1.5 max-w-2xl text-[13px] leading-relaxed text-ink-700">{answer.body}</p>
          {answer.action && answer.href && (
            <Link
              href={answer.href as never}
              className="mt-3 inline-flex items-center gap-1.5 text-[13px] font-medium text-ink-900 underline underline-offset-4"
            >
              {answer.action} <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          )}
          <p className="mt-2 font-mono text-[10.5px] uppercase tracking-widest text-ink-400">
            {answer.source === 'ai' ? 'written for this brand' : 'guide'}
          </p>
        </div>
        <button onClick={onClose} className="shrink-0 text-ink-400 hover:text-ink-900" aria-label="Dismiss">
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
