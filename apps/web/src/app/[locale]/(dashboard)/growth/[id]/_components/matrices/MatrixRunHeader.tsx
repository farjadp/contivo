'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { Check, Circle, Info, Loader2, RefreshCw, Sparkles } from 'lucide-react';

import { Link } from '@/i18n/navigation';
import type { MatrixStatus } from '@/app/actions/growth-matrices';
import { ErrorNote, WarningNote } from '../CompetitorBits';
import {
  MATRIX_STAGE_ORDER,
  basisNotice,
  emptyStateReason,
  isMatricesStale,
  isMatrixRunActive,
  stageIndex,
} from './matrix-run-logic';

/**
 * Spec §6.1: what the matrices are built on, when they last ran, whether they
 * are stale, the live stage list during a run, why a run failed, and what is
 * missing when one cannot start.
 */
export function MatrixRunHeader({
  workspaceId,
  status,
  loadState,
  matrices,
  starting,
  startError,
  pollStopped,
  hasAxesToEdit,
  onStart,
  onOpenAxes,
}: {
  workspaceId: string;
  status: MatrixStatus | null;
  loadState: 'loading' | 'ready' | 'error';
  /** The saved result the page rendered with (the projection blob), if any. */
  matrices: unknown;
  starting: boolean;
  startError: string | null;
  pollStopped: boolean;
  hasAxesToEdit: boolean;
  onStart: () => void;
  onOpenAxes: () => void;
}) {
  const t = useTranslations('tabsB.matrices.run');
  const tBasis = useTranslations('growth.competitors.basis');
  const format = useFormatter();

  const run = status?.run ?? null;
  const active = isMatrixRunActive(run?.status);
  const missing = status ? emptyStateReason(status) : null;
  const hasMatrices = matrices != null;
  const notice = hasMatrices ? basisNotice(matrices) : null;
  const stale = hasMatrices && isMatricesStale(matrices);
  const currentStage = stageIndex(run?.stage);
  const lastRunAt = run?.status === 'DONE' ? run.finishedAt : null;
  const busy = starting || active;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <button
          type="button"
          onClick={onStart}
          disabled={busy || loadState !== 'ready' || missing !== null}
          className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-moss px-5 py-2 text-[13px] font-bold text-chalk transition hover:bg-moss-700 disabled:opacity-50"
        >
          {busy ? (
            <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
          ) : (
            <Sparkles aria-hidden className="h-4 w-4 text-saffron" />
          )}
          {hasMatrices ? t('rebuild') : t('start')}
        </button>
        {hasAxesToEdit && !active ? (
          <button
            type="button"
            onClick={onOpenAxes}
            className="inline-flex min-h-10 items-center rounded-lg border border-rule bg-chalk-raised px-4 py-2 text-[13px] font-bold text-moss transition hover:border-rule-strong hover:bg-chalk"
          >
            {t('axesButton')}
          </button>
        ) : null}
        {status ? (
          <p className="text-xs text-moss-muted">
            {status.basis === 'NONE'
              ? t('basis.NONE')
              : t('competitorLine', {
                  basis: t(`basis.${status.basis}`),
                  count: status.competitorCount,
                  formatted: format.number(status.competitorCount),
                })}
          </p>
        ) : loadState === 'loading' ? (
          <p className="text-xs text-moss-muted">{t('loading')}</p>
        ) : null}
        {lastRunAt ? (
          <p className="text-xs text-moss-muted">
            {t('lastRun', { date: format.dateTime(new Date(lastRunAt), { dateStyle: 'medium', timeStyle: 'short' }) })}
          </p>
        ) : null}
      </div>

      {loadState === 'error' ? <ErrorNote>{t('statusFailed')}</ErrorNote> : null}
      {startError && run?.status !== 'FAILED' ? <ErrorNote>{startError}</ErrorNote> : null}

      {missing ? (
        <div role="status" className="rounded-xl border border-rule bg-chalk-sunk px-4 py-3 text-sm text-moss">
          <p className="font-semibold">{t(`empty.${missing}.title`)}</p>
          <p className="mt-1 text-moss-muted">{t(`empty.${missing}.body`)}</p>
          {missing === 'competitors' ? (
            <a href="#matrices-competitors" className="mt-2 inline-block font-semibold text-moss underline underline-offset-2">
              {t('empty.competitors.link')}
            </a>
          ) : (
            <Link
              href={{ pathname: '/growth/[id]', params: { id: workspaceId }, query: { tab: 'strategy' } }}
              className="mt-2 inline-block font-semibold text-moss underline underline-offset-2"
            >
              {t('empty.brandSummary.link')}
            </Link>
          )}
        </div>
      ) : null}

      {stale && !active ? (
        <WarningNote>
          <span className="flex flex-wrap items-center justify-between gap-3">
            <span>{t('stale')}</span>
            <button
              type="button"
              onClick={onStart}
              disabled={busy || missing !== null}
              className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-saffron bg-chalk-raised px-3 py-1.5 text-xs font-bold text-saffron-ink transition hover:bg-chalk disabled:opacity-50"
            >
              <RefreshCw aria-hidden className="h-3.5 w-3.5" />
              {t('regenerate')}
            </button>
          </span>
        </WarningNote>
      ) : null}

      {notice === 'unconfirmed' ? <WarningNote>{tBasis('unconfirmed')}</WarningNote> : null}
      {notice === 'legacy' ? (
        <p role="note" className="flex items-start gap-2 text-xs leading-relaxed text-moss-muted">
          <Info aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{t('legacy')}</span>
        </p>
      ) : null}

      {run?.status === 'FAILED' ? (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <p className="font-semibold">{t('failed.title')}</p>
          <p className="mt-1">{t(`failed.${run.errorKind ?? 'generic'}`)}</p>
        </div>
      ) : null}

      {pollStopped ? <WarningNote>{t('pollStopped')}</WarningNote> : null}

      {active || starting ? (
        <div className="space-y-3 border-t border-rule pt-4" aria-live="polite">
          <ol className="space-y-2">
            {MATRIX_STAGE_ORDER.map((stage, index) => {
              const state = index < currentStage ? 'done' : index === currentStage ? 'current' : 'upcoming';
              return (
                <li
                  key={stage}
                  className={`flex items-center gap-2 text-sm ${
                    state === 'current' ? 'font-semibold text-moss' : state === 'done' ? 'text-moss-700' : 'text-moss-muted'
                  }`}
                >
                  {state === 'done' ? (
                    <Check aria-hidden className="h-4 w-4 shrink-0 text-moss-700" />
                  ) : state === 'current' ? (
                    <Loader2 aria-hidden className="h-4 w-4 shrink-0 animate-spin text-saffron-ink" />
                  ) : (
                    <Circle aria-hidden className="h-4 w-4 shrink-0 text-rule-strong" />
                  )}
                  <span>{t(`stages.${stage}`)}</span>
                  {state !== 'upcoming' ? (
                    <span className="sr-only">{state === 'done' ? t('stageDone') : t('stageCurrent')}</span>
                  ) : null}
                </li>
              );
            })}
          </ol>
          {currentStage < 0 ? <p className="text-sm text-moss-muted">{t('starting')}</p> : null}
          <p className="text-xs text-moss-muted">{t('leaveNote')}</p>
        </div>
      ) : null}
    </div>
  );
}
