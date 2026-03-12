import { ArrowRight, BarChart3, Flag, Target } from 'lucide-react';
import type { WorkspaceProgressReport } from '@/lib/workspace-progress';

const DIMENSION_LABELS: Record<string, string> = {
  brand_understanding: 'Brand Understanding',
  strategy_readiness: 'Strategy Readiness',
  market_intelligence: 'Market Intelligence',
  content_system: 'Content System',
  distribution_readiness: 'Distribution Readiness',
  optimization_maturity: 'Optimization Maturity',
};

export function ProgressReportTab({
  report,
}: {
  report: WorkspaceProgressReport;
}) {
  const rows = Object.entries(report.dimension_scores).map(([key, value]) => ({
    key,
    label: DIMENSION_LABELS[key] || key,
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
            <h3 className="text-lg font-bold text-[#121212]">Point A → Point B Transformation</h3>
            <p className="mt-1 text-xs text-gray-500">
              From {new Date(report.baseline_created_at).toLocaleDateString()} to{' '}
              {new Date(report.report_generated_at).toLocaleDateString()} ({report.time_window_days} day window)
            </p>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-right">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">Overall Score</p>
            <p className="text-sm font-bold text-[#121212]">
              {report.overall_score_before.toFixed(1)} → {report.overall_score_now.toFixed(1)}
            </p>
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <p className="text-xs font-bold uppercase tracking-widest text-gray-500">Point A</p>
            <p className="mt-1 text-sm text-gray-700">{report.point_a_summary}</p>
            <p className="mt-3 text-xs font-medium text-gray-600">
              Maturity: <span className="font-bold text-[#121212]">{report.maturity.before_stage}</span>
            </p>
          </div>
          <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-4">
            <p className="text-xs font-bold uppercase tracking-widest text-emerald-700">Point B</p>
            <p className="mt-1 text-sm text-emerald-900">{report.point_b_summary}</p>
            <p className="mt-3 text-xs font-medium text-emerald-800">
              Maturity: <span className="font-bold">{report.maturity.now_stage}</span>
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-5">
        <p className="text-xs font-bold uppercase tracking-widest text-gray-500">Scorecard</p>
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className="border border-gray-200 bg-gray-50 px-3 py-2 text-left text-xs font-bold uppercase tracking-widest text-gray-500">
                  Dimension
                </th>
                <th className="border border-gray-200 bg-gray-50 px-3 py-2 text-center text-xs font-bold uppercase tracking-widest text-gray-500">
                  Before
                </th>
                <th className="border border-gray-200 bg-gray-50 px-3 py-2 text-center text-xs font-bold uppercase tracking-widest text-gray-500">
                  Now
                </th>
                <th className="border border-gray-200 bg-gray-50 px-3 py-2 text-center text-xs font-bold uppercase tracking-widest text-gray-500">
                  Delta
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key} className="odd:bg-white even:bg-gray-50/40">
                  <td className="border border-gray-200 px-3 py-2 font-medium text-gray-800">{row.label}</td>
                  <td className="border border-gray-200 px-3 py-2 text-center text-gray-600">{row.before}/10</td>
                  <td className="border border-gray-200 px-3 py-2 text-center font-bold text-[#121212]">{row.now}/10</td>
                  <td
                    className={`border border-gray-200 px-3 py-2 text-center font-semibold ${
                      row.delta >= 0 ? 'text-emerald-700' : 'text-red-700'
                    }`}
                  >
                    {row.delta >= 0 ? `+${row.delta}` : row.delta}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        <UsageCard label="Days Active" value={report.usage_summary.days_since_signup} />
        <UsageCard label="Meaningful Sessions" value={report.usage_summary.meaningful_sessions} />
        <UsageCard label="Strategy Runs" value={report.usage_summary.strategy_runs} />
        <UsageCard label="Content Generated" value={report.usage_summary.content_generated} />
        <UsageCard label="Approved Assets" value={report.usage_summary.approved_assets} />
        <UsageCard label="Published Assets" value={report.usage_summary.published_assets} />
        <UsageCard label="Connected Channels" value={report.usage_summary.connected_channels} />
        <UsageCard label="Competitor Validations" value={report.usage_summary.competitor_validations} />
        <UsageCard label="Refinements" value={report.usage_summary.refinements} />
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <p className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-gray-500">
            <BarChart3 className="h-3.5 w-3.5" />
            Progress Delta
          </p>
          <p className="mt-2 text-sm text-gray-700">{report.progress_delta}</p>
          <p className="mt-3 text-sm font-medium text-gray-700">{report.narrative_summary}</p>
        </div>
        <div className="rounded-xl border border-indigo-100 bg-indigo-50 p-4">
          <p className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-indigo-700">
            <Target className="h-3.5 w-3.5" />
            Next Best Action
          </p>
          <p className="mt-2 text-sm font-medium text-indigo-900">{report.next_best_action}</p>

          <p className="mt-4 inline-flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-indigo-700">
            <Flag className="h-3.5 w-3.5" />
            Milestones
          </p>
          <ul className="mt-2 space-y-1">
            {report.milestone_triggers.map((item) => (
              <li key={item} className="inline-flex items-start gap-2 text-sm text-indigo-900">
                <ArrowRight className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function UsageCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white px-4 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-widest text-gray-500">{label}</p>
      <p className="mt-1 text-lg font-bold text-[#121212]">{value.toLocaleString()}</p>
    </div>
  );
}
