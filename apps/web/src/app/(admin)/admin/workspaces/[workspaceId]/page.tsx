import Link from 'next/link';
import { notFound } from 'next/navigation';

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
  formatDateTime,
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

  const contentCounts = new Map(contentStatusGroups.map((entry) => [entry.status, entry._count._all]));

  return (
    <div className="space-y-6">
      <PageHeader
        backHref="/admin?section=workspaces"
        backLabel="← Back to Workspaces"
        title={workspace.name}
        subtitle="Workspace detail view for brand state, competitor intelligence, SEO footprint, and pipeline operations."
        actions={
          <>
            <Link
              href={`/admin/users/${workspace.user.id}`}
              className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
            >
              View Owner
            </Link>
            <a
              href={workspace.websiteUrl?.startsWith('http') ? workspace.websiteUrl : workspace.websiteUrl ? `https://${workspace.websiteUrl}` : '#'}
              target="_blank"
              rel="noreferrer"
              className="rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white"
            >
              Open Website
            </a>
          </>
        }
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Competitors" value={workspace._count.competitors.toLocaleString()} />
        <MetricCard label="Content Items" value={workspace._count.contentItems.toLocaleString()} />
        <MetricCard label="SEO Keyword Rows" value={workspace._count.competitorKeywords.toLocaleString()} />
        <MetricCard label="Archive State" value={archiveState.isArchived ? 'ARCHIVED' : 'ACTIVE'} helper={archiveState.archivedReason || undefined} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
        <Panel title="Workspace Profile" subtitle="Owner, URL, lifecycle state, and timestamps">
          <KeyValueGrid
            items={[
              { label: 'Workspace ID', value: workspace.id },
              { label: 'Status', value: <StatusBadge status={workspace.status} /> },
              { label: 'Archive Status', value: <StatusBadge status={archiveState.isArchived ? 'ARCHIVED' : 'ACTIVE'} /> },
              { label: 'Owner', value: <Link href={`/admin/users/${workspace.user.id}`} className="font-semibold text-slate-700 hover:underline">{workspace.user.email}</Link> },
              { label: 'Owner Plan', value: workspace.user.plan },
              { label: 'Website URL', value: workspace.websiteUrl || '-' },
              { label: 'Created At', value: formatDateTime(workspace.createdAt) },
              { label: 'Updated At', value: formatDateTime(workspace.updatedAt) },
              { label: 'Rescrape Count', value: workspace.rescrapeCount.toLocaleString() },
              { label: 'Archived At', value: formatDateTime(archiveState.archivedAt) },
              { label: 'Archive Reason', value: archiveState.archivedReason || '-' },
            ]}
            columns={2}
          />
        </Panel>

        <Panel title="Content Pipeline Status" subtitle="Current output distribution inside this workspace">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <InfoPill label="Draft" value={String(contentCounts.get('DRAFT') || 0)} />
            <InfoPill label="Generated" value={String(contentCounts.get('GENERATED') || 0)} />
            <InfoPill label="Scheduled" value={String(contentCounts.get('SCHEDULED') || 0)} />
            <InfoPill label="Published" value={String(contentCounts.get('PUBLISHED') || 0)} />
          </div>
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_1fr]">
        <Panel title="Brand Memory" subtitle="Current extracted brand summary and archived versions">
          <div className="space-y-4">
            <pre className="overflow-x-auto whitespace-pre-wrap rounded-xl border border-gray-200 bg-slate-50 p-3 text-[11px] text-slate-600">
              {stringifyJson(workspace.brandSummary)}
            </pre>
            <pre className="overflow-x-auto whitespace-pre-wrap rounded-xl border border-gray-200 bg-slate-50 p-3 text-[11px] text-slate-600">
              {stringifyJson(workspace.archivedSummaries)}
            </pre>
          </div>
        </Panel>

        <Panel title="Competitors" subtitle="Latest discovered competitors and classification">
          {workspace.competitors.length === 0 ? (
            <EmptyState text="No competitors recorded for this workspace." />
          ) : (
            <div className="space-y-3">
              {workspace.competitors.map((competitor) => (
                <div key={competitor.id} className="rounded-xl border border-gray-200 bg-slate-50 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-bold text-[#121212]">{competitor.name}</p>
                      <p className="mt-1 text-xs text-slate-500">{competitor.domain || '-'}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {competitor.type ? <StatusBadge status={competitor.type} /> : null}
                      {competitor.userDecision ? <StatusBadge status={competitor.userDecision} /> : null}
                    </div>
                  </div>
                  {competitor.description ? <p className="mt-2 text-xs text-slate-600">{competitor.description}</p> : null}
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_1fr]">
        <Panel title="SEO Intelligence" subtitle="Gap keywords and latest SERP analysis runs">
          <div className="space-y-4">
            <div>
              <p className="mb-2 text-xs font-bold uppercase tracking-widest text-slate-500">Top Opportunities</p>
              {keywordOpportunityTop.length === 0 ? (
                <EmptyState text="No keyword opportunities generated yet." />
              ) : (
                <div className="space-y-2">
                  {keywordOpportunityTop.map((item) => (
                    <div key={item.id} className="rounded-xl border border-gray-200 bg-slate-50 p-3">
                      <p className="text-sm font-bold text-[#121212]">{item.keyword}</p>
                      <p className="mt-1 text-xs text-slate-500">
                        Volume {item.searchVolume} • Competition {item.competition.toFixed(2)} • Score {item.opportunityScore.toFixed(2)}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div>
              <p className="mb-2 text-xs font-bold uppercase tracking-widest text-slate-500">Recent SERP Analyses</p>
              {recentSerpAnalyses.length === 0 ? (
                <EmptyState text="No SERP analyses recorded yet." />
              ) : (
                <div className="space-y-2">
                  {recentSerpAnalyses.map((entry) => (
                    <div key={entry.id} className="rounded-xl border border-gray-200 bg-slate-50 p-3">
                      <p className="text-sm font-bold text-[#121212]">{entry.keyword}</p>
                      <p className="mt-1 text-xs text-slate-500">{formatDateTime(entry.createdAt)}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </Panel>

        <Panel title="Recent Content & Framework Events" subtitle="Latest content items and framework execution history">
          <div className="space-y-4">
            <div>
              <p className="mb-2 text-xs font-bold uppercase tracking-widest text-slate-500">Recent Content Items</p>
              {workspace.contentItems.length === 0 ? (
                <EmptyState text="No content items found." />
              ) : (
                <div className="space-y-2">
                  {workspace.contentItems.map((item) => (
                    <div key={item.id} className="rounded-xl border border-gray-200 bg-slate-50 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <Link href={`/admin/content/${item.id}`} className="text-sm font-bold text-[#121212] hover:underline">
                          {item.topic}
                        </Link>
                        <StatusBadge status={item.status} />
                      </div>
                      <p className="mt-1 text-xs text-slate-500">{item.channel} • {formatDateTime(item.createdAt)}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div>
              <p className="mb-2 text-xs font-bold uppercase tracking-widest text-slate-500">Framework Events</p>
              {frameworkEvents.length === 0 ? (
                <EmptyState text="No framework events recorded yet." />
              ) : (
                <div className="space-y-2">
                  {frameworkEvents.map((entry) => (
                    <div key={entry.id} className="rounded-xl border border-gray-200 bg-slate-50 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <p className="text-sm font-bold text-[#121212]">{entry.frameworkName}</p>
                        {entry.fallbackUsed ? <StatusBadge status="fallback" /> : null}
                      </div>
                      <p className="mt-1 text-xs text-slate-500">
                        {entry.eventName} • {entry.platform || '-'} • {formatDateTime(entry.createdAt)}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </Panel>
      </div>

      <Panel title="Activity Logs" subtitle="Recent actions recorded against this workspace">
        <LogList rows={activityLogs} />
      </Panel>
    </div>
  );
}
