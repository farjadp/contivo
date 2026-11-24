/**
 * NextStepBar: the one next-step bar (spec first-post B §5). One line and at
 * most one button, sticky under the top bar, the same on the workspace page,
 * Today, Connections and the `?connected=` landing.
 *
 * Server component. The step comes from buildNextStep (lib/next-step.ts) fed
 * by loadNextStepInput; its Msg keys are root-relative, so the translator
 * has no namespace. A wait state (busy) shows progress and no button.
 * `confirmation` is the one-time line above it (the compact
 * ChannelConnectedNotice on the OAuth landing).
 */

import { Loader2 } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';

import type { NextStep, NextStepSurface } from '@/lib/first-post/types';

import { NextStepButton } from './NextStepButton';
import { barText, toButtonAction } from './next-step-logic';

export async function NextStepBar({
  step,
  surface,
  confirmation,
}: {
  step: NextStep | null;
  surface: NextStepSurface;
  confirmation?: ReactNode;
}) {
  if (!step) return confirmation ? <>{confirmation}</> : null;

  const t = await getTranslations();
  const text = barText(step, (key, values) => t(key as never, values as never));

  return (
    <section
      aria-label={text.line}
      data-next-step={step.id}
      className="sticky top-0 z-30 border border-moss bg-chalk-raised"
    >
      {confirmation && <div className="border-b border-rule">{confirmation}</div>}
      <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div className="flex min-w-0 items-start gap-3">
          {text.counter && (
            <span className="mt-0.5 shrink-0 bg-moss px-2 py-0.5 font-plexmono text-[11px] text-saffron">
              {text.counter}
            </span>
          )}
          <div className="min-w-0" aria-live="polite">
            <p className="flex items-center gap-2 text-[14px] font-semibold text-moss">
              {step.busy && <Loader2 aria-hidden className="h-4 w-4 shrink-0 animate-spin text-moss-muted" />}
              <span>{text.line}</span>
            </p>
            {text.why && <p className="mt-0.5 text-[12.5px] text-moss-muted">{text.why}</p>}
            {step.busy && <span className="sr-only">{t('nextStep.busy')}</span>}
          </div>
        </div>
        {step.action && text.label && !step.busy && (
          <NextStepButton stepId={step.id} surface={surface} label={text.label} action={toButtonAction(step.action)} />
        )}
      </div>
    </section>
  );
}
