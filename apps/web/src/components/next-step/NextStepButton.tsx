'use client';

/**
 * The bar's one button (spec first-post B §5). Every kind first awaits
 * recordNextStepClick, so the NEXT_STEP_CLICKED row is not lost to a page
 * unload (the LinkedIn redirect in particular), then acts:
 * - link: client navigation; an external link opens a new tab and logs
 *   without waiting, because this page does not unload;
 * - connectLinkedIn: getSocialConnectUrl, then the browser goes to LinkedIn;
 * - retryFirstPost / otherAngle: startFirstPost / firstPostOtherAngle on the
 *   first-post tab, then a refresh so the view shows the run;
 * - publishNow: publishNow, then a refresh so the bar and view show
 *   "Publishing…". A refusal opens the first-post tab with `?publish=<refusal>`,
 *   and the view's publish panel says why (no connection, quality gate).
 */

import { ArrowRight, ExternalLink, Loader2 } from 'lucide-react';
import { useState, useTransition } from 'react';

import { firstPostOtherAngle, startFirstPost } from '@/app/actions/first-post';
import { recordNextStepClick } from '@/app/actions/next-step';
import { publishNow } from '@/app/actions/publish-now';
import { getSocialConnectUrl } from '@/app/actions/social-connect';
import { useRouter } from '@/i18n/navigation';
import { publishRefusalHref, refusalFromReason } from '@/lib/first-post/publish-refusal';
import type { NextStepId, NextStepSurface } from '@/lib/first-post/types';

/** NextStepAction with its label already translated. */
export type NextStepButtonAction =
  | { kind: 'link'; href: string; external?: true }
  | { kind: 'connectLinkedIn'; workspaceId: string }
  | { kind: 'publishNow'; contentItemId: string; href: string }
  | { kind: 'retryFirstPost' | 'otherAngle'; workspaceId: string; href: string };

const BUTTON =
  'inline-flex min-h-10 shrink-0 items-center justify-center gap-2 bg-moss px-4 py-2 text-[13px] font-semibold text-chalk transition-colors hover:bg-moss-700 disabled:cursor-wait disabled:opacity-70';

async function logClick(stepId: NextStepId, surface: NextStepSurface) {
  try {
    await recordNextStepClick(stepId, surface);
  } catch (error) {
    // A lost funnel row must never block the user's next step.
    console.error('recordNextStepClick failed:', error);
  }
}

export function NextStepButton({
  stepId,
  surface,
  label,
  action,
}: {
  stepId: NextStepId;
  surface: NextStepSurface;
  label: string;
  action: NextStepButtonAction;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState('');

  if (action.kind === 'link' && action.external) {
    return (
      <a
        href={action.href}
        target="_blank"
        rel="noopener noreferrer"
        onClick={() => void logClick(stepId, surface)}
        className={BUTTON}
      >
        {label}
        <ExternalLink className="h-3.5 w-3.5" />
      </a>
    );
  }

  const onClick = () => {
    setError('');
    start(async () => {
      await logClick(stepId, surface);
      if (action.kind === 'link') {
        router.push(action.href as never);
        return;
      }
      if (action.kind === 'connectLinkedIn') {
        const result = await getSocialConnectUrl('linkedin', action.workspaceId);
        if ('url' in result) {
          window.location.assign(result.url);
          return;
        }
        setError(result.error);
        return;
      }
      if (action.kind !== 'publishNow') {
        // On the first-post tab: start the run, then refresh so the view polls it.
        const run = action.kind === 'retryFirstPost' ? startFirstPost : firstPostOtherAngle;
        const result = await run(action.workspaceId);
        if ('ok' in result && result.ok) {
          router.refresh();
          return;
        }
        setError(result.error);
        return;
      }
      const result = await publishNow(action.contentItemId);
      if (result.ok) {
        router.refresh();
        return;
      }
      router.push(publishRefusalHref(action.href, refusalFromReason(result.reason)) as never);
    });
  };

  return (
    <div className="flex shrink-0 flex-col items-stretch gap-1 sm:items-end">
      <button type="button" onClick={onClick} disabled={pending} aria-busy={pending} className={BUTTON}>
        {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
        {label}
        {!pending && <ArrowRight className="h-3.5 w-3.5 rtl:rotate-180" />}
      </button>
      {error && (
        <p role="alert" className="max-w-xs text-[12px] text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
