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
      <div className="rounded-2xl border border-gray-200 bg-gradient-to-br from-white to-gray-50 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-gray-500">
              {report.report_name}
            </p>
            <h3 className="text-lg font-bold text-[#121212]">{t('heading')}</h3>
            <p className="mt-1 text-xs text-gray-500">
              {t('window', {
                from: date(report.baseline_created_at),
                to: date(report.report_generated_at),
                days: num(report.time_window_days),
              })}
            </p>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-end">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">
              {t('overallScore')}
            </p>
            <p className="text-sm font-bold text-[#121212]">
              {t('scoreArrow', {
                before: num(report.overall_score_before, 1),
                now: num(report.overall_score_now, 1),
              })}
            </p>
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <p className="text-xs font-bold uppercase tracking-widest text-gray-500">{t('pointA')}</p>
            <p className="mt-1 text-sm text-gray-700">{report.point_a_summary}</p>
            <p className="mt-3 text-xs font-medium text-gray-600">
              {t('maturity')}{' '}
              <span className="font-bold text-[#121212]">{report.maturity.before_stage}</span>
            </p>
          </div>
          <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-4">
            <p className="text-xs font-bold uppercase tracking-widest text-emerald-700">{t('pointB')}</p>
            <p className="mt-1 text-sm text-emerald-900">{report.point_b_summary}</p>
            <p className="mt-3 text-xs font-medium text-emerald-800">
              {t('maturity')} <span className="font-bold">{report.maturity.now_stage}</span>
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-5">
        <p className="text-xs font-bold uppercase tracking-widest text-gray-500">{t('scorecard')}</p>
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className="border border-gray-200 bg-gray-50 px-3 py-2 text-start text-xs font-bold uppercase tracking-widest text-gray-500">
                  {t('colDimension')}
                </th>
                <th className="border border-gray-200 bg-gray-50 px-3 py-2 text-center text-xs font-bold uppercase tracking-widest text-gray-500">
                  {t('colBefore')}
                </th>
                <th className="border border-gray-200 bg-gray-50 px-3 py-2 text-center text-xs font-bold uppercase tracking-widest text-gray-500">
                  {t('colNow')}
                </th>
                <th className="border border-gray-200 bg-gray-50 px-3 py-2 text-center text-xs font-bold uppercase tracking-widest text-gray-500">
                  {t('colDelta')}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key} className="odd:bg-white even:bg-gray-50/40">
                  <td className="border border-gray-200 px-3 py-2 font-medium text-gray-800">{row.label}</td>
                  <td className="border border-gray-200 px-3 py-2 text-center text-gray-600">
                    {t('outOfTen', { value: num(row.before) })}
                  </td>
                  <td className="border border-gray-200 px-3 py-2 text-center font-bold text-[#121212]">
                    {t('outOfTen', { value: num(row.now) })}
                  </td>
                  <td
                    className={`border border-gray-200 px-3 py-2 text-center font-semibold ${
                      row.delta >= 0 ? 'text-emerald-700' : 'text-red-700'
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
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <p className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-gray-500">
            <BarChart3 className="h-3.5 w-3.5" />
            {t('progressDelta')}
          </p>
          <p className="mt-2 text-sm text-gray-700">{report.progress_delta}</p>
          <p className="mt-3 text-sm font-medium text-gray-700">{report.narrative_summary}</p>
        </div>
        <div className="rounded-xl border border-indigo-100 bg-indigo-50 p-4">
          <p className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-indigo-700">
            <Target className="h-3.5 w-3.5" />
            {t('nextBestAction')}
          </p>
          <p className="mt-2 text-sm font-medium text-indigo-900">{report.next_best_action}</p>

          <p className="mt-4 inline-flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-indigo-700">
            <Flag className="h-3.5 w-3.5" />
            {t('milestones')}
          </p>
          <ul className="mt-2 space-y-1">
            {report.milestone_triggers.map((item) => (
              <li key={item} className="inline-flex items-start gap-2 text-sm text-indigo-900">
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
    <div className="rounded-xl border border-gray-200 bg-white px-4 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-widest text-gray-500">{label}</p>
      <p className="mt-1 text-lg font-bold text-[#121212]">{value}</p>
    </div>
  );
}
