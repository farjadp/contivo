'use client';

import { useEffect, useRef, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { Minus, Pencil, Plus, Undo2, X } from 'lucide-react';

import { clearMatrixOverride, setMatrixOverride } from '@/app/actions/growth-matrices';
import { ConfidenceWord, ErrorNote, SafeExternalLink } from '../CompetitorBits';
import { legendKeyForType } from './MatrixChart';
import { bandOf, canOverride, compactDomain, type ChartView, type CompanyView } from './matrix-view';

const MIN = 1;
const MAX = 10;

type Axis = 'x' | 'y';

/** What the point looked like before the last change, so Undo can put it back. */
type Previous = { x: number; y: number; hadOverride: boolean };

type Notice = { kind: 'saved' | 'undone' | 'cleared'; previous: Previous | null } | { kind: 'error'; message: string };

/**
 * Spec §6.4: both reasons, the evidence that still exists, the confidence as a
 * word, and two steppers that write a manual override. The server returns the
 * rebuilt result with every save, so the page updates without a refetch.
 */
export function PointDrawer({
  workspaceId,
  chart,
  company,
  onClose,
  onMatricesChange,
}: {
  workspaceId: string;
  chart: ChartView;
  company: CompanyView;
  onClose: () => void;
  onMatricesChange: (matrices: unknown) => void;
}) {
  const t = useTranslations('tabsB.matrices');
  const tType = useTranslations('tabsB.matrices.legend');
  const format = useFormatter();
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  const headingRef = useRef<HTMLHeadingElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const editable = canOverride(company);
  const competitorId = company.competitor_id ?? null;
  const pointKey = `${chart.chart_key}::${company.name}::${company.website}`;

  // A different point is a different conversation: drop the last notice.
  useEffect(() => {
    setNotice(null);
  }, [pointKey]);

  // The drawer is only mounted while open, so this Escape listener and the
  // focus handling below exist only then. Focus goes to the heading on open
  // and back to whatever opened the drawer when it closes.
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    openerRef.current = opener;
    return () => {
      if (opener && opener.isConnected) opener.focus();
    };
  }, []);

  useEffect(() => {
    headingRef.current?.focus();
  }, [pointKey]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const fail = (message: string) => setNotice({ kind: 'error', message });

  const run = async (
    action: () => Promise<{ matrices: unknown } | { error: string }>,
    onDone: Notice,
  ) => {
    setSaving(true);
    try {
      const result = await action();
      if ('error' in result) {
        fail(result.error);
        return;
      }
      onMatricesChange(result.matrices);
      setNotice(onDone);
    } catch (error) {
      console.error(error);
      fail(t('drawer.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const previous: Previous = { x: company.x_score, y: company.y_score, hadOverride: company.override != null };

  const step = (axis: Axis, delta: number) => {
    const current = axis === 'x' ? company.x_score : company.y_score;
    const next = Math.max(MIN, Math.min(MAX, current + delta));
    if (next === current) return;
    void run(
      () => setMatrixOverride(workspaceId, chart.chart_key, competitorId, axis === 'x' ? { xScore: next } : { yScore: next }),
      { kind: 'saved', previous },
    );
  };

  const backToAi = () => void run(() => clearMatrixOverride(workspaceId, chart.chart_key, competitorId), { kind: 'cleared', previous: null });

  const undo = () => {
    if (!notice || notice.kind !== 'saved' || !notice.previous) return;
    const before = notice.previous;
    void run(
      () =>
        before.hadOverride
          ? setMatrixOverride(workspaceId, chart.chart_key, competitorId, { xScore: before.x, yScore: before.y })
          : clearMatrixOverride(workspaceId, chart.chart_key, competitorId),
      { kind: 'undone', previous: null },
    );
  };

  const rows: Array<{ axis: Axis; label: string; score: number; reason: string; ai: number | null }> = [
    { axis: 'x', label: chart.axes.x, score: company.x_score, reason: company.x_reason, ai: company.override?.ai_x_score ?? null },
    { axis: 'y', label: chart.axes.y, score: company.y_score, reason: company.y_reason, ai: company.override?.ai_y_score ?? null },
  ];

  const evidence = company.evidence;
  const showEvidence = evidence !== undefined && (evidence.length > 0 || company.evidence_missing === true);

  return (
    <aside
      aria-label={company.name}
      className="flex w-full min-w-0 max-w-full flex-col gap-5 rounded-2xl border border-rule bg-chalk-raised p-4 shadow-sm sm:p-5"
    >
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-bold uppercase tracking-widest text-moss-muted">
            {tType(legendKeyForType(company.type))}
          </p>
          <h4 ref={headingRef} tabIndex={-1} className="break-words text-lg font-bold tracking-tight text-moss focus:outline-none">
            <bdi>{company.name}</bdi>
          </h4>
          <p className="truncate text-[12px] text-moss-muted" dir="ltr">
            {compactDomain(company.website)}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-rule text-moss hover:border-rule-strong hover:bg-chalk"
        >
          <X aria-hidden className="h-4 w-4" />
          <span className="sr-only">{t('drawer.close')}</span>
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <ConfidenceWord band={bandOf(company)} />
        {company.estimated ? <span className="text-[12px] text-moss-muted">{t('drawer.estimated')}</span> : null}
      </div>

      <div className="grid min-w-0 grid-cols-1 gap-4">
        {rows.map((row) => (
          <section key={row.axis} className="min-w-0 rounded-xl border border-rule bg-chalk p-3 sm:p-4">
            <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
              <h5 className="min-w-0 break-words text-[11px] font-bold uppercase tracking-widest text-moss-muted">
                <bdi>{row.label}</bdi>
              </h5>
              {editable ? (
                <div className="inline-flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    disabled={saving || row.score <= MIN}
                    onClick={() => step(row.axis, -1)}
                    className="inline-flex h-11 w-11 items-center justify-center rounded-lg border border-rule bg-chalk-raised text-moss hover:border-rule-strong disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Minus aria-hidden className="h-4 w-4" />
                    <span className="sr-only">{t('drawer.lower', { axis: row.label })}</span>
                  </button>
                  <span className="min-w-16 text-center text-[14px] font-bold text-moss" aria-live="polite">
                    {t('drawer.score', { score: format.number(row.score), max: format.number(MAX) })}
                  </span>
                  <button
                    type="button"
                    disabled={saving || row.score >= MAX}
                    onClick={() => step(row.axis, 1)}
                    className="inline-flex h-11 w-11 items-center justify-center rounded-lg border border-rule bg-chalk-raised text-moss hover:border-rule-strong disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Plus aria-hidden className="h-4 w-4" />
                    <span className="sr-only">{t('drawer.raise', { axis: row.label })}</span>
                  </button>
                </div>
              ) : (
                <span className="text-[14px] font-bold text-moss">{t('drawer.score', { score: format.number(row.score), max: format.number(MAX) })}</span>
              )}
            </div>
            <p className="mt-3 break-words text-[13px] leading-6 text-moss" dir="auto">
              {row.reason}
            </p>
            {row.ai !== null && row.ai !== row.score ? (
              <p className="mt-2 flex items-center gap-1.5 text-[12px] text-moss-muted">
                <Pencil aria-hidden className="h-3 w-3 shrink-0" />
                {t('drawer.aiScored', { score: format.number(row.ai) })}
              </p>
            ) : null}
          </section>
        ))}
      </div>

      {editable && company.override ? (
        <button
          type="button"
          disabled={saving}
          onClick={backToAi}
          className="inline-flex min-h-10 items-center justify-center gap-2 self-start rounded-lg border border-rule bg-chalk-raised px-4 py-2 text-[13px] font-bold text-moss hover:border-rule-strong disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Undo2 aria-hidden className="h-4 w-4 rtl:-scale-x-100" />
          {t('drawer.backToAi')}
        </button>
      ) : null}

      {!editable ? <p className="text-[12px] text-moss-muted">{t('drawer.readOnly')}</p> : null}

      {notice?.kind === 'error' ? <ErrorNote>{notice.message}</ErrorNote> : null}
      <div role="status" aria-live="polite" className="min-h-5 text-[12px]">
        {notice && notice.kind !== 'error' ? (
          <p className="flex flex-wrap items-center gap-3 text-moss">
            <span>{t(`drawer.${notice.kind}`)}</span>
            {notice.kind === 'saved' && notice.previous ? (
              <button
                type="button"
                disabled={saving}
                onClick={undo}
                className="font-bold underline decoration-rule-strong underline-offset-2 hover:decoration-moss disabled:opacity-40"
              >
                {t('drawer.undo')}
              </button>
            ) : null}
          </p>
        ) : null}
      </div>

      {showEvidence ? (
        <section className="min-w-0">
          <h5 className="mb-2 text-[11px] font-bold uppercase tracking-widest text-moss-muted">{t('drawer.evidence')}</h5>
          {evidence!.length > 0 ? (
            <ul className="space-y-1.5">
              {evidence!.map((item) => (
                <li key={item.id} className="min-w-0 text-[13px] text-moss">
                  <SafeExternalLink url={item.url} className="min-w-0 max-w-full">
                    <bdi className="min-w-0 truncate">{item.title || compactDomain(item.url)}</bdi>
                  </SafeExternalLink>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13px] text-moss-muted">{t('drawer.evidenceGone')}</p>
          )}
        </section>
      ) : null}
    </aside>
  );
}
