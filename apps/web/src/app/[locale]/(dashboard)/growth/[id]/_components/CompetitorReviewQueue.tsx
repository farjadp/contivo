'use client';

import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Check, Loader2, Undo2, X } from 'lucide-react';

import type { CompetitorView } from '@/app/actions/growth-competitors';
import type { CompetitorType } from '@/lib/competitors/types';
import { ConfidenceWord, DomainLink, LabelChips, SafeExternalLink, TypeSelect } from './CompetitorBits';
import {
  REJECTION_REASON_CHIPS,
  evidenceQueries,
  splitEvidence,
  type RejectionReasonChip,
} from './competitor-discovery-logic';

export type LastDecision = {
  id: string;
  name: string;
  /** What just happened: accepted or set aside from the queue, or removed from the accepted list. */
  kind: 'ACCEPTED' | 'REJECTED' | 'REMOVED';
  /** The decision Undo restores. */
  previous: 'PENDING' | 'ACCEPTED';
  reason: RejectionReasonChip | null;
  busy: boolean;
};

const bold = (chunks: ReactNode) => <bdi className="font-bold">{chunks}</bdi>;

/**
 * The undo strip shown after an accept, a reject or a removal. A reject or
 * removal also offers the optional reason chips. Only the message is a live
 * region; the buttons around it are not re-announced on every change.
 */
export function DecisionUndoBar({
  last,
  onUndo,
  onReason,
  onDismiss,
}: {
  last: LastDecision;
  onUndo: () => void;
  onReason: (reason: RejectionReasonChip) => void;
  onDismiss: () => void;
}) {
  const t = useTranslations('growth.competitors');
  return (
    <div className="space-y-3 rounded-xl border border-rule-strong bg-chalk-sunk px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <p role="status" aria-live="polite" className="min-w-0 flex-1 text-sm text-moss">
          {last.kind === 'ACCEPTED'
            ? t.rich('undo.accepted', { name: last.name, b: bold })
            : last.kind === 'REMOVED'
              ? t.rich('undo.removed', { name: last.name, b: bold })
              : t.rich('undo.rejected', { name: last.name, b: bold })}
        </p>
        <button
          type="button"
          onClick={onUndo}
          disabled={last.busy}
          className="inline-flex items-center gap-1.5 rounded-lg border border-rule-strong bg-chalk-raised px-3 py-1.5 text-sm font-semibold text-moss transition hover:bg-chalk disabled:opacity-60"
        >
          {last.busy ? <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" /> : <Undo2 aria-hidden className="h-3.5 w-3.5 rtl:-scale-x-100" />}
          {t('undo.undo')}
        </button>
        <button
          type="button"
          onClick={onDismiss}
          aria-label={t('undo.dismiss')}
          className="rounded-lg p-1.5 text-moss-muted transition hover:bg-chalk hover:text-moss"
        >
          <X aria-hidden className="h-4 w-4" />
        </button>
      </div>
      {last.kind !== 'ACCEPTED' ? (
        <div className="space-y-2">
          <p className="text-xs text-moss-muted" aria-live="polite">
            {last.reason ? t('undo.reasonSaved') : t('undo.reasonPrompt')}
          </p>
          <div className="flex flex-wrap gap-2">
            {REJECTION_REASON_CHIPS.map((reason) => {
              const chosen = last.reason === reason;
              return (
                <button
                  key={reason}
                  type="button"
                  aria-pressed={chosen}
                  disabled={last.busy}
                  onClick={() => onReason(reason)}
                  className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-semibold transition disabled:opacity-60 ${
                    chosen
                      ? 'border-moss bg-moss text-chalk'
                      : 'border-rule-strong bg-chalk-raised text-moss hover:bg-chalk'
                  }`}
                >
                  {chosen ? <Check aria-hidden className="h-3 w-3" /> : null}
                  {t(`reasons.${reason}`)}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function CompetitorReviewQueue({
  competitors,
  savingDecisionIds,
  savingTypeIds,
  onDecision,
  onType,
}: {
  competitors: CompetitorView[];
  savingDecisionIds: ReadonlySet<string>;
  savingTypeIds: ReadonlySet<string>;
  onDecision: (competitor: CompetitorView, decision: 'ACCEPTED' | 'REJECTED') => void;
  onType: (competitor: CompetitorView, type: CompetitorType) => void;
}) {
  const t = useTranslations('growth.competitors');

  if (competitors.length === 0) {
    return <p className="text-sm text-moss-muted">{t('queue.empty')}</p>;
  }

  return (
    <ul className="space-y-3">
      {competitors.map((competitor) => (
        <ReviewCard
          key={competitor.id}
          competitor={competitor}
          savingDecision={savingDecisionIds.has(competitor.id)}
          savingType={savingTypeIds.has(competitor.id)}
          onDecision={(decision) => onDecision(competitor, decision)}
          onType={(type) => onType(competitor, type)}
        />
      ))}
    </ul>
  );
}

function ReviewCard({
  competitor,
  savingDecision,
  savingType,
  onDecision,
  onType,
}: {
  competitor: CompetitorView;
  savingDecision: boolean;
  savingType: boolean;
  onDecision: (decision: 'ACCEPTED' | 'REJECTED') => void;
  onType: (type: CompetitorType) => void;
}) {
  const t = useTranslations('growth.competitors');
  const queries = evidenceQueries(competitor.evidence);
  const { sources, sitePages } = splitEvidence(competitor.evidence);
  const hasSiteSummary = Boolean(competitor.positioning) || competitor.keyFeatures.length > 0 || sitePages.length > 0;
  const hasEvidence = queries.length > 0 || sources.length > 0 || hasSiteSummary;

  return (
    <li className="rounded-xl border border-rule bg-chalk p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="truncate text-sm font-bold text-moss">
            <bdi>{competitor.name}</bdi>
          </p>
          <DomainLink domain={competitor.domain} />
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => onDecision('ACCEPTED')}
            disabled={savingDecision}
            className="inline-flex items-center gap-1.5 rounded-lg bg-moss px-3 py-1.5 text-sm font-bold text-chalk transition hover:bg-moss-700 disabled:opacity-60"
          >
            {savingDecision ? <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" /> : <Check aria-hidden className="h-3.5 w-3.5" />}
            {t('queue.accept')}
          </button>
          <button
            type="button"
            onClick={() => onDecision('REJECTED')}
            disabled={savingDecision}
            className="inline-flex items-center gap-1.5 rounded-lg border border-rule-strong bg-chalk-raised px-3 py-1.5 text-sm font-semibold text-moss transition hover:bg-chalk-sunk disabled:opacity-60"
          >
            <X aria-hidden className="h-3.5 w-3.5" />
            {t('queue.reject')}
          </button>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <ConfidenceWord band={competitor.confidenceBand} />
        <LabelChips labels={competitor.labels} />
        <TypeSelect id={`type-${competitor.id}`} value={competitor.type} saving={savingType} onChange={onType} />
      </div>

      {competitor.description ? (
        <p dir="auto" className="mt-3 line-clamp-2 text-sm leading-relaxed text-moss">
          {competitor.description}
        </p>
      ) : null}

      <details className="group mt-3 border-t border-rule pt-3">
        <summary className="cursor-pointer text-sm font-semibold text-moss-700 hover:text-moss">{t('queue.why')}</summary>
        <div className="mt-3 space-y-4 text-sm">
          {!hasEvidence ? <p className="text-moss-muted">{t('queue.noEvidence')}</p> : null}

          {queries.length > 0 ? (
            <section className="space-y-2">
              <h5 className="text-xs font-bold text-moss-muted">{t('queue.queries')}</h5>
              <ul className="flex flex-wrap gap-2">
                {queries.map((query) => (
                  <li key={query} dir="auto" className="rounded-full border border-rule bg-chalk-raised px-2.5 py-0.5 text-xs text-moss">
                    {query}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {sources.length > 0 ? (
            <section className="space-y-2">
              <h5 className="text-xs font-bold text-moss-muted">{t('queue.sources')}</h5>
              <ul className="space-y-2">
                {sources.map((item) => (
                  <li key={item.id + item.url} className="space-y-0.5">
                    <SafeExternalLink url={item.url} className="max-w-full text-sm font-semibold text-moss">
                      <span dir="auto" className="break-words">
                        {item.title || item.url}
                      </span>
                    </SafeExternalLink>
                    {item.snippet ? (
                      <p dir="auto" className="line-clamp-3 text-xs leading-relaxed text-moss-muted">
                        {item.snippet}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {hasSiteSummary ? (
            <section className="space-y-2">
              <h5 className="text-xs font-bold text-moss-muted">{t('queue.site')}</h5>
              {competitor.positioning ? (
                <p dir="auto" className="leading-relaxed text-moss">
                  {competitor.positioning}
                </p>
              ) : null}
              {competitor.keyFeatures.length > 0 ? (
                <div className="space-y-1">
                  <p className="text-xs font-semibold text-moss-muted">{t('queue.features')}</p>
                  <ul className="list-disc space-y-0.5 ps-5 text-moss">
                    {competitor.keyFeatures.map((feature, index) => (
                      <li key={`${index}-${feature}`} dir="auto">
                        {feature}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {sitePages.length > 0 ? (
                <div className="space-y-1">
                  <p className="text-xs font-semibold text-moss-muted">{t('queue.sitePages')}</p>
                  <ul className="space-y-1">
                    {sitePages.map((page) => (
                      <li key={page.id + page.url}>
                        <SafeExternalLink url={page.url} className="max-w-full text-xs text-moss">
                          <span dir="auto" className="break-all">
                            {page.title || page.url}
                          </span>
                        </SafeExternalLink>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </section>
          ) : null}
        </div>
      </details>
    </li>
  );
}
