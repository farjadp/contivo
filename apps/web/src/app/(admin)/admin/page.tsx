import Link from 'next/link';
import { getSession } from '@/lib/auth';
import {
  adjustCredits,
  manageBilling,
  manageJob,
  manageUserLifecycle,
  manageWorkspace,
  updateAiControls,
  updatePlatformLimits,
  updateUserAccess,
} from '@/app/actions/admin';
import {
  type AdminSection,
  getAdminAnalytics,
  getAdminContentItems,
  getAdminCreditLedger,
  getAdminIntegrations,
  getAdminJobs,
  getAdminLogs,
  getAdminOverview,
  getAdminSettingsState,
  getAdminUsers,
  getAdminWorkspaces,
  resolveAdminSection,
} from '@/lib/admin-console';
import { prisma } from '@/lib/db';
import {
  GEMINI_COOLDOWN_SECONDS_MAX,
  GEMINI_COOLDOWN_SECONDS_MIN,
  PLATFORM_LIMIT_MAX,
  PLATFORM_LIMIT_MIN,
  SCHEDULE_DELAY_HOURS_MAX,
  SCHEDULE_DELAY_HOURS_MIN,
} from '@/lib/app-settings';
import {
  WORD_COUNT_LIMIT_ABSOLUTE_MAX,
  WORD_COUNT_LIMIT_ABSOLUTE_MIN,
  WORD_COUNT_PLATFORM_LABELS,
  WORD_COUNT_PLATFORMS,
} from '@/lib/content-word-count';

type Props = {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

const SECTION_META: Array<{ key: AdminSection; label: string; description: string }> = [
  { key: 'overview', label: 'Overview', description: 'Platform status, cost, health, and risk' },
  { key: 'users', label: 'Users', description: 'Accounts, plans, roles, and access control' },
  { key: 'workspaces', label: 'Workspaces', description: 'Workspace state, owner, and intervention tools' },
  { key: 'content', label: 'Content', description: 'Generated assets, schedule state, and output review' },
  { key: 'ai', label: 'AI & Models', description: 'Primary/fallback model and provider behavior' },
  { key: 'integrations', label: 'SEO Intelligence', description: 'DataForSEO readiness, cache footprint, and provider health' },
  { key: 'credits', label: 'Credits & Billing', description: 'Ledger, adjustments, refunds, and usage' },
  { key: 'jobs', label: 'Queues & Jobs', description: 'Background execution, failures, and durations' },
  { key: 'settings', label: 'Platform Settings', description: 'Runtime limits and scheduling rules' },
  { key: 'logs', label: 'Logs & Security', description: 'Activity stream and admin audit trail' },
  { key: 'analytics', label: 'Analytics', description: 'Adoption, framework usage, and cost patterns' },
];

const USER_PLAN_OPTIONS = ['FREE', 'STARTER', 'PRO', 'AGENCY'];
const USER_ROLE_OPTIONS = ['USER', 'ADMIN'];
const USER_ACCOUNT_STATUS_OPTIONS = ['ACTIVE', 'SUSPENDED'];
const WORKSPACE_STATUS_OPTIONS = ['PENDING', 'CRAWLING', 'ANALYZING', 'READY', 'ERROR', 'ARCHIVED'];
const CONTENT_STATUS_OPTIONS = ['DRAFT', 'GENERATED', 'EDITED', 'READY', 'SCHEDULED', 'PUBLISHING', 'PUBLISHED', 'FAILED', 'ARCHIVED'];
const CONTENT_CHANNEL_OPTIONS = ['linkedin', 'twitter', 'instagram', 'email', 'blog'];
const JOB_TYPE_OPTIONS = ['INSTANT_CONTENT', 'WEBSITE_CRAWL', 'BRAND_ANALYSIS', 'STRATEGY_GENERATION', 'ARTICLE_DRAFT'];
const JOB_STATUS_OPTIONS = ['PENDING', 'RUNNING', 'COMPLETED', 'FAILED'];

function readParam(value: string | string[] | undefined, fallback = ''): string {
  return Array.isArray(value) ? value[0] || fallback : value || fallback;
}

function formatUsd(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(value);
}

function formatDateTime(value: Date | null | undefined): string {
  if (!value) return '-';
  return new Date(value).toLocaleString();
}

function formatDuration(value: number | null | undefined): string {
  if (!value || value <= 0) return '-';
  if (value < 1000) return `${value} ms`;
  return `${(value / 1000).toFixed(1)} s`;
}

function getStatusTone(status: string): string {
  if (['FAILED', 'ERROR', 'PAST_DUE'].includes(status)) return 'text-red-700 bg-red-50 border-red-200';
  if (['PENDING', 'RUNNING', 'CRAWLING', 'ANALYZING'].includes(status)) return 'text-amber-700 bg-amber-50 border-amber-200';
  if (['SCHEDULED', 'PUBLISHED', 'READY', 'ACTIVE', 'TRIALING', 'healthy'].includes(status)) {
    return 'text-emerald-700 bg-emerald-50 border-emerald-200';
  }
  if (['warning'].includes(status)) return 'text-amber-700 bg-amber-50 border-amber-200';
  return 'text-gray-700 bg-gray-50 border-gray-200';
}

export default async function AdminDashboardPage({ searchParams }: Props) {
  const user = await getSession();
  const resolvedParams = await searchParams;
  const section = resolveAdminSection(resolvedParams.section);

  const [
    overview,
    settingsState,
    analytics,
    integrations,
  ] = await Promise.all([
    getAdminOverview(),
    getAdminSettingsState(),
    getAdminAnalytics(),
    getAdminIntegrations(),
  ]);

  const sectionData = await getSectionData(section, resolvedParams);
  const userOptions =
    section === 'users' || section === 'workspaces' || section === 'credits'
      ? await prisma.user.findMany({
          orderBy: { email: 'asc' },
          select: { id: true, email: true, name: true },
          take: 120,
        })
      : [];
  const workspaceOptions =
    section === 'content'
      ? await prisma.workspace.findMany({
          orderBy: { name: 'asc' },
          select: { id: true, name: true },
          take: 120,
        })
      : [];

  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-gray-200 bg-gradient-to-br from-white via-white to-slate-50 p-6 shadow-sm">
        <div className="flex flex-col gap-6 xl:flex-row xl:items-start xl:justify-between">
          <div className="max-w-3xl">
            <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-slate-500">Operational Control Center</p>
            <h1 className="mt-3 text-3xl font-bold tracking-tight text-[#121212]">Contivo Admin</h1>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              Daily console for users, workspaces, AI controls, billing, content operations, and audit visibility.
            </p>
            <p className="mt-2 text-xs text-slate-500">
              Signed in as {user?.email || 'unknown'} {user?.role ? `(${user.role})` : ''}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <MetricCard label="Users" value={overview.metrics.totalUsers.toLocaleString()} />
            <MetricCard label="Workspaces" value={overview.metrics.totalWorkspaces.toLocaleString()} />
            <MetricCard label="AI Jobs Today" value={overview.metrics.aiJobsToday.toLocaleString()} />
            <MetricCard label="AI Cost Today" value={formatUsd(overview.metrics.estimatedAiCostToday)} emphasis />
          </div>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Active Users Today" value={overview.metrics.activeUsersToday.toLocaleString()} helper={`${overview.metrics.activeUsers} active in 30d`} />
        <MetricCard label="Active Workspaces" value={overview.metrics.activeWorkspaces.toLocaleString()} helper={`${overview.metrics.payingUsers} paying users`} />
        <MetricCard label="Content Generated Today" value={overview.metrics.contentGeneratedToday.toLocaleString()} helper={`${overview.metrics.scheduledContentCount} scheduled`} />
        <MetricCard label="Queue Backlog" value={`${overview.metrics.pendingJobs + overview.metrics.runningJobs}`} helper={`${overview.metrics.failedJobs} failed total`} />
      </div>

      <div className="grid gap-3 lg:grid-cols-5">
        <HealthCard title="API" status="healthy" description="Admin app route is responding normally." />
        <HealthCard title="Database" status={overview.health.database} description={`Prisma reachable. Latency ${overview.metrics.databaseLatencyMs} ms.`} />
        <HealthCard title="Redis" status={integrations.providers.redisConfigured ? 'healthy' : 'FAILED'} description={integrations.providers.redisConfigured ? 'Queue/cache URL configured.' : 'Missing REDIS_URL.'} />
        <HealthCard title="Jobs" status={overview.health.jobs} description={`${overview.metrics.pendingJobs} pending, ${overview.metrics.runningJobs} running, ${overview.metrics.failedJobs} failed.`} />
        <HealthCard title="Providers" status={overview.health.provider} description={`${integrations.providers.geminiConfigured ? 'Gemini' : 'Gemini missing'}, ${integrations.providers.openAiConfigured ? 'OpenAI' : 'OpenAI missing'}.`} />
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-2 shadow-sm">
        <nav className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
          {SECTION_META.map((item) => {
            const active = section === item.key;
            return (
              <Link
                key={item.key}
                href={`/admin?section=${item.key}`}
                className={`rounded-xl border px-4 py-3 transition ${
                  active
                    ? 'border-[#121212] bg-[#121212] text-white'
                    : 'border-gray-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'
                }`}
              >
                <p className="text-sm font-bold">{item.label}</p>
                <p className={`mt-1 text-xs ${active ? 'text-slate-200' : 'text-slate-500'}`}>{item.description}</p>
              </Link>
            );
          })}
        </nav>
      </div>

      <div className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-[#121212]">{SECTION_META.find((item) => item.key === section)?.label}</h2>
            <p className="mt-1 text-sm text-slate-500">{SECTION_META.find((item) => item.key === section)?.description}</p>
          </div>
        </div>

        {section === 'overview' ? (
          <OverviewSection overview={overview} analytics={analytics} />
        ) : null}

        {section === 'users' ? (
          <UsersSection
            rows={sectionData.users || []}
            status={readParam(resolvedParams.users)}
            filters={{
              q: readParam(resolvedParams.q),
              plan: readParam(resolvedParams.plan, 'ALL'),
              role: readParam(resolvedParams.role, 'ALL'),
              status: readParam(resolvedParams.status, 'ALL'),
            }}
          />
        ) : null}

        {section === 'workspaces' ? (
          <WorkspacesSection
            rows={sectionData.workspaces || []}
            userOptions={userOptions}
            status={readParam(resolvedParams.workspaces)}
            filters={{
              q: readParam(resolvedParams.q),
              status: readParam(resolvedParams.status, 'ALL'),
              ownerId: readParam(resolvedParams.ownerId, 'ALL'),
            }}
          />
        ) : null}

        {section === 'ai' ? (
          <AiSection settingsState={settingsState} analytics={analytics} status={readParam(resolvedParams.settings)} />
        ) : null}

        {section === 'settings' ? (
          <SettingsSection settingsState={settingsState} status={readParam(resolvedParams.limits)} />
        ) : null}

        {section === 'credits' ? (
          <CreditsSection
            rows={sectionData.creditLedger || []}
            subscriptions={sectionData.subscriptions || []}
            userOptions={userOptions}
            status={readParam(resolvedParams.credits)}
            billingStatus={readParam(resolvedParams.billing)}
            filterUserId={readParam(resolvedParams.userId)}
          />
        ) : null}

        {section === 'content' ? (
          <ContentSection
            rows={sectionData.contentItems || []}
            workspaceOptions={workspaceOptions}
            filters={{
              q: readParam(resolvedParams.q),
              status: readParam(resolvedParams.status, 'ALL'),
              channel: readParam(resolvedParams.channel, 'ALL'),
              workspaceId: readParam(resolvedParams.workspaceId, 'ALL'),
            }}
          />
        ) : null}

        {section === 'jobs' ? (
          <JobsSection
            rows={sectionData.jobs || []}
            status={readParam(resolvedParams.jobs)}
            filters={{
              status: readParam(resolvedParams.status, 'ALL'),
              type: readParam(resolvedParams.type, 'ALL'),
            }}
          />
        ) : null}

        {section === 'logs' ? (
          <LogsSection logs={sectionData.logs} />
        ) : null}

        {section === 'analytics' ? (
          <AnalyticsSection analytics={analytics} />
        ) : null}

        {section === 'integrations' ? (
          <IntegrationsSection integrations={integrations} />
        ) : null}
      </div>
    </div>
  );
}

async function getSectionData(
  section: AdminSection,
  params: { [key: string]: string | string[] | undefined },
) {
  if (section === 'users') {
    return {
      users: await getAdminUsers({
        query: readParam(params.q),
        plan: readParam(params.plan, 'ALL'),
        role: readParam(params.role, 'ALL'),
        status: readParam(params.status, 'ALL'),
      }),
    };
  }
  if (section === 'workspaces') {
    return {
      workspaces: await getAdminWorkspaces({
        query: readParam(params.q),
        status: readParam(params.status, 'ALL'),
        ownerId: readParam(params.ownerId, 'ALL'),
      }),
    };
  }
  if (section === 'credits') {
    return {
      creditLedger: await getAdminCreditLedger(readParam(params.userId) || undefined),
      subscriptions: await prisma.subscription.findMany({
        orderBy: { updatedAt: 'desc' },
        take: 80,
        include: {
          user: { select: { id: true, email: true, name: true } },
        },
      }),
    };
  }
  if (section === 'content') {
    return {
      contentItems: await getAdminContentItems({
        query: readParam(params.q),
        status: readParam(params.status, 'ALL'),
        channel: readParam(params.channel, 'ALL'),
        workspaceId: readParam(params.workspaceId, 'ALL'),
      }),
    };
  }
  if (section === 'jobs') {
    return {
      jobs: await getAdminJobs({
        status: readParam(params.status, 'ALL'),
        type: readParam(params.type, 'ALL'),
      }),
    };
  }
  if (section === 'logs') {
    return {
      logs: await getAdminLogs(),
    };
  }
  return {};
}

function OverviewSection({
  overview,
  analytics,
}: {
  overview: Awaited<ReturnType<typeof getAdminOverview>>;
  analytics: Awaited<ReturnType<typeof getAdminAnalytics>>;
}) {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 lg:grid-cols-4">
        <MetricCard
          label="Average Generation Time"
          value={formatDuration(overview.metrics.averageGenerationTimeMs)}
          helper="completed AI jobs today"
        />
        <MetricCard
          label="Credits Used Today"
          value={overview.metrics.creditsUsedToday.toLocaleString()}
          helper={`${overview.metrics.publishedContentToday} published today`}
        />
        <MetricCard
          label="Scheduled Posts"
          value={overview.metrics.scheduledContentCount.toLocaleString()}
          helper={`${overview.metrics.contentGeneratedToday} generated today`}
        />
        <MetricCard
          label="Published Posts"
          value={overview.metrics.publishedContentToday.toLocaleString()}
          helper={`${overview.metrics.failedAiJobsToday} AI failures today`}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Recent Critical Failures" subtitle="Latest failed background jobs">
          <div className="space-y-3">
            {overview.recentFailedJobs.length === 0 ? (
              <EmptyState text="No failed jobs recorded." />
            ) : (
              overview.recentFailedJobs.map((job: any) => (
                <div key={job.id} className="rounded-xl border border-red-100 bg-red-50/70 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-bold text-[#121212]">{job.type}</p>
                    <span className="rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-red-700 border-red-200 bg-white">
                      {job.status}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-slate-600">
                    {job.user.email} {job.workspace?.name ? `• ${job.workspace.name}` : ''} • {formatDateTime(job.updatedAt)}
                  </p>
                  <p className="mt-2 text-xs text-red-700">{job.errorMessage || 'Unknown error'}</p>
                </div>
              ))
            )}
          </div>
        </Panel>

        <Panel title="Top Frameworks (30d)" subtitle="Most adopted generation frameworks">
          <SimpleTable
            headers={['Framework', 'Events', 'Fallback', 'Score']}
            rows={overview.topFrameworks.map((item) => [
              item.frameworkName,
              item.events.toLocaleString(),
              item.fallbackEvents.toLocaleString(),
              item.avgOverallScore?.toFixed(2) || '-',
            ])}
          />
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Top Platforms" subtitle="Content created in the last 30 days">
          <SimpleTable
            headers={['Platform', 'Count']}
            rows={analytics.platforms.map((item: any) => [item.channel, item.count.toLocaleString()])}
          />
        </Panel>
        <Panel title="AI Cost by Feature" subtitle="30-day provider spend">
          <SimpleTable
            headers={['Feature', 'Cost', 'Tokens']}
            rows={analytics.aiCostByFeature.map((item: any) => [
              item.feature,
              formatUsd(item.costUsd),
              item.totalTokens.toLocaleString(),
            ])}
          />
        </Panel>
        <Panel title="Content Status Breakdown" subtitle="Operational state of assets">
          <SimpleTable
            headers={['Status', 'Count']}
            rows={analytics.contentStatusBreakdown.map((item: any) => [item.status, item.count.toLocaleString()])}
          />
        </Panel>
      </div>
    </div>
  );
}

function UsersSection({
  rows,
  status,
  filters,
}: {
  rows: Awaited<ReturnType<typeof getAdminUsers>>;
  status: string;
  filters: {
    q: string;
    plan: string;
    role: string;
    status: string;
  };
}) {
  return (
    <div className="space-y-4">
      <StatusBanner status={status} />
      <form action="/admin" className="grid gap-3 rounded-2xl border border-gray-200 bg-slate-50 p-4 lg:grid-cols-5">
        <input type="hidden" name="section" value="users" />
        <input name="q" defaultValue={filters.q} placeholder="Search email, name, user id" className="rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-black" />
        <select name="plan" defaultValue={filters.plan} className="rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-black">
          <option value="ALL">All plans</option>
          {USER_PLAN_OPTIONS.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
        <select name="role" defaultValue={filters.role} className="rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-black">
          <option value="ALL">All roles</option>
          {USER_ROLE_OPTIONS.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
        <select name="status" defaultValue={filters.status} className="rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-black">
          <option value="ALL">All statuses</option>
          {USER_ACCOUNT_STATUS_OPTIONS.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
        <button className="rounded-xl bg-black px-4 py-2 text-sm font-bold text-white">Apply Filters</button>
      </form>

      <Panel title="User Management" subtitle="Search, inspect, and update access controls">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wider text-gray-500">
                <th className="px-3 py-3">User</th>
                <th className="px-3 py-3">Plan / Role</th>
                <th className="px-3 py-3">Status</th>
                <th className="px-3 py-3">Usage</th>
                <th className="px-3 py-3">Last Active</th>
                <th className="px-3 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-gray-100 align-top">
                  <td className="px-3 py-4">
                    <Link href={`/admin/users/${row.id}`} className="font-bold text-[#121212] hover:underline">
                      {row.name || 'Unnamed user'}
                    </Link>
                    <p className="text-xs text-gray-500">{row.email}</p>
                    <p className="mt-1 text-[11px] text-gray-400">{row.id}</p>
                  </td>
                  <td className="px-3 py-4">
                    <div className="space-y-2">
                      <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${getStatusTone(row.subscription?.status || row.plan)}`}>
                        {row.plan}
                      </span>
                      <span className={`ml-2 inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${getStatusTone(row.role)}`}>
                        {row.role}
                      </span>
                      <p className="text-xs text-gray-500">Subscription: {row.subscription?.status || 'none'}</p>
                    </div>
                  </td>
                  <td className="px-3 py-4">
                    <div className="space-y-2">
                      <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${getStatusTone(row.accountStatus)}`}>
                        {row.accountStatus}
                      </span>
                      {row.suspendedReason ? (
                        <p className="max-w-[180px] text-[11px] text-red-600">{row.suspendedReason}</p>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-3 py-4 text-xs text-gray-600">
                    <p>{row._count.workspaces} workspaces</p>
                    <p>{row._count.contentItems} content items</p>
                    <p>{String(row.creditBalance || 0)} credits</p>
                    <p>{formatUsd(Number(row.totalAiCost || 0))} AI cost</p>
                  </td>
                  <td className="px-3 py-4 text-xs text-gray-600">{formatDateTime(row.lastActiveAt)}</td>
                  <td className="px-3 py-4">
                    <div className="grid gap-2 md:grid-cols-3">
                      <form action={updateUserAccess} className="space-y-2 rounded-xl border border-gray-200 bg-slate-50 p-3">
                        <input type="hidden" name="userId" value={row.id} />
                        <select name="plan" defaultValue={row.plan} className="w-full rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-xs outline-none focus:border-black">
                          {USER_PLAN_OPTIONS.map((item) => <option key={item} value={item}>{item}</option>)}
                        </select>
                        <button className="w-full rounded-lg bg-black px-2 py-1.5 text-xs font-bold text-white">Update Plan</button>
                      </form>
                      <form action={updateUserAccess} className="space-y-2 rounded-xl border border-gray-200 bg-slate-50 p-3">
                        <input type="hidden" name="userId" value={row.id} />
                        <select name="role" defaultValue={row.role} className="w-full rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-xs outline-none focus:border-black">
                          {USER_ROLE_OPTIONS.map((item) => <option key={item} value={item}>{item}</option>)}
                        </select>
                        <button className="w-full rounded-lg bg-black px-2 py-1.5 text-xs font-bold text-white">Update Role</button>
                      </form>
                      <form action={manageUserLifecycle} className="space-y-2 rounded-xl border border-gray-200 bg-slate-50 p-3">
                        <input type="hidden" name="userId" value={row.id} />
                        <input type="hidden" name="actionType" value={row.accountStatus === 'SUSPENDED' ? 'REACTIVATE' : 'SUSPEND'} />
                        {row.accountStatus !== 'SUSPENDED' ? (
                          <input
                            name="reason"
                            placeholder="Suspension reason"
                            className="w-full rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-xs outline-none focus:border-black"
                          />
                        ) : (
                          <p className="rounded-lg border border-green-200 bg-green-50 px-2 py-1.5 text-[11px] text-green-700">
                            Account is suspended and can be reactivated.
                          </p>
                        )}
                        <button className={`w-full rounded-lg px-2 py-1.5 text-xs font-bold text-white ${row.accountStatus === 'SUSPENDED' ? 'bg-green-600' : 'bg-red-600'}`}>
                          {row.accountStatus === 'SUSPENDED' ? 'Reactivate' : 'Suspend'}
                        </button>
                      </form>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

function WorkspacesSection({
  rows,
  userOptions,
  status,
  filters,
}: {
  rows: Awaited<ReturnType<typeof getAdminWorkspaces>>;
  userOptions: Array<{ id: string; email: string; name: string | null }>;
  status: string;
  filters: {
    q: string;
    status: string;
    ownerId: string;
  };
}) {
  return (
    <div className="space-y-4">
      <StatusBanner status={status} />
      <form action="/admin" className="grid gap-3 rounded-2xl border border-gray-200 bg-slate-50 p-4 lg:grid-cols-4">
        <input type="hidden" name="section" value="workspaces" />
        <input name="q" defaultValue={filters.q} placeholder="Search workspace, url, owner" className="rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-black" />
        <select name="status" defaultValue={filters.status} className="rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-black">
          <option value="ALL">All statuses</option>
          {WORKSPACE_STATUS_OPTIONS.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
        <select name="ownerId" defaultValue={filters.ownerId} className="rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-black">
          <option value="ALL">All owners</option>
          {userOptions.map((item) => <option key={item.id} value={item.id}>{item.email}</option>)}
        </select>
        <button className="rounded-xl bg-black px-4 py-2 text-sm font-bold text-white">Apply Filters</button>
      </form>

      <Panel title="Workspace Management" subtitle="Inspect health, reassign ownership, or force intervention">
        <div className="space-y-4">
          {rows.map((row) => (
            <div key={row.id} className="rounded-2xl border border-gray-200 bg-white p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <Link href={`/admin/workspaces/${row.id}`} className="text-base font-bold text-[#121212] hover:underline">
                      {row.name}
                    </Link>
                    <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${getStatusTone(row.status)}`}>
                      {row.status}
                    </span>
                    {row.archiveState?.isArchived ? (
                      <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${getStatusTone('ARCHIVED')}`}>
                        Archived
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1 text-sm text-slate-500">{row.websiteUrl || 'No website URL'}</p>
                  <p className="mt-1 text-xs text-slate-400">
                    Owner: {row.user.email} • Created {formatDateTime(row.createdAt)}
                  </p>
                </div>
                <div className="grid gap-2 text-xs text-slate-600 sm:grid-cols-3">
                  <InfoPill label="Competitors" value={row._count.competitors.toLocaleString()} />
                  <InfoPill label="Content Items" value={row._count.contentItems.toLocaleString()} />
                  <InfoPill label="Strategy Runs" value={row._count.strategyRuns.toLocaleString()} />
                </div>
              </div>

              <div className="mt-4 grid gap-3 lg:grid-cols-4">
                <form action={manageWorkspace} className="rounded-xl border border-gray-200 bg-slate-50 p-3">
                  <input type="hidden" name="workspaceId" value={row.id} />
                  <input type="hidden" name="actionType" value="REANALYZE" />
                  <button className="w-full rounded-lg bg-black px-3 py-2 text-xs font-bold text-white">Force Re-analysis</button>
                </form>

                <form action={manageWorkspace} className="space-y-2 rounded-xl border border-gray-200 bg-slate-50 p-3">
                  <input type="hidden" name="workspaceId" value={row.id} />
                  <input type="hidden" name="actionType" value={row.archiveState?.isArchived ? 'RESTORE' : 'ARCHIVE'} />
                  {!row.archiveState?.isArchived ? (
                    <input
                      name="reason"
                      placeholder="Archive reason"
                      className="w-full rounded-lg border border-gray-300 bg-white px-2 py-2 text-xs outline-none focus:border-black"
                    />
                  ) : (
                    <p className="rounded-lg border border-green-200 bg-green-50 px-2 py-2 text-[11px] text-green-700">
                      Workspace is archived and hidden from user workspace lists.
                    </p>
                  )}
                  <button className={`w-full rounded-lg px-3 py-2 text-xs font-bold text-white ${row.archiveState?.isArchived ? 'bg-green-600' : 'bg-amber-600'}`}>
                    {row.archiveState?.isArchived ? 'Restore Workspace' : 'Archive Workspace'}
                  </button>
                </form>

                <form action={manageWorkspace} className="space-y-2 rounded-xl border border-gray-200 bg-slate-50 p-3">
                  <input type="hidden" name="workspaceId" value={row.id} />
                  <input type="hidden" name="actionType" value="TRANSFER" />
                  <select name="targetUserId" defaultValue="" className="w-full rounded-lg border border-gray-300 bg-white px-2 py-2 text-xs outline-none focus:border-black">
                    <option value="">Transfer owner to...</option>
                    {userOptions.map((item) => <option key={item.id} value={item.id}>{item.email}</option>)}
                  </select>
                  <button className="w-full rounded-lg bg-black px-3 py-2 text-xs font-bold text-white">Transfer Owner</button>
                </form>

                <form action={manageWorkspace} className="rounded-xl border border-red-200 bg-red-50 p-3">
                  <input type="hidden" name="workspaceId" value={row.id} />
                  <input type="hidden" name="actionType" value="DELETE" />
                  <button className="w-full rounded-lg bg-red-600 px-3 py-2 text-xs font-bold text-white">Delete Workspace</button>
                </form>
              </div>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}

function AiSection({
  settingsState,
  analytics,
  status,
}: {
  settingsState: Awaited<ReturnType<typeof getAdminSettingsState>>;
  analytics: Awaited<ReturnType<typeof getAdminAnalytics>>;
  status: string;
}) {
  return (
    <div className="space-y-4">
      <StatusBanner status={status} />
      <div className="grid gap-4 lg:grid-cols-3">
        <MetricCard label="Primary Model" value={settingsState.geminiModel} />
        <MetricCard label="Fallback Model" value={settingsState.openAiFallbackModel} />
        <MetricCard label="Cooldown" value={`${settingsState.geminiCooldownSeconds}s`} helper="after Gemini 429/503" />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <Panel title="AI Provider Control" subtitle="Primary, fallback, and retry guardrails">
          <form action={updateAiControls} className="grid gap-4">
            <label className="space-y-2">
              <span className="block text-sm font-medium text-[#121212]">Gemini Primary Model</span>
              <input
                name="geminiModel"
                defaultValue={settingsState.geminiModel}
                className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm outline-none focus:border-black"
                required
              />
            </label>
            <label className="space-y-2">
              <span className="block text-sm font-medium text-[#121212]">OpenAI Fallback Model</span>
              <input
                name="openAiFallbackModel"
                defaultValue={settingsState.openAiFallbackModel}
                className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm outline-none focus:border-black"
                required
              />
            </label>
            <label className="space-y-2">
              <span className="block text-sm font-medium text-[#121212]">Gemini Cooldown Seconds</span>
              <input
                type="number"
                name="geminiCooldownSeconds"
                min={GEMINI_COOLDOWN_SECONDS_MIN}
                max={GEMINI_COOLDOWN_SECONDS_MAX}
                defaultValue={settingsState.geminiCooldownSeconds}
                className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm outline-none focus:border-black"
                required
              />
            </label>
            <button className="inline-flex w-fit rounded-xl bg-black px-4 py-2 text-sm font-bold text-white">Save AI Controls</button>
          </form>
        </Panel>

        <Panel title="Framework Cost Signals" subtitle="Recent usage and quality">
          <SimpleTable
            headers={['Feature', 'Cost', 'Tokens']}
            rows={analytics.aiCostByFeature.slice(0, 8).map((item) => [
              item.feature,
              formatUsd(item.costUsd),
              item.totalTokens.toLocaleString(),
            ])}
          />
        </Panel>
      </div>
    </div>
  );
}

function SettingsSection({
  settingsState,
  status,
}: {
  settingsState: Awaited<ReturnType<typeof getAdminSettingsState>>;
  status: string;
}) {
  return (
    <div className="space-y-4">
      <StatusBanner status={status} />
      <Panel title="Runtime Platform Settings" subtitle="No-redeploy controls for core generation behavior">
        <form action={updatePlatformLimits} className="grid gap-5">
          <input type="hidden" name="redirectTo" value="/admin" />
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <Field label="Competitive Landscape Limit">
              <input type="number" name="competitiveLandscapeLimit" min={PLATFORM_LIMIT_MIN} max={PLATFORM_LIMIT_MAX} defaultValue={settingsState.competitiveLandscapeLimit} className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm outline-none focus:border-black" />
            </Field>
            <Field label="Brand Memory Rescrape Limit">
              <input type="number" name="brandMemoryLimit" min={PLATFORM_LIMIT_MIN} max={PLATFORM_LIMIT_MAX} defaultValue={settingsState.brandMemoryLimit} className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm outline-none focus:border-black" />
            </Field>
            <Field label="Ideation Max Content Count">
              <input type="number" name="ideationMaxContentCount" min={PLATFORM_LIMIT_MIN} max={PLATFORM_LIMIT_MAX} defaultValue={settingsState.ideationMaxContentCount} className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm outline-none focus:border-black" />
            </Field>
            <Field label="Default Schedule Delay (Hours)">
              <input type="number" name="defaultScheduleDelayHours" min={SCHEDULE_DELAY_HOURS_MIN} max={SCHEDULE_DELAY_HOURS_MAX} defaultValue={settingsState.defaultScheduleDelayHours} className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm outline-none focus:border-black" />
            </Field>
          </div>

          <div className="rounded-2xl border border-gray-200 bg-slate-50 p-4">
            <p className="text-sm font-bold text-[#121212]">Word Count Rules</p>
            <p className="mt-1 text-xs text-slate-500">Current enforced range: {WORD_COUNT_LIMIT_ABSOLUTE_MIN} to {WORD_COUNT_LIMIT_ABSOLUTE_MAX} words.</p>
            <div className="mt-4 grid gap-3 lg:grid-cols-2">
              {WORD_COUNT_PLATFORMS.map((platform) => (
                <div key={platform} className="rounded-xl border border-gray-200 bg-white p-3">
                  <p className="text-xs font-bold uppercase tracking-wider text-slate-600">{WORD_COUNT_PLATFORM_LABELS[platform]}</p>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <input type="number" name={`wordMin_${platform}`} min={WORD_COUNT_LIMIT_ABSOLUTE_MIN} max={WORD_COUNT_LIMIT_ABSOLUTE_MAX} defaultValue={settingsState.wordCountLimits[platform].min} className="rounded-lg border border-gray-300 px-2 py-2 text-sm outline-none focus:border-black" />
                    <input type="number" name={`wordMax_${platform}`} min={WORD_COUNT_LIMIT_ABSOLUTE_MIN} max={WORD_COUNT_LIMIT_ABSOLUTE_MAX} defaultValue={settingsState.wordCountLimits[platform].max} className="rounded-lg border border-gray-300 px-2 py-2 text-sm outline-none focus:border-black" />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <button className="inline-flex w-fit rounded-xl bg-black px-4 py-2 text-sm font-bold text-white">Save Platform Settings</button>
        </form>
      </Panel>
    </div>
  );
}

function CreditsSection({
  rows,
  subscriptions,
  userOptions,
  status,
  billingStatus,
  filterUserId,
}: {
  rows: Awaited<ReturnType<typeof getAdminCreditLedger>>;
  subscriptions: Array<{
    id: string;
    plan: string;
    status: string;
    stripeCustomerId: string;
    stripeSubscriptionId: string | null;
    currentPeriodEnd: Date | null;
    user: {
      id: string;
      email: string;
      name: string | null;
    };
  }>;
  userOptions: Array<{ id: string; email: string; name: string | null }>;
  status: string;
  billingStatus: string;
  filterUserId: string;
}) {
  return (
    <div className="space-y-4">
      <StatusBanner status={status} />
      <StatusBanner status={billingStatus} />
      <div className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
        <Panel title="Manual Credit Control" subtitle="Add, refund, top up, or deduct ledger balances">
          <form action={adjustCredits} className="grid gap-3">
            <select name="userId" defaultValue="" className="rounded-xl border border-gray-300 px-3 py-2 text-sm outline-none focus:border-black" required>
              <option value="">Select user</option>
              {userOptions.map((item) => <option key={item.id} value={item.id}>{item.email}</option>)}
            </select>
            <select name="adjustmentType" defaultValue="TOP_UP" className="rounded-xl border border-gray-300 px-3 py-2 text-sm outline-none focus:border-black">
              <option value="TOP_UP">Top Up</option>
              <option value="REFUND">Refund</option>
              <option value="ALLOCATE">Allocate</option>
              <option value="DEDUCT">Deduct</option>
            </select>
            <input type="number" name="amount" min={1} placeholder="Amount" className="rounded-xl border border-gray-300 px-3 py-2 text-sm outline-none focus:border-black" required />
            <textarea name="note" placeholder="Reason / internal note" className="min-h-[90px] rounded-xl border border-gray-300 px-3 py-2 text-sm outline-none focus:border-black" />
            <button className="inline-flex w-fit rounded-xl bg-black px-4 py-2 text-sm font-bold text-white">Apply Credit Adjustment</button>
          </form>
        </Panel>

        <Panel title="Credit Ledger" subtitle="Append-only history of balance movement">
          <form action="/admin" className="mb-4 grid gap-3 rounded-2xl border border-gray-200 bg-slate-50 p-3 md:grid-cols-[1fr_auto]">
            <input type="hidden" name="section" value="credits" />
            <select name="userId" defaultValue={filterUserId} className="rounded-xl border border-gray-300 px-3 py-2 text-sm outline-none focus:border-black">
              <option value="">All users</option>
              {userOptions.map((item) => <option key={item.id} value={item.id}>{item.email}</option>)}
            </select>
            <button className="rounded-xl bg-black px-4 py-2 text-sm font-bold text-white">Filter Ledger</button>
          </form>
          <div className="max-h-[520px] overflow-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wider text-gray-500">
                  <th className="px-3 py-3">User</th>
                  <th className="px-3 py-3">Type</th>
                  <th className="px-3 py-3">Feature</th>
                  <th className="px-3 py-3">Delta</th>
                  <th className="px-3 py-3">Balance</th>
                  <th className="px-3 py-3">At</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-b border-gray-100">
                    <td className="px-3 py-3">
                      <p className="font-medium text-[#121212]">{row.user.email}</p>
                      <p className="text-xs text-gray-400">{row.userId}</p>
                    </td>
                    <td className="px-3 py-3 text-xs">{row.type}</td>
                    <td className="px-3 py-3 text-xs">{row.feature}</td>
                    <td className={`px-3 py-3 font-bold ${row.amount < 0 ? 'text-red-600' : 'text-emerald-600'}`}>{row.amount}</td>
                    <td className="px-3 py-3 text-xs">{row.balanceAfter}</td>
                    <td className="px-3 py-3 text-xs">{formatDateTime(row.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
        <Panel title="Billing Operations" subtitle="Sync Stripe state, grant trials, and apply promo credits">
          <form action={manageBilling} className="grid gap-3">
            <select name="userId" defaultValue={filterUserId} className="rounded-xl border border-gray-300 px-3 py-2 text-sm outline-none focus:border-black" required>
              <option value="">Select user</option>
              {userOptions.map((item) => <option key={item.id} value={item.id}>{item.email}</option>)}
            </select>
            <select name="actionType" defaultValue="SYNC_STRIPE" className="rounded-xl border border-gray-300 px-3 py-2 text-sm outline-none focus:border-black">
              <option value="SYNC_STRIPE">Sync Stripe</option>
              <option value="GRANT_TRIAL">Grant Trial</option>
              <option value="APPLY_PROMO">Apply Promo Credits</option>
            </select>
            <select name="plan" defaultValue="STARTER" className="rounded-xl border border-gray-300 px-3 py-2 text-sm outline-none focus:border-black">
              {USER_PLAN_OPTIONS.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
            <input type="number" name="trialDays" min={1} max={90} defaultValue={14} placeholder="Trial days" className="rounded-xl border border-gray-300 px-3 py-2 text-sm outline-none focus:border-black" />
            <input type="number" name="promoCredits" min={1} placeholder="Promo credits" className="rounded-xl border border-gray-300 px-3 py-2 text-sm outline-none focus:border-black" />
            <textarea name="note" placeholder="Billing note / promo reason" className="min-h-[90px] rounded-xl border border-gray-300 px-3 py-2 text-sm outline-none focus:border-black" />
            <button className="inline-flex w-fit rounded-xl bg-black px-4 py-2 text-sm font-bold text-white">Run Billing Action</button>
          </form>
        </Panel>

        <Panel title="Subscriptions" subtitle="Current local subscription records">
          <div className="max-h-[520px] overflow-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wider text-gray-500">
                  <th className="px-3 py-3">User</th>
                  <th className="px-3 py-3">Plan</th>
                  <th className="px-3 py-3">Status</th>
                  <th className="px-3 py-3">Renewal</th>
                </tr>
              </thead>
              <tbody>
                {subscriptions.map((row) => (
                  <tr key={row.id} className="border-b border-gray-100">
                    <td className="px-3 py-3">
                      <p className="font-medium text-[#121212]">{row.user.email}</p>
                      <p className="text-xs text-gray-400">{row.stripeSubscriptionId || row.stripeCustomerId}</p>
                    </td>
                    <td className="px-3 py-3 text-xs">{row.plan}</td>
                    <td className="px-3 py-3"><span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${getStatusTone(row.status)}`}>{row.status}</span></td>
                    <td className="px-3 py-3 text-xs">{formatDateTime(row.currentPeriodEnd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    </div>
  );
}

function ContentSection({
  rows,
  workspaceOptions,
  filters,
}: {
  rows: Awaited<ReturnType<typeof getAdminContentItems>>;
  workspaceOptions: Array<{ id: string; name: string }>;
  filters: {
    q: string;
    status: string;
    channel: string;
    workspaceId: string;
  };
}) {
  return (
    <Panel title="Content Operations" subtitle="Inspect generated output, schedule state, and operational metadata">
      <form action="/admin" className="mb-4 grid gap-3 rounded-2xl border border-gray-200 bg-slate-50 p-4 lg:grid-cols-4">
        <input type="hidden" name="section" value="content" />
        <input
          name="q"
          defaultValue={filters.q}
          placeholder="Search topic or content id"
          className="rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-black"
        />
        <select name="status" defaultValue={filters.status} className="rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-black">
          <option value="ALL">All statuses</option>
          {CONTENT_STATUS_OPTIONS.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
        <select name="channel" defaultValue={filters.channel} className="rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-black">
          <option value="ALL">All channels</option>
          {CONTENT_CHANNEL_OPTIONS.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
        <select name="workspaceId" defaultValue={filters.workspaceId} className="rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-black">
          <option value="ALL">All workspaces</option>
          {workspaceOptions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
        <button className="rounded-xl bg-black px-4 py-2 text-sm font-bold text-white lg:col-span-4">Apply Filters</button>
      </form>

      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wider text-gray-500">
              <th className="px-3 py-3">Topic</th>
              <th className="px-3 py-3">Workspace</th>
              <th className="px-3 py-3">Platform</th>
              <th className="px-3 py-3">Status</th>
              <th className="px-3 py-3">Words</th>
              <th className="px-3 py-3">Schedule</th>
              <th className="px-3 py-3">Generated</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-b border-gray-100 align-top">
                <td className="px-3 py-4">
                  <Link href={`/admin/content/${row.id}`} className="font-bold text-[#121212] hover:underline">
                    {row.topic}
                  </Link>
                  <p className="mt-1 line-clamp-2 text-xs text-slate-500">{row.content}</p>
                </td>
                <td className="px-3 py-4 text-xs text-slate-600">{row.workspace?.name || '-'}</td>
                <td className="px-3 py-4 text-xs text-slate-600">{row.channel}</td>
                <td className="px-3 py-4">
                  <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${getStatusTone(row.status)}`}>
                    {row.status}
                  </span>
                </td>
                <td className="px-3 py-4 text-xs text-slate-600">{row.wordCount.toLocaleString()}</td>
                <td className="px-3 py-4 text-xs text-slate-600">{formatDateTime(row.scheduledAtUtc)}</td>
                <td className="px-3 py-4 text-xs text-slate-600">{formatDateTime(row.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function JobsSection({
  rows,
  status,
  filters,
}: {
  rows: Awaited<ReturnType<typeof getAdminJobs>>;
  status: string;
  filters: {
    status: string;
    type: string;
  };
}) {
  return (
    <Panel title="Jobs & Queue Monitoring" subtitle="Current job records, duration, and failure visibility">
      <StatusBanner status={status} />
      <form action="/admin" className="mb-4 grid gap-3 rounded-2xl border border-gray-200 bg-slate-50 p-4 lg:grid-cols-3">
        <input type="hidden" name="section" value="jobs" />
        <select name="status" defaultValue={filters.status} className="rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-black">
          <option value="ALL">All statuses</option>
          {JOB_STATUS_OPTIONS.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
        <select name="type" defaultValue={filters.type} className="rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-black">
          <option value="ALL">All job types</option>
          {JOB_TYPE_OPTIONS.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
        <button className="rounded-xl bg-black px-4 py-2 text-sm font-bold text-white">Apply Filters</button>
      </form>

      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wider text-gray-500">
              <th className="px-3 py-3">Job</th>
              <th className="px-3 py-3">User / Workspace</th>
              <th className="px-3 py-3">Status</th>
              <th className="px-3 py-3">Credits</th>
              <th className="px-3 py-3">Duration</th>
              <th className="px-3 py-3">Error</th>
              <th className="px-3 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-b border-gray-100 align-top">
                <td className="px-3 py-4">
                  <p className="font-bold text-[#121212]">{row.type}</p>
                  <p className="text-xs text-slate-400">{row.id}</p>
                </td>
                <td className="px-3 py-4 text-xs text-slate-600">
                  <p>{row.user.email}</p>
                  <p>{row.workspace?.name || '-'}</p>
                </td>
                <td className="px-3 py-4">
                  <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${getStatusTone(row.status)}`}>
                    {row.status}
                  </span>
                </td>
                <td className="px-3 py-4 text-xs text-slate-600">{row.creditsCost}</td>
                <td className="px-3 py-4 text-xs text-slate-600">{formatDuration(row.durationMs)}</td>
                <td className="px-3 py-4 text-xs text-red-600">{row.errorMessage || '-'}</td>
                <td className="px-3 py-4">
                  <div className="flex flex-wrap gap-2">
                    <form action={manageJob}>
                      <input type="hidden" name="jobId" value={row.id} />
                      <input type="hidden" name="actionType" value="RETRY" />
                      <button className="rounded-lg bg-black px-3 py-1.5 text-[11px] font-bold text-white">
                        Retry
                      </button>
                    </form>
                    {row.status === 'PENDING' || row.status === 'RUNNING' ? (
                      <form action={manageJob}>
                        <input type="hidden" name="jobId" value={row.id} />
                        <input type="hidden" name="actionType" value="CANCEL" />
                        <button className="rounded-lg bg-red-600 px-3 py-1.5 text-[11px] font-bold text-white">
                          Cancel
                        </button>
                      </form>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function LogsSection({
  logs,
}: {
  logs: Awaited<ReturnType<typeof getAdminLogs>> | undefined;
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel title="Admin Audit Trail" subtitle="All admin-originated changes are recorded here">
        <LogList rows={logs?.adminAuditLogs || []} />
      </Panel>
      <Panel title="Platform Activity Logs" subtitle="Cross-feature user and workspace activity">
        <LogList rows={logs?.activityLogs || []} />
      </Panel>
    </div>
  );
}

function AnalyticsSection({
  analytics,
}: {
  analytics: Awaited<ReturnType<typeof getAdminAnalytics>>;
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Panel title="Top Frameworks" subtitle="Framework adoption over the last 30 days">
        <SimpleTable headers={['Framework', 'Events', 'Avg Score']} rows={analytics.frameworks.map((item) => [item.frameworkName, item.events.toLocaleString(), item.avgOverallScore?.toFixed(2) || '-'])} />
      </Panel>
      <Panel title="Top Platforms" subtitle="Distribution by content channel">
        <SimpleTable headers={['Platform', 'Count']} rows={analytics.platforms.map((item) => [item.channel, item.count.toLocaleString()])} />
      </Panel>
      <Panel title="Highest Cost Features" subtitle="AI cost concentration by feature">
        <SimpleTable headers={['Feature', 'Cost']} rows={analytics.aiCostByFeature.map((item) => [item.feature, formatUsd(item.costUsd)])} />
      </Panel>
    </div>
  );
}

function IntegrationsSection({
  integrations,
}: {
  integrations: Awaited<ReturnType<typeof getAdminIntegrations>>;
}) {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <HealthCard title="Gemini" status={integrations.providers.geminiConfigured ? 'healthy' : 'FAILED'} description={integrations.providers.geminiConfigured ? 'API key configured.' : 'Missing GEMINI_API_KEY.'} />
        <HealthCard title="OpenAI" status={integrations.providers.openAiConfigured ? 'healthy' : 'FAILED'} description={integrations.providers.openAiConfigured ? 'API key configured.' : 'Missing OPENAI_API_KEY.'} />
        <HealthCard title="Redis" status={integrations.providers.redisConfigured ? 'healthy' : 'FAILED'} description={integrations.providers.redisConfigured ? 'Queue/cache provider configured.' : 'Missing REDIS_URL.'} />
        <HealthCard title="DataForSEO" status={integrations.providers.dataForSeoConfigured ? 'healthy' : 'FAILED'} description={integrations.providers.dataForSeoConfigured ? 'Credentials configured.' : 'Credentials not configured.'} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="SEO Data Footprint" subtitle="Current stored external intelligence">
          <div className="grid gap-3 sm:grid-cols-2">
            <InfoPill label="Keyword Rows" value={integrations.seoData.keywordRows.toLocaleString()} />
            <InfoPill label="SERP Analyses" value={integrations.seoData.serpRows.toLocaleString()} />
          </div>
        </Panel>
        <Panel title="AI Requests (24h)" subtitle="Recent provider load by model">
          <SimpleTable
            headers={['Model', 'Requests', 'Cost']}
            rows={integrations.aiUsageLastDay.map((item) => [item.model, item.requests.toLocaleString(), formatUsd(item.costUsd)])}
          />
        </Panel>
      </div>
    </div>
  );
}

function StatusBanner({ status }: { status: string }) {
  if (!status) return null;
  const tone =
    status === 'saved'
      ? 'border-green-200 bg-green-50 text-green-700'
      : status === 'failed'
        ? 'border-red-200 bg-red-50 text-red-700'
        : 'border-amber-200 bg-amber-50 text-amber-700';
  const message =
    status === 'saved'
      ? 'Change saved successfully.'
      : status === 'failed'
        ? 'Action failed. Check logs and retry.'
        : 'Invalid input. Review the submitted values.';

  return <div className={`rounded-xl border px-4 py-3 text-sm font-medium ${tone}`}>{message}</div>;
}

function MetricCard({
  label,
  value,
  helper,
  emphasis,
}: {
  label: string;
  value: string;
  helper?: string;
  emphasis?: boolean;
}) {
  return (
    <div className={`rounded-2xl border p-4 ${emphasis ? 'border-emerald-200 bg-emerald-50' : 'border-gray-200 bg-white'}`}>
      <p className="text-[11px] font-bold uppercase tracking-widest text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-bold text-[#121212]">{value}</p>
      {helper ? <p className="mt-1 text-xs text-slate-500">{helper}</p> : null}
    </div>
  );
}

function HealthCard({
  title,
  status,
  description,
}: {
  title: string;
  status: string;
  description: string;
}) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-bold text-[#121212]">{title}</p>
        <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${getStatusTone(status)}`}>
          {status}
        </span>
      </div>
      <p className="mt-2 text-sm text-slate-600">{description}</p>
    </div>
  );
}

function Panel({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white">
      <div className="border-b border-gray-100 px-5 py-4">
        <p className="text-base font-bold text-[#121212]">{title}</p>
        <p className="mt-1 text-sm text-slate-500">{subtitle}</p>
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return <p className="text-sm text-slate-500">{text}</p>;
}

function InfoPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-slate-50 px-3 py-2">
      <p className="text-[11px] font-bold uppercase tracking-widest text-slate-500">{label}</p>
      <p className="mt-1 text-sm font-bold text-[#121212]">{value}</p>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="space-y-2">
      <span className="block text-sm font-medium text-[#121212]">{label}</span>
      {children}
    </label>
  );
}

function SimpleTable({
  headers,
  rows,
}: {
  headers: string[];
  rows: string[][];
}) {
  return rows.length === 0 ? (
    <EmptyState text="No data available." />
  ) : (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wider text-gray-500">
            {headers.map((header) => (
              <th key={header} className="px-3 py-3">{header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`${row[0]}-${index}`} className="border-b border-gray-100">
              {row.map((cell, cellIndex) => (
                <td key={`${row[0]}-${cellIndex}`} className="px-3 py-3 text-sm text-slate-700">{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LogList({
  rows,
}: {
  rows: Array<{ id: string; action: string; workspaceName: string | null; detail: unknown; createdAt: Date }>;
}) {
  if (!rows.length) {
    return <EmptyState text="No log entries recorded." />;
  }

  return (
    <div className="max-h-[560px] space-y-3 overflow-auto">
      {rows.map((row) => (
        <div key={row.id} className="rounded-xl border border-gray-200 bg-slate-50 p-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-bold text-[#121212]">{row.action}</p>
            <p className="text-[11px] text-slate-400">{formatDateTime(row.createdAt)}</p>
          </div>
          <p className="mt-1 text-xs text-slate-500">{row.workspaceName || 'No workspace'}</p>
          <pre className="mt-2 overflow-x-auto whitespace-pre-wrap rounded-lg border border-gray-200 bg-white p-2 text-[11px] text-slate-600">
            {JSON.stringify(row.detail, null, 2)}
          </pre>
        </div>
      ))}
    </div>
  );
}
