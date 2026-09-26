import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { getTranslations } from 'next-intl/server';

import { Link, getPathname } from '@/i18n/navigation';
import { getSession } from '@/lib/auth';
import { AdminBarChart, AdminPieChart } from './charts';
import { createAdminFormat } from './_components/AdminUi';
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
  WORD_COUNT_PLATFORMS,
} from '@/lib/content-word-count';

type Props = {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

/*
  Plan names, roles, lifecycle states and job types are values the database
  stores and the server actions compare against. They stay Latin in both
  languages — a translated enum is a bug report waiting to happen.
*/
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

/**
 * The filter forms submit with GET to this page. Written as a bare `/admin`
 * the submission leaves the locale behind, so it is built through the routing
 * map instead and keeps the visitor inside /fa.
 */
function useAdminFormAction(): string {
  const locale = useLocale();
  return getPathname({ href: '/admin', locale });
}

/** One formatter + translator pair for a section. */
function useAdminScreen() {
  const t = useTranslations('admin');
  const format = useFormatter();
  return { t, fmt: createAdminFormat(format, t) };
}

function getStatusTone(status: string): string {
  if (['FAILED', 'ERROR', 'PAST_DUE'].includes(status)) return 'text-red-700 bg-red-50 border-red-200';
  if (['PENDING', 'RUNNING', 'CRAWLING', 'ANALYZING'].includes(status)) return 'text-amber-700 bg-amber-50 border-amber-200';
  if (['SCHEDULED', 'PUBLISHED', 'READY', 'ACTIVE', 'TRIALING', 'healthy'].includes(status)) {
    return 'text-moss-700 bg-chalk-sunk border-rule';
  }
  if (['warning'].includes(status)) return 'text-amber-700 bg-amber-50 border-amber-200';
  return 'text-moss bg-chalk border-rule';
}

export default async function AdminDashboardPage({ searchParams }: Props) {
  const user = await getSession();
  const resolvedParams = await searchParams;
  const section = resolveAdminSection(resolvedParams.section);
  const t = await getTranslations('admin');

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
    <div className="mx-auto flex max-w-[1440px] flex-col gap-8">
      <AdminHero user={user} overview={overview} integrations={integrations} />

      <div className="rounded-[2rem] border border-rule/60 bg-chalk-raised p-6 shadow-sm sm:p-8">
        <div className="mb-8 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-2xl font-black tracking-tight text-moss">{t(`sections.${section}.label`)}</h2>
            <p className="mt-2 text-sm font-medium text-moss-muted">{t(`sections.${section}.description`)}</p>
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

/**
 * The masthead: identity, live counters and the five health lamps.
 *
 * Split out of the page so it can format its own numbers through the hook
 * rather than being handed a dozen pre-rendered strings.
 */
function AdminHero({
  user,
  overview,
  integrations,
}: {
  user: { email: string } | null;
  overview: Awaited<ReturnType<typeof getAdminOverview>>;
  integrations: Awaited<ReturnType<typeof getAdminIntegrations>>;
}) {
  const { t, fmt } = useAdminScreen();

  return (
    <>
      <div className="relative overflow-hidden rounded-3xl bg-forest p-8 text-chalk sm:p-12">
        <div className="relative flex flex-col gap-10 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-3xl">
            <div className="mb-6 inline-flex items-center gap-2.5 rounded-full border border-forest-line px-4 py-1.5">
              <span aria-hidden className="h-2 w-2 rotate-45 bg-saffron" />
              <p className="font-plexmono text-[11px] uppercase tracking-[0.2em] text-forest-muted">{t('hero.badge')}</p>
            </div>
            <h1 className="font-display text-4xl font-extrabold tracking-tight text-chalk md:text-5xl lg:text-6xl">{t('hero.title')}</h1>
            <p className="mt-6 text-lg leading-relaxed text-forest-muted">{t('hero.body')}</p>
            <p className="mt-8 text-sm font-medium text-forest-muted">
              {t.rich('hero.session', {
                email: user?.email || t('hero.unknownUser'),
                b: (chunks) => <bdi className="font-bold text-chalk">{chunks}</bdi>,
              })}
            </p>
          </div>
          <div className="grid w-full grid-cols-2 gap-4 sm:grid-cols-4 xl:w-auto">
            <DarkMetricCard label={t('hero.users')} value={fmt.number(overview.metrics.totalUsers)} />
            <DarkMetricCard label={t('hero.workspaces')} value={fmt.number(overview.metrics.totalWorkspaces)} />
            <DarkMetricCard label={t('hero.aiJobsToday')} value={fmt.number(overview.metrics.aiJobsToday)} />
            <DarkMetricCard label={t('hero.aiCostToday')} value={fmt.usd(overview.metrics.estimatedAiCostToday)} emphasis />
          </div>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label={t('metrics.activeUsersToday')}
          value={fmt.number(overview.metrics.activeUsersToday)}
          helper={t('metrics.activeUsersHelper', { count: fmt.number(overview.metrics.activeUsers) })}
        />
        <MetricCard
          label={t('metrics.activeWorkspaces')}
          value={fmt.number(overview.metrics.activeWorkspaces)}
          helper={t('metrics.activeWorkspacesHelper', { count: fmt.number(overview.metrics.payingUsers) })}
        />
        <MetricCard
          label={t('metrics.contentGeneratedToday')}
          value={fmt.number(overview.metrics.contentGeneratedToday)}
          helper={t('metrics.contentGeneratedHelper', { count: fmt.number(overview.metrics.scheduledContentCount) })}
        />
        <MetricCard
          label={t('metrics.queueBacklog')}
          value={fmt.number(overview.metrics.pendingJobs + overview.metrics.runningJobs)}
          helper={t('metrics.queueBacklogHelper', { count: fmt.number(overview.metrics.failedJobs) })}
        />
      </div>

      <div className="grid gap-3 lg:grid-cols-5">
        <HealthCard title={t('health.api')} status="healthy" description={t('health.apiDescription')} />
        <HealthCard
          title={t('health.database')}
          status={overview.health.database}
          description={t('health.databaseDescription', { latency: fmt.number(overview.metrics.databaseLatencyMs) })}
        />
        <HealthCard
          title={t('health.redis')}
          status={integrations.providers.redisConfigured ? 'healthy' : 'FAILED'}
          description={integrations.providers.redisConfigured ? t('health.redisQueueUrlConfigured') : t('health.redisMissing')}
        />
        <HealthCard
          title={t('health.jobs')}
          status={overview.health.jobs}
          description={t('health.jobsDescription', {
            pending: fmt.number(overview.metrics.pendingJobs),
            running: fmt.number(overview.metrics.runningJobs),
            failed: fmt.number(overview.metrics.failedJobs),
          })}
        />
        <HealthCard
          title={t('health.providers')}
          status={overview.health.provider}
          description={t('health.providersDescription', {
            gemini: integrations.providers.geminiConfigured ? t('health.geminiReady') : t('health.geminiMissing'),
            openAi: integrations.providers.openAiConfigured ? t('health.openAiReady') : t('health.openAiMissing'),
          })}
        />
      </div>
    </>
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
  const { t, fmt } = useAdminScreen();

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 auto-rows-max">
      {/* Feature 1: Top Frameworks (Spans 8 cols) */}
      <div className="lg:col-span-8">
        <Panel title={t('overview.topFrameworks')} subtitle={t('overview.topFrameworksSubtitle')}>
          <SimpleTable
            headers={[t('overview.framework'), t('overview.events'), t('overview.fallback'), t('overview.score')]}
            rows={overview.topFrameworks.slice(0, 5).map((item) => [
              item.frameworkName,
              fmt.number(item.events),
              fmt.number(item.fallbackEvents),
              item.avgOverallScore != null ? fmt.decimal(item.avgOverallScore) : '-',
            ])}
          />
        </Panel>
      </div>

      {/* Feature 2: High-density metric stack (Spans 4 cols) */}
      <div className="flex flex-col gap-6 lg:col-span-4 lg:row-span-2">
        <MetricCard
          label={t('metrics.creditsUsedToday')}
          value={fmt.number(overview.metrics.creditsUsedToday)}
          helper={t('metrics.creditsUsedHelper', { count: fmt.number(overview.metrics.publishedContentToday) })}
          emphasis
        />
        <MetricCard
          label={t('metrics.averageGenerationTime')}
          value={fmt.duration(overview.metrics.averageGenerationTimeMs)}
          helper={t('metrics.averageGenerationHelper')}
        />
        <MetricCard
          label={t('metrics.scheduledPosts')}
          value={fmt.number(overview.metrics.scheduledContentCount)}
          helper={t('metrics.scheduledPostsHelper', { count: fmt.number(overview.metrics.contentGeneratedToday) })}
        />
        <MetricCard
          label={t('metrics.publishedPosts')}
          value={fmt.number(overview.metrics.publishedContentToday)}
          helper={t('metrics.publishedPostsHelper', { count: fmt.number(overview.metrics.failedAiJobsToday) })}
        />
      </div>

      {/* Feature 3: Recent Failures (Spans 8 cols) */}
      <div className="lg:col-span-8">
        <Panel title={t('overview.recentFailures')} subtitle={t('overview.recentFailuresSubtitle')}>
          <div className="space-y-3">
            {overview.recentFailedJobs.length === 0 ? (
              <EmptyState text={t('overview.noFailedJobs')} />
            ) : (
              overview.recentFailedJobs.slice(0, 4).map((job: any) => (
                <div key={job.id} className="rounded-3xl border border-red-100 bg-red-50/70 p-5 transition-colors hover:bg-red-50">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-bold text-moss" dir="ltr">{job.type}</p>
                    <span className="rounded-full border border-red-200 bg-chalk-raised px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-red-700 shadow-sm">
                      {job.status}
                    </span>
                  </div>
                  <p className="mt-2 text-xs font-semibold text-moss-muted">
                    <bdi>{job.user.email}</bdi> {job.workspace?.name ? <>• <bdi>{job.workspace.name}</bdi></> : null} • {fmt.dateTime(job.updatedAt)}
                  </p>
                  <p className="mt-3 text-xs font-medium text-red-700">{job.errorMessage || t('overview.unknownError')}</p>
                </div>
              ))
            )}
          </div>
        </Panel>
      </div>

      {/* Bottom row graphs/tables (Span 4 cols each) */}
      <div className="lg:col-span-4">
        <Panel title={t('overview.topPlatforms')} subtitle={t('overview.topPlatformsSubtitle')}>
          <div className="pt-4">
            <AdminBarChart
              data={analytics.platforms}
              dataKey="count"
              nameKey="channel"
              color="#3b82f6"
              valueName={t('charts.count')}
            />
          </div>
        </Panel>
      </div>
      <div className="lg:col-span-4">
        <Panel title={t('overview.aiCostContext')} subtitle={t('overview.aiCostContextSubtitle')}>
          <div className="pt-4">
            <AdminBarChart
              data={analytics.aiCostByFeature}
              dataKey="costUsd"
              nameKey="feature"
              color="#10b981"
              valueName={t('charts.costUsd')}
            />
          </div>
        </Panel>
      </div>
      <div className="lg:col-span-4">
        <Panel title={t('overview.assetPipeline')} subtitle={t('overview.assetPipelineSubtitle')}>
          <div className="pt-4">
            <AdminPieChart
              data={analytics.contentStatusBreakdown.map(item => ({ ...item, count: Number(item.count) }))}
              dataKey="count"
              nameKey="status"
              valueName={t('charts.count')}
            />
          </div>
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
  const { t, fmt } = useAdminScreen();
  const formAction = useAdminFormAction();

  return (
    <div className="space-y-4">
      <StatusBanner status={status} />
      <form action={formAction} className="grid gap-4 rounded-[2rem] border border-rule/60 bg-chalk-raised p-5 shadow-sm lg:grid-cols-5">
        <input type="hidden" name="section" value="users" />
        <input name="q" defaultValue={filters.q} placeholder={t('users.searchPlaceholder')} className="rounded-xl border border-rule-strong bg-chalk-raised px-3 py-2 text-sm outline-none focus:border-moss" />
        <select name="plan" defaultValue={filters.plan} className="rounded-xl border border-rule-strong bg-chalk-raised px-3 py-2 text-sm outline-none focus:border-moss">
          <option value="ALL">{t('common.allPlans')}</option>
          {USER_PLAN_OPTIONS.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
        <select name="role" defaultValue={filters.role} className="rounded-xl border border-rule-strong bg-chalk-raised px-3 py-2 text-sm outline-none focus:border-moss">
          <option value="ALL">{t('common.allRoles')}</option>
          {USER_ROLE_OPTIONS.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
        <select name="status" defaultValue={filters.status} className="rounded-xl border border-rule-strong bg-chalk-raised px-3 py-2 text-sm outline-none focus:border-moss">
          <option value="ALL">{t('common.allStatuses')}</option>
          {USER_ACCOUNT_STATUS_OPTIONS.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
        <button className="rounded-xl bg-moss px-4 py-2 text-sm font-bold text-chalk transition-colors hover:bg-moss">{t('common.applyFilters')}</button>
      </form>

      <Panel title={t('users.panelTitle')} subtitle={t('users.panelSubtitle')}>
        <div className="overflow-x-auto">
          <table className="w-full text-start text-sm">
            <thead>
              <tr className="border-b border-rule uppercase tracking-widest text-moss-muted">
                <th className="px-4 py-4 text-start text-[10px] font-bold">{t('users.colUser')}</th>
                <th className="px-4 py-4 text-start text-[10px] font-bold">{t('users.colPlanRole')}</th>
                <th className="px-4 py-4 text-start text-[10px] font-bold">{t('users.colStatus')}</th>
                <th className="px-4 py-4 text-start text-[10px] font-bold">{t('users.colUsage')}</th>
                <th className="px-4 py-4 text-start text-[10px] font-bold">{t('users.colLastActive')}</th>
                <th className="px-4 py-4 text-start text-[10px] font-bold w-[340px]">{t('users.colActions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-rule/80">
              {rows.map((row) => (
                <tr key={row.id} className="align-top transition-colors hover:bg-chalk/50">
                  <td className="px-4 py-4">
                    <Link href={{ pathname: '/admin/users/[userId]', params: { userId: row.id } }} className="font-bold text-moss hover:underline">
                      {row.name || t('users.unnamedUser')}
                    </Link>
                    <p className="text-xs text-moss-muted"><bdi>{row.email}</bdi></p>
                    <p className="mt-1 text-[11px] text-moss-muted" dir="ltr">{row.id}</p>
                  </td>
                  <td className="px-4 py-4">
                    <div className="space-y-2">
                      <span className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${getStatusTone(row.subscription?.status || row.plan)}`}>
                        {row.plan}
                      </span>
                      <span className={`ms-2 inline-flex rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${getStatusTone(row.role)}`}>
                        {row.role}
                      </span>
                      <p className="text-xs font-medium text-moss-muted">
                        {t.rich('users.subscription', {
                          status: row.subscription?.status || t('users.noSubscription'),
                          b: (chunks) => <span className="text-moss">{chunks}</span>,
                        })}
                      </p>
                    </div>
                  </td>
                  <td className="px-4 py-4">
                    <div className="space-y-2">
                      <span className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${getStatusTone(row.accountStatus)}`}>
                        {row.accountStatus}
                      </span>
                      {row.suspendedReason ? (
                        <p className="max-w-[180px] text-[11px] font-semibold text-red-600">{row.suspendedReason}</p>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-4 py-4 text-xs font-medium text-moss-muted space-y-1">
                    <p>{t.rich('users.usageWorkspaces', { count: fmt.number(row._count.workspaces), b: boldValue })}</p>
                    <p>{t.rich('users.usageContentItems', { count: fmt.number(row._count.contentItems), b: boldValue })}</p>
                    <p>{t.rich('users.usageCredits', { count: fmt.number(Number(row.creditBalance || 0)), b: boldValue })}</p>
                    <p>{t.rich('users.usageAiCost', { value: fmt.usd(Number(row.totalAiCost || 0)), b: boldValue })}</p>
                  </td>
                  <td className="px-4 py-4 text-xs font-medium text-moss-muted">{fmt.dateTime(row.lastActiveAt)}</td>
                  <td className="px-4 py-4">
                    <div className="flex flex-col gap-3">
                      <form action={updateUserAccess} className="flex gap-2 rounded-2xl border border-rule/60 bg-chalk-raised p-3 shadow-sm">
                        <input type="hidden" name="userId" value={row.id} />
                        <select name="plan" defaultValue={row.plan} className="w-full flex-1 rounded-xl border border-rule bg-chalk px-2.5 py-1.5 text-xs font-semibold outline-none focus:border-moss focus:bg-chalk-raised text-moss">
                          {USER_PLAN_OPTIONS.map((item) => <option key={item} value={item}>{item}</option>)}
                        </select>
                        <button className="shrink-0 rounded-xl bg-moss px-3 py-1.5 text-[11px] font-bold text-chalk transition-colors hover:bg-moss">{t('users.setPlan')}</button>
                      </form>
                      <form action={updateUserAccess} className="flex gap-2 rounded-2xl border border-rule/60 bg-chalk-raised p-3 shadow-sm">
                        <input type="hidden" name="userId" value={row.id} />
                        <select name="role" defaultValue={row.role} className="w-full flex-1 rounded-xl border border-rule bg-chalk px-2.5 py-1.5 text-xs font-semibold outline-none focus:border-moss focus:bg-chalk-raised text-moss">
                          {USER_ROLE_OPTIONS.map((item) => <option key={item} value={item}>{item}</option>)}
                        </select>
                        <button className="shrink-0 rounded-xl bg-moss px-3 py-1.5 text-[11px] font-bold text-chalk transition-colors hover:bg-moss">{t('users.setRole')}</button>
                      </form>
                      <form action={manageUserLifecycle} className="flex flex-col gap-2 rounded-2xl border border-rule/60 bg-chalk-raised p-3 shadow-sm">
                        <input type="hidden" name="userId" value={row.id} />
                        <input type="hidden" name="actionType" value={row.accountStatus === 'SUSPENDED' ? 'REACTIVATE' : 'SUSPEND'} />
                        {row.accountStatus !== 'SUSPENDED' ? (
                          <div className="flex gap-2">
                            <input
                              name="reason"
                              placeholder={t('users.suspensionReason')}
                              className="w-full flex-1 rounded-xl border border-rule bg-chalk px-2.5 py-1.5 text-xs font-semibold outline-none focus:border-red-500 focus:bg-chalk-raised"
                            />
                            <button className="shrink-0 rounded-xl bg-red-600 px-3 py-1.5 text-[11px] font-bold text-chalk transition-colors hover:bg-red-700">
                              {t('users.suspend')}
                            </button>
                          </div>
                        ) : (
                          <div className="flex gap-2 items-center justify-between">
                            <p className="rounded-xl border border-rule/60 bg-chalk-sunk px-2.5 py-1.5 text-[10px] font-bold text-moss-700 w-full text-center">
                              {t('users.accountSuspended')}
                            </p>
                            <button className="shrink-0 rounded-xl bg-moss px-3 py-1.5 text-[11px] font-bold text-chalk transition-colors hover:bg-moss">
                              {t('users.reactivate')}
                            </button>
                          </div>
                        )}
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
  const { t, fmt } = useAdminScreen();
  const formAction = useAdminFormAction();

  return (
    <div className="space-y-4">
      <StatusBanner status={status} />
      <form action={formAction} className="grid gap-4 rounded-[2rem] border border-rule/60 bg-chalk-raised p-5 shadow-sm lg:grid-cols-4">
        <input type="hidden" name="section" value="workspaces" />
        <input name="q" defaultValue={filters.q} placeholder={t('workspaces.searchPlaceholder')} className="rounded-xl border border-rule-strong bg-chalk-raised px-3 py-2 text-sm outline-none focus:border-moss" />
        <select name="status" defaultValue={filters.status} className="rounded-xl border border-rule-strong bg-chalk-raised px-3 py-2 text-sm outline-none focus:border-moss">
          <option value="ALL">{t('common.allStatuses')}</option>
          {WORKSPACE_STATUS_OPTIONS.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
        <select name="ownerId" defaultValue={filters.ownerId} className="rounded-xl border border-rule-strong bg-chalk-raised px-3 py-2 text-sm outline-none focus:border-moss">
          <option value="ALL">{t('common.allOwners')}</option>
          {userOptions.map((item) => <option key={item.id} value={item.id}>{item.email}</option>)}
        </select>
        <button className="rounded-xl bg-moss px-4 py-2 text-sm font-bold text-chalk transition-colors hover:bg-moss">{t('common.applyFilters')}</button>
      </form>

      <Panel title={t('workspaces.panelTitle')} subtitle={t('workspaces.panelSubtitle')}>
        <div className="space-y-4">
          {rows.map((row: any) => (
            <div key={row.id} className="relative overflow-hidden rounded-3xl border border-rule/60 bg-chalk-raised p-6 shadow-sm transition-shadow hover:shadow-md">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <div className="flex items-center gap-3">
                    <Link href={{ pathname: '/admin/workspaces/[workspaceId]', params: { workspaceId: row.id } }} className="text-xl font-black tracking-tight text-moss hover:underline">
                      {row.name}
                    </Link>
                    <span className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${getStatusTone(row.status)}`}>
                      {row.status}
                    </span>
                    {row.archiveState?.isArchived ? (
                      <span className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${getStatusTone('ARCHIVED')}`}>
                        {t('workspaces.archived')}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-2 text-sm font-medium text-moss-muted">
                    {row.websiteUrl ? <bdi>{row.websiteUrl}</bdi> : t('common.noWebsiteUrl')}
                  </p>
                  <p className="mt-2 text-xs font-semibold text-moss-muted">
                    {t('workspaces.ownerLine', { email: row.user.email, date: fmt.dateTime(row.createdAt) })}
                  </p>
                </div>
                <div className="grid gap-3 text-xs text-moss-muted sm:grid-cols-3">
                  <InfoPill label={t('workspaces.competitors')} value={fmt.number(row._count.competitors)} />
                  <InfoPill label={t('workspaces.contentItems')} value={fmt.number(row._count.contentItems)} />
                  <InfoPill label={t('workspaces.strategyRuns')} value={fmt.number(row._count.strategyRuns)} />
                </div>
              </div>

              <div className="mt-6 grid gap-4 lg:grid-cols-4">
                <form action={manageWorkspace} className="flex flex-col gap-2 rounded-2xl border border-rule/60 bg-chalk p-4 transition-colors hover:border-rule-strong">
                  <input type="hidden" name="workspaceId" value={row.id} />
                  <input type="hidden" name="actionType" value="REANALYZE" />
                  <button className="mt-auto w-full rounded-xl bg-moss px-3 py-2.5 text-xs font-bold text-chalk hover:bg-moss">{t('workspaces.forceReanalysis')}</button>
                </form>

                <form action={manageWorkspace} className="flex flex-col gap-2 rounded-2xl border border-rule/60 bg-chalk p-4 transition-colors hover:border-rule-strong">
                  <input type="hidden" name="workspaceId" value={row.id} />
                  <input type="hidden" name="actionType" value={row.archiveState?.isArchived ? 'RESTORE' : 'ARCHIVE'} />
                  {!row.archiveState?.isArchived ? (
                    <input
                      name="reason"
                      placeholder={t('workspaces.archiveReason')}
                      className="w-full flex-1 rounded-xl border border-rule bg-chalk-raised px-2.5 py-2 text-xs outline-none focus:border-moss"
                    />
                  ) : (
                    <p className="rounded-xl border border-rule/60 bg-chalk-sunk px-2.5 py-2 text-[11px] font-bold text-moss-700">
                      {t('workspaces.workspaceArchived')}
                    </p>
                  )}
                  <button className={`mt-auto w-full rounded-xl px-3 py-2.5 text-xs font-bold text-chalk transition-opacity hover:opacity-90 ${row.archiveState?.isArchived ? 'bg-moss' : 'bg-amber-600'}`}>
                    {row.archiveState?.isArchived ? t('workspaces.restoreWorkspace') : t('workspaces.archiveWorkspace')}
                  </button>
                </form>

                <form action={manageWorkspace} className="flex flex-col gap-2 rounded-2xl border border-rule/60 bg-chalk p-4 transition-colors hover:border-rule-strong">
                  <input type="hidden" name="workspaceId" value={row.id} />
                  <input type="hidden" name="actionType" value="TRANSFER" />
                  <select name="targetUserId" defaultValue="" className="w-full flex-1 rounded-xl border border-rule bg-chalk-raised px-2.5 py-2 text-xs outline-none focus:border-moss">
                    <option value="">{t('workspaces.transferOwnerTo')}</option>
                    {userOptions.map((item) => <option key={item.id} value={item.id}>{item.email}</option>)}
                  </select>
                  <button className="mt-auto w-full rounded-xl bg-moss px-3 py-2.5 text-xs font-bold text-chalk hover:bg-moss">{t('workspaces.transferOwner')}</button>
                </form>

                <form action={manageWorkspace} className="flex flex-col gap-2 rounded-2xl border border-red-200/60 bg-red-50 p-4 transition-colors hover:border-red-300">
                  <input type="hidden" name="workspaceId" value={row.id} />
                  <input type="hidden" name="actionType" value="DELETE" />
                  <button className="mt-auto w-full rounded-xl bg-red-600 px-3 py-2.5 text-xs font-bold text-chalk hover:bg-red-700">{t('workspaces.deleteWorkspace')}</button>
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
  const { t, fmt } = useAdminScreen();

  return (
    <div className="space-y-4">
      <StatusBanner status={status} />
      <div className="grid gap-4 lg:grid-cols-3">
        <MetricCard label={t('ai.primaryModel')} value={settingsState.geminiModel} />
        <MetricCard label={t('ai.fallbackModel')} value={settingsState.openAiFallbackModel} />
        <MetricCard
          label={t('ai.cooldown')}
          value={t('units.seconds', { value: fmt.number(settingsState.geminiCooldownSeconds) })}
          helper={t('ai.cooldownHelper')}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <Panel title={t('ai.controlTitle')} subtitle={t('ai.controlSubtitle')}>
          <form action={updateAiControls} className="grid gap-4">
            <label className="space-y-2">
              <span className="block text-sm font-medium text-moss">{t('ai.geminiPrimaryModel')}</span>
              <input
                name="geminiModel"
                dir="ltr"
                defaultValue={settingsState.geminiModel}
                className="w-full rounded-xl border border-rule-strong px-3 py-2 text-sm outline-none focus:border-moss"
                required
              />
            </label>
            <label className="space-y-2">
              <span className="block text-sm font-medium text-moss">{t('ai.openAiFallbackModel')}</span>
              <input
                name="openAiFallbackModel"
                dir="ltr"
                defaultValue={settingsState.openAiFallbackModel}
                className="w-full rounded-xl border border-rule-strong px-3 py-2 text-sm outline-none focus:border-moss"
                required
              />
            </label>
            <label className="space-y-2">
              <span className="block text-sm font-medium text-moss">{t('ai.geminiCooldownSeconds')}</span>
              <input
                type="number"
                name="geminiCooldownSeconds"
                min={GEMINI_COOLDOWN_SECONDS_MIN}
                max={GEMINI_COOLDOWN_SECONDS_MAX}
                defaultValue={settingsState.geminiCooldownSeconds}
                className="w-full rounded-xl border border-rule-strong px-3 py-2 text-sm outline-none focus:border-moss"
                required
              />
            </label>
            <button className="inline-flex w-fit rounded-xl bg-moss px-4 py-2 text-sm font-bold text-chalk transition-colors hover:bg-moss">{t('ai.saveControls')}</button>
          </form>
        </Panel>

        <Panel title={t('ai.costSignalsTitle')} subtitle={t('ai.costSignalsSubtitle')}>
          <SimpleTable
            headers={[t('ai.colFeature'), t('ai.colCost'), t('ai.colTokens')]}
            rows={analytics.aiCostByFeature.slice(0, 8).map((item: any) => [
              item.feature,
              fmt.usd(item.costUsd),
              fmt.number(item.totalTokens),
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
  const { t, fmt } = useAdminScreen();

  return (
    <div className="space-y-4">
      <StatusBanner status={status} />
      <Panel title={t('settings.panelTitle')} subtitle={t('settings.panelSubtitle')}>
        <form action={updatePlatformLimits} className="grid gap-5">
          <input type="hidden" name="redirectTo" value="/admin" />
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <Field label={t('settings.competitiveLandscapeLimit')}>
              <input type="number" name="competitiveLandscapeLimit" min={PLATFORM_LIMIT_MIN} max={PLATFORM_LIMIT_MAX} defaultValue={settingsState.competitiveLandscapeLimit} className="w-full rounded-xl border border-rule-strong px-3 py-2 text-sm outline-none focus:border-moss" />
            </Field>
            <Field label={t('settings.brandMemoryLimit')}>
              <input type="number" name="brandMemoryLimit" min={PLATFORM_LIMIT_MIN} max={PLATFORM_LIMIT_MAX} defaultValue={settingsState.brandMemoryLimit} className="w-full rounded-xl border border-rule-strong px-3 py-2 text-sm outline-none focus:border-moss" />
            </Field>
            <Field label={t('settings.ideationMaxContentCount')}>
              <input type="number" name="ideationMaxContentCount" min={PLATFORM_LIMIT_MIN} max={PLATFORM_LIMIT_MAX} defaultValue={settingsState.ideationMaxContentCount} className="w-full rounded-xl border border-rule-strong px-3 py-2 text-sm outline-none focus:border-moss" />
            </Field>
            <Field label={t('settings.defaultScheduleDelayHours')}>
              <input type="number" name="defaultScheduleDelayHours" min={SCHEDULE_DELAY_HOURS_MIN} max={SCHEDULE_DELAY_HOURS_MAX} defaultValue={settingsState.defaultScheduleDelayHours} className="w-full rounded-xl border border-rule-strong px-3 py-2 text-sm outline-none focus:border-moss" />
            </Field>
          </div>

          <div className="rounded-2xl border border-rule bg-chalk p-4">
            <p className="text-sm font-bold text-moss">{t('settings.wordCountRules')}</p>
            <p className="mt-1 text-xs text-moss-muted">
              {t('settings.wordCountRange', {
                min: fmt.number(WORD_COUNT_LIMIT_ABSOLUTE_MIN),
                max: fmt.number(WORD_COUNT_LIMIT_ABSOLUTE_MAX),
              })}
            </p>
            <div className="mt-4 grid gap-3 lg:grid-cols-2">
              {WORD_COUNT_PLATFORMS.map((platform) => (
                <div key={platform} className="rounded-xl border border-rule bg-chalk-raised p-3">
                  {/* Platform names are brands; they stay Latin in both languages. */}
                  <p className="text-xs font-bold uppercase tracking-wider text-moss-muted">{t(`platforms.${platform}`)}</p>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <input type="number" name={`wordMin_${platform}`} min={WORD_COUNT_LIMIT_ABSOLUTE_MIN} max={WORD_COUNT_LIMIT_ABSOLUTE_MAX} defaultValue={settingsState.wordCountLimits[platform].min} className="rounded-lg border border-rule-strong px-2 py-2 text-sm outline-none focus:border-moss" />
                    <input type="number" name={`wordMax_${platform}`} min={WORD_COUNT_LIMIT_ABSOLUTE_MIN} max={WORD_COUNT_LIMIT_ABSOLUTE_MAX} defaultValue={settingsState.wordCountLimits[platform].max} className="rounded-lg border border-rule-strong px-2 py-2 text-sm outline-none focus:border-moss" />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <button className="inline-flex w-fit rounded-xl bg-moss px-4 py-2 text-sm font-bold text-chalk transition-colors hover:bg-moss">{t('settings.save')}</button>
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
  const { t, fmt } = useAdminScreen();
  const formAction = useAdminFormAction();

  return (
    <div className="space-y-4">
      <StatusBanner status={status} />
      <StatusBanner status={billingStatus} />
      <div className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
        <Panel title={t('credits.manualTitle')} subtitle={t('credits.manualSubtitle')}>
          <form action={adjustCredits} className="grid gap-3">
            <select name="userId" defaultValue="" className="rounded-xl border border-rule-strong px-3 py-2 text-sm outline-none focus:border-moss" required>
              <option value="">{t('common.selectUser')}</option>
              {userOptions.map((item) => <option key={item.id} value={item.id}>{item.email}</option>)}
            </select>
            <select name="adjustmentType" defaultValue="TOP_UP" className="rounded-xl border border-rule-strong px-3 py-2 text-sm outline-none focus:border-moss">
              <option value="TOP_UP">{t('credits.topUp')}</option>
              <option value="REFUND">{t('credits.refund')}</option>
              <option value="ALLOCATE">{t('credits.allocate')}</option>
              <option value="DEDUCT">{t('credits.deduct')}</option>
            </select>
            <input type="number" name="amount" min={1} placeholder={t('credits.amount')} className="rounded-xl border border-rule-strong px-3 py-2 text-sm outline-none focus:border-moss" required />
            <textarea name="note" placeholder={t('credits.note')} className="min-h-[90px] rounded-xl border border-rule-strong px-3 py-2 text-sm outline-none focus:border-moss" />
            <button className="inline-flex w-fit rounded-xl bg-moss px-4 py-2 text-sm font-bold text-chalk transition-colors hover:bg-moss">{t('credits.applyAdjustment')}</button>
          </form>
        </Panel>

        <Panel title={t('credits.ledgerTitle')} subtitle={t('credits.ledgerSubtitle')}>
          <form action={formAction} className="mb-4 grid gap-3 rounded-2xl border border-rule bg-chalk p-3 md:grid-cols-[1fr_auto]">
            <input type="hidden" name="section" value="credits" />
            <select name="userId" defaultValue={filterUserId} className="rounded-xl border border-rule-strong px-3 py-2 text-sm outline-none focus:border-moss">
              <option value="">{t('common.allUsers')}</option>
              {userOptions.map((item) => <option key={item.id} value={item.id}>{item.email}</option>)}
            </select>
            <button className="rounded-xl bg-moss px-4 py-2 text-sm font-bold text-chalk transition-colors hover:bg-moss">{t('credits.filterLedger')}</button>
          </form>
          <div className="max-h-[520px] overflow-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-rule text-start text-xs uppercase tracking-wider text-moss-muted">
                  <th className="px-3 py-3 text-start">{t('credits.colUser')}</th>
                  <th className="px-3 py-3 text-start">{t('credits.colType')}</th>
                  <th className="px-3 py-3 text-start">{t('credits.colFeature')}</th>
                  <th className="px-3 py-3 text-start">{t('credits.colDelta')}</th>
                  <th className="px-3 py-3 text-start">{t('credits.colBalance')}</th>
                  <th className="px-3 py-3 text-start">{t('credits.colAt')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row: any) => (
                  <tr key={row.id} className="border-b border-rule">
                    <td className="px-3 py-3">
                      <p className="font-medium text-moss"><bdi>{row.user.email}</bdi></p>
                      <p className="text-xs text-moss-muted" dir="ltr">{row.userId}</p>
                    </td>
                    <td className="px-3 py-3 text-xs">{row.type}</td>
                    <td className="px-3 py-3 text-xs">{row.feature}</td>
                    <td className={`px-3 py-3 font-bold ${row.amount < 0 ? 'text-red-600' : 'text-moss-700'}`}>{fmt.number(row.amount)}</td>
                    <td className="px-3 py-3 text-xs">{fmt.number(row.balanceAfter)}</td>
                    <td className="px-3 py-3 text-xs">{fmt.dateTime(row.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
        <Panel title={t('credits.billingTitle')} subtitle={t('credits.billingSubtitle')}>
          <form action={manageBilling} className="grid gap-3">
            <select name="userId" defaultValue={filterUserId} className="rounded-xl border border-rule-strong px-3 py-2 text-sm outline-none focus:border-moss" required>
              <option value="">{t('common.selectUser')}</option>
              {userOptions.map((item) => <option key={item.id} value={item.id}>{item.email}</option>)}
            </select>
            <select name="actionType" defaultValue="SYNC_STRIPE" className="rounded-xl border border-rule-strong px-3 py-2 text-sm outline-none focus:border-moss">
              <option value="SYNC_STRIPE">{t('credits.syncStripe')}</option>
              <option value="GRANT_TRIAL">{t('credits.grantTrial')}</option>
              <option value="APPLY_PROMO">{t('credits.applyPromo')}</option>
            </select>
            <select name="plan" defaultValue="STARTER" className="rounded-xl border border-rule-strong px-3 py-2 text-sm outline-none focus:border-moss">
              {USER_PLAN_OPTIONS.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
            <input type="number" name="trialDays" min={1} max={90} defaultValue={14} placeholder={t('credits.trialDays')} className="rounded-xl border border-rule-strong px-3 py-2 text-sm outline-none focus:border-moss" />
            <input type="number" name="promoCredits" min={1} placeholder={t('credits.promoCredits')} className="rounded-xl border border-rule-strong px-3 py-2 text-sm outline-none focus:border-moss" />
            <textarea name="note" placeholder={t('credits.billingNote')} className="min-h-[90px] rounded-xl border border-rule-strong px-3 py-2 text-sm outline-none focus:border-moss" />
            <button className="inline-flex w-fit rounded-xl bg-moss px-4 py-2 text-sm font-bold text-chalk transition-colors hover:bg-moss">{t('credits.runBillingAction')}</button>
          </form>
        </Panel>

        <Panel title={t('credits.subscriptionsTitle')} subtitle={t('credits.subscriptionsSubtitle')}>
          <div className="max-h-[520px] overflow-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-rule text-start text-xs uppercase tracking-wider text-moss-muted">
                  <th className="px-3 py-3 text-start">{t('credits.colUser')}</th>
                  <th className="px-3 py-3 text-start">{t('credits.colPlan')}</th>
                  <th className="px-3 py-3 text-start">{t('credits.colStatus')}</th>
                  <th className="px-3 py-3 text-start">{t('credits.colRenewal')}</th>
                </tr>
              </thead>
              <tbody>
                {subscriptions.map((row) => (
                  <tr key={row.id} className="border-b border-rule">
                    <td className="px-3 py-3">
                      <p className="font-medium text-moss"><bdi>{row.user.email}</bdi></p>
                      <p className="text-xs text-moss-muted" dir="ltr">{row.stripeSubscriptionId || row.stripeCustomerId}</p>
                    </td>
                    <td className="px-3 py-3 text-xs">{row.plan}</td>
                    <td className="px-3 py-3"><span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${getStatusTone(row.status)}`}>{row.status}</span></td>
                    <td className="px-3 py-3 text-xs">{fmt.dateTime(row.currentPeriodEnd)}</td>
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
  const { t, fmt } = useAdminScreen();
  const formAction = useAdminFormAction();

  return (
    <Panel title={t('content.panelTitle')} subtitle={t('content.panelSubtitle')}>
      <form action={formAction} className="mb-6 grid gap-4 rounded-[2rem] border border-rule/60 bg-chalk-raised p-5 shadow-sm lg:grid-cols-4">
        <input type="hidden" name="section" value="content" />
        <input
          name="q"
          defaultValue={filters.q}
          placeholder={t('content.searchPlaceholder')}
          className="rounded-xl border border-rule-strong bg-chalk-raised px-3 py-2 text-sm outline-none focus:border-moss"
        />
        <select name="status" defaultValue={filters.status} className="rounded-xl border border-rule-strong bg-chalk-raised px-3 py-2 text-sm outline-none focus:border-moss">
          <option value="ALL">{t('common.allStatuses')}</option>
          {CONTENT_STATUS_OPTIONS.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
        <select name="channel" defaultValue={filters.channel} className="rounded-xl border border-rule-strong bg-chalk-raised px-3 py-2 text-sm outline-none focus:border-moss">
          <option value="ALL">{t('common.allChannels')}</option>
          {CONTENT_CHANNEL_OPTIONS.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
        <select name="workspaceId" defaultValue={filters.workspaceId} className="rounded-xl border border-rule-strong bg-chalk-raised px-3 py-2 text-sm outline-none focus:border-moss">
          <option value="ALL">{t('common.allWorkspaces')}</option>
          {workspaceOptions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
        <button className="rounded-xl bg-moss px-4 py-2 text-sm font-bold text-chalk transition-colors hover:bg-moss lg:col-span-4">{t('common.applyFilters')}</button>
      </form>

      <div className="overflow-x-auto">
        <table className="w-full text-start text-sm">
          <thead>
            <tr className="border-b border-rule uppercase tracking-widest text-moss-muted">
              <th className="px-4 py-4 text-start text-[10px] font-bold">{t('content.colTopic')}</th>
              <th className="px-4 py-4 text-start text-[10px] font-bold">{t('content.colWorkspace')}</th>
              <th className="px-4 py-4 text-start text-[10px] font-bold">{t('content.colPlatform')}</th>
              <th className="px-4 py-4 text-start text-[10px] font-bold">{t('content.colStatus')}</th>
              <th className="px-4 py-4 text-start text-[10px] font-bold">{t('content.colWords')}</th>
              <th className="px-4 py-4 text-start text-[10px] font-bold">{t('content.colSchedule')}</th>
              <th className="px-4 py-4 text-start text-[10px] font-bold">{t('content.colGenerated')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-rule/80">
            {rows.map((row: any) => (
              <tr key={row.id} className="align-top transition-colors hover:bg-chalk/50">
                <td className="px-4 py-4">
                  <Link href={{ pathname: '/admin/content/[contentId]', params: { contentId: row.id } }} className="font-bold text-moss hover:underline">
                    {row.topic}
                  </Link>
                  <p className="mt-1 line-clamp-2 text-xs font-medium text-moss-muted">{row.content}</p>
                </td>
                <td className="px-4 py-4 text-xs font-semibold text-moss-muted">{row.workspace?.name || '-'}</td>
                <td className="px-4 py-4 text-xs font-semibold text-moss-muted">{row.channel}</td>
                <td className="px-4 py-4">
                  <span className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${getStatusTone(row.status)}`}>
                    {row.status}
                  </span>
                </td>
                <td className="px-4 py-4 text-xs font-semibold text-moss-muted">{fmt.number(row.wordCount)}</td>
                <td className="px-4 py-4 text-xs font-semibold text-moss-muted">{fmt.dateTime(row.scheduledAtUtc)}</td>
                <td className="px-4 py-4 text-xs font-semibold text-moss-muted">{fmt.dateTime(row.createdAt)}</td>
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
  const { t, fmt } = useAdminScreen();
  const formAction = useAdminFormAction();

  return (
    <Panel title={t('jobs.panelTitle')} subtitle={t('jobs.panelSubtitle')}>
      <StatusBanner status={status} />
      <form action={formAction} className="mb-6 grid gap-4 rounded-[2rem] border border-rule/60 bg-chalk-raised p-5 shadow-sm lg:grid-cols-3">
        <input type="hidden" name="section" value="jobs" />
        <select name="status" defaultValue={filters.status} className="rounded-xl border border-rule-strong bg-chalk-raised px-3 py-2 text-sm outline-none focus:border-moss">
          <option value="ALL">{t('common.allStatuses')}</option>
          {JOB_STATUS_OPTIONS.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
        <select name="type" defaultValue={filters.type} className="rounded-xl border border-rule-strong bg-chalk-raised px-3 py-2 text-sm outline-none focus:border-moss">
          <option value="ALL">{t('common.allJobTypes')}</option>
          {JOB_TYPE_OPTIONS.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
        <button className="rounded-xl bg-moss px-4 py-2 text-sm font-bold text-chalk transition-colors hover:bg-moss">{t('common.applyFilters')}</button>
      </form>

      <div className="overflow-x-auto">
        <table className="w-full text-start text-sm">
          <thead>
            <tr className="border-b border-rule uppercase tracking-widest text-moss-muted">
              <th className="px-4 py-4 text-start text-[10px] font-bold">{t('jobs.colJob')}</th>
              <th className="px-4 py-4 text-start text-[10px] font-bold">{t('jobs.colUserWorkspace')}</th>
              <th className="px-4 py-4 text-start text-[10px] font-bold">{t('jobs.colStatus')}</th>
              <th className="px-4 py-4 text-start text-[10px] font-bold">{t('jobs.colCredits')}</th>
              <th className="px-4 py-4 text-start text-[10px] font-bold">{t('jobs.colDuration')}</th>
              <th className="px-4 py-4 text-start text-[10px] font-bold">{t('jobs.colError')}</th>
              <th className="px-4 py-4 text-start text-[10px] font-bold">{t('jobs.colActions')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-rule/80">
            {rows.map((row: any) => (
              <tr key={row.id} className="align-top transition-colors hover:bg-chalk/50">
                <td className="px-4 py-4">
                  <p className="font-bold text-moss" dir="ltr">{row.type}</p>
                  <p className="text-[10px] font-plexmono font-medium text-moss-muted" dir="ltr">{row.id}</p>
                </td>
                <td className="px-4 py-4 text-xs font-semibold text-moss-muted">
                  <p className="text-moss"><bdi>{row.user.email}</bdi></p>
                  <p className="text-moss-muted">{row.workspace?.name || '-'}</p>
                </td>
                <td className="px-4 py-4">
                  <span className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${getStatusTone(row.status)}`}>
                    {row.status}
                  </span>
                </td>
                <td className="px-4 py-4 text-xs font-semibold text-moss-muted">{fmt.number(row.creditsCost)}</td>
                <td className="px-4 py-4 text-xs font-semibold text-moss-muted">{fmt.duration(row.durationMs)}</td>
                <td className="px-4 py-4 text-xs font-medium text-red-600 max-w-xs truncate">{row.errorMessage || '-'}</td>
                <td className="px-4 py-4">
                  <div className="flex flex-wrap gap-2">
                    <form action={manageJob}>
                      <input type="hidden" name="jobId" value={row.id} />
                      <input type="hidden" name="actionType" value="RETRY" />
                      <button className="rounded-xl border border-rule-strong bg-chalk-raised px-3 py-1.5 text-[11px] font-bold text-moss shadow-sm transition-colors hover:bg-chalk">
                        {t('jobs.retry')}
                      </button>
                    </form>
                    {row.status === 'PENDING' || row.status === 'RUNNING' ? (
                      <form action={manageJob}>
                        <input type="hidden" name="jobId" value={row.id} />
                        <input type="hidden" name="actionType" value="CANCEL" />
                        <button className="rounded-xl bg-red-600 px-3 py-1.5 text-[11px] font-bold text-chalk shadow-sm transition-opacity hover:opacity-90">
                          {t('jobs.cancel')}
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
  const t = useTranslations('admin');

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel title={t('logs.auditTitle')} subtitle={t('logs.auditSubtitle')}>
        <LogList rows={logs?.adminAuditLogs || []} />
      </Panel>
      <Panel title={t('logs.activityTitle')} subtitle={t('logs.activitySubtitle')}>
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
  const { t, fmt } = useAdminScreen();

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Panel title={t('analytics.frameworksTitle')} subtitle={t('analytics.frameworksSubtitle')}>
        <SimpleTable
          headers={[t('analytics.colFramework'), t('analytics.colEvents'), t('analytics.colAvgScore')]}
          rows={analytics.frameworks.map((item: any) => [
            item.frameworkName,
            fmt.number(item.events),
            item.avgOverallScore != null ? fmt.decimal(item.avgOverallScore) : '-',
          ])}
        />
      </Panel>
      <Panel title={t('analytics.platformsTitle')} subtitle={t('analytics.platformsSubtitle')}>
        <SimpleTable
          headers={[t('analytics.colPlatform'), t('analytics.colCount')]}
          rows={analytics.platforms.map((item: any) => [item.channel, fmt.number(item.count)])}
        />
      </Panel>
      <Panel title={t('analytics.costTitle')} subtitle={t('analytics.costSubtitle')}>
        <SimpleTable
          headers={[t('analytics.colFeature'), t('analytics.colCost')]}
          rows={analytics.aiCostByFeature.map((item: any) => [item.feature, fmt.usd(item.costUsd)])}
        />
      </Panel>
    </div>
  );
}

function IntegrationsSection({
  integrations,
}: {
  integrations: Awaited<ReturnType<typeof getAdminIntegrations>>;
}) {
  const { t, fmt } = useAdminScreen();

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <HealthCard
          title={t('health.gemini')}
          status={integrations.providers.geminiConfigured ? 'healthy' : 'FAILED'}
          description={integrations.providers.geminiConfigured ? t('health.apiKeyConfigured') : t('health.geminiKeyMissing')}
        />
        <HealthCard
          title={t('health.openAi')}
          status={integrations.providers.openAiConfigured ? 'healthy' : 'FAILED'}
          description={integrations.providers.openAiConfigured ? t('health.apiKeyConfigured') : t('health.openAiKeyMissing')}
        />
        <HealthCard
          title={t('health.redis')}
          status={integrations.providers.redisConfigured ? 'healthy' : 'FAILED'}
          description={integrations.providers.redisConfigured ? t('health.redisQueueProviderConfigured') : t('health.redisMissing')}
        />
        <HealthCard
          title={t('health.dataForSeo')}
          status={integrations.providers.dataForSeoConfigured ? 'healthy' : 'FAILED'}
          description={integrations.providers.dataForSeoConfigured ? t('health.credentialsConfigured') : t('health.credentialsMissing')}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title={t('integrations.footprintTitle')} subtitle={t('integrations.footprintSubtitle')}>
          <div className="grid gap-3 sm:grid-cols-2">
            <InfoPill label={t('integrations.keywordRows')} value={fmt.number(integrations.seoData.keywordRows)} />
            <InfoPill label={t('integrations.serpAnalyses')} value={fmt.number(integrations.seoData.serpRows)} />
          </div>
        </Panel>
        <Panel title={t('integrations.requestsTitle')} subtitle={t('integrations.requestsSubtitle')}>
          <SimpleTable
            headers={[t('integrations.colModel'), t('integrations.colRequests'), t('integrations.colCost')]}
            rows={integrations.aiUsageLastDay.map((item: any) => [item.model, fmt.number(item.requests), fmt.usd(item.costUsd)])}
          />
        </Panel>
      </div>
    </div>
  );
}

/** Shared bold-value wrapper for the rich usage strings. */
const boldValue = (chunks: React.ReactNode) => <span className="font-bold text-moss">{chunks}</span>;

function StatusBanner({ status }: { status: string }) {
  const t = useTranslations('admin');
  if (!status) return null;
  const tone =
    status === 'saved'
      ? 'border-rule/60 bg-chalk-sunk text-moss-700'
      : status === 'failed'
        ? 'border-red-200/60 bg-red-50 text-red-700'
        : 'border-amber-200/60 bg-amber-50 text-amber-700';
  const message =
    status === 'saved'
      ? t('banner.saved')
      : status === 'failed'
        ? t('banner.failed')
        : t('banner.invalid');

  return <div className={`mb-6 flex items-center gap-3 rounded-2xl border px-5 py-4 text-sm font-semibold shadow-sm ${tone}`}>{message}</div>;
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
    <div
      className={`group relative flex flex-col justify-between overflow-hidden rounded-[2rem] border p-6 sm:p-8 transition-all duration-500 hover:-translate-y-1 hover:shadow-xl ${
        emphasis
          ? 'border-rule/60 bg-chalk-sunk/10'
          : 'border-rule/60 bg-chalk-raised shadow-sm'
      }`}
    >
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:16px_16px] [mask-image:radial-gradient(ellipse_50%_50%_at_50%_0%,#000_70%,transparent_100%)] pointer-events-none" />
      {emphasis && (
        <div className="absolute -end-6 -top-6 h-32 w-32 rounded-full bg-saffron/20 blur-2xl transition-transform duration-700 group-hover:scale-125 pointer-events-none" />
      )}
      <div className="relative z-10">
        <p className={`text-[10px] font-bold uppercase tracking-[0.2em] ${emphasis ? 'text-moss-700' : 'text-moss-muted'}`}>{label}</p>
        <p className="mt-4 text-4xl sm:text-5xl font-black tracking-tight text-moss">{value}</p>
      </div>
      {helper && (
        <div className="relative z-10 mt-8 flex items-center gap-2 border-t border-rule/80 pt-5">
          <div className={`h-1.5 w-1.5 shrink-0 rounded-full ${emphasis ? 'bg-saffron' : 'bg-rule-strong'}`} />
          <p className="text-xs font-semibold text-moss-muted">{helper}</p>
        </div>
      )}
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
  const isHealthy = status === 'healthy';
  const toneBg = isHealthy ? 'bg-chalk-sunk/50 hover:bg-chalk-sunk/80' : 'bg-red-50/50 hover:bg-red-50/80';
  const toneBorder = isHealthy ? 'border-rule/60' : 'border-red-200/60';

  return (
    <div className={`flex flex-col justify-between rounded-3xl border ${toneBorder} ${toneBg} p-5 transition-all duration-300 hover:-translate-y-1 hover:shadow-md`}>
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-bold text-moss">{title}</p>
        <span className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${getStatusTone(status)}`}>
          {status}
        </span>
      </div>
      <p className="mt-4 text-xs font-medium leading-relaxed text-moss-muted">{description}</p>
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
    <div className="flex h-full flex-col overflow-hidden rounded-[2rem] border border-rule/60 bg-chalk-raised shadow-sm transition-shadow hover:shadow-md">
      <div className="border-b border-rule px-6 py-5 sm:px-8">
        <p className="text-lg font-bold text-moss">{title}</p>
        <p className="mt-1 text-sm font-medium text-moss-muted">{subtitle}</p>
      </div>
      <div className="flex flex-1 flex-col p-6 sm:p-8">{children}</div>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return <p className="text-sm text-moss-muted">{text}</p>;
}

function InfoPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-2xl border border-rule/60 bg-chalk px-5 py-4 transition-colors hover:bg-chalk-sunk">
      <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-moss-muted">{label}</p>
      <p className="text-xl font-black tracking-tight text-moss">{value}</p>
    </div>
  );
}

function DarkMetricCard({ label, value, emphasis }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div
      className={`flex flex-col justify-between rounded-2xl border p-6 ${
        emphasis ? 'border-saffron bg-moss' : 'border-forest-line'
      }`}
    >
      <p className="font-plexmono text-[11px] uppercase tracking-[0.2em] text-forest-muted">{label}</p>
      <p className={`mt-3 font-plexmono text-2xl font-medium sm:text-3xl ${emphasis ? 'text-saffron' : 'text-chalk'}`}>{value}</p>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="space-y-2">
      <span className="block text-sm font-medium text-moss">{label}</span>
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
  const t = useTranslations('admin');

  return rows.length === 0 ? (
    <EmptyState text={t('common.noData')} />
  ) : (
    <div className="overflow-x-auto">
      <table className="w-full text-start text-sm">
        <thead>
          <tr className="border-b border-rule uppercase tracking-widest text-moss-muted">
            {headers.map((header) => (
              <th key={header} className="px-4 py-4 text-start text-[10px] font-bold">{header}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-rule/80">
          {rows.map((row, index) => (
            <tr key={`${row[0]}-${index}`} className="transition-colors hover:bg-chalk/50">
              {row.map((cell, cellIndex) => (
                <td key={`${row[0]}-${cellIndex}`} className={`px-4 py-4 text-sm ${cellIndex === 0 ? 'font-semibold text-moss' : 'text-moss-muted'}`}>{cell}</td>
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
  const { t, fmt } = useAdminScreen();

  if (!rows.length) {
    return <EmptyState text={t('common.noLogEntries')} />;
  }

  return (
    <div className="max-h-[560px] space-y-4 overflow-auto pe-2">
      {rows.map((row) => (
        <div key={row.id} className="relative overflow-hidden rounded-2xl border border-rule/60 bg-chalk p-5 transition-colors hover:border-rule-strong">
          <div className="flex items-center justify-between gap-4">
            {/* Event codes are stored values; they stay Latin and read LTR. */}
            <p className="text-sm font-black tracking-tight text-moss" dir="ltr">{row.action}</p>
            <p className="shrink-0 text-[11px] font-medium text-moss-muted">{fmt.dateTime(row.createdAt)}</p>
          </div>
          <p className="mt-1 text-xs font-semibold text-moss-muted">{row.workspaceName || t('common.platformLevel')}</p>
          <pre dir="ltr" className="mt-4 overflow-x-auto whitespace-pre-wrap rounded-xl border border-rule/40 bg-chalk-raised p-4 text-start text-[11px] leading-relaxed text-moss-muted shadow-sm">
            {JSON.stringify(row.detail, null, 2)}
          </pre>
        </div>
      ))}
    </div>
  );
}
