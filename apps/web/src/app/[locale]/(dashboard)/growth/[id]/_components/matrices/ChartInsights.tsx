'use client';

import { useTranslations } from 'next-intl';

import type { ChartView, MatrixView } from './matrix-view';

/** Spec §6.5 and §6.6: what the market looks like, where the gap is, and what to publish about it. */
export function ChartInsights({ chart }: { chart: ChartView }) {
  const t = useTranslations('tabsB.matrices.insights');
  const angles = chart.content_angles ?? [];

  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-2">
        <div className="rounded-2xl border border-rule bg-chalk p-5">
          <h4 className="mb-3 text-[10px] font-bold uppercase tracking-widest text-moss-muted">{t('marketPattern')}</h4>
          <p className="text-[14px] font-medium leading-7 text-moss" dir="auto">
            {chart.summary.market_pattern}
          </p>
        </div>
        <div className="rounded-2xl border border-saffron bg-saffron-soft/40 p-5">
          <h4 className="mb-3 text-[10px] font-bold uppercase tracking-widest text-saffron-ink">{t('opportunity')}</h4>
          <p className="text-[14px] font-bold leading-7 text-moss" dir="auto">
            {chart.summary.positioning_opportunity}
          </p>
        </div>
      </div>

      {angles.length > 0 ? (
        <div className="rounded-2xl border border-rule bg-chalk-raised p-5">
          <h4 className="mb-3 text-[10px] font-bold uppercase tracking-widest text-moss-muted">{t('contentTitle')}</h4>
          <ul className="grid gap-3 md:grid-cols-2">
            {angles.map((item) => (
              <li key={`${item.angle}::${item.audience_segment}`} className="rounded-xl border border-rule bg-chalk p-4">
                <p className="text-[14px] font-semibold leading-6 text-moss" dir="auto">
                  {item.angle}
                </p>
                {item.audience_segment ? (
                  <p className="mt-1.5 text-[12px] text-moss-muted" dir="auto">
                    {t('contentAudience', { segment: item.audience_segment })}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/** The card above every chart: the strongest way to stand apart, who to aim at, and the read across charts. */
export function MatrixSummaryCard({ matrices }: { matrices: MatrixView }) {
  const t = useTranslations('tabsB.matrices.insights');
  const segment = matrices.target_audience_segment?.trim();

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <h4 className="text-[10px] font-bold uppercase tracking-widest text-moss-700">{t('strongest')}</h4>
        <p className="rounded-xl border border-rule bg-chalk-sunk/80 p-4 text-[13px] font-semibold leading-relaxed text-moss" dir="auto">
          {matrices.strongest_differentiation_opportunity}
        </p>
      </div>
      {segment ? (
        <div className="space-y-2">
          <h4 className="text-[10px] font-bold uppercase tracking-widest text-moss-muted">{t('audience')}</h4>
          <p className="text-[13px] leading-relaxed text-moss" dir="auto">
            {segment}
          </p>
        </div>
      ) : null}
      <div className="space-y-2">
        <h4 className="text-[10px] font-bold uppercase tracking-widest text-moss-muted">{t('crossChart')}</h4>
        <p className="max-h-64 overflow-y-auto border-s-[3px] border-rule pe-2 ps-4 text-[13px] leading-relaxed text-moss" dir="auto">
          {matrices.cross_chart_summary}
        </p>
      </div>
    </div>
  );
}
