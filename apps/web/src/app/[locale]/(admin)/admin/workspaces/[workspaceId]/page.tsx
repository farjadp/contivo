import { getFormatter, getLocale, getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';

import { Link, getPathname } from '@/i18n/navigation';
import { getWorkspaceArchiveState } from '@/lib/admin-state';
import { prisma } from '@/lib/db';
import { listWorkspaceActivityLogsForAdmin } from '@/lib/activity-log';
import { listFrameworkMetadataForWorkspace } from '@/lib/framework-metadata-log';
import {
  EmptyState,
  InfoPill,
  KeyValueGrid,
  LogList,
  MetricCard,
  PageHeader,
  Panel,
  StatusBadge,
  createAdminFormat,
} from '../../_components/AdminUi';

type Props = {
  params: Promise<{ workspaceId: string }>;
};

function stringifyJson(value: unknown): string {
  if (value == null) return '-';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export default async function AdminWorkspaceDetailPage({ params }: Props) {
  const { workspaceId } = await params;
  const t = await getTranslations('admin');
  const locale = await getLocale();
  const fmt = createAdminFormat(await getFormatter(), t);

  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    include: {
      user: {
        select: {
          id: true,
          email: true,
          name: true,
          plan: true,
        },
      },
      competitors: {
        orderBy: { createdAt: 'desc' },
        take: 20,
      },
      strategyRuns: {
        orderBy: { createdAt: 'desc' },
        take: 12,
      },
      contentItems: {
        orderBy: { createdAt: 'desc' },
        take: 20,
      },
      _count: {
        select: {
          competitors: true,
          contentItems: true,
          strategyRuns: true,
          competitorKeywords: true,
          keywordOpportunities: true,
          serpAnalyses: true,
        },
      },
    },
  });

  if (!workspace) notFound();

  const [
    contentStatusGroups,
    activityLogs,
    frameworkEvents,
    keywordOpportunityTop,
    recentSerpAnalyses,
    archiveState,
  ] = await Promise.all([
    prisma.contentItem.groupBy({
      by: ['status'],
      where: { workspaceId },
      _count: { _all: true },
    }),
    listWorkspaceActivityLogsForAdmin(workspaceId, 50),
    listFrameworkMetadataForWorkspace(workspaceId, 25),
    prisma.keywordOpportunity.findMany({
      where: { workspaceId },
      orderBy: { opportunityScore: 'desc' },
      take: 10,
    }),
    prisma.serpAnalysis.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' },
      take: 10,
    }),
    getWorkspaceArchiveState(workspaceId),
  ]);

  const contentCounts = new Map(contentStatusGroups.map((entry: any) => [entry.status, entry._count._all]));

  return (
    <div className="space-y-6">
      <PageHeader
        backHref={`${getPathname({ href: '/admin', locale })}?section=workspaces`}
        backLabel={t('workspaceDetail.back')}
        title={workspace.name}
        subtitle={t('workspaceDetail.subtitle')}
        actions={
          <>
            <Link
              href={{ pathname: '/admin/users/[userId]', params: { userId: workspace.user.id } }}
              className="rounded-xl border border-rule bg-chalk-raised px-4 py-2 text-sm font-semibold text-moss transition hover:border-rule-strong hover:bg-chalk"
            >
              {t('workspaceDetail.viewOwner')}
            </Link>
            <a
              href={workspace.websiteUrl?.startsWith('http') ? workspace.websiteUrl : workspace.websiteUrl ? `https://${workspace.websiteUrl}` : '#'}
              target="_blank"
              rel="noreferrer"
              className="rounded-xl bg-moss px-4 py-2 text-sm font-semibold text-chalk"
            >
              {t('workspaceDetail.openWebsite')}
            </a>
          </>
        }
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label={t('workspaceDetail.competitors')} value={fmt.number(workspace._count.competitors)} />
        <MetricCard label={t('workspaceDetail.contentItems')} value={fmt.number(workspace._count.contentItems)} />
        <MetricCard label={t('workspaceDetail.seoKeywordRows')} value={fmt.number(workspace._count.competitorKeywords)} />
        {/* ARCHIVED / ACTIVE are stored lifecycle values, so the badge keeps them Latin. */}
        <MetricCard label={t('workspaceDetail.archiveState')} value={archiveState.isArchived ? 'ARCHIVED' : 'ACTIVE'} helper={archiveState.archivedReason || undefined} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
        <Panel title={t('workspaceDetail.profileTitle')} subtitle={t('workspaceDetail.profileSubtitle')}>
          <KeyValueGrid
            items={[
              { label: t('workspaceDetail.workspaceId'), value: <span dir="ltr">{workspace.id}</span> },
              { label: t('workspaceDetail.status'), value: <StatusBadge status={workspace.status} /> },
              { label: t('workspaceDetail.archiveStatus'), value: <StatusBadge status={archiveState.isArchived ? 'ARCHIVED' : 'ACTIVE'} /> },
              { label: t('workspaceDetail.owner'), value: <Link href={{ pathname: '/admin/users/[userId]', params: { userId: workspace.user.id } }} className="font-semibold text-moss hover:underline"><bdi>{workspace.user.email}</bdi></Link> },
              { label: t('workspaceDetail.ownerPlan'), value: workspace.user.plan },
              { label: t('workspaceDetail.websiteUrl'), value: workspace.websiteUrl ? <bdi>{workspace.websiteUrl}</bdi> : '-' },
              { label: t('workspaceDetail.createdAt'), value: fmt.dateTime(workspace.createdAt) },
              { label: t('workspaceDetail.updatedAt'), value: fmt.dateTime(workspace.updatedAt) },
              { label: t('workspaceDetail.rescrapeCount'), value: fmt.number(workspace.rescrapeCount) },
              { label: t('workspaceDetail.archivedAt'), value: fmt.dateTime(archiveState.archivedAt) },
              { label: t('workspaceDetail.archiveReason'), value: archiveState.archivedReason || '-' },
            ]}
            columns={2}
          />
        </Panel>

        <Panel title={t('workspaceDetail.pipelineTitle')} subtitle={t('workspaceDetail.pipelineSubtitle')}>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <InfoPill label={t('workspaceDetail.draft')} value={fmt.number(Number(contentCounts.get('DRAFT') || 0))} />
            <InfoPill label={t('workspaceDetail.generated')} value={fmt.number(Number(contentCounts.get('GENERATED') || 0))} />
            <InfoPill label={t('workspaceDetail.scheduled')} value={fmt.number(Number(contentCounts.get('SCHEDULED') || 0))} />
            <InfoPill label={t('workspaceDetail.published')} value={fmt.number(Number(contentCounts.get('PUBLISHED') || 0))} />
          </div>
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_1fr]">
        <Panel title={t('workspaceDetail.brandMemoryTitle')} subtitle={t('workspaceDetail.brandMemorySubtitle')}>
          <div className="space-y-4">
            <pre dir="ltr" className="overflow-x-auto whitespace-pre-wrap rounded-xl border border-rule bg-chalk p-3 text-start text-[11px] text-moss-muted">
              {stringifyJson(workspace.brandSummary)}
            </pre>
            <pre dir="ltr" className="overflow-x-auto whitespace-pre-wrap rounded-xl border border-rule bg-chalk p-3 text-start text-[11px] text-moss-muted">
              {stringifyJson(workspace.archivedSummaries)}
            </pre>
          </div>
        </Panel>

        <Panel title={t('workspaceDetail.competitorsTitle')} subtitle={t('workspaceDetail.competitorsSubtitle')}>
          {workspace.competitors.length === 0 ? (
            <EmptyState text={t('workspaceDetail.noCompetitors')} />
          ) : (
            <div className="space-y-3">
              {workspace.competitors.map((competitor: any) => (
                <div key={competitor.id} className="rounded-xl border border-rule bg-chalk p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-bold text-moss">{competitor.name}</p>
                      <p className="mt-1 text-xs text-moss-muted">{competitor.domain ? <bdi>{competitor.domain}</bdi> : '-'}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {competitor.type ? <StatusBadge status={competitor.type} /> : null}
                      {competitor.userDecision ? <StatusBadge status={competitor.userDecision} /> : null}
                    </div>
                  </div>
                  {competitor.description ? <p className="mt-2 text-xs text-moss-muted">{competitor.description}</p> : null}
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_1fr]">
        <Panel title={t('workspaceDetail.seoTitle')} subtitle={t('workspaceDetail.seoSubtitle')}>
          <div className="space-y-4">
            <div>
              <p className="mb-2 text-xs font-bold uppercase tracking-widest text-moss-muted">{t('workspaceDetail.topOpportunities')}</p>
              {keywordOpportunityTop.length === 0 ? (
                <EmptyState text={t('workspaceDetail.noOpportunities')} />
              ) : (
                <div className="space-y-2">
                  {keywordOpportunityTop.map((item: any) => (
                    <div key={item.id} className="rounded-xl border border-rule bg-chalk p-3">
                      <p className="text-sm font-bold text-moss">{item.keyword}</p>
                      <p className="mt-1 text-xs text-moss-muted">
                        {t('workspaceDetail.opportunityLine', {
                          volume: fmt.number(item.searchVolume),
                          competition: fmt.decimal(item.competition),
                          score: fmt.decimal(item.opportunityScore),
                        })}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div>
              <p className="mb-2 text-xs font-bold uppercase tracking-widest text-moss-muted">{t('workspaceDetail.recentSerp')}</p>
              {recentSerpAnalyses.length === 0 ? (
                <EmptyState text={t('workspaceDetail.noSerp')} />
              ) : (
                <div className="space-y-2">
                  {recentSerpAnalyses.map((entry: any) => (
                    <div key={entry.id} className="rounded-xl border border-rule bg-chalk p-3">
                      <p className="text-sm font-bold text-moss">{entry.keyword}</p>
                      <p className="mt-1 text-xs text-moss-muted">{fmt.dateTime(entry.createdAt)}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </Panel>

        <Panel title={t('workspaceDetail.recentContentTitle')} subtitle={t('workspaceDetail.recentContentSubtitle')}>
          <div className="space-y-4">
            <div>
              <p className="mb-2 text-xs font-bold uppercase tracking-widest text-moss-muted">{t('workspaceDetail.recentContentItems')}</p>
              {workspace.contentItems.length === 0 ? (
                <EmptyState text={t('workspaceDetail.noContent')} />
              ) : (
                <div className="space-y-2">
                  {workspace.contentItems.map((item: any) => (
                    <div key={item.id} className="rounded-xl border border-rule bg-chalk p-3">
                      <div className="flex items-start justify-between gap-3">
                        <Link href={{ pathname: '/admin/content/[contentId]', params: { contentId: item.id } }} className="text-sm font-bold text-moss hover:underline">
                          {item.topic}
                        </Link>
                        <StatusBadge status={item.status} />
                      </div>
                      <p className="mt-1 text-xs text-moss-muted">
                        {t('workspaceDetail.contentLine', { channel: item.channel, date: fmt.dateTime(item.createdAt) })}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div>
              <p className="mb-2 text-xs font-bold uppercase tracking-widest text-moss-muted">{t('workspaceDetail.frameworkEvents')}</p>
              {frameworkEvents.length === 0 ? (
                <EmptyState text={t('workspaceDetail.noFrameworkEvents')} />
              ) : (
                <div className="space-y-2">
                  {frameworkEvents.map((entry: any) => (
                    <div key={entry.id} className="rounded-xl border border-rule bg-chalk p-3">
                      <div className="flex items-start justify-between gap-3">
                        <p className="text-sm font-bold text-moss">{entry.frameworkName}</p>
                        {entry.fallbackUsed ? <StatusBadge status="fallback" /> : null}
                      </div>
                      <p className="mt-1 text-xs text-moss-muted">
                        {t('workspaceDetail.frameworkLine', {
                          event: entry.eventName,
                          platform: entry.platform || '-',
                          date: fmt.dateTime(entry.createdAt),
                        })}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </Panel>
      </div>

      <Panel title={t('workspaceDetail.activityTitle')} subtitle={t('workspaceDetail.activitySubtitle')}>
        <LogList rows={activityLogs} />
      </Panel>
    </div>
  );
}
