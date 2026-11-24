'use client';

/**
 * RunProgress.tsx
 *
 * The wait (spec first-post B §4.2): four rows, each finished one saying what
 * it found (stored values only), the current one working. On a failure the
 * failed row says what broke in plain words. The one "Try again" is the
 * bar's button (B8), so the view adds none; after a second failure of the
 * same step, "Write my own instead" and "Report a problem". Finished rows
 * stay ticked either way.
 */

import { useTranslations } from 'next-intl';
import { Check, Loader2, X } from 'lucide-react';

import { useBugReport } from '@/components/bug-report/BugReportProvider';
import type { FirstPostState } from '@/lib/first-post/types';

import { WriteOwnButton } from './DraftCard';
import { primaryButton, quietLink } from './PublishPanel';
import { runRows, stepSummaryMessage, type RunRowStatus } from './first-post-view-logic';

const BOX: Record<RunRowStatus, string> = {
  done: 'border-moss bg-moss text-saffron',
  current: 'border-saffron text-moss-700',
  failed: 'border-red-700 bg-red-50 text-red-700',
  pending: 'border-rule-strong',
};

export function RunProgress({
  workspaceId,
  state,
  headingId,
}: {
  workspaceId: string;
  state: Extract<FirstPostState, { phase: 'running' | 'failed' }>;
  headingId: string;
}) {
  const t = useTranslations('tabsA.firstPost');
  const report = useBugReport();

  const rows = runRows(state);
  const failed = state.phase === 'failed' ? state : null;

  return (
    <div className="max-w-3xl">
      <h2
        id={headingId}
        tabIndex={-1}
        className="font-display text-[26px] font-semibold leading-tight tracking-tight text-moss focus:outline-none sm:text-[32px]"
      >
        {t('progress.title')}
      </h2>
      {failed ? null : <p className="mt-2 text-[15px] text-moss-muted">{t('progress.lede')}</p>}

      {/* One announcement per change: the current step, or what failed. */}
      <p className="sr-only" aria-live="polite">
        {state.phase === 'running' ? t('progress.now', { step: t(`progress.steps.${state.current}`) }) : ''}
      </p>

      <ol className="mt-6">
        {rows.map((row) => {
          const summary = row.result ? stepSummaryMessage(row.result) : null;
          return (
            <li key={row.step} className="flex items-start gap-4 border-t border-rule py-4 last:border-b">
              <span
                className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border-[1.5px] ${BOX[row.status]}`}
              >
                {row.status === 'done' ? <Check className="h-3.5 w-3.5" strokeWidth={3} aria-hidden="true" /> : null}
                {row.status === 'current' ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : null}
                {row.status === 'failed' ? <X className="h-3.5 w-3.5" strokeWidth={3} aria-hidden="true" /> : null}
                <span className="sr-only">{t(`progress.status.${row.status}`)}</span>
              </span>
              <div className="min-w-0">
                <p className={`font-semibold ${row.status === 'pending' ? 'text-moss-muted' : 'text-moss'}`}>
                  {t(`progress.steps.${row.step}`)}
                </p>
                {summary ? (
                  <p dir="auto" className="mt-1 text-[13.5px] text-moss-muted">
                    {t(`progress.summary.${summary.key}`, summary.values)}
                  </p>
                ) : null}
                {row.status === 'failed' && failed ? (
                  <div role="alert" className="mt-1 text-[13.5px] text-red-800">
                    <p className="font-semibold">{t(`failed.line.${row.step}`)}</p>
                    <p>{t(`failed.reason.${failed.errorKind}`)}</p>
                  </div>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>

      {failed ? (
        <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-3">
          <WriteOwnButton
            workspaceId={workspaceId}
            label={t('failed.writeOwn')}
            className={failed.retriesLeft > 0 || failed.errorKind === 'needsBrandSummary' ? quietLink : primaryButton}
          />
          {failed.retriesLeft === 0 && report ? (
            <button type="button" onClick={() => report.openReport()} data-action="report-open" className={quietLink}>
              {t('failed.report')}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
