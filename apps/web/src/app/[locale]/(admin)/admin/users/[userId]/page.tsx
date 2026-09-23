import { getFormatter, getLocale, getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';

import { Link, getPathname } from '@/i18n/navigation';
import { getUserAccessState } from '@/lib/admin-state';
import {
  Panel,
  PageHeader,
  MetricCard,
  KeyValueGrid,
  InfoPill,
  LogList,
  StatusBadge,
  EmptyState,
  createAdminFormat,
} from '../../_components/AdminUi';
import { listUserActivityLogs } from '@/lib/activity-log';
import { prisma } from '@/lib/db';

type Props = {
  params: Promise<{ userId: string }>;
};

export default async function AdminUserDetailPage({ params }: Props) {
  const { userId } = await params;
  const t = await getTranslations('admin');
  const locale = await getLocale();
  const fmt = createAdminFormat(await getFormatter(), t);

  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      subscription: true,
      workspaces: {
        orderBy: { updatedAt: 'desc' },
        take: 20,
        include: {
          _count: {
            select: {
              competitors: true,
              contentItems: true,
            },
          },
        },
      },
      _count: {
        select: {
          workspaces: true,
          contentItems: true,
          contentJobs: true,
          aiUsageLogs: true,
        },
      },
    },
  });

  if (!user) notFound();

  const [creditAggregate, aiAggregate, recentAiUsage, recentJobs, recentContent, activityLogs, accessState] =
    await Promise.all([
      prisma.creditLedger.aggregate({
        where: { userId },
        _sum: { amount: true },
        _count: { _all: true },
      }),
      prisma.aiUsageLog.aggregate({
        where: { userId },
        _sum: { estimatedCostUsd: true, totalTokens: true },
      }),
      prisma.aiUsageLog.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 12,
      }),
      prisma.contentJob.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 12,
      }),
      prisma.contentItem.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 12,
        include: {
          workspace: { select: { id: true, name: true } },
        },
      }),
      listUserActivityLogs(userId, 40),
      getUserAccessState(userId),
    ]);

  const currentCreditBalance = creditAggregate._sum.amount ?? 0;
  const totalAiCost = Number(aiAggregate._sum.estimatedCostUsd ?? 0);
  const totalTokens = aiAggregate._sum.totalTokens ?? 0;

  return (
    <div className="space-y-6">
      <PageHeader
        backHref={`${getPathname({ href: '/admin', locale })}?section=users`}
        backLabel={t('userDetail.back')}
        title={user.name || user.email}
        subtitle={t('userDetail.subtitle')}
        actions={
          <>
            <Link
              href={{ pathname: '/admin', query: { section: 'credits', userId: user.id } }}
              className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
            >
              {t('userDetail.openLedger')}
            </Link>
            <Link
              href={{ pathname: '/admin', query: { section: 'users', q: encodeURIComponent(user.email) } }}
              className="rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white"
            >
              {t('userDetail.searchInUsers')}
            </Link>
          </>
        }
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label={t('userDetail.currentCredits')} value={fmt.number(currentCreditBalance)} />
        <MetricCard label={t('userDetail.lifetimeAiCost')} value={fmt.usd(totalAiCost)} />
        <MetricCard label={t('userDetail.totalTokens')} value={fmt.number(totalTokens)} />
        <MetricCard
          label={t('userDetail.accessStatus')}
          value={accessState.status}
          helper={accessState.suspendedReason || t('userDetail.workspacesHelper', { count: fmt.number(user._count.workspaces) })}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
        <Panel title={t('userDetail.profileTitle')} subtitle={t('userDetail.profileSubtitle')}>
          <KeyValueGrid
            items={[
              { label: t('userDetail.email'), value: <bdi>{user.email}</bdi> },
              { label: t('userDetail.userId'), value: <span dir="ltr">{user.id}</span> },
              { label: t('userDetail.role'), value: <StatusBadge status={user.role} /> },
              { label: t('userDetail.plan'), value: <StatusBadge status={user.plan} /> },
              { label: t('userDetail.accessStatus'), value: <StatusBadge status={accessState.status} /> },
              { label: t('userDetail.createdAt'), value: fmt.dateTime(user.createdAt) },
              { label: t('userDetail.updatedAt'), value: fmt.dateTime(user.updatedAt) },
              { label: t('userDetail.suspendedAt'), value: fmt.dateTime(accessState.suspendedAt) },
              { label: t('userDetail.suspensionReason'), value: accessState.suspendedReason || '-' },
            ]}
            columns={2}
          />
        </Panel>

        <Panel title={t('userDetail.subscriptionTitle')} subtitle={t('userDetail.subscriptionSubtitle')}>
          <KeyValueGrid
            items={[
              { label: t('userDetail.stripeCustomer'), value: <span dir="ltr">{user.subscription?.stripeCustomerId || '-'}</span> },
              { label: t('userDetail.stripeSubscription'), value: <span dir="ltr">{user.subscription?.stripeSubscriptionId || '-'}</span> },
              { label: t('userDetail.subscriptionStatus'), value: user.subscription ? <StatusBadge status={user.subscription.status} /> : t('userDetail.noSubscription') },
              { label: t('userDetail.subscriptionPlan'), value: user.subscription?.plan || user.plan },
              { label: t('userDetail.periodStart'), value: fmt.dateTime(user.subscription?.currentPeriodStart) },
              { label: t('userDetail.periodEnd'), value: fmt.dateTime(user.subscription?.currentPeriodEnd) },
            ]}
            columns={2}
          />
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_1fr]">
        <Panel title={t('userDetail.workspacesTitle')} subtitle={t('userDetail.workspacesSubtitle')}>
          {user.workspaces.length === 0 ? (
            <EmptyState text={t('userDetail.noWorkspaces')} />
          ) : (
            <div className="space-y-3">
              {user.workspaces.map((workspace: any) => (
                <div key={workspace.id} className="rounded-xl border border-gray-200 bg-slate-50 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <Link href={{ pathname: '/admin/workspaces/[workspaceId]', params: { workspaceId: workspace.id } }} className="text-sm font-bold text-[#121212] hover:underline">
                        {workspace.name}
                      </Link>
                      <p className="mt-1 text-xs text-slate-500">
                        {workspace.websiteUrl ? <bdi>{workspace.websiteUrl}</bdi> : t('common.noWebsiteUrl')}
                      </p>
                    </div>
                    <StatusBadge status={workspace.status} />
                  </div>
                  <div className="mt-3 grid gap-2 sm:grid-cols-3">
                    <InfoPill label={t('userDetail.competitors')} value={fmt.number(workspace._count.competitors)} />
                    <InfoPill label={t('userDetail.content')} value={fmt.number(workspace._count.contentItems)} />
                    <InfoPill label={t('userDetail.updated')} value={fmt.dateTime(workspace.updatedAt)} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel title={t('userDetail.aiUsageTitle')} subtitle={t('userDetail.aiUsageSubtitle')}>
          {recentAiUsage.length === 0 ? (
            <EmptyState text={t('userDetail.noAiUsage')} />
          ) : (
            <div className="space-y-3">
              {recentAiUsage.map((entry: any) => (
                <div key={entry.id} className="rounded-xl border border-gray-200 bg-slate-50 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-bold text-[#121212]">{entry.feature}</p>
                    <p className="text-xs font-semibold text-slate-500">{fmt.usd(Number(entry.estimatedCostUsd))}</p>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    {/* The model name is a provider identifier and stays Latin. */}
                    {t('userDetail.aiUsageLine', {
                      model: entry.model,
                      tokens: fmt.number(entry.totalTokens),
                      date: fmt.dateTime(entry.createdAt),
                    })}
                  </p>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_1fr]">
        <Panel title={t('userDetail.recentContentTitle')} subtitle={t('userDetail.recentContentSubtitle')}>
          {recentContent.length === 0 ? (
            <EmptyState text={t('userDetail.noContent')} />
          ) : (
            <div className="space-y-3">
              {recentContent.map((item: any) => (
                <div key={item.id} className="rounded-xl border border-gray-200 bg-slate-50 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <Link href={{ pathname: '/admin/content/[contentId]', params: { contentId: item.id } }} className="text-sm font-bold text-[#121212] hover:underline">
                        {item.topic}
                      </Link>
                      <p className="mt-1 text-xs text-slate-500">
                        {t('userDetail.contentLine', {
                          workspace: item.workspace?.name || t('common.noWorkspace'),
                          channel: item.channel,
                        })}
                      </p>
                    </div>
                    <StatusBadge status={item.status} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel title={t('userDetail.recentJobsTitle')} subtitle={t('userDetail.recentJobsSubtitle')}>
          {recentJobs.length === 0 ? (
            <EmptyState text={t('userDetail.noJobs')} />
          ) : (
            <div className="space-y-3">
              {recentJobs.map((job: any) => (
                <div key={job.id} className="rounded-xl border border-gray-200 bg-slate-50 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-bold text-[#121212]" dir="ltr">{job.type}</p>
                      <p className="mt-1 text-xs text-slate-500">{fmt.dateTime(job.createdAt)}</p>
                    </div>
                    <StatusBadge status={job.status} />
                  </div>
                  {job.errorMessage ? <p className="mt-2 text-xs text-red-600">{job.errorMessage}</p> : null}
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>

      <Panel title={t('userDetail.activityTitle')} subtitle={t('userDetail.activitySubtitle')}>
        <LogList rows={activityLogs} />
      </Panel>
    </div>
  );
}
