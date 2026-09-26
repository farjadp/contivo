'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';

import { Link } from '@/i18n/navigation';
import { ArrowRight, Check, Lock, Sparkles, X } from 'lucide-react';

import { explainNextStep, type GuideAnswer } from '@/app/actions/guide';
import type { Journey, Msg } from '@/lib/workspace-journey';

/**
 * The setup rail: shows the dependency chain as a chain, marks where the user
 * is, and offers an AI explanation of the current step in their brand's terms.
 * Collapses to a thin bar once setup is complete so it stops taking space.
 */
export function JourneyGuide({ workspaceId, journey }: { workspaceId: string; journey: Journey }) {
  const t = useTranslations('journey');
  const tg = useTranslations('journeyGuide');
  const format = useFormatter();
  /*
    `buildJourney` runs on the server with no request context, so it names its
    sentences instead of writing them. This is where they become words.
  */
  const msg = (m: Msg) => t(m.key, m.values);

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
      <div className="flex flex-wrap items-center justify-between gap-3 border border-rule bg-chalk-raised px-5 py-3">
        <p className="flex items-center gap-2 text-[13px] text-moss-muted">
          <Check className="h-4 w-4 text-moss-700" />
          {tg('complete')}
        </p>
        <GuideButton onClick={handleAsk} pending={isAsking} label={tg('whatNow')} />
        {answer && <GuideBubble answer={answer} onClose={() => setAnswer(null)} />}
      </div>
    );
  }

  const next = journey.next;

  return (
    <div className="border border-rule bg-chalk-raised">
      {/* Progress header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-rule px-5 py-3">
        <div className="flex items-center gap-3">
          <span className="font-plexmono text-[11px] uppercase tracking-widest text-moss-muted">
            {tg('setup')}
          </span>
          {/* Through the formatter so the counter reads ۳ / ۶ in Persian
              rather than Persian words around Latin digits. */}
          <span className="font-plexmono text-[12px] text-moss">
            {format.number(journey.completed)} / {format.number(journey.total)}
          </span>
          <span className="h-1 w-28 bg-chalk-sunk">
            <span className="block h-1 bg-moss" style={{ width: `${journey.percent}%` }} />
          </span>
        </div>
        <GuideButton onClick={handleAsk} pending={isAsking} label={tg('explainStep')} />
      </div>

      {/* The chain */}
      {/* Column count follows the chain length; hardcoding 5 left an empty
          cell the moment Narrative made it six. */}
      <ol className="grid gap-px bg-chalk-sunk sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-6">
        {journey.steps.map((s) => {
          const isCurrent = s.state === 'current';
          const isDone = s.state === 'done';
          const isLocked = s.state === 'locked';
          const content = (
            <>
              <div className="flex items-center gap-2">
                <span
                  className={`flex h-5 w-5 shrink-0 items-center justify-center font-plexmono text-[11px] ${
                    isDone
                      ? 'bg-moss-700 text-chalk'
                      : isCurrent
                        ? 'bg-moss text-chalk'
                        : 'bg-chalk-sunk text-moss-muted'
                  }`}
                >
                  {isDone ? <Check className="h-3 w-3" /> : isLocked ? <Lock className="h-3 w-3" /> : s.order}
                </span>
                <span
                  className={`text-[13px] ${isCurrent ? 'font-semibold text-moss' : isDone ? 'text-moss-muted' : 'text-moss-muted'}`}
                >
                  {msg(s.title)}
                </span>
              </div>
              <p className={`mt-1.5 ps-7 text-[12px] ${isLocked ? 'text-moss-muted' : 'text-moss-muted'}`}>
                {isLocked && s.blockedBy
                  ? tg('needs', { what: msg(s.blockedBy) })
                  : msg(s.detail)}
              </p>
              {isCurrent && (
                <p className="mt-2 inline-flex items-center gap-1.5 ps-7 text-[12px] font-medium text-moss">
                  {msg(s.action)} <ArrowRight className="h-3 w-3 rtl:rotate-180" />
                </p>
              )}
            </>
          );

          return (
            <li key={s.id} className={`bg-chalk-raised p-4 ${isCurrent ? 'ring-1 ring-inset ring-moss' : ''}`}>
              {isLocked ? (
                <div
                  className="cursor-not-allowed opacity-70"
                  title={s.blockedBy ? tg('needs', { what: msg(s.blockedBy) }) : undefined}
                >
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
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-rule bg-chalk-sunk px-5 py-3">
          <p className="text-[13px] text-moss-muted">
            <span className="font-semibold text-moss">{tg('youAreHere')}</span> {msg(next.why)}
          </p>
          <Link
            href={next.href as never}
            className="inline-flex shrink-0 items-center gap-2 bg-moss px-4 py-2 text-[13px] font-medium text-chalk hover:bg-moss-700"
          >
            {msg(next.action)} <ArrowRight className="h-4 w-4 rtl:rotate-180" />
          </Link>
        </div>
      )}

      {error && <p className="border-t border-rule px-5 py-2 text-[12px] text-red-600">{error}</p>}
      {answer && (
        <div className="border-t border-rule px-5 py-4">
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
      className="inline-flex items-center gap-1.5 border border-rule px-3 py-1.5 text-[12.5px] font-medium text-moss transition-colors hover:border-rule-strong disabled:opacity-60"
    >
      <Sparkles className="h-3.5 w-3.5 text-saffron-ink" />
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
  const tg = useTranslations('journeyGuide');

  return (
    <div className={inline ? '' : 'w-full'}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-display text-[15px] font-semibold text-moss">{answer.headline}</p>
          <p className="mt-1.5 max-w-2xl text-[13px] leading-relaxed text-moss-muted">{answer.body}</p>
          {answer.action && answer.href && (
            <Link
              href={answer.href as never}
              className="mt-3 inline-flex items-center gap-1.5 text-[13px] font-medium text-moss underline underline-offset-4"
            >
              {answer.action} <ArrowRight className="h-3.5 w-3.5 rtl:rotate-180" />
            </Link>
          )}
          <p className="mt-2 font-plexmono text-[10.5px] uppercase tracking-widest text-moss-muted">
            {tg(answer.source === 'ai' ? 'writtenForBrand' : 'guideLabel')}
          </p>
        </div>
        <button onClick={onClose} className="shrink-0 text-moss-muted hover:text-moss" aria-label={tg('dismiss')}>
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
