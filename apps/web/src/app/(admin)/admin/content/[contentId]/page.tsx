import Link from 'next/link';
import { notFound } from 'next/navigation';

import { listContentActivityLogs } from '@/lib/activity-log';
import { prisma } from '@/lib/db';
import {
  getLatestFrameworkMetadataForContentItem,
  listFrameworkMetadataForContentItem,
} from '@/lib/framework-metadata-log';
import {
  EmptyState,
  KeyValueGrid,
  LogList,
  MetricCard,
  PageHeader,
  Panel,
  StatusBadge,
  formatDateTime,
  formatDuration,
  formatUsd,
} from '../../_components/AdminUi';

type Props = {
  params: Promise<{ contentId: string }>;
};

function countWords(value: string | null | undefined): number {
  return String(value || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

export default async function AdminContentDetailPage({ params }: Props) {
  const { contentId } = await params;

  const contentItem = await prisma.contentItem.findUnique({
    where: { id: contentId },
    include: {
      user: {
        select: {
          id: true,
          email: true,
          name: true,
        },
      },
      workspace: {
        select: {
          id: true,
          name: true,
          websiteUrl: true,
        },
      },
    },
  });

  if (!contentItem) notFound();

  const [frameworkMeta, frameworkHistory, contentLogs, relatedJob, aiUsage] = await Promise.all([
    getLatestFrameworkMetadataForContentItem(contentItem.userId, contentId),
    listFrameworkMetadataForContentItem(contentId, 20),
    listContentActivityLogs(contentId, 40),
    contentItem.jobId
      ? prisma.contentJob.findUnique({
          where: { id: contentItem.jobId },
        })
      : null,
    contentItem.jobId
      ? prisma.aiUsageLog.findFirst({
          where: { jobId: contentItem.jobId },
          orderBy: { createdAt: 'desc' },
        })
      : null,
  ]);

  const scheduledSummary = contentItem.scheduledAtUtc
    ? `${formatDateTime(contentItem.scheduledAtUtc)} (${contentItem.scheduledTimezone || 'UTC'})`
    : 'Not scheduled';

  return (
    <div className="space-y-6">
      <PageHeader
        backHref="/admin?section=content"
        backLabel="← Back to Content"
        title={contentItem.topic}
        subtitle="Content detail view for output inspection, schedule state, framework metadata, and related logs."
        actions={
          <>
            {contentItem.workspace ? (
              <Link
                href={`/admin/workspaces/${contentItem.workspace.id}`}
                className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
              >
                Open Workspace
              </Link>
            ) : null}
            <Link
              href={`/admin/users/${contentItem.user.id}`}
              className="rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white"
            >
              Open User
            </Link>
          </>
        }
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Status" value={contentItem.status} />
        <MetricCard label="Word Count" value={countWords(contentItem.content).toLocaleString()} />
        <MetricCard label="Credits Cost" value={contentItem.creditsCost.toLocaleString()} />
        <MetricCard label="AI Cost" value={formatUsd(Number(aiUsage?.estimatedCostUsd ?? 0))} helper={aiUsage ? `${aiUsage.totalTokens.toLocaleString()} tokens` : 'No AI usage log linked'} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
        <Panel title="Metadata" subtitle="Workspace, platform, content type, and generation references">
          <KeyValueGrid
            items={[
              { label: 'Content ID', value: contentItem.id },
              { label: 'Workspace', value: contentItem.workspace ? <Link href={`/admin/workspaces/${contentItem.workspace.id}`} className="font-semibold text-slate-700 hover:underline">{contentItem.workspace.name}</Link> : 'No workspace' },
              { label: 'User', value: <Link href={`/admin/users/${contentItem.user.id}`} className="font-semibold text-slate-700 hover:underline">{contentItem.user.email}</Link> },
              { label: 'Platform', value: contentItem.channel },
              { label: 'Type', value: contentItem.type },
              { label: 'Status', value: <StatusBadge status={contentItem.status} /> },
              { label: 'Created At', value: formatDateTime(contentItem.createdAt) },
              { label: 'Updated At', value: formatDateTime(contentItem.updatedAt) },
            ]}
            columns={2}
          />
        </Panel>

        <Panel title="Schedule & Publish State" subtitle="Current scheduling and publication timestamps">
          <KeyValueGrid
            items={[
              { label: 'Scheduled', value: scheduledSummary },
              { label: 'Published At', value: formatDateTime(contentItem.publishedAtUtc) },
              { label: 'Job ID', value: contentItem.jobId || '-' },
              { label: 'Failure Reason', value: contentItem.failedReason || '-' },
              { label: 'Campaign', value: contentItem.campaign || '-' },
              { label: 'Notes', value: contentItem.notes || '-' },
            ]}
            columns={2}
          />
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <Panel title="Generated Output" subtitle="Current stored content body">
          <pre className="overflow-x-auto whitespace-pre-wrap rounded-xl border border-gray-200 bg-slate-50 p-4 text-[12px] leading-6 text-slate-700">
            {contentItem.content}
          </pre>
        </Panel>

        <Panel title="Framework Metadata" subtitle="Latest framework selection and quality state">
          {frameworkMeta ? (
            <div className="space-y-4">
              <KeyValueGrid
                items={[
                  { label: 'Framework', value: frameworkMeta.frameworkName },
                  { label: 'Framework ID', value: frameworkMeta.frameworkId },
                  { label: 'Category', value: frameworkMeta.frameworkCategory },
                  { label: 'Selection Mode', value: frameworkMeta.selectionMode },
                  { label: 'Goal', value: frameworkMeta.goal || '-' },
                  { label: 'Platform', value: frameworkMeta.platform || '-' },
                  { label: 'Funnel Stage', value: frameworkMeta.funnelStage || '-' },
                  { label: 'Fallback', value: frameworkMeta.fallbackUsed ? 'Yes' : 'No' },
                ]}
                columns={2}
              />
              <pre className="overflow-x-auto whitespace-pre-wrap rounded-xl border border-gray-200 bg-slate-50 p-3 text-[11px] text-slate-600">
                {JSON.stringify(frameworkMeta.qualityScores, null, 2)}
              </pre>
            </div>
          ) : (
            <EmptyState text="No framework metadata recorded for this content item." />
          )}
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_1fr]">
        <Panel title="Related Job" subtitle="Background job linked directly by jobId">
          {relatedJob ? (
            <KeyValueGrid
              items={[
                { label: 'Job Type', value: relatedJob.type },
                { label: 'Status', value: <StatusBadge status={relatedJob.status} /> },
                { label: 'Created At', value: formatDateTime(relatedJob.createdAt) },
                { label: 'Completed At', value: formatDateTime(relatedJob.completedAt) },
                { label: 'Duration', value: formatDuration(relatedJob.completedAt ? new Date(relatedJob.completedAt).getTime() - new Date(relatedJob.createdAt).getTime() : null) },
                { label: 'Credits Cost', value: relatedJob.creditsCost.toLocaleString() },
              ]}
              columns={2}
            />
          ) : (
            <EmptyState text="No direct content job is linked to this item." />
          )}
        </Panel>

        <Panel title="Framework Event History" subtitle="Chronological framework-related events for this content item">
          {frameworkHistory.length === 0 ? (
            <EmptyState text="No framework history found." />
          ) : (
            <div className="space-y-3">
              {frameworkHistory.map((entry: any) => (
                <div key={entry.id} className="rounded-xl border border-gray-200 bg-slate-50 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-bold text-[#121212]">{entry.frameworkName}</p>
                    <p className="text-[11px] text-slate-400">{formatDateTime(entry.createdAt)}</p>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    {entry.eventName} • {entry.selectionMode} • {entry.platform || '-'}
                  </p>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>

      <Panel title="Activity Logs" subtitle="Recent activity log entries that reference this content item">
        <LogList rows={contentLogs} />
      </Panel>
    </div>
  );
}
