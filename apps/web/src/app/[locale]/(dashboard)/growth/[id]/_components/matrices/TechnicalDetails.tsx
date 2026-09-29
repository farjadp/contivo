'use client';

import { useFormatter, useTranslations } from 'next-intl';

import { runModel } from './matrix-run-logic';
import type { MatrixView } from './matrix-view';

/**
 * Spec §6.7: what a person debugging a run needs, and nobody else. Collapsed
 * by default; every row is left out when the saved result does not carry it.
 */
export function TechnicalDetails({ matrices }: { matrices: MatrixView }) {
  const t = useTranslations('tabsB.matrices.technical');
  const tBasis = useTranslations('tabsB.matrices.run.basis');
  const format = useFormatter();

  const lastRun = matrices.token_usage?.last_run ?? null;
  const tokens = matrices.tokens_used ?? lastRun?.total_tokens;
  const model = runModel(matrices);
  const generatedAt = matrices.generated_at ? new Date(matrices.generated_at) : null;

  const rows: Array<{ label: string; value: string; raw?: boolean }> = [];
  if (matrices.run_id) rows.push({ label: t('runId'), value: matrices.run_id, raw: true });
  if (model) rows.push({ label: t('model'), value: model, raw: true });
  if (typeof tokens === 'number') rows.push({ label: t('tokens'), value: format.number(tokens) });
  if (matrices.competitor_basis) rows.push({ label: t('basis'), value: tBasis(matrices.competitor_basis) });
  if (generatedAt && !Number.isNaN(generatedAt.getTime())) {
    rows.push({ label: t('generatedAt'), value: format.dateTime(generatedAt, { dateStyle: 'medium', timeStyle: 'short' }) });
  }
  if (rows.length === 0) return null;

  return (
    <details className="group rounded-2xl border border-rule bg-chalk-raised">
      <summary className="cursor-pointer select-none rounded-2xl px-5 py-3 text-[12px] font-bold uppercase tracking-widest text-moss-muted hover:text-moss">
        {t('title')}
      </summary>
      <dl className="grid gap-x-6 gap-y-3 border-t border-rule px-5 py-4 text-[13px] sm:grid-cols-[max-content_1fr]">
        {rows.map((row) => (
          <div key={row.label} className="contents">
            <dt className="text-moss-muted">{row.label}</dt>
            <dd className="min-w-0 break-all font-medium text-moss">
              {row.raw ? <bdi dir="ltr">{row.value}</bdi> : row.value}
            </dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
