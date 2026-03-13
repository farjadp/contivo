import Link from 'next/link';
import { notFound } from 'next/navigation';

import { getUserAccessState } from '@/lib/admin-state';
import { Panel, PageHeader, MetricCard, KeyValueGrid, InfoPill, LogList, StatusBadge, formatDateTime, formatUsd, EmptyState } from '../../_components/AdminUi';
import { listUserActivityLogs } from '@/lib/activity-log';
import { prisma } from '@/lib/db';

type Props = {
  params: Promise<{ userId: string }>;
};

export default async function AdminUserDetailPage({ params }: Props) {
  const { userId } = await params;

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
        backHref="/admin?section=users"
        backLabel="← Back to Users"
        title={user.name || user.email}
        subtitle="User detail view for subscription state, credits, workspaces, and recent platform activity."
        actions={
          <>
            <Link
              href={`/admin?section=credits&userId=${user.id}`}
              className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
            >
              Open Ledger
            </Link>
            <Link
              href={`/admin?section=users&q=${encodeURIComponent(user.email)}`}
              className="rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white"
            >
              Search in Users
            </Link>
          </>
        }
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Current Credits" value={currentCreditBalance.toLocaleString()} />
        <MetricCard label="Lifetime AI Cost" value={formatUsd(totalAiCost)} />
        <MetricCard label="Total Tokens" value={totalTokens.toLocaleString()} />
        <MetricCard label="Access Status" value={accessState.status} helper={accessState.suspendedReason || `${user._count.workspaces} workspaces`} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
        <Panel title="Profile" subtitle="Core account and access state">
          <KeyValueGrid
            items={[
              { label: 'Email', value: user.email },
              { label: 'User ID', value: user.id },
              { label: 'Role', value: <StatusBadge status={user.role} /> },
              { label: 'Plan', value: <StatusBadge status={user.plan} /> },
              { label: 'Access Status', value: <StatusBadge status={accessState.status} /> },
              { label: 'Created At', value: formatDateTime(user.createdAt) },
              { label: 'Updated At', value: formatDateTime(user.updatedAt) },
              { label: 'Suspended At', value: formatDateTime(accessState.suspendedAt) },
              { label: 'Suspension Reason', value: accessState.suspendedReason || '-' },
            ]}
            columns={2}
          />
        </Panel>

        <Panel title="Subscription" subtitle="Billing-facing state available in the current schema">
          <KeyValueGrid
            items={[
              { label: 'Stripe Customer', value: user.subscription?.stripeCustomerId || '-' },
              { label: 'Stripe Subscription', value: user.subscription?.stripeSubscriptionId || '-' },
              { label: 'Subscription Status', value: user.subscription ? <StatusBadge status={user.subscription.status} /> : 'No subscription' },
              { label: 'Subscription Plan', value: user.subscription?.plan || user.plan },
              { label: 'Period Start', value: formatDateTime(user.subscription?.currentPeriodStart) },
              { label: 'Period End', value: formatDateTime(user.subscription?.currentPeriodEnd) },
            ]}
            columns={2}
          />
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_1fr]">
        <Panel title="Workspaces" subtitle="Current workspaces owned by this user">
          {user.workspaces.length === 0 ? (
            <EmptyState text="No workspaces found for this user." />
          ) : (
            <div className="space-y-3">
              {user.workspaces.map((workspace: any) => (
                <div key={workspace.id} className="rounded-xl border border-gray-200 bg-slate-50 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <Link href={`/admin/workspaces/${workspace.id}`} className="text-sm font-bold text-[#121212] hover:underline">
                        {workspace.name}
                      </Link>
                      <p className="mt-1 text-xs text-slate-500">{workspace.websiteUrl || 'No website URL'}</p>
                    </div>
                    <StatusBadge status={workspace.status} />
                  </div>
                  <div className="mt-3 grid gap-2 sm:grid-cols-3">
                    <InfoPill label="Competitors" value={workspace._count.competitors.toLocaleString()} />
                    <InfoPill label="Content" value={workspace._count.contentItems.toLocaleString()} />
                    <InfoPill label="Updated" value={formatDateTime(workspace.updatedAt)} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel title="Recent AI Usage" subtitle="Latest provider activity and cost trail">
          {recentAiUsage.length === 0 ? (
            <EmptyState text="No AI usage logged yet." />
          ) : (
            <div className="space-y-3">
              {recentAiUsage.map((entry: any) => (
                <div key={entry.id} className="rounded-xl border border-gray-200 bg-slate-50 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-bold text-[#121212]">{entry.feature}</p>
                    <p className="text-xs font-semibold text-slate-500">{formatUsd(Number(entry.estimatedCostUsd))}</p>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    {entry.model} • {entry.totalTokens.toLocaleString()} tokens • {formatDateTime(entry.createdAt)}
                  </p>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_1fr]">
        <Panel title="Recent Content" subtitle="Latest assets generated by this user">
          {recentContent.length === 0 ? (
            <EmptyState text="No content items found." />
          ) : (
            <div className="space-y-3">
              {recentContent.map((item: any) => (
                <div key={item.id} className="rounded-xl border border-gray-200 bg-slate-50 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <Link href={`/admin/content/${item.id}`} className="text-sm font-bold text-[#121212] hover:underline">
                        {item.topic}
                      </Link>
                      <p className="mt-1 text-xs text-slate-500">
                        {item.workspace?.name || 'No workspace'} • {item.channel}
                      </p>
                    </div>
                    <StatusBadge status={item.status} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel title="Recent Jobs" subtitle="Latest content/background jobs for this user">
          {recentJobs.length === 0 ? (
            <EmptyState text="No jobs found." />
          ) : (
            <div className="space-y-3">
              {recentJobs.map((job: any) => (
                <div key={job.id} className="rounded-xl border border-gray-200 bg-slate-50 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-bold text-[#121212]">{job.type}</p>
                      <p className="mt-1 text-xs text-slate-500">{formatDateTime(job.createdAt)}</p>
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

      <Panel title="Activity" subtitle="Recent user and workspace actions recorded in activity logs">
        <LogList rows={activityLogs} />
      </Panel>
    </div>
  );
}
