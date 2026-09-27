'use client';

import { forwardRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { ChevronDown, Loader2, MinusCircle, Plus, Undo2 } from 'lucide-react';

import type { CompetitorView, RunHistoryItem } from '@/app/actions/growth-competitors';
import type { CompetitorType } from '@/lib/competitors/types';
import { DomainLink, ErrorNote, TypeSelect, WarningNote } from './CompetitorBits';
import { displayName, isRejectionReasonChip } from './competitor-discovery-logic';

export type LegacyRun = {
  id: string;
  runNumber: number;
  discoveredCount: number;
  createdAt: string | Date;
};

const bold = (chunks: ReactNode) => <bdi className="font-bold">{chunks}</bdi>;

const HISTORY_STATUSES = ['PENDING', 'RUNNING', 'DONE', 'EMPTY', 'FAILED'] as const;
type HistoryStatus = (typeof HISTORY_STATUSES)[number];
function historyStatus(value: string): HistoryStatus | null {
  return HISTORY_STATUSES.find((status) => status === value) ?? null;
}

export function CompetitorList({
  accepted,
  rejected,
  savingTypeIds,
  savingDecisionIds,
  removingIds,
  onType,
  onRemove,
  onBackToReview,
  addSlot,
}: {
  accepted: CompetitorView[];
  rejected: CompetitorView[];
  savingTypeIds: ReadonlySet<string>;
  savingDecisionIds: ReadonlySet<string>;
  removingIds: ReadonlySet<string>;
  onType: (competitor: CompetitorView, type: CompetitorType) => void;
  onRemove: (competitor: CompetitorView) => void;
  onBackToReview: (competitor: CompetitorView) => void;
  addSlot: ReactNode;
}) {
  const t = useTranslations('growth.competitors');
  const format = useFormatter();

  return (
    <div className="space-y-4">
      {accepted.length === 0 ? (
        <p className="text-sm text-moss-muted">{t('list.empty')}</p>
      ) : (
        <ul className="divide-y divide-rule rounded-xl border border-rule bg-chalk">
          {accepted.map((competitor) => {
            const removing = removingIds.has(competitor.id);
            return (
              <li key={competitor.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
                <div className="min-w-0 flex-1 space-y-0.5">
                  <p className="truncate text-sm font-semibold text-moss">
                    <bdi>{competitor.name}</bdi>
                  </p>
                  <div className="flex flex-wrap items-center gap-x-2">
                    <DomainLink domain={competitor.domain} />
                    {competitor.source === 'MANUAL' ? (
                      <span className="text-[11px] text-moss-muted">{t('list.addedByYou')}</span>
                    ) : null}
                  </div>
                </div>
                <TypeSelect
                  id={`accepted-type-${competitor.id}`}
                  value={competitor.type}
                  saving={savingTypeIds.has(competitor.id)}
                  onChange={(type) => onType(competitor, type)}
                />
                {/* Removing sets the competitor aside (REJECTED) rather than
                    deleting it, so it is never suggested again; the undo
                    strip that follows says so and can bring it back. */}
                <button
                  type="button"
                  disabled={removing}
                  onClick={() => onRemove(competitor)}
                  className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-moss-muted transition hover:bg-chalk-sunk hover:text-moss disabled:opacity-60"
                >
                  {removing ? <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" /> : <MinusCircle aria-hidden className="h-3.5 w-3.5" />}
                  {t('list.remove')}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {addSlot}

      {rejected.length > 0 ? (
        <details className="group rounded-xl border border-rule bg-chalk">
          <summary className="flex cursor-pointer list-none [&::-webkit-details-marker]:hidden items-center justify-between gap-2 px-4 py-3 text-sm font-semibold text-moss">
            <span>
              {t('list.setAside')}{' '}
              <span className="text-moss-muted">({format.number(rejected.length)})</span>
            </span>
            <ChevronDown aria-hidden className="h-4 w-4 text-moss-muted transition-transform group-open:rotate-180" />
          </summary>
          <ul className="divide-y divide-rule border-t border-rule">
            {rejected.map((competitor) => {
              const reason = competitor.rejectionReason;
              return (
                <li key={competitor.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-moss">
                      <bdi>{competitor.name}</bdi>
                    </p>
                    {isRejectionReasonChip(reason) ? (
                      <p className="text-[11px] text-moss-muted">{t(`reasons.${reason}`)}</p>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    disabled={savingDecisionIds.has(competitor.id)}
                    onClick={() => onBackToReview(competitor)}
                    className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-moss-700 transition hover:bg-chalk-sunk disabled:opacity-60"
                  >
                    {savingDecisionIds.has(competitor.id) ? (
                      <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Undo2 aria-hidden className="h-3.5 w-3.5 rtl:-scale-x-100" />
                    )}
                    {t('list.backToReview')}
                  </button>
                </li>
              );
            })}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

export const ManualCompetitorForm = forwardRef<
  HTMLInputElement,
  {
    adding: boolean;
    error: string | null;
    addedName: string | null;
    warning: string | null;
    onAdd: (domain: string) => Promise<boolean>;
  }
>(function ManualCompetitorForm({ adding, error, addedName, warning, onAdd }, ref) {
  const t = useTranslations('growth.competitors');
  const [domain, setDomain] = useState('');

  return (
    <form
      className="space-y-3 rounded-xl border border-rule bg-chalk p-4"
      onSubmit={async (event) => {
        event.preventDefault();
        const value = domain.trim();
        if (!value) return;
        if (await onAdd(value)) setDomain('');
      }}
    >
      <div className="space-y-1">
        <label htmlFor="competitor-manual-domain" className="text-sm font-bold text-moss">
          {t('add.title')}
        </label>
        <p className="text-xs text-moss-muted">{t('add.hint')}</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
        <input
          ref={ref}
          id="competitor-manual-domain"
          type="text"
          inputMode="url"
          autoComplete="off"
          value={domain}
          onChange={(event) => setDomain(event.target.value)}
          placeholder={t('add.placeholder')}
          dir="ltr"
          className="w-full rounded-lg border border-rule-strong bg-chalk-raised px-3 py-2 text-sm text-moss focus:border-moss focus:outline-none"
        />
        <button
          type="submit"
          disabled={adding || !domain.trim()}
          className="inline-flex items-center justify-center gap-2 rounded-lg border border-rule-strong bg-chalk-raised px-4 py-2 text-sm font-bold text-moss transition hover:bg-chalk-sunk disabled:opacity-60"
        >
          {adding ? <Loader2 aria-hidden className="h-4 w-4 animate-spin" /> : <Plus aria-hidden className="h-4 w-4" />}
          {t('add.button')}
        </button>
      </div>
      {error ? <ErrorNote>{error}</ErrorNote> : null}
      {addedName && !error ? (
        warning ? (
          <WarningNote>
            <p>{t.rich('add.added', { name: addedName, b: bold })}</p>
            <p className="mt-1">
              <span className="font-semibold">{t('add.warning')}</span>{' '}
              <span dir="auto">{warning}</span>
            </p>
          </WarningNote>
        ) : (
          <p role="status" className="text-sm text-moss-700">
            {t.rich('add.added', { name: addedName, b: bold })}
          </p>
        )
      ) : null}
    </form>
  );
});

export function RunHistory({ runs, legacy }: { runs: RunHistoryItem[]; legacy: LegacyRun[] }) {
  const t = useTranslations('growth.competitors');
  const format = useFormatter();
  const locale = useLocale();
  const total = runs.length + legacy.length;

  const when = (value: string | Date) => {
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? '' : format.dateTime(date, { dateStyle: 'medium', timeStyle: 'short' });
  };

  return (
    <details className="group rounded-xl border border-rule bg-chalk">
      <summary className="flex cursor-pointer list-none [&::-webkit-details-marker]:hidden items-center justify-between gap-2 px-4 py-3 text-sm font-semibold text-moss">
        <span>
          {t('history.title')} <span className="text-moss-muted">({format.number(total)})</span>
        </span>
        <ChevronDown aria-hidden className="h-4 w-4 text-moss-muted transition-transform group-open:rotate-180" />
      </summary>
      {total === 0 ? (
        <p className="border-t border-rule px-4 py-3 text-sm text-moss-muted">{t('history.empty')}</p>
      ) : (
        <ul className="divide-y divide-rule border-t border-rule">
          {runs.map((run) => {
            const status = historyStatus(run.status);
            const notCharged = run.status === 'EMPTY' || run.status === 'FAILED';
            const details: string[] = [];
            if (run.market) {
              details.push(
                t('history.market', {
                  country: run.market.country
                    ? displayName(locale, 'region', run.market.country)
                    : t('market.everywhere'),
                  language: displayName(locale, 'language', run.market.language),
                }),
              );
            }
            if (run.queryCount != null) details.push(t('history.queries', { count: run.queryCount }));
            if (run.status === 'DONE') {
              details.push(t('history.found', { count: run.foundCount }));
              details.push(t('history.accepted', { count: run.acceptedCount }));
            }
            if (notCharged) details.push(t('history.notCharged'));
            return (
              <li key={run.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2.5 text-sm">
                <span className="text-moss">
                  {status ? t(`history.status.${status}`) : null}
                  {details.map((detail) => (
                    <span key={detail} className="text-moss-muted">
                      {' · '}
                      {detail}
                    </span>
                  ))}
                </span>
                <span className="text-xs text-moss-muted">{when(run.startedAt)}</span>
              </li>
            );
          })}
          {legacy.map((run) => (
            <li key={run.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2.5 text-sm">
              <span className="text-moss">
                {t('history.legacy')}
                <span className="text-moss-muted"> · {t('history.found', { count: run.discoveredCount })}</span>
              </span>
              <span className="text-xs text-moss-muted">{when(run.createdAt)}</span>
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}
