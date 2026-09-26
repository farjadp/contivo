import { ArrowRight, BarChart3, Flag, Target } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';

import type { WorkspaceProgressReport } from '@/lib/workspace-progress';

const DIMENSION_KEYS = [
  'brand_understanding',
  'strategy_readiness',
  'market_intelligence',
  'content_system',
  'distribution_readiness',
  'optimization_maturity',
] as const;

const USAGE_KEYS = [
  'days_since_signup',
  'meaningful_sessions',
  'strategy_runs',
  'content_generated',
  'approved_assets',
  'published_assets',
  'connected_channels',
  'competitor_validations',
  'refinements',
] as const;

export function ProgressReportTab({
  report,
}: {
  report: WorkspaceProgressReport;
}) {
  const t = useTranslations('tabsB.progress');
  const format = useFormatter();

  /* Scores are read out loud as numbers, so they go through the request
     formatter rather than String() — Persian gets Persian digits. */
  const num = (value: number, digits = 0) =>
    format.number(value, { minimumFractionDigits: digits, maximumFractionDigits: digits });

  const date = (iso: string) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : format.dateTime(d, { dateStyle: 'medium' });
  };

  const rows = Object.entries(report.dimension_scores).map(([key, value]) => ({
    key,
    label: (DIMENSION_KEYS as readonly string[]).includes(key)
      ? t(`dimensions.${key as (typeof DIMENSION_KEYS)[number]}`)
      : key,
    before: value.before,
    now: value.now,
    delta: value.now - value.before,
  }));

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-rule bg-gradient-to-br from-chalk-raised to-chalk p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-moss-muted">
              {report.report_name}
            </p>
            <h3 className="text-lg font-bold text-moss">{t('heading')}</h3>
            <p className="mt-1 text-xs text-moss-muted">
              {t('window', {
                from: date(report.baseline_created_at),
                to: date(report.report_generated_at),
                days: num(report.time_window_days),
              })}
            </p>
          </div>
          <div className="rounded-xl border border-rule bg-chalk-raised px-3 py-2 text-end">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-moss-muted">
              {t('overallScore')}
            </p>
            <p className="text-sm font-bold text-moss">
              {t('scoreArrow', {
                before: num(report.overall_score_before, 1),
                now: num(report.overall_score_now, 1),
              })}
            </p>
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <div className="rounded-xl border border-rule bg-chalk-raised p-4">
            <p className="text-xs font-bold uppercase tracking-widest text-moss-muted">{t('pointA')}</p>
            <p className="mt-1 text-sm text-moss">{report.point_a_summary}</p>
            <p className="mt-3 text-xs font-medium text-moss-muted">
              {t('maturity')}{' '}
              <span className="font-bold text-moss">{report.maturity.before_stage}</span>
            </p>
          </div>
          <div className="rounded-xl border border-rule bg-chalk-sunk p-4">
            <p className="text-xs font-bold uppercase tracking-widest text-moss-700">{t('pointB')}</p>
            <p className="mt-1 text-sm text-moss">{report.point_b_summary}</p>
            <p className="mt-3 text-xs font-medium text-moss">
              {t('maturity')} <span className="font-bold">{report.maturity.now_stage}</span>
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-rule bg-chalk-raised p-5">
        <p className="text-xs font-bold uppercase tracking-widest text-moss-muted">{t('scorecard')}</p>
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className="border border-rule bg-chalk px-3 py-2 text-start text-xs font-bold uppercase tracking-widest text-moss-muted">
                  {t('colDimension')}
                </th>
                <th className="border border-rule bg-chalk px-3 py-2 text-center text-xs font-bold uppercase tracking-widest text-moss-muted">
                  {t('colBefore')}
                </th>
                <th className="border border-rule bg-chalk px-3 py-2 text-center text-xs font-bold uppercase tracking-widest text-moss-muted">
                  {t('colNow')}
                </th>
                <th className="border border-rule bg-chalk px-3 py-2 text-center text-xs font-bold uppercase tracking-widest text-moss-muted">
                  {t('colDelta')}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key} className="odd:bg-chalk-raised even:bg-chalk/40">
                  <td className="border border-rule px-3 py-2 font-medium text-moss">{row.label}</td>
                  <td className="border border-rule px-3 py-2 text-center text-moss-muted">
                    {t('outOfTen', { value: num(row.before) })}
                  </td>
                  <td className="border border-rule px-3 py-2 text-center font-bold text-moss">
                    {t('outOfTen', { value: num(row.now) })}
                  </td>
                  <td
                    className={`border border-rule px-3 py-2 text-center font-semibold ${
                      row.delta >= 0 ? 'text-moss-700' : 'text-red-700'
                    }`}
                  >
                    {/* A signed delta is a number with a sign, so it stays LTR
                        whichever way the table around it runs. */}
                    <span dir="ltr">
                      {format.number(row.delta, { signDisplay: 'exceptZero' })}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {USAGE_KEYS.map((key) => (
          <UsageCard key={key} label={t(`usage.${key}`)} value={num(report.usage_summary[key])} />
        ))}
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-xl border border-rule bg-chalk-raised p-4">
          <p className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-moss-muted">
            <BarChart3 className="h-3.5 w-3.5" />
            {t('progressDelta')}
          </p>
          <p className="mt-2 text-sm text-moss">{report.progress_delta}</p>
          <p className="mt-3 text-sm font-medium text-moss">{report.narrative_summary}</p>
        </div>
        <div className="rounded-xl border border-rule bg-chalk-sunk p-4">
          <p className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-moss">
            <Target className="h-3.5 w-3.5" />
            {t('nextBestAction')}
          </p>
          <p className="mt-2 text-sm font-medium text-moss">{report.next_best_action}</p>

          <p className="mt-4 inline-flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-moss">
            <Flag className="h-3.5 w-3.5" />
            {t('milestones')}
          </p>
          <ul className="mt-2 space-y-1">
            {report.milestone_triggers.map((item) => (
              <li key={item} className="inline-flex items-start gap-2 text-sm text-moss">
                <ArrowRight className="mt-0.5 h-3.5 w-3.5 shrink-0 rtl:rotate-180" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function UsageCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-rule bg-chalk-raised px-4 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-widest text-moss-muted">{label}</p>
      <p className="mt-1 text-lg font-bold text-moss">{value}</p>
    </div>
  );
}
